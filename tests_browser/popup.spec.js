// Popup eines Messpunkts: muss mit 12 px Rand vollständig in der Karte liegen,
// vor und nach dem Nachladen des Verlaufs, ohne dass der angetippte Punkt das
// Blickfeld verlässt.
import { expect, test } from "@playwright/test";
import { openCard, waitIdle } from "./harness.js";

const MARGIN = 12;
const SIZES = {
  gross: { width: 900, height: 650 },
  klein: { width: 380, height: 300 },
};

// Zielposition des Punkts auf der Karte (Bruchteile von Breite/Höhe bzw. Pixel vom Rand).
const POSITIONS = {
  oben: (w, h) => [w / 2, 22],
  unten: (w, h) => [w / 2, h - 22],
  links: (w, h) => [22, h / 2],
  rechts: (w, h) => [w - 22, h * 0.3],
  mitte: (w, h) => [w / 2, h / 2],
};

// Schiebt die Karte so, dass ein einzelner Messpunkt an (x, y) liegt, und gibt ihn zurück.
async function placePoint(page, [x, y]) {
  await page.evaluate(([x, y]) => {
    const card = window.__card;
    const map = card._map;
    // Ein Punkt ohne Nachbarn im Umkreis von 0,01°: wird bei Zoom 13 sicher einzeln gezeichnet.
    const points = card._allFeatures.map((f) => f.geometry.coordinates);
    const lonely = points.find(([lng, lat]) => points.every(([l2, b2]) => (l2 === lng && b2 === lat) || Math.hypot(l2 - lng, b2 - lat) > 0.01));
    map.jumpTo({ center: lonely, zoom: 13 });
    const canvas = map.getCanvas();
    map.panBy([canvas.clientWidth / 2 - x, canvas.clientHeight / 2 - y], { duration: 0 });
    window.__target = lonely;
  }, [x, y]);
  await waitIdle(page);
}

async function geometry(page) {
  return page.evaluate(() => {
    const card = window.__card;
    const map = card._map;
    const box = card.querySelector(".ortsnetz-map").getBoundingClientRect();
    const element = card._popup?.getElement();
    if (!element?.isConnected) return null;
    const rect = element.getBoundingClientRect();
    const at = map.project(card._popup.getLngLat());
    const close = element.querySelector(".maplibregl-popup-close-button").getBoundingClientRect();
    return {
      popup: { left: rect.left - box.left, top: rect.top - box.top, right: rect.right - box.left, bottom: rect.bottom - box.top },
      close: { left: close.left - box.left, top: close.top - box.top, right: close.right - box.left, bottom: close.bottom - box.top },
      point: { x: at.x, y: at.y },
      width: box.width,
      height: box.height,
      charts: Boolean(element.querySelector(".popup-charts svg")),
    };
  });
}

function expectInside(g, step) {
  const info = `${step}: ${JSON.stringify(g)}`;
  expect(g, info).not.toBeNull();
  expect(g.popup.left, info).toBeGreaterThanOrEqual(MARGIN - 1);
  expect(g.popup.top, info).toBeGreaterThanOrEqual(MARGIN - 1);
  expect(g.popup.right, info).toBeLessThanOrEqual(g.width - MARGIN + 1);
  expect(g.popup.bottom, info).toBeLessThanOrEqual(g.height - MARGIN + 1);
  // Schließen-Kreuz sichtbar in der Karte, angetippter Punkt im Blickfeld.
  expect(g.close.top, info).toBeGreaterThanOrEqual(0);
  expect(g.close.right, info).toBeLessThanOrEqual(g.width);
  expect(g.point.x, info).toBeGreaterThanOrEqual(0);
  expect(g.point.x, info).toBeLessThanOrEqual(g.width);
  expect(g.point.y, info).toBeGreaterThanOrEqual(0);
  expect(g.point.y, info).toBeLessThanOrEqual(g.height);
}

for (const [label, size] of Object.entries(SIZES)) {
  test(`Popup bleibt in der Karte (${label} ${size.width}×${size.height})`, async ({ page }) => {
    await openCard(page, { size, holdHistory: true, config: { latitude: 52.52, longitude: 13.4, zoom: 13, show_legend: false } });
    const box = await page.locator(".ortsnetz-map").boundingBox();
    for (const [where, position] of Object.entries(POSITIONS)) {
      await page.evaluate(() => window.__card._popup?.remove());
      await page.evaluate(() => { window.__historyReleased = new Promise((resolve) => { window.__releaseHistory = resolve; }); });
      const [x, y] = position(size.width, size.height);
      await placePoint(page, [x, y]);
      await page.mouse.click(box.x + x, box.y + y);
      await page.waitForFunction(() => window.__card._popup?.getElement()?.isConnected);
      await waitIdle(page);
      expectInside(await geometry(page), `${where}, vor dem Verlauf`);

      await page.evaluate(() => window.__releaseHistory());
      await page.waitForFunction(() => window.__card._popup.getElement().querySelector(".popup-charts svg"));
      await waitIdle(page);
      const after = await geometry(page);
      expect(after.charts).toBe(true);
      expectInside(after, `${where}, nach dem Verlauf`);
    }
  });
}
