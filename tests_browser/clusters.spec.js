// Invariante: Nach jedem Zoomen/Schwenken (nach idle) wird jeder aktivierte
// Punkt im Blickfeld genau einmal dargestellt – als Einzelpunkt oder in einem Cluster.
import { expect, test } from "@playwright/test";
import { openCard, representation, waitIdle } from "./harness.js";

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
      const box = await page.locator(".ortsnetz-map").boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      // Kooperative Gesten (Standard): Zoomen mit dem Mausrad nur mit Strg.
      await page.keyboard.down("Control");
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
  const result = await representation(page);
  expect(text).toBe(`Zoom 6,0 · 700 Punkte gesetzt · ${result.clusters} Cluster (${result.clusterPointSum} Punkte) · ${result.singles} Einzel sichtbar`);
});

test("Cluster zählen je Status genau ihre Punkte, Farbe nach dem schlechtesten", async ({ page }) => {
  await openCard(page, { size: SIZES.gross, config: { latitude: 51.0, longitude: 10.0, zoom: 6 } });
  for (const zoom of [5, 7, 9, 11]) {
    await zoomTo(page, zoom, false);
    const problems = await page.evaluate(async () => {
      const map = window.__card._map;
      const source = map.getSource("ortsnetz-points");
      const statuses = ["crit_low", "warn_low", "normal", "warn_high", "crit_high"];
      const out = [];
      for (const feature of map.queryRenderedFeatures({ layers: ["ortsnetz-clusters"] })) {
        const p = feature.properties;
        const leaves = await source.getClusterLeaves(p.cluster_id, Infinity, 0);
        const counts = Object.fromEntries(statuses.map((s) => [s, 0]));
        let worst = 0;
        for (const leaf of leaves) {
          counts[leaf.properties.status] += 1;
          worst = Math.max(worst, leaf.properties.rank);
        }
        const got = Object.fromEntries(statuses.map((s) => [s, p[s]]));
        if (JSON.stringify(got) !== JSON.stringify(counts) || p.worst !== worst || p.point_count !== leaves.length) {
          out.push({ id: p.cluster_id, got, counts, worst: p.worst, expectedWorst: worst });
        }
      }
      return out;
    });
    expect(problems, `Zoom ${zoom}`).toEqual([]);
  }
});

test("Ist die Schrift für den Zähler nicht ladbar, bleiben alle Punkte sichtbar", async ({ page }) => {
  await openCard(page, { size: SIZES.gross, config: { latitude: 52.52, longitude: 13.4, zoom: 12 }, glyphsFail: true });
  for (const zoom of [11, 9, 7, 5, 8, 12]) {
    await zoomTo(page, zoom, false);
    await check(page, `Schrift fehlt, Zoom ${zoom}`);
  }
});

test("Daten, die eintreffen, während Kacheln laden, werden trotzdem gezeichnet", async ({ page }) => {
  await openCard(page, { size: SIZES.gross, config: { latitude: 51.0, longitude: 10.0, zoom: 6 }, tileDelay: 1500, holdData: true });
  // Neue Kacheln anfordern, dann die Daten liefern, solange sie noch laden.
  await page.evaluate(() => window.__card._map.jumpTo({ zoom: 7 }));
  await page.waitForFunction(() => !window.__card._map.isStyleLoaded());
  await page.evaluate(() => window.__releaseData());
  await page.waitForFunction(() => window.__card._currentData);
  await waitIdle(page);
  const result = await check(page, "nach dem Laden der Kacheln");
  expect(result.expected).toBeGreaterThan(0);
});

test("Klick auf Cluster zoomt hinein, Tipp neben einen Einzelpunkt öffnet das Popup", async ({ page }) => {
  await openCard(page, { size: SIZES.gross, config: { latitude: 51.0, longitude: 10.0, zoom: 6 } });
  const box = await page.locator(".ortsnetz-map").boundingBox();

  // Cluster nahe der Mitte anklicken.
  const cluster = await page.evaluate(() => {
    const map = window.__card._map;
    const canvas = map.getCanvas();
    const center = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    const features = map.queryRenderedFeatures({ layers: ["ortsnetz-clusters"] });
    const at = features.map((f) => map.project(f.geometry.coordinates))
      .filter((p) => p.x > 60 && p.y > 60 && p.x < canvas.clientWidth - 60 && p.y < canvas.clientHeight - 60)
      .sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y))[0];
    return { x: at.x, y: at.y, zoom: map.getZoom() };
  });
  await page.mouse.click(box.x + cluster.x, box.y + cluster.y);
  await page.waitForFunction((zoom) => window.__card._map.getZoom() > zoom + 0.5, cluster.zoom);
  await waitIdle(page);

  // Bis Einzelpunkte sichtbar sind, dann 8 px daneben tippen.
  await page.evaluate(() => window.__card._map.jumpTo({ center: [13.4, 52.52], zoom: 13 }));
  await waitIdle(page);
  const single = await page.evaluate(() => {
    const map = window.__card._map;
    const canvas = map.getCanvas();
    const feature = map.queryRenderedFeatures({ layers: ["ortsnetz-points"] })
      .map((f) => ({ id: f.properties.public_id, at: map.project(f.geometry.coordinates) }))
      .find((f) => f.at.x > 40 && f.at.y > 40 && f.at.x < canvas.clientWidth - 40 && f.at.y < canvas.clientHeight - 40);
    return feature && { x: feature.at.x, y: feature.at.y };
  });
  expect(single).toBeTruthy();
  // 9 px diagonal daneben (knapp 13 px vom Mittelpunkt): außerhalb kleiner Punkte, im Treffbereich.
  await page.mouse.click(box.x + single.x + 9, box.y + single.y + 9);
  await expect(page.locator(".maplibregl-popup .popup-title")).toHaveText("Ortsnetz-Messpunkt");
});
