// Testseite für die Card im echten Browser, vollständig ohne Netz:
// - Card und MapLibre kommen aus dem Repository,
// - die OpenFreeMap-Stile werden durch einen Minimalstil ersetzt,
// - hass ist eine Attrappe mit deterministisch erzeugten Messpunkten.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WWW = path.join(ROOT, "custom_components/ortsnetz_map/www");
export const ORIGIN = "http://ortsnetz.test";

// Minimalstil ohne Kacheln. Mit glyphs für den hellen, ohne für den dunklen Stil,
// damit beide Pfade (Zähler als Symbol-Layer / ohne Zähler) im Test vorkommen.
// Die Glyphen-Antwort ist leer, aber gültig (mit glyphsFail: 404).
const MINIMAL_STYLE = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#ddd" } }] };
const STYLES = {
  liberty: { ...MINIMAL_STYLE, glyphs: `${ORIGIN}/fonts/{fontstack}/{range}.pbf` },
  dark: { ...MINIMAL_STYLE, layers: [{ id: "bg", type: "background", paint: { "background-color": "#333" } }] },
};

// 1×1-PNG für die langsamen Kacheln (Option tileDelay).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGM4c+bMfwAIMANkhLK+mwAAAABJRU5ErkJggg==", "base64");

// Quellenangabe wie bei OpenFreeMap (kommt dort zur Laufzeit aus der TileJSON; der
// genaue Text ist von hier nicht abrufbar, Länge und Aufbau sind realistisch).
const ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

function styleFor(name, tileDelay) {
  const style = structuredClone(STYLES[name] ?? STYLES.liberty);
  style.sources.basemap = { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: ATTRIBUTION };
  if (tileDelay) {
    // Simuliert eine Basiskarte, deren Kacheln (wie im Netz) erst nach einer Weile kommen.
    style.sources.raster = { type: "raster", tiles: [`${ORIGIN}/tiles/{z}/{x}/{y}.png`], tileSize: 256 };
    style.layers.push({ id: "raster", type: "raster", source: "raster", paint: { "raster-opacity": 0.1 } });
  }
  return style;
}

