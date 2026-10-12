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
      userMoved: Boolean(card._popupUserMoved),
      moving: map.isMoving(),
      pans: window.__pans || [],
      anchor: [...element.classList].find((name) => name.startsWith("maplibregl-popup-anchor-")),
      // Liegt etwas (Legende, Statuszeile) über dem Popup? Ecken des Inhalts und das Kreuz prüfen.
      covered: (() => {
        const root = card.getRootNode();
        const content = element.querySelector(".maplibregl-popup-content").getBoundingClientRect();
        // Raster im Abstand von 16 px über den ganzen Inhalt, dazu das Kreuz. Die Statuszeile
        // hat pointer-events:none und wird hier nicht erkannt; sie liegt wie die Legende auf z-index 5.
        const spots = { kreuz: [close.left + close.width / 2, close.top + close.height / 2] };
        for (let y = content.top + 4; y < content.bottom - 2; y += 16) {
          for (let x = content.left + 4; x < content.right - 2; x += 16) spots[`${Math.round(x - content.left)},${Math.round(y - content.top)}`] = [x, y];
        }
        return Object.entries(spots)
          .filter(([, [x, y]]) => !root.elementFromPoint(x, y)?.closest(".maplibregl-popup"))
          .map(([name, [x, y]]) => `${name}: ${root.elementFromPoint(x, y)?.className}`)
          .slice(0, 5);
      })(),
    };
  });
}

// Wartet, bis die Karte ruht und das Popup seine Lage 300 ms lang nicht mehr ändert
// (die Card verschiebt die Karte erst im nächsten Frame und animiert 250 ms).
async function settle(page) {
  let previous = "";
  for (let i = 0; i < 40; i++) {
    await waitIdle(page);
    await page.waitForTimeout(300);
    const now = await page.evaluate(() => {
      const map = window.__card._map;
      const rect = window.__card._popup?.getElement()?.getBoundingClientRect();
      return JSON.stringify([map.isMoving(), rect && [rect.left, rect.top, rect.right, rect.bottom]]);
    });
    if (now === previous && !JSON.parse(now)[0]) return;
    previous = now;
  }
  throw new Error("Popup kommt nicht zur Ruhe");
}

function expectInside(g, step) {
  const info = `${step}: ${JSON.stringify(g)}`;
  expect(g, info).not.toBeNull();
  expect(g.covered, info).toEqual([]);
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
    await openCard(page, { size, holdHistory: true, config: { latitude: 52.52, longitude: 13.4, zoom: 13 } });
    const box = await page.locator(".ortsnetz-map").boundingBox();
    // Protokoll der Verschiebungen und Nutzerbewegungen für Fehlermeldungen.
    await page.evaluate(() => {
      const map = window.__card._map;
      const panBy = map.panBy.bind(map);
      map.panBy = (offset, options) => { (window.__pans ||= []).push(offset); return panBy(offset, options); };
      map.on("movestart", (event) => { if (event.originalEvent) (window.__pans ||= []).push(`Nutzer:${event.originalEvent.type}`); });
    });
    for (const [where, position] of Object.entries(POSITIONS)) {
      await page.evaluate(() => { window.__card._popup?.remove(); window.__pans = []; });
      await page.evaluate(() => { window.__historyReleased = new Promise((resolve) => { window.__releaseHistory = resolve; }); });
      const [x, y] = position(size.width, size.height);
      await placePoint(page, [x, y]);
      await page.mouse.click(box.x + x, box.y + y);
      await page.waitForFunction(() => window.__card._popup?.getElement()?.isConnected);
      await settle(page);
      const before = await geometry(page);
      expectInside(before, `${where}, vor dem Verlauf`);

      await page.evaluate(() => window.__releaseHistory());
      await page.waitForFunction(() => window.__card._popup.getElement().querySelector(".popup-charts svg"));
      await settle(page);
      const after = await geometry(page);
      expect(after.charts).toBe(true);
      expectInside(after, `${where}, nach dem Verlauf`);
      // Keine Layout-Sprünge: die Ankerseite bleibt beim Wachsen gleich.
      expect(after.anchor, where).toBe(before.anchor);
    }
  });
}

test("Hat der Nutzer die Karte bewegt, verschiebt die Card sie nicht mehr", async ({ page }) => {
  const size = SIZES.klein;
  await openCard(page, { size, holdHistory: true, config: { latitude: 52.52, longitude: 13.4, zoom: 13, show_legend: false } });
  const box = await page.locator(".ortsnetz-map").boundingBox();
  // Punkt oben: nach dem Verlauf wäre eine Verschiebung nötig.
  const [x, y] = POSITIONS.oben(size.width, size.height);
  await placePoint(page, [x, y]);
  await page.mouse.click(box.x + x, box.y + y);
  await page.waitForFunction(() => window.__card._popup?.getElement()?.isConnected);
  await settle(page);

  // Nutzer zieht die Karte neben dem Popup ein Stück nach oben.
  await page.mouse.move(box.x + size.width - 15, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + size.width - 15, box.y + 150, { steps: 5 });
  await page.mouse.up();
  await settle(page);
  const center = await page.evaluate(() => window.__card._map.getCenter().toArray());

  await page.evaluate(() => window.__releaseHistory());
  await page.waitForFunction(() => window.__card._popup.getElement().querySelector(".popup-charts svg"));
  await settle(page);
  const state = await page.evaluate(() => ({ center: window.__card._map.getCenter().toArray(), userMoved: window.__card._popupUserMoved }));
  expect(state.userMoved).toBe(true);
  expect(state.center).toEqual(center);
});
