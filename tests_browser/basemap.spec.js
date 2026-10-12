// Kartenhintergrund nicht erreichbar (Pi-hole, offline, App ohne Internet):
// Messpunkte müssen trotzdem geladen und gezeichnet werden, die Statuszeile
// erklärt das Problem, und kommt das Netz zurück, kehrt der echte Stil wieder.
import { expect, test } from "@playwright/test";
import { openCard, representation, waitIdle } from "./harness.js";

const SIZE = { width: 900, height: 650 };
const CONFIG = { latitude: 51.0, longitude: 10.0, zoom: 6 };
const FALLBACK_LIGHT = "#e5e7eb";
const FALLBACK_DARK = "#1f2937";

async function expectAllShown(page, step) {
  const result = await representation(page);
  expect(result.expected, step).toBeGreaterThan(0);
  expect(result.missing, `${step}: ${JSON.stringify({ ...result, missing: result.missing.slice(0, 10) })}`).toEqual([]);
  expect(result.doubled, step).toEqual([]);
  return result;
}

async function background(page) {
  return page.evaluate(() => {
    const layers = window.__card._map.getStyle()?.layers || [];
    return layers.find((layer) => layer.type === "background")?.paint?.["background-color"] ?? null;
  });
}

async function status(page) {
  return page.locator(".ortsnetz-status").textContent();
}

// Wartet, bis Daten da sind und die eigene Quelle in der Karte liegt.
async function waitForPoints(page) {
  await page.waitForFunction(() => window.__card?._currentData && window.__card._map?.getSource("ortsnetz-points"), null, { timeout: 30000 });
  await waitIdle(page);
}

test("Stil nicht erreichbar: Punkte auf neutralem Hintergrund, Erklärung, später echter Stil", async ({ page }) => {
  await openCard(page, { size: SIZE, config: CONFIG, styleFail: true, waitReady: false });
  await waitForPoints(page);

  expect(await background(page)).toBe(FALLBACK_LIGHT);
  const shown = await expectAllShown(page, "Ersatzstil hell");
  expect(shown.clusters).toBeGreaterThan(0);
  await expect(page.locator(".ortsnetz-status")).toContainText("Kartenhintergrund nicht erreichbar");
  await expect(page.locator(".ortsnetz-status")).toContainText("700 Messpunkte");
  // Ohne Glyphen im Ersatzstil gibt es keinen Zähler-Layer.
  expect(await page.evaluate(() => Boolean(window.__card._map.getLayer("ortsnetz-cluster-count")))).toBe(false);

  // Theme-Wechsel bei weiter fehlendem Netz: dunkler Ersatzstil.
  await page.evaluate(() => { window.__card.hass = { ...window.__card._hass, themes: { darkMode: true } }; });
  await page.waitForFunction((color) => window.__card._map.getStyle()?.layers?.some((l) => l.paint?.["background-color"] === color), FALLBACK_DARK);
  await waitIdle(page);
  await expectAllShown(page, "Ersatzstil dunkel");

  // Netz wieder da: der nächste Theme-Wechsel lädt den echten Stil.
  page.ortsnetzNet.styleFail = false;
  await page.evaluate(() => { window.__card.hass = { ...window.__card._hass, themes: { darkMode: false } }; });
  await page.waitForFunction(() => window.__card._map.getStyle()?.layers?.some((l) => l.paint?.["background-color"] === "#ddd"));
  await waitIdle(page);
  await expectAllShown(page, "echter Stil zurück");
  expect(await page.evaluate(() => Boolean(window.__card._map.getLayer("ortsnetz-cluster-count")))).toBe(true);
  await expect(page.locator(".ortsnetz-status")).not.toContainText("nicht erreichbar");
});

test("Kacheln liefern 404: Daten werden trotzdem geladen und gezeichnet", async ({ page }) => {
  // MapLibre wertet 404 als "hier gibt es keine Kachel" und meldet keinen Fehler;
  // "load" feuert dann in Chromium trotzdem nicht. Die Daten müssen dennoch kommen.
  await openCard(page, { size: SIZE, config: CONFIG, tilesFail: "404", waitReady: false });
  await waitForPoints(page);
  await expectAllShown(page, "Kacheln 404");
  await expect(page.locator(".ortsnetz-status")).toContainText("700 Messpunkte");
});

test("Kacheln nicht erreichbar: Daten, Erklärung, keine Konsolenflut", async ({ page }) => {
  const messages = [];
  page.on("console", (message) => { if (message.type() === "error") messages.push(message.text()); });
  await openCard(page, { size: SIZE, config: CONFIG, tilesFail: "refused", waitReady: false });
  await waitForPoints(page);

  await expectAllShown(page, "Kacheln fehlen");
  await expect(page.locator(".ortsnetz-status")).toContainText("Kartenhintergrund nicht erreichbar");
  await expect(page.locator(".ortsnetz-status")).toContainText("700 Messpunkte");

  // Zoomen lädt weitere (fehlende) Kacheln: MapLibre schreibt dazu nichts auf die Konsole.
  for (const zoom of [7, 8, 9]) {
    await page.evaluate((zoom) => window.__card._map.jumpTo({ zoom }), zoom);
    await waitIdle(page);
  }
  await expectAllShown(page, "nach dem Zoomen");
  const fromMapLibre = messages.filter((text) => !text.startsWith("Failed to load resource"));
  expect(fromMapLibre).toEqual([]);

  // Netz wieder da: sobald eine Kachel lädt, verschwindet der Hinweis.
  page.ortsnetzNet.tilesFail = false;
  await page.evaluate(() => window.__card._map.jumpTo({ zoom: 10 }));
  await waitIdle(page);
  await expect(page.locator(".ortsnetz-status")).not.toContainText("nicht erreichbar");
});