// Deterministischer Zufall (mulberry32).
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ca. 700 Punkte: dichte Gebiete (Cluster), Streuung über Deutschland, einige
// Punkte mit identischen Koordinaten; gemischte Status.
export function makePoints(count = 700, seed = 42) {
  const rnd = random(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const cities = [[52.52, 13.40], [48.14, 11.58], [50.94, 6.96], [53.55, 9.99], [51.34, 12.37], [49.45, 11.08]];
  const voltages = [200, 212, 230, 230, 230, 230, 247, 258];
  const points = [];
  for (let i = 0; i < count; i++) {
    let lat;
    let lng;
    if (i < 480) {
      const [cLat, cLng] = cities[i % cities.length];
      const spread = i % 4 === 0 ? 0.25 : 0.04;
      lat = cLat + gauss() * spread;
      lng = cLng + gauss() * spread * 1.6;
    } else if (i < 690) {
      lat = 47.4 + rnd() * 7.4;
      lng = 6.0 + rnd() * 8.9;
    } else {
      // Gleiche Koordinaten wie ein früherer Punkt (Mehrfamilienhaus o. ä.).
      lat = points[i - 690].latitude;
      lng = points[i - 690].longitude;
    }
    const pick = () => voltages[Math.floor(rnd() * voltages.length)];
    points.push({
      public_id: `p${String(i).padStart(4, "0")}`,
      latitude: Number(lat.toFixed(5)),
      longitude: Number(lng.toFixed(5)),
      l1_v: pick(),
      l2_v: rnd() < 0.2 ? -1 : pick(),
      l3_v: pick(),
      grid_frequency_hz: 50,
      sample_count: 5,
      observed_at: new Date().toISOString(),
      stale: rnd() < 0.1,
      forecast_kwh_per_kwp_day: rnd() < 0.7 ? Number((rnd() * 8).toFixed(2)) : null,
    });
  }
  return points;
}

const HARNESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Ortsnetz Map Test</title>
<style>html,body{margin:0;height:100%} #host{width:var(--w);height:var(--h)}</style>
</head><body><div id="host"></div>
<script>
  window.matchMedia = window.matchMedia || (() => ({ matches: false }));
  // 24 Stunden im 5-Minuten-Takt, Spannungen um 230 V mit Ausreißern, Frequenz um 50 Hz.
  window.__makeHistory = () => {
    const end = Date.now();
    const start = end - 24 * 3600 * 1000;
    const samples = [];
    for (let t = start; t <= end; t += 5 * 60 * 1000) {
      const i = samples.length;
      const wave = Math.sin(i / 20) * 8;
      samples.push({
        at: new Date(t).toISOString(),
        l1_v: 230 + wave, l2_v: 228 - wave / 2, l3_v: i % 50 === 0 ? 255 : 232 + wave / 3,
        grid_frequency_hz: 50 + Math.sin(i / 7) * 0.04,
      });
    }
    return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), samples };
  };
  window.__setupCard = (config, points, size, options = {}) => {
    const host = document.getElementById("host");
    host.style.setProperty("--w", size.width + "px");
    host.style.setProperty("--h", size.height + "px");
    // Wie in Home Assistant (hui-card, Sections): die Card liegt in einem Shadow-Root,
    // Stylesheets aus document.head wirken dort nicht.
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    // Farbvariablen eines hellen Home-Assistant-Themes (sonst wären z. B. Popups durchsichtig).
    style.textContent = ":host{display:block;--card-background-color:#fff;--primary-background-color:#fafafa;" +
      "--primary-text-color:#212121;--secondary-text-color:#727272;--primary-color:#03a9f4;--divider-color:#e0e0e0}" +
      " ortsnetz-map-card{display:block;height:100%}";
    root.appendChild(style);
    const card = document.createElement("ortsnetz-map-card");
    card.setConfig(config);
    let release;
    window.__dataReleased = options.holdData ? new Promise((resolve) => { release = resolve; }) : Promise.resolve();
    window.__releaseData = () => release?.();
    // Verlauf für das Popup: mit holdHistory erst nach window.__releaseHistory().
    let releaseHistory;
    window.__historyReleased = options.holdHistory ? new Promise((resolve) => { releaseHistory = resolve; }) : Promise.resolve();
    window.__releaseHistory = () => releaseHistory?.();
    card.hass = {
      config: { latitude: 51.0, longitude: 10.0 },
      themes: { darkMode: false },
      connection: {
        sendMessagePromise: async (msg) => {
          if (msg.type === "ortsnetz_map/get_points") await window.__dataReleased;
          if (msg.type === "ortsnetz_map/get_points") return JSON.parse(JSON.stringify({ points: window.__points }));
          if (msg.type === "ortsnetz_map/get_history") {
            await window.__historyReleased;
            return window.__makeHistory();
          }
          throw { code: "not_found" };
        },
      },
    };
    window.__points = points;
    root.appendChild(card);
    window.__card = card;
  };
