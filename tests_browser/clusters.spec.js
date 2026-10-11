// Invariante: Nach jedem Zoomen/Schwenken (nach idle) wird jeder aktivierte
// Punkt im Blickfeld genau einmal dargestellt – als Einzelpunkt oder in einem Cluster.
import { expect, test } from "@playwright/test";
import { openCard, representation, usesOwnClusters, waitIdle } from "./harness.js";

// Bekannte Fehler der eigenen Cluster-Berechnung bis 2.0.0 (in Phase 0 reproduziert):
// 1. .ortsnetz-cluster{position:relative} überschreibt .maplibregl-marker{position:absolute};
//    die Marker liegen im Fluss untereinander, nur der erste sitzt richtig, die übrigen
//    sind nach unten verschoben und meist abgeschnitten.
// 2. Marker nur im Sichtbereich plus 15 % Rand: in kleinen Karten fehlen Randpunkte.
// 3. _renderPoints verwirft Daten still, solange Kacheln laden (isStyleLoaded() false).
// test.fail meldet, falls der alte Pfad diese Tests doch besteht.
const KNOWN_OLD_PATH = "bekannter Fehler der eigenen Cluster-Berechnung bis 2.0.0";
async function markKnownFailure(page) {
  test.fail(await usesOwnClusters(page), KNOWN_OLD_PATH);
}

const SIZES = {
  gross: { width: 900, height: 650 },
  // Kleine Karte wie eine halbe Spalte im Sections-Layout auf dem iPad.
  klein: { width: 380, height: 300 },
};

async function check(page, step) {
  const result = await representation(page);
  const summary = JSON.stringify({ ...result, missing: result.missing.slice(0, 10), doubled: result.doubled.slice(0, 10) });
  expect(result.missing, `${step}: fehlende Punkte (${summary})`).toEqual([]);
  expect(result.doubled, `${step}: doppelt dargestellte Punkte (${summary})`).toEqual([]);
  return result;
}

async function zoomTo(page, zoom, animate) {
  await page.evaluate(({ zoom, animate }) => {
    const map = window.__card._map;
    if (animate) map.zoomTo(zoom, { duration: 300 });
    else map.jumpTo({ zoom });
  }, { zoom, animate });
  await waitIdle(page);
}

for (const [label, size] of Object.entries(SIZES)) {
  test.describe(`Karte ${label} (${size.width}×${size.height})`, () => {
    test("zoomTo 12 → 5 → 12, mehrfach", async ({ page }) => {
      await openCard(page, { size, config: { latitude: 52.52, longitude: 13.4, zoom: 12 } });
      await markKnownFailure(page);
      await check(page, "Start");
      for (let round = 0; round < 3; round++) {
        for (const zoom of [11, 10, 9, 8, 7, 6, 5]) {
          await zoomTo(page, zoom, round % 2 === 1);
          await check(page, `Runde ${round} raus auf ${zoom}`);
        }
        for (const zoom of [6, 7, 8, 9, 10, 11, 12]) {
          await zoomTo(page, zoom, round % 2 === 1);
          await check(page, `Runde ${round} rein auf ${zoom}`);
        }
      }
    });

    test("Mausrad raus und rein", async ({ page }) => {
      await openCard(page, { size, config: { latitude: 48.14, longitude: 11.58, zoom: 12 } });
      await markKnownFailure(page);
      const box = await page.locator(".ortsnetz-map").boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < 6; i++) {
          await page.mouse.wheel(0, 300);
          await page.waitForTimeout(150);
          await waitIdle(page);
          await check(page, `Runde ${round} Mausrad raus ${i}`);
        }
        for (let i = 0; i < 6; i++) {
          await page.mouse.wheel(0, -300);
          await page.waitForTimeout(150);
          await waitIdle(page);
          await check(page, `Runde ${round} Mausrad rein ${i}`);
        }
      }
    });

    test("fitBounds und Schwenken", async ({ page }) => {
      await openCard(page, { size, config: { latitude: 50.94, longitude: 6.96, zoom: 12 } });
      await markKnownFailure(page);
      const views = [
        [[5.8, 47.2], [15.1, 55.0]],
        [[13.2, 52.4], [13.6, 52.6]],
        [[9.5, 53.3], [10.5, 53.8]],
        [[6.0, 48.0], [12.0, 51.0]],
      ];
      for (let round = 0; round < 2; round++) {
        for (const bounds of views) {
          await page.evaluate((bounds) => window.__card._map.fitBounds(bounds, { duration: 200 }), bounds);
          await waitIdle(page);
          await check(page, `fitBounds ${JSON.stringify(bounds)}`);
          await page.evaluate(() => window.__card._map.panBy([180, -120], { duration: 150 }));
          await waitIdle(page);
          await check(page, `Schwenken nach ${JSON.stringify(bounds)}`);
        }
      }
    });
  });
}

test("Legendenfilter und Theme-Wechsel", async ({ page }) => {
  await openCard(page, { size: SIZES.gross, config: { latitude: 51.0, longitude: 10.0, zoom: 6 } });
  await markKnownFailure(page);
  await check(page, "Start");
  await page.evaluate(() => {
    const input = window.__card.querySelector('.ortsnetz-legend input[data-status="normal"]');
    input.checked = false;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitIdle(page);
  await check(page, "Filter normal aus");

  await page.evaluate(() => { window.__card.hass = { ...window.__card._hass, themes: { darkMode: true } }; });
  await page.waitForFunction(() => window.__card._map.getStyle()?.layers?.some((layer) => layer.paint?.["background-color"] === "#333"));
  await waitIdle(page);
  await check(page, "dunkles Theme");
  for (const zoom of [8, 11, 13, 9, 5]) {
    await zoomTo(page, zoom, false);
    await check(page, `dunkles Theme, Zoom ${zoom}`);
  }
});

test("Diagnosezeile mit debug: true", async ({ page }) => {
  await openCard(page, { size: SIZES.gross, config: { latitude: 51.0, longitude: 10.0, zoom: 6, debug: true } });
  const text = await page.locator(".ortsnetz-debug").textContent();
  expect(text).toMatch(/^Zoom 6,0 · \d+ Punkte gesetzt · \d+ Cluster · \d+ Einzel sichtbar$/);
  const result = await representation(page);
  expect(text).toContain(`${result.singles} Einzel sichtbar`);
  // Die Cluster-Zahl ist nur bei MapLibre-Clustern genau die sichtbare Menge.
  if (!(await usesOwnClusters(page))) expect(text).toContain(`${result.clusters} Cluster ·`);
});

test("Daten, die eintreffen, während Kacheln laden, werden trotzdem gezeichnet", async ({ page }) => {
  await openCard(page, { size: SIZES.gross, config: { latitude: 51.0, longitude: 10.0, zoom: 6 }, tileDelay: 1500, holdData: true });
  await markKnownFailure(page);
  // Neue Kacheln anfordern, dann die Daten liefern, solange sie noch laden.
  await page.evaluate(() => window.__card._map.jumpTo({ zoom: 7 }));
  await page.waitForFunction(() => !window.__card._map.isStyleLoaded());
  await page.evaluate(() => window.__releaseData());
  await page.waitForFunction(() => window.__card._currentData);
  await waitIdle(page);
  const result = await check(page, "nach dem Laden der Kacheln");
  expect(result.expected).toBeGreaterThan(0);
});
