// Cluster als Tortendiagramme (HTML-Marker über dem Cluster-Kreis).
// Lehre aus 2.0.0: Marker müssen sichtbar an ihrer Kartenposition sitzen – das wird hier
// für jeden Cluster geprüft, auch während einer Bewegung.
import { expect, test } from "@playwright/test";
import { openCard, representation, waitIdle } from "./harness.js";

const SIZES = { gross: { width: 900, height: 650 }, klein: { width: 380, height: 300 } };

// Je gerendertem Cluster: passende Torte vorhanden, an der richtigen Stelle, mit den
// Zählern des Clusters; keine Torten ohne Cluster.
async function pieState(page) {
  return page.evaluate(() => {
    const card = window.__card;
    const map = card._map;
    const box = card.querySelector(".ortsnetz-map").getBoundingClientRect();
    const statuses = ["crit_low", "warn_low", "normal", "warn_high", "crit_high"];
    const clusters = new Map();
    for (const f of map.queryRenderedFeatures({ layers: ["ortsnetz-clusters"] })) clusters.set(String(f.properties.cluster_id), f);
    const pies = [...card.querySelectorAll(".ortsnetz-pie")];
    const problems = [];
    const seen = new Set();
    for (const pie of pies) {
      const id = pie.dataset.clusterId;
      if (seen.has(id)) problems.push(`Torte ${id} doppelt`);
      seen.add(id);
      const feature = clusters.get(id);
      if (!feature) { problems.push(`Torte ${id} ohne Cluster`); continue; }
      const r = pie.getBoundingClientRect();
      const at = map.project(feature.geometry.coordinates);
      const dx = r.left + r.width / 2 - (box.left + at.x);
      const dy = r.top + r.height / 2 - (box.top + at.y);
      if (Math.hypot(dx, dy) > 1.5) problems.push(`Torte ${id} versetzt um ${dx.toFixed(1)}/${dy.toFixed(1)}`);
      const counts = Object.fromEntries([...pie.querySelectorAll("[data-status]")].map((el) => [el.dataset.status, Number(el.dataset.count)]));
      let sum = 0;
      for (const s of statuses) {
        const expected = feature.properties[s] || 0;
        sum += counts[s] || 0;
        if ((counts[s] || 0) !== expected) problems.push(`Torte ${id}: ${s} ${counts[s] || 0} statt ${expected}`);
      }
      if (sum !== feature.properties.point_count) problems.push(`Torte ${id}: Summe ${sum} statt ${feature.properties.point_count}`);
    }
    for (const [id, feature] of clusters) {
      const at = map.project(feature.geometry.coordinates);
      const inside = at.x >= 0 && at.y >= 0 && at.x <= box.width && at.y <= box.height;
      if (inside && !seen.has(id)) problems.push(`Cluster ${id} ohne Torte`);
    }
    return { pies: pies.length, clusters: clusters.size, problems };
  });
}

for (const [label, size] of Object.entries(SIZES)) {
  test(`Torten sitzen auf ihren Clustern und stimmen mit den Zählern (${label})`, async ({ page }) => {
    await openCard(page, { size, config: { latitude: 51.0, longitude: 10.0, zoom: 5 } });
    for (const zoom of [5, 6.5, 8, 9.5, 11, 12, 7]) {
      await page.evaluate((zoom) => window.__card._map.jumpTo({ zoom }), zoom);
      await waitIdle(page);
      const state = await pieState(page);
      expect(state.problems, `Zoom ${zoom}`).toEqual([]);
      if (zoom < 12) expect(state.pies, `Zoom ${zoom}`).toBeGreaterThan(0);
      else expect(state.pies, "ab Zoom 12 keine Cluster").toBe(0);
      const result = await representation(page);
      expect(result.missing, `Invariante bei Zoom ${zoom}`).toEqual([]);
    }
  });
}

test("Torten folgen der Karte während der Bewegung und werden nicht neu aufgebaut", async ({ page }) => {
  await openCard(page, { size: SIZES.gross, config: { latitude: 51.0, longitude: 10.0, zoom: 7 } });
  // Während einer animierten Verschiebung in jedem Frame: Torte sitzt auf ihrem Cluster.
  const worst = await page.evaluate(() => new Promise((resolve) => {
    const card = window.__card;
    const map = card._map;
    const box = card.querySelector(".ortsnetz-map").getBoundingClientRect();
    const before = new Map([...card.querySelectorAll(".ortsnetz-pie")].map((el) => [el.dataset.clusterId, el]));
    let max = 0;
    let frames = 0;
    let replaced = 0;
    const sample = () => {
      for (const marker of card._pieMarkers.values()) {
        const el = marker.getElement().querySelector(".ortsnetz-pie");
        const r = el.getBoundingClientRect();
        const at = map.project(marker.getLngLat());
        max = Math.max(max, Math.hypot(r.left + r.width / 2 - (box.left + at.x), r.top + r.height / 2 - (box.top + at.y)));
      }
      frames += 1;
    };
    map.on("render", sample);
    map.once("moveend", () => {
      map.off("render", sample);
      for (const [id, el] of before) {
        const now = card.querySelector(`.ortsnetz-pie[data-cluster-id="${id}"]`);
        if (now && now !== el) replaced += 1;
      }
      resolve({ max, frames, replaced, kept: before.size });
    });
    map.panBy([160, 90], { duration: 600 });
  }));
  expect(worst.frames).toBeGreaterThan(5);
  expect(worst.max).toBeLessThanOrEqual(1.5);
  expect(worst.kept).toBeGreaterThan(0);
  expect(worst.replaced).toBe(0);
});

test("Klick und Tastatur auf eine Torte zoomen hinein", async ({ page }) => {
  await openCard(page, { size: SIZES.gross, config: { latitude: 51.0, longitude: 10.0, zoom: 6 } });
  const target = await page.evaluate(() => {
    const card = window.__card;
    const box = card.querySelector(".ortsnetz-map").getBoundingClientRect();
    const pie = [...card.querySelectorAll(".ortsnetz-pie")].find((el) => {
      const r = el.getBoundingClientRect();
      return r.left > box.left + 80 && r.top > box.top + 80 && r.right < box.right - 280 && r.bottom < box.bottom - 80;
    });
    const r = pie.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: pie.dataset.clusterId, zoom: card._map.getZoom() };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction((zoom) => window.__card._map.getZoom() > zoom + 0.5, target.zoom);
  await waitIdle(page);

  await page.evaluate(() => window.__card._map.jumpTo({ center: [10.0, 51.0], zoom: 6 }));
  await waitIdle(page);
  const zoom = await page.evaluate(() => window.__card._map.getZoom());
  const button = page.locator('.ortsnetz-pie [role="button"]').first();
  await button.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction((zoom) => window.__card._map.getZoom() > zoom + 0.5, zoom);
});

test("Torten kommen nach dem Theme-Wechsel wieder", async ({ page }) => {
  await openCard(page, { size: SIZES.gross, config: { latitude: 51.0, longitude: 10.0, zoom: 6 } });
  await page.evaluate(() => { window.__card.hass = { ...window.__card._hass, themes: { darkMode: true } }; });
  await page.waitForFunction(() => window.__card._map.getStyle()?.layers?.some((l) => l.paint?.["background-color"] === "#333"));
  await waitIdle(page);
  const state = await pieState(page);
  expect(state.problems).toEqual([]);
  expect(state.pies).toBeGreaterThan(0);
});