</script>
<script src="/card.js"></script>
</body></html>`;

async function fulfillFile(route, file, contentType) {
  route.fulfill({ status: 200, contentType, body: await readFile(file) });
}

// Netz-Zustand für Ausfalltests; page.ortsnetzNet lässt sich im Test ändern
// (z. B. styleFail = false: Netz wieder da).
//   styleFail: Anfragen an die OpenFreeMap-Stile werden abgewiesen (wie Pi-hole/offline)
//   tilesFail: Rasterkacheln scheitern (erzwingt eine Rasterquelle im Stil):
//              "404" (MapLibre wertet das als "keine Kachel", kein Fehler) oder
//              "refused" (Verbindung abgewiesen wie bei Pi-hole/offline)
export async function installRoutes(page, { tileDelay = 0, glyphsFail = false, styleFail = false, tilesFail = false } = {}) {
  const net = { tileDelay, glyphsFail, styleFail, tilesFail };
  page.ortsnetzNet = net;
  await page.route("**/*", async (route) => {
    const { tileDelay, glyphsFail, styleFail, tilesFail } = net;
    const url = new URL(route.request().url());
    // WebKit leitet auch blob:-URLs (MapLibre-Worker) durch page.route; nicht abbrechen.
    if (url.protocol === "blob:" || url.protocol === "data:") return route.continue();
    if (url.origin === ORIGIN) {
      if (url.pathname === "/harness.html") return route.fulfill({ status: 200, contentType: "text/html", body: HARNESS_HTML });
      if (url.pathname === "/card.js") return fulfillFile(route, path.join(WWW, "ortsnetz-map-card.js"), "text/javascript");
      if (url.pathname.startsWith("/ortsnetz_map/maplibre/")) {
        const name = path.basename(url.pathname);
        const type = name.endsWith(".css") ? "text/css" : "text/javascript";
        return fulfillFile(route, path.join(WWW, "maplibre", name), type);
      }
      if (url.pathname.startsWith("/fonts/")) {
        return glyphsFail
          ? route.fulfill({ status: 404, body: "" })
          : route.fulfill({ status: 200, contentType: "application/x-protobuf", body: Buffer.alloc(0) });
      }
      if (url.pathname.startsWith("/tiles/")) {
        if (tilesFail === "refused") return route.abort("connectionrefused");
        if (tilesFail) return route.fulfill({ status: 404, body: "" });
        await new Promise((resolve) => setTimeout(resolve, tileDelay));
        return route.fulfill({ status: 200, contentType: "image/png", body: PNG }).catch(() => {});
      }
      return route.fulfill({ status: 404, body: "" });
    }
    if (url.hostname === "tiles.openfreemap.org" && url.pathname.startsWith("/styles/")) {
      if (styleFail) return route.abort("connectionrefused");
      const style = styleFor(url.pathname.split("/").pop(), tileDelay || tilesFail);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(style) });
    }
    return route.abort();
  });
}

// Lädt die Testseite und wartet, bis die Karte Punkte zeigt.
// Mit holdData wartet die hass-Attrappe auf window.__releaseData(), bevor sie die Punkte liefert.
// Mit waitReady: false kehrt openCard direkt nach dem Aufbau zurück (Ausfalltests).
export async function openCard(page, { config = {}, points = makePoints(), size = { width: 900, height: 650 }, tileDelay = 0, holdData = false, holdHistory = false, glyphsFail = false, styleFail = false, tilesFail = false, waitReady = true } = {}) {
  await page.setViewportSize({ width: size.width + 40, height: size.height + 40 });
  await installRoutes(page, { tileDelay, glyphsFail, styleFail, tilesFail });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(({ config, points, size, holdData, holdHistory }) => window.__setupCard(config, points, size, { holdData, holdHistory }), { config, points, size, holdData, holdHistory });
  if (!waitReady) return points;
  if (holdData) {
    await page.waitForFunction(() => window.__card?._map?.loaded());
    return points;
  }
  await page.waitForFunction(() => window.__card?._map && window.__card._currentData && window.__card._map.loaded());
  await waitIdle(page);
  return points;
}

// Wartet, bis die Karte nach einer Aktion zur Ruhe gekommen ist: keine Bewegung,
// Stil und Kacheln geladen, und ein weiterer Frame danach gezeichnet. Bewusst nicht
// nur auf "idle": Kacheln, die mit Fehler enden (z. B. Schrift nicht ladbar), lösen
// keinen neuen Frame aus, und dann kommt idle erst beim nächsten Neuzeichnen.
export async function waitIdle(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const map = window.__card._map;
    const started = performance.now();
    const frame = () => new Promise((done) => {
      map.once("render", done);
      map.triggerRepaint();
    });
    const settled = () => !map.isMoving() && map.loaded() && map.areTilesLoaded();
    (async () => {
      let calm = 0;
      while (calm < 2) {
        if (performance.now() - started > 15000) {
          const state = { loaded: map.loaded(), tiles: map.areTilesLoaded(), moving: map.isMoving(), zoom: map.getZoom() };
          throw new Error(`Karte kommt nicht zur Ruhe: ${JSON.stringify(state)}`);
        }
        await Promise.race([frame(), new Promise((done) => setTimeout(done, 100))]);
        calm = settled() ? calm + 1 : 0;
      }
    })().then(resolve, reject);
  }));
}

// Prüft im Browser: Jeder aktivierte Punkt im Blickfeld wird genau einmal
// dargestellt, entweder als Einzelpunkt oder als Mitglied eines Clusters.
// HTML-Marker zählen nur, wenn sie sichtbar an ihrer Kartenposition sitzen.
// (Die Summe aus point_count und Einzelpunkten allein taugt an den Rändern nicht:
// Cluster am Rand enthalten auch Punkte außerhalb des Blickfelds.)
export async function representation(page) {
  return page.evaluate(async () => {
    const card = window.__card;
    const map = card._map;
    const canvas = map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const margin = 3;

    const expected = [];
    for (const point of card._currentData.points) {
      const status = card._pointStatus(point);
      if (!status || !card._enabled.has(status.key)) continue;
      const { x, y } = map.project([point.longitude, point.latitude]);
      if (x >= margin && x <= width - margin && y >= margin && y <= height - margin) expected.push(point.public_id);
    }

    const singles = new Set();
    const clustered = new Map(); // public_id -> Anzahl Cluster, die ihn enthalten
    let clusterCount = 0;
    let clusterPointSum = 0;

    const add = (id) => clustered.set(id, (clustered.get(id) || 0) + 1);
    const nativeClusters = map.getLayer("ortsnetz-clusters");
    if (nativeClusters) {
      const source = map.getSource("ortsnetz-points");
      const seen = new Set();
      for (const feature of map.queryRenderedFeatures({ layers: ["ortsnetz-clusters"] })) {
        const id = feature.properties.cluster_id;
        if (seen.has(id)) continue;
        seen.add(id);
        clusterCount += 1;
        clusterPointSum += feature.properties.point_count;
        const leaves = await source.getClusterLeaves(id, Infinity, 0);
        for (const leaf of leaves) add(leaf.properties.public_id);
      }
    } else {
      const box = card.querySelector(".ortsnetz-map").getBoundingClientRect();
      for (const marker of card._clusterMarkers.values()) {
        const element = marker.getElement();
        if (!element.isConnected) continue;
        const rect = element.getBoundingClientRect();
        const at = map.project(marker.getLngLat());
        const dx = rect.left + rect.width / 2 - (box.left + at.x);
        const dy = rect.top + rect.height / 2 - (box.top + at.y);
        if (Math.hypot(dx, dy) > 3) continue; // nicht dort, wo er hingehört
        const visible = rect.right > box.left && rect.left < box.right && rect.bottom > box.top && rect.top < box.bottom;
        if (!visible) continue;
        clusterCount += 1;
        clusterPointSum += marker.ortsnetzIds.length;
        for (const id of marker.ortsnetzIds) add(id);
      }
    }
    for (const feature of map.queryRenderedFeatures({ layers: ["ortsnetz-points"] })) {
      if (feature.properties.point_count === undefined) singles.add(feature.properties.public_id);
    }

    let missing = expected.filter((id) => !singles.has(id) && !clustered.has(id));

    // Randeffekt jedes Schwerpunkt-Clusterings: Ein Punkt knapp im Blickfeld kann zu
    // einem Cluster gehören, dessen Kreis ganz außerhalb liegt. Das ist erlaubt, aber nur
    // dann; jeder andere fehlende Punkt bleibt ein Fehler.
    const offscreen = {};
    if (missing.length && nativeClusters) {
      const source = map.getSource("ortsnetz-points");
      const seen = new Set();
      for (const feature of map.querySourceFeatures("ortsnetz-points", { filter: ["has", "point_count"] })) {
        const id = feature.properties.cluster_id;
        if (seen.has(id)) continue;
        seen.add(id);
        const at = map.project(feature.geometry.coordinates);
        // Radius wie im Layer plus Rand.
        const radius = Math.min(36, 14 + 2 * Math.sqrt(feature.properties.point_count)) + 2;
        // Kreis schneidet das Kartenrechteck nicht: Abstand zum nächsten Rechteckpunkt > Radius.
        const nearX = Math.min(width, Math.max(0, at.x));
        const nearY = Math.min(height, Math.max(0, at.y));
        const outside = Math.hypot(at.x - nearX, at.y - nearY) > radius;
        if (!outside) continue;
        for (const leaf of await source.getClusterLeaves(id, Infinity, 0)) {
          const leafId = leaf.properties.public_id;
          if (missing.includes(leafId)) offscreen[leafId] = { cluster: [Math.round(at.x), Math.round(at.y)], count: feature.properties.point_count };
        }
      }
      missing = missing.filter((id) => !offscreen[id]);
    }
    const doubled = expected.filter((id) => (singles.has(id) ? 1 : 0) + (clustered.get(id) || 0) > 1);
    return {
      zoom: Number(map.getZoom().toFixed(2)),
      expected: expected.length,
      singles: singles.size,
      clusters: clusterCount,
      clusterPointSum,
      missing,
      offscreen: Object.keys(offscreen).length,
      doubled,
      size: [width, height],
    };
  });
}
