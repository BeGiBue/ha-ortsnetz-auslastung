// Konfiguration zur Laufzeit ändern (wie beim Bearbeiten im Dashboard-Editor):
// dieselbe Karte bleibt erhalten, nur das Geänderte wird angepasst.
import { expect, test } from "@playwright/test";
import { openCard, representation, waitIdle } from "./harness.js";

test("setConfig passt Kamera, Anzeige und Gesten an, ohne die Karte neu aufzubauen", async ({ page }) => {
  await openCard(page, { size: { width: 900, height: 650 }, config: { latitude: 51.0, longitude: 10.0, zoom: 6 } });
  await page.evaluate(() => { window.__firstMap = window.__card._map; });

  await page.evaluate(() => window.__card.setConfig({ latitude: 52.52, longitude: 13.4, zoom: 9, show_legend: false, cooperative_gestures: false, phase: "L1" }));
  await waitIdle(page);
  const state = await page.evaluate(() => {
    const card = window.__card;
    const map = card._map;
    return {
      same: map === window.__firstMap,
      zoom: map.getZoom(),
      center: map.getCenter().toArray().map((v) => Number(v.toFixed(2))),
      legendHidden: card.querySelector(".ortsnetz-legend").hidden,
      cooperative: map.cooperativeGestures.isEnabled(),
    };
  });
  expect(state).toEqual({ same: true, zoom: 9, center: [13.4, 52.52], legendHidden: true, cooperative: false });
  const result = await representation(page);
  expect(result.missing).toEqual([]);
});

test("Quellenangabe ist kompakt und sichtbar", async ({ page }) => {
  await openCard(page, { size: { width: 900, height: 650 }, config: { latitude: 51.0, longitude: 10.0, zoom: 6 } });
  const attribution = page.locator(".maplibregl-ctrl-attrib");
  await expect(attribution).toBeVisible();
  await expect(attribution).toHaveClass(/maplibregl-compact/);
  await expect(attribution).toContainText("MapLibre");
});

test("Quellenangabe bleibt im Ersatzstil sichtbar", async ({ page }) => {
  await openCard(page, { size: { width: 380, height: 300 }, config: { latitude: 51.0, longitude: 10.0, zoom: 6 }, styleFail: true, waitReady: false });
  await page.waitForFunction(() => window.__card?._fallbackActive && window.__card._map.getSource("ortsnetz-points"));
  await waitIdle(page);
  await expect(page.locator(".maplibregl-ctrl-attrib")).toBeVisible();
});

// Legende und Statuszeile dürfen das (i) bzw. die aufgeklappte Quellenangabe nicht verdecken.
for (const size of [{ width: 380, height: 300 }, { width: 900, height: 650 }]) {
  test(`Legende und Status überdecken die Quellenangabe nicht (${size.width}×${size.height})`, async ({ page }) => {
    await openCard(page, { size, config: { latitude: 51.0, longitude: 10.0, zoom: 6 } });
    const overlaps = () => page.evaluate(() => {
      const card = window.__card;
      const attrib = card.querySelector(".maplibregl-ctrl-attrib").getBoundingClientRect();
      const hit = (el) => {
        const r = el.getBoundingClientRect();
        return r.left < attrib.right && r.right > attrib.left && r.top < attrib.bottom && r.bottom > attrib.top;
      };
      return {
        expanded: card.querySelector(".maplibregl-ctrl-attrib").classList.contains("maplibregl-compact-show"),
        legend: hit(card.querySelector(".ortsnetz-legend")),
        status: hit(card.querySelector(".ortsnetz-status")),
      };
    });
    const toggle = page.locator(".maplibregl-ctrl-attrib-button");
    for (let i = 0; i < 2; i++) {
      await page.waitForTimeout(200);
      const state = await overlaps();
      expect({ legend: state.legend, status: state.status }, `aufgeklappt: ${state.expanded}`).toEqual({ legend: false, status: false });
      await toggle.click({ force: true });
    }
  });
}
