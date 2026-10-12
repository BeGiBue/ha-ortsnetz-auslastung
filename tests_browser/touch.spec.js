// Touch-Bedienung: Standardmäßig kooperative Gesten (ein Finger scrollt die Seite,
// zwei Finger bewegen die Karte), Drehen und Kippen gesperrt, Antippen funktioniert.
//
// Touch-Ereignisse: WebKit erlaubt kein new Touch(); deshalb normale Events mit den
// Feldern, die MapLibre ausliest (touches, targetTouches, changedTouches mit clientX/Y).
// Echtes Scrollen der Seite lässt sich so nicht auslösen; geprüft wird stattdessen,
// dass die Karte die Geste nicht abfängt (kein preventDefault) und sich nicht bewegt.
import { expect, test } from "@playwright/test";
import { openCard, waitIdle } from "./harness.js";

test.use({ hasTouch: true });

const SMALL = { width: 380, height: 300 };
const CONFIG = { latitude: 51.0, longitude: 10.0, zoom: 6 };

// Spielt eine Geste ab: frames ist eine Liste von Fingerpositionen je Schritt
// (Pixel relativ zur Karte). Gibt zurück, ob ein touchmove abgefangen wurde.
async function gesture(page, frames, selector = null) {
  return page.evaluate(async ({ frames, selector }) => {
    const card = window.__card;
    const map = card._map;
    const target = selector ? card.querySelector(selector) : map.getCanvas();
    const rect = map.getCanvas().getBoundingClientRect();
    const fire = (type, points) => {
      const touches = points.map(([x, y], i) => ({
        identifier: i + 1, target, clientX: rect.left + x, clientY: rect.top + y,
        pageX: rect.left + x, pageY: rect.top + y, screenX: rect.left + x, screenY: rect.top + y,
      }));
      const event = new Event(type, { bubbles: true, cancelable: true });
      const active = type === "touchend" ? [] : touches;
      Object.defineProperty(event, "touches", { value: active });
      Object.defineProperty(event, "targetTouches", { value: active });
      Object.defineProperty(event, "changedTouches", { value: touches });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
    let prevented = false;
    fire("touchstart", frames[0]);
    for (const points of frames.slice(1)) {
      await pause();
      prevented = fire("touchmove", points) || prevented;
    }
    fire("touchend", frames.at(-1));
    return prevented;
  }, { frames, selector });
}

const steps = (from, to, n = 8) => Array.from({ length: n + 1 }, (_, i) => from.map((p, k) => [
  p[0] + ((to[k][0] - p[0]) * i) / n,
  p[1] + ((to[k][1] - p[1]) * i) / n,
]));

async function camera(page) {
  await waitIdle(page);
  return page.evaluate(() => {
    const map = window.__card._map;
    return { center: map.getCenter().toArray().map((v) => Number(v.toFixed(5))), zoom: Number(map.getZoom().toFixed(3)), bearing: map.getBearing(), pitch: map.getPitch() };
  });
}

test("Standard: ein Finger bewegt die Karte nicht und lässt die Seite scrollen", async ({ page }) => {
  await openCard(page, { size: SMALL, config: CONFIG });
  const before = await camera(page);
  const prevented = await gesture(page, steps([[190, 150]], [[190, 60]]));
  expect(prevented).toBe(false);
  expect(await camera(page)).toEqual(before);
});

test("Standard: zwei Finger verschieben, Pinch zoomt, Drehen und Kippen bleiben aus", async ({ page }) => {
  await openCard(page, { size: SMALL, config: CONFIG });
  const start = await camera(page);

  // Waagerecht: zwei Finger parallel nach oben wertet MapLibre als Kippen.
  await gesture(page, steps([[140, 150], [240, 150]], [[80, 150], [180, 150]]));
  const panned = await camera(page);
  expect(panned.center).not.toEqual(start.center);

  await gesture(page, steps([[170, 150], [210, 150]], [[90, 150], [290, 150]]));
  const zoomed = await camera(page);
  expect(zoomed.zoom).toBeGreaterThan(panned.zoom + 0.5);

  // Zwei Finger drehen sich um die Mitte.
  const rotate = Array.from({ length: 9 }, (_, i) => {
    const angle = (i / 8) * (Math.PI / 2);
    return [[190 - 60 * Math.cos(angle), 150 - 60 * Math.sin(angle)], [190 + 60 * Math.cos(angle), 150 + 60 * Math.sin(angle)]];
  });
  await gesture(page, rotate);
  // Zwei Finger parallel nach oben (Kipp-Geste).
  await gesture(page, steps([[150, 200], [230, 200]], [[150, 100], [230, 100]]));
  const after = await camera(page);
  expect(after.bearing).toBe(0);
  expect(after.pitch).toBe(0);
});

test("Antippen von Cluster und Punkt funktioniert mit kooperativen Gesten", async ({ page }) => {
  await openCard(page, { size: { width: 900, height: 650 }, config: CONFIG });
  const box = await page.locator(".ortsnetz-map").boundingBox();
  const cluster = await page.evaluate(() => {
    const map = window.__card._map;
    const canvas = map.getCanvas();
    const at = map.queryRenderedFeatures({ layers: ["ortsnetz-clusters"] })
      .map((f) => map.project(f.geometry.coordinates))
      .find((p) => p.x > 80 && p.y > 80 && p.x < canvas.clientWidth - 280 && p.y < canvas.clientHeight - 80);
    return { x: at.x, y: at.y, zoom: map.getZoom() };
  });
  await page.touchscreen.tap(box.x + cluster.x, box.y + cluster.y);
  await page.waitForFunction((zoom) => window.__card._map.getZoom() > zoom + 0.5, cluster.zoom);
  await waitIdle(page);

  await page.evaluate(() => window.__card._map.jumpTo({ center: [13.4, 52.52], zoom: 13 }));
  await waitIdle(page);
  const point = await page.evaluate(() => {
    const map = window.__card._map;
    const canvas = map.getCanvas();
    return map.queryRenderedFeatures({ layers: ["ortsnetz-points"] })
      .map((f) => map.project(f.geometry.coordinates))
      .find((p) => p.x > 60 && p.y > 60 && p.x < canvas.clientWidth - 280 && p.y < canvas.clientHeight - 60);
  });
  await page.touchscreen.tap(box.x + point.x, box.y + point.y);
  await expect(page.locator(".maplibregl-popup .popup-title")).toHaveText("Ortsnetz-Messpunkt");

  // Ein Finger im Popup wird von der Karte nicht abgefangen (der Inhalt darf scrollen).
  // Erst abwarten, bis der Verlauf geladen ist und die Card das Popup ins Bild geschoben hat.
  await page.waitForFunction(() => window.__card._popup?.getElement()?.querySelector(".popup-charts svg"));
  await page.waitForTimeout(400);
  const before = await camera(page);
  const prevented = await gesture(page, steps([[200, 300]], [[200, 200]]), ".popup-scroll");
  expect(prevented).toBe(false);
  expect((await camera(page)).center).toEqual(before.center);
});

test("Hinweis für zwei Finger: deutsch und unter Legende und Statuszeile", async ({ page }) => {
  await openCard(page, { size: SMALL, config: CONFIG });
  // MapLibre zeigt den Hinweis nur 100 ms per Klasse an (danach blendet CSS aus):
  // im Moment der blockierten Geste prüfen.
  await page.evaluate(() => {
    const card = window.__card;
    window.__overlay = null;
    // MapLibre feuert das Ereignis und setzt die Klasse direkt danach: einen Mikrotask warten.
    card._map.once("cooperativegestureprevented", () => queueMicrotask(() => {
      const screen = card.querySelector(".maplibregl-cooperative-gesture-screen");
      const z = (el) => Number(getComputedStyle(el).zIndex);
      window.__overlay = {
        shown: screen.classList.contains("maplibregl-show"),
        mobile: screen.querySelector(".maplibregl-mobile-message")?.textContent,
        desktop: screen.querySelector(".maplibregl-desktop-message")?.textContent,
        below: z(screen) < z(card.querySelector(".ortsnetz-legend")) && z(screen) < z(card.querySelector(".ortsnetz-status")),
      };
    }));
  });
  await gesture(page, steps([[190, 150]], [[190, 60]]));
  const overlay = await page.evaluate(() => window.__overlay);
  expect(overlay).not.toBeNull();
  expect(overlay.shown).toBe(true);
  expect(overlay.mobile).toBe("Karte mit zwei Fingern bewegen");
  expect(overlay.desktop).toMatch(/^(Strg|⌘) \+ Mausrad zum Zoomen der Karte$/);
  expect(overlay.below).toBe(true);
});

test("Mausrad zoomt standardmäßig nur mit Strg", async ({ page }) => {
  await openCard(page, { size: SMALL, config: CONFIG });
  const box = await page.locator(".ortsnetz-map").boundingBox();
  await page.mouse.move(box.x + 190, box.y + 150);
  const start = await camera(page);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  expect((await camera(page)).zoom).toBe(start.zoom);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await page.waitForTimeout(300);
  expect((await camera(page)).zoom).toBeGreaterThan(start.zoom);
});

test("Mit cooperative_gestures: false bewegt ein Finger die Karte, Drehen bleibt aus", async ({ page }) => {
  await openCard(page, { size: SMALL, config: { ...CONFIG, cooperative_gestures: false } });
  const before = await camera(page);
  await gesture(page, steps([[190, 150]], [[190, 60]]));
  const after = await camera(page);
  expect(after.center).not.toEqual(before.center);
  const rotate = Array.from({ length: 9 }, (_, i) => {
    const angle = (i / 8) * (Math.PI / 2);
    return [[190 - 60 * Math.cos(angle), 150 - 60 * Math.sin(angle)], [190 + 60 * Math.cos(angle), 150 + 60 * Math.sin(angle)]];
  });
  await gesture(page, rotate);
  expect((await camera(page)).bearing).toBe(0);
});
