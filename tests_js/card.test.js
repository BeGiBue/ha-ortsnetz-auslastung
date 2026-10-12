// Tests für die Dashboard-Card (jsdom, ohne echten Browser und ohne Netz).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const CARD = "../custom_components/ortsnetz_map/www/ortsnetz-map-card.js";

// ---- Nachbildung von MapLibre ------------------------------------------------

const maps = [];

class FakeMap {
  constructor(options) {
    this.options = options;
    this.handlers = {};
    this.zoom = options.zoom;
    this.center = options.center;
    this.sources = {};
    this.layers = [];
    this.paint = {};
    this.removed = false;
    this.setStyleCalls = [];
    this.easeToCalls = [];
    // Wie MapLibre: nach setData/setStyle ist der Stil "nicht geladen", bis idle feuert.
    this.styleLoaded = false;
    this.autoStyleLoaded = null; // fester Wert für isStyleLoaded(), sonst null
    this.renderedFeatures = [];
    this.clusterExpansionZoom = 14;
    this.touchZoomRotate = { rotationDisabled: false, disableRotation() { this.rotationDisabled = true; } };
    this.keyboard = { rotationDisabled: false, disableRotation() { this.rotationDisabled = true; } };
    maps.push(this);
  }
  on(event, ...args) {
    const handler = args[args.length - 1];
    const layer = args.length > 1 ? args[0] : null;
    (this.handlers[event] ||= []).push({ handler, layer, once: false });
    return this;
  }
  once(event, ...args) {
    this.on(event, ...args);
    this.handlers[event][this.handlers[event].length - 1].once = true;
    return this;
  }
  off(event, ...args) {
    const handler = args[args.length - 1];
    this.handlers[event] = (this.handlers[event] || []).filter((entry) => entry.handler !== handler);
    return this;
  }
  fire(event, payload) {
    if (event === "idle" || event === "load" || event === "style.load") this.styleLoaded = true;
    const entries = this.handlers[event] || [];
    this.handlers[event] = entries.filter((entry) => !entry.once);
    for (const entry of entries) entry.handler(payload);
  }
  addControl() {}
  remove() { this.removed = true; }
  resize() {}
  getZoom() { return this.zoom; }
  isMoving() { return false; }
  getCenter() { return this.center; }
  easeTo(options) {
    this.easeToCalls.push(options);
    if (options.zoom !== undefined) this.zoom = options.zoom;
    if (options.center !== undefined) this.center = options.center;
  }
  project([lng, lat]) { return { x: lng * 1000, y: lat * 1000 }; }
  getBounds() {
    return { getWest: () => -180, getEast: () => 180, getSouth: () => -90, getNorth: () => 90 };
  }
  getStyle() {
    const style = { version: 8, sources: { ...this.sources }, layers: [...this.layers] };
    if (this.glyphs !== false) style.glyphs = "https://example.org/fonts/{fontstack}/{range}.pbf";
    return style;
  }
  getSource(id) { return this.sources[id]; }
  addSource(id, source) {
    this.styleLoaded = false;
    this.sources[id] = {
      ...source,
      setDataCalls: 0,
      setData: (data) => {
        this.sources[id].data = data;
        this.sources[id].setDataCalls += 1;
        this.styleLoaded = false;
      },
      getClusterExpansionZoom: () => Promise.resolve(this.clusterExpansionZoom),
    };
  }
  getLayer(id) { return this.layers.find((layer) => layer.id === id); }
  addLayer(layer) { this.layers.push(layer); }
  setPaintProperty(id, name, value) { (this.paint[id] ||= {})[name] = value; }
  // Wie MapLibre: (geometry?, {layers}); gefiltert nach feature.layer.id.
  queryRenderedFeatures(...args) {
    const options = args.find((arg) => arg && !Array.isArray(arg) && typeof arg === "object" && "layers" in arg);
    this.lastQuery = args;
    if (!options?.layers) return this.renderedFeatures;
    return this.renderedFeatures.filter((feature) => options.layers.includes(feature.layer?.id));
  }
  isStyleLoaded() { return this.autoStyleLoaded ?? this.styleLoaded; }
  getCanvas() { return (this.canvas ||= { style: {} }); }
  setStyle(url, options) {
    this.setStyleCalls.push({ url, options });
    this.styleLoaded = false;
  }
}

class FakeMarker {
  constructor({ element }) { this.element = element; }
  setLngLat() { return this; }
  addTo() { return this; }
  remove() {}
}

const fakeMapLibre = {
  Map: FakeMap,
  NavigationControl: class {},
  Popup: class {},
  Marker: FakeMarker,
  LngLatBounds: class { extend() {} },
};

// ---- Hilfen ------------------------------------------------------------------

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeHass(overrides = {}) {
  return {
    config: { latitude: 52.5, longitude: 13.4 },
    themes: { darkMode: false },
    connection: { sendMessagePromise: vi.fn(() => new Promise(() => {})) },
    ...overrides,
  };
}

function newCard() {
  return document.createElement("ortsnetz-map-card");
}

function mapLibreScript() {
  return document.querySelector('script[src^="/ortsnetz_map/maplibre/maplibre-gl.js"]');
}

beforeAll(async () => {
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  window.matchMedia = () => ({ matches: false });
  await import(CARD);
});

beforeEach(() => {
  maps.length = 0;
  delete window.maplibregl;
  document.head.querySelectorAll("script, link").forEach((element) => element.remove());
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

// ---- Sicherheit: API-Werte im HTML -------------------------------------------

describe("Escaping von API-Werten", () => {
  const malicious = '<img src=x onerror="alert(1)">';

  it("setzt sample_count nur als Zahl ins Popup", () => {
    const card = newCard();
    const html = card._popupHtml({ sample_count: malicious, observed_at: malicious });
    expect(html).not.toContain("<img");
    expect(html).toContain("Messungen: <span class=\"popup-value\">–</span>");
    expect(card._popupHtml({ sample_count: "12" })).toContain(">12<");
  });

  it("ersetzt ungültige API-Farben durch die Standardfarbe", () => {
    const card = newCard();
    card._applyScale({
      scale: { colors: ["#123456", '#0f0"><img src=x onerror=alert(1)>', "red", "rgb(1, 2, 3)", "hsl(10 20% 30%)"] },
    });
    expect(card._color("crit_low")).toBe("#123456");
    expect(card._color("warn_low")).toBe("#38bdf8");
    expect(card._color("normal")).toBe("#16a34a");
    expect(card._color("warn_high")).toBe("rgb(1, 2, 3)");
    expect(card._color("crit_high")).toBe("hsl(10 20% 30%)");
  });

  it("baut Legende und Cluster ohne eingeschleustes HTML", () => {
    const card = newCard();
    card._legendElement = document.createElement("div");
    card._legendOpen = true;
    card._currentData = {
      points: [{ l1_v: 230 }],
      scale: { colors: Array(5).fill('red" onmouseover="alert(1)') },
    };
    card._applyScale(card._currentData);
    card._renderLegend();
    expect(card._legendElement.innerHTML).not.toContain("onmouseover");
  });

  it("nimmt Schwellwerte nur als Zahlen", () => {
    const card = newCard();
    card._applyScale({ scale: { criticalLow: "200", warningLow: "<b>", warningHigh: 240 } });
    expect(card._scale).toEqual({ criticalLow: 200, warningLow: 218, warningHigh: 240, criticalHigh: 253 });
  });
});

// ---- Status- und Farblogik -------------------------------------------------

describe("Status je Messpunkt", () => {
  it("nimmt den schlechtesten Wert, bei Gleichstand Unterspannung", () => {
    const card = newCard();
    expect(card._pointStatus({ l1_v: 230, l2_v: 250, l3_v: 215 }).key).toBe("warn_low");
    expect(card._pointStatus({ l1_v: 230, l2_v: 260 }).key).toBe("crit_high");
    expect(card._pointStatus({ l1_v: -1, l2_v: "" })).toBeNull();
  });

  it("wertet stale als String richtig aus", () => {
    const card = newCard();
    expect(card._isStale({ stale: "false" })).toBe(false);
    expect(card._isStale({ stale: "true" })).toBe(true);
    expect(card._isStale({ stale: true })).toBe(true);
    expect(card._isStale({ stale: false })).toBe(false);
  });

  it("zeigt den Forecast in Marker und Popup aus denselben Feldern", () => {
    const card = newCard();
    const map = new FakeMap({ zoom: 14 });
    map.fire("idle");
    card._map = map;
    card._maplibregl = fakeMapLibre;
    card._mapLoaded = true;
    card._renderPoints({ points: [{ latitude: 52, longitude: 13, l1_v: 230, forecast_yield: 4.2 }] });
    const [feature] = map.sources["ortsnetz-points"].data.features;
    expect(feature.properties.forecast_yield).toBe(4.2);
    expect(card._popupHtml(feature.properties)).toContain("4.20 kWh/kWp/Tag");
  });
});

// ---- Cluster (MapLibre-Clustering) ---------------------------------------------

const POINT = { latitude: 52, longitude: 13, l1_v: 230 };

// Card mit FakeMap, deren Stil schon geladen ist, aber ohne DOM-Aufbau.
function cardWithMap({ styleLoaded = true, glyphs = true } = {}) {
  const card = newCard();
  const map = new FakeMap({ zoom: 8 });
  map.glyphs = glyphs;
  if (styleLoaded) map.fire("style.load");
  card._map = map;
  card._maplibregl = fakeMapLibre;
  card._mapLoaded = true;
  return { card, map };
}

describe("Cluster", () => {
  it("legt eine Cluster-Quelle mit Zählern je Status und dem schlechtesten Rang an", () => {
    const { card, map } = cardWithMap();
    card._renderPoints({ points: [POINT] });
    const source = map.sources["ortsnetz-points"];
    expect(source).toMatchObject({ type: "geojson", cluster: true, clusterRadius: 45, clusterMaxZoom: 11 });
    expect(source.clusterProperties.crit_low).toEqual(["+", ["case", ["==", ["get", "status"], "crit_low"], 1, 0]]);
    expect(Object.keys(source.clusterProperties).sort()).toEqual(
      ["crit_high", "crit_low", "normal", "warn_high", "warn_low", "worst"],
    );
    expect(source.clusterProperties.worst).toEqual(["max", ["get", "rank"]]);
  });

  it("vergibt Ränge: schlechtester Wert gewinnt, bei gleicher Schwere Unterspannung", () => {
    const { card, map } = cardWithMap();
    card._renderPoints({
      points: [
        { ...POINT, public_id: "a", l1_v: 200 },
        { ...POINT, public_id: "b", l1_v: 260 },
        { ...POINT, public_id: "c", l1_v: 212 },
        { ...POINT, public_id: "d", l1_v: 247 },
        { ...POINT, public_id: "e", l1_v: 230 },
      ],
    });
    const ranks = Object.fromEntries(
      map.sources["ortsnetz-points"].data.features.map((f) => [f.properties.status, f.properties.rank]),
    );
    expect(ranks).toEqual({ crit_low: 4, crit_high: 3, warn_low: 2, warn_high: 1, normal: 0 });
  });

  it("zeichnet Cluster-Kreis, Zähler und Einzelpunkte in dieser Reihenfolge", () => {
    const { card, map } = cardWithMap();
    card._renderPoints({ points: [POINT] });
    expect(map.layers.map((layer) => layer.id)).toEqual(["ortsnetz-clusters", "ortsnetz-cluster-count", "ortsnetz-points"]);
    const [circle, count, points] = map.layers;
    expect(circle.filter).toEqual(["has", "point_count"]);
    expect(count.layout["text-font"]).toEqual(["Noto Sans Regular"]);
    expect(count.layout["text-field"]).toEqual(["get", "point_count_abbreviated"]);
    // Zähler auf eigener, gleich konfigurierter Quelle: Schriftfehler treffen nur ihn.
    expect(count.source).toBe("ortsnetz-cluster-labels");
    expect(map.sources["ortsnetz-cluster-labels"]).toMatchObject({ cluster: true, clusterRadius: 45, clusterMaxZoom: 11 });
    expect(map.sources["ortsnetz-cluster-labels"].data).toBe(map.sources["ortsnetz-points"].data);
    expect(circle.source).toBe("ortsnetz-points");
    expect(points.source).toBe("ortsnetz-points");
    expect(points.filter).toEqual(["!", ["has", "point_count"]]);
  });

  it("lässt den Zähler weg, wenn der Stil keine Glyphen hat", () => {
    const { card, map } = cardWithMap({ glyphs: false });
    card._renderPoints({ points: [POINT] });
    expect(map.layers.map((layer) => layer.id)).toEqual(["ortsnetz-clusters", "ortsnetz-points"]);
    expect(map.sources["ortsnetz-cluster-labels"]).toBeUndefined();
  });

  it("färbt Cluster nach dem schlechtesten Status mit geprüften API-Farben", () => {
    const { card, map } = cardWithMap();
    card._applyScale({ scale: { colors: ["#111111", 'red"><img>', "#333333", "#444444", "#555555"] } });
    card._renderPoints({ points: [POINT] });
    const color = map.layers[0].paint["circle-color"];
    expect(color).toEqual(["match", ["get", "worst"], 4, "#111111", 3, "#555555", 2, "#38bdf8", 1, "#444444", "#333333"]);
    // Neue Farben aus der API werden in den bestehenden Layer übernommen.
    card._applyScale({ scale: { colors: ["#aaaaaa", "#bbbbbb", "#cccccc", "#dddddd", "#eeeeee"] } });
    card._renderPoints({ points: [POINT] });
    expect(map.paint["ortsnetz-clusters"]["circle-color"][3]).toBe("#aaaaaa");
  });

  it("zählt nur aktivierte Status (Legendenfilter wirkt vor setData)", () => {
    const { card, map } = cardWithMap();
    card._enabled.delete("normal");
    card._renderPoints({ points: [POINT, { ...POINT, public_id: "x", l1_v: 200 }] });
    expect(map.sources["ortsnetz-points"].data.features.map((f) => f.properties.status)).toEqual(["crit_low"]);
  });
});

describe("Rendern", () => {
  it("zeichnet auch, wenn isStyleLoaded() false liefert (Kacheln laden)", () => {
    const { card, map } = cardWithMap();
    map.autoStyleLoaded = false;
    card._renderPoints({ points: [POINT] });
    expect(map.sources["ortsnetz-points"].data.features).toHaveLength(1);
  });

  it("merkt sich Daten vor dem Laden des Stils und legt die Quelle bei style.load an", () => {
    const { card, map } = cardWithMap({ styleLoaded: false });
    map.addSource = vi.fn(() => { throw new Error("Style is not done loading"); });
    card._renderPoints({ points: [POINT] });
    expect(card._allFeatures).toHaveLength(1);
    delete map.addSource;
    card._installMapEvents();
    map.fire("style.load");
    expect(map.sources["ortsnetz-points"].data.features).toHaveLength(1);
  });

  it("ruft setData nur bei geänderten Daten auf", () => {
    const { card, map } = cardWithMap();
    card._renderPoints({ points: [POINT] });
    const source = map.sources["ortsnetz-points"];
    const calls = source.setDataCalls;
    card._renderPoints({ points: [{ ...POINT }] });
    expect(source.setDataCalls).toBe(calls);
    card._renderPoints({ points: [{ ...POINT, l1_v: 250 }] });
    expect(source.setDataCalls).toBe(calls + 1);
    expect(map.sources["ortsnetz-cluster-labels"].data).toBe(source.data);
    card._renderPoints({ points: [{ ...POINT, l1_v: 250, stale: true }] });
    expect(source.setDataCalls).toBe(calls + 2);
  });

  it("überspringt ungültige Koordinaten", () => {
    const { card, map } = cardWithMap();
    card._renderPoints({
      points: [
        { ...POINT, public_id: "ok", latitude: "52.1", longitude: "13.2" },
        { ...POINT, public_id: "leer", latitude: "", longitude: 13 },
        { ...POINT, public_id: "null", latitude: null, longitude: null },
        { ...POINT, public_id: "text", latitude: "abc", longitude: 13 },
        { ...POINT, public_id: "lat", latitude: 91, longitude: 13 },
        { ...POINT, public_id: "lng", latitude: 52, longitude: -181 },
        { ...POINT, public_id: "nullinsel", latitude: 0, longitude: 0 },
        { ...POINT, public_id: "inf", latitude: Infinity, longitude: 13 },
      ],
    });
    const features = map.sources["ortsnetz-points"].data.features;
    expect(features.map((f) => f.properties.public_id)).toEqual(["ok"]);
    expect(features[0].geometry.coordinates).toEqual([13.2, 52.1]);
  });

  it("fällt bei ungültigem Kartenmittelpunkt der Konfiguration auf den HA-Standort zurück", () => {
    const card = newCard();
    card._hass = makeHass();
    card.setConfig({ latitude: "abc", longitude: 13 });
    expect(card._initialCenter()).toEqual([13.4, 52.5]);
    card.setConfig({ latitude: 48.1, longitude: 11.5 });
    expect(card._initialCenter()).toEqual([11.5, 48.1]);
    card.setConfig({ latitude: 0, longitude: 0 });
    expect(card._initialCenter()).toEqual([13.4, 52.5]);
  });
});

describe("Interaktion", () => {
  const box = { x: 100, y: 100 };

  it("zoomt beim Klick auf einen Cluster auf dessen Auflösungs-Zoom", async () => {
    const { card, map } = cardWithMap();
    card._renderPoints({ points: [POINT] });
    card._installPointInteractions(fakeMapLibre);
    map.clusterExpansionZoom = 9;
    map.renderedFeatures = [
      { layer: { id: "ortsnetz-clusters" }, geometry: { coordinates: [13, 52] }, properties: { cluster_id: 7, point_count: 3 } },
    ];
    map.fire("click", { point: box, lngLat: { lng: 13, lat: 52 } });
    await flush();
    expect(map.easeToCalls).toEqual([{ center: [13, 52], zoom: 9 }]);
    // Treffbereich: Box von 10 px um den Tippunkt.
    expect(map.lastQuery[0]).toEqual([[90, 90], [110, 110]]);
  });

  it("öffnet beim Klick in der Nähe eines Einzelpunkts dessen Popup", () => {
    const { card, map } = cardWithMap();
    card._renderPoints({ points: [POINT] });
    const popups = [];
    const maplibre = {
      ...fakeMapLibre,
      Popup: class {
        constructor(options) { this.options = options; popups.push(this); }
        setLngLat(at) { this.at = at; return this; }
        setHTML(html) { this.html = html; return this; }
        addTo() { return this; }
        getElement() { return null; }
        remove() {}
      },
    };
    card._installPointInteractions(maplibre);
    map.renderedFeatures = [
      { layer: { id: "ortsnetz-points" }, geometry: { coordinates: [13, 52] }, properties: { public_id: "a", l1_v: 230 } },
    ];
    map.fire("click", { point: box, lngLat: { lng: 13, lat: 52 } });
    expect(popups).toHaveLength(1);
    expect(popups[0].at).toEqual([13, 52]);
    expect(popups[0].html).toContain("Ortsnetz-Messpunkt");
  });
});

// ---- Popup in der Karte halten ------------------------------------------------

describe("Verschiebung für das Popup", () => {
  const offset = (...args) => customElements.get("ortsnetz-map-card").popupPanOffset(...args);
  const view = { width: 400, height: 300 };

  it("verschiebt nicht, wenn das Popup mit 12 px Rand passt", () => {
    expect(offset({ left: 12, top: 12, right: 388, bottom: 288 }, view, { x: 200, y: 150 })).toEqual([0, 0]);
  });

  it("schiebt so weit wie nötig nach links, rechts, oben oder unten", () => {
    // panBy([dx, dy]) bewegt den Inhalt um -dx/-dy.
    expect(offset({ left: 100, top: 50, right: 418, bottom: 150 }, view, { x: 260, y: 150 })).toEqual([30, 0]);
    expect(offset({ left: -20, top: 50, right: 200, bottom: 150 }, view, { x: 90, y: 150 })).toEqual([-32, 0]);
    expect(offset({ left: 50, top: -5, right: 200, bottom: 100 }, view, { x: 120, y: 100 })).toEqual([0, -17]);
    expect(offset({ left: 50, top: 150, right: 200, bottom: 320 }, view, { x: 120, y: 150 })).toEqual([0, 32]);
  });

  it("zeigt ein zu hohes Popup von oben (Schließen-Kreuz sichtbar)", () => {
    expect(offset({ left: 50, top: 100, right: 200, bottom: 500 }, view, { x: 120, y: 100 })).toEqual([0, 88]);
  });

  it("lässt den angetippten Punkt nie aus dem Blickfeld laufen", () => {
    // Popup über dem Punkt ragt oben heraus, der Punkt sitzt unten am Rand.
    expect(offset({ left: 50, top: -50, right: 200, bottom: 280 }, view, { x: 120, y: 280 })).toEqual([0, -8]);
    // Popup ragt rechts heraus, der Punkt sitzt links am Rand: höchstens 8 px schieben.
    expect(offset({ left: 300, top: 50, right: 500, bottom: 150 }, view, { x: 20, y: 150 })).toEqual([8, 0]);
  });
});

// ---- Nachbildung von MapLibre selbst -------------------------------------------

describe("FakeMap", () => {
  it("bildet once, Argumente und isStyleLoaded nach", () => {
    const map = new FakeMap({ zoom: 5 });
    const seen = [];
    map.once("idle", (payload) => seen.push(payload));
    map.fire("idle", "a");
    map.fire("idle", "b");
    expect(seen).toEqual(["a"]);
    expect(map.isStyleLoaded()).toBe(true);
    map.addSource("s", { type: "geojson" });
    map.getSource("s").setData({});
    expect(map.isStyleLoaded()).toBe(false);
    map.fire("idle");
    map.setStyle("x");
    expect(map.isStyleLoaded()).toBe(false);
  });
});

// ---- Lebenszyklus --------------------------------------------------------------

describe("Initialisierung", () => {
  it("legt nach Trennen und Neuverbinden während des Ladens nur eine Karte an", async () => {
    const card = newCard();
    card.hass = makeHass();
    document.body.appendChild(card); // Aufbau A wartet auf MapLibre
    card.remove();
    document.body.appendChild(card); // Aufbau B

    window.maplibregl = fakeMapLibre;
    mapLibreScript().dispatchEvent(new Event("load"));
    await flush();

    expect(maps).toHaveLength(1);
    expect(card._map).toBe(maps[0]);
  });

  it("startet keinen Abruf-Timer, wenn die Card vor dem Laden entfernt wurde", async () => {
    const setInterval = vi.spyOn(window, "setInterval");
    const card = newCard();
    card.hass = makeHass();
    document.body.appendChild(card);
    card.remove();

    window.maplibregl = fakeMapLibre;
    mapLibreScript().dispatchEvent(new Event("load"));
    await flush();

    expect(maps).toHaveLength(0);
    expect(setInterval).not.toHaveBeenCalled();
    setInterval.mockRestore();
  });

  it("meldet einen Ladefehler verständlich und lädt beim nächsten Versuch neu", async () => {
    const card = newCard();
    card.hass = makeHass();
    document.body.appendChild(card);
    const first = mapLibreScript();
    first.dispatchEvent(new Event("error"));
    await flush();

    expect(card.querySelector(".ortsnetz-status").textContent).toBe(
      "Fehler: MapLibre konnte nicht geladen werden",
    );
    expect(mapLibreScript()).toBeNull();

    const second = newCard();
    second.hass = makeHass();
    document.body.appendChild(second);
    expect(mapLibreScript()).not.toBeNull();
  });
});

describe("Kartenhintergrund nicht erreichbar", () => {
  async function mountedCard(hass = makeHass()) {
    window.maplibregl = fakeMapLibre;
    const card = newCard();
    card.hass = hass;
    document.body.appendChild(card);
    await vi.advanceTimersByTimeAsync(0);
    return { card, map: maps[0], hass };
  }
  const status = (card) => card.querySelector(".ortsnetz-status").textContent;

  beforeEach(() => vi.useFakeTimers());

  it("startet den Datenabruf direkt nach dem Kartenaufbau, ohne auf load zu warten", async () => {
    const { hass } = await mountedCard();
    expect(hass.connection.sendMessagePromise).toHaveBeenCalledWith({ type: "ortsnetz_map/get_points" });
  });

  it("ruft bei sichtbarem Tab nach Ablauf des Intervalls auch ohne load erneut ab", async () => {
    const { card, hass } = await mountedCard();
    hass.connection.sendMessagePromise.mockClear();
    card._lastLoad = 0;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(hass.connection.sendMessagePromise).toHaveBeenCalledTimes(1);
  });

  it("meldet Kachelfehler einmal entprellt in der Statuszeile, ohne console.error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { card, map } = await mountedCard();
    map.fire("style.load");
    card._setStatus("700 Messpunkte · 09:40");
    for (let i = 0; i < 50; i++) map.fire("error", { error: new Error("404"), sourceId: "openmaptiles", tile: {} });
    await vi.advanceTimersByTimeAsync(1000);
    expect(status(card)).toContain("700 Messpunkte · 09:40");
    expect(status(card)).toContain("Kartenhintergrund nicht erreichbar (tiles.openfreemap.org)");
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("schaltet auf einen Ersatzstil, wenn der Stil nicht lädt", async () => {
    const { card, map } = await mountedCard();
    map.fire("error", { error: new Error("Failed to fetch") });
    const { url } = map.setStyleCalls.at(-1);
    expect(url.layers).toEqual([{ id: "background", type: "background", paint: { "background-color": "#e5e7eb" } }]);
    expect(url.glyphs).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(status(card)).toContain("Kartenhintergrund nicht erreichbar");
  });

  it("nimmt im dunklen Theme den dunklen Ersatzstil", async () => {
    const { map } = await mountedCard(makeHass({ themes: { darkMode: true } }));
    map.fire("error", { error: new Error("Failed to fetch") });
    expect(map.setStyleCalls.at(-1).url.layers[0].paint["background-color"]).toBe("#1f2937");
  });

  it("schaltet auf den Ersatzstil, wenn der Stil nach 10 s noch nicht geladen ist", async () => {
    const { map } = await mountedCard();
    await vi.advanceTimersByTimeAsync(9000);
    expect(map.setStyleCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(map.setStyleCalls.at(-1).url.layers[0].id).toBe("background");
  });

  it("bleibt beim echten Stil, wenn er rechtzeitig lädt", async () => {
    const { map } = await mountedCard();
    map.fire("style.load");
    map.fire("error", { error: new Error("404"), sourceId: "openmaptiles" });
    await vi.advanceTimersByTimeAsync(15000);
    expect(map.setStyleCalls).toHaveLength(0);
  });

  it("versucht nach dem Ersatzstil beim nächsten Theme-Wechsel wieder den echten Stil", async () => {
    const { card, map } = await mountedCard();
    map.fire("error", { error: new Error("Failed to fetch") });
    map.fire("style.load"); // Ersatzstil geladen
    card.hass = makeHass({ themes: { darkMode: true } });
    expect(map.setStyleCalls.at(-1).url).toContain("tiles.openfreemap.org/styles/dark");
  });
});

describe("Theme-Wechsel", () => {
  const own = [
    { id: "ortsnetz-clusters", type: "circle", source: "ortsnetz-points" },
    { id: "ortsnetz-cluster-count", type: "symbol", source: "ortsnetz-cluster-labels" },
    { id: "ortsnetz-points", type: "circle", source: "ortsnetz-points" },
  ];
  const source = { type: "geojson", cluster: true, data: { type: "FeatureCollection", features: [] } };
  const labels = { ...source };

  async function transform() {
    window.maplibregl = fakeMapLibre;
    const card = newCard();
    card.hass = makeHass();
    document.body.appendChild(card);
    await flush();
    card.hass = makeHass({ themes: { darkMode: true } });
    const [{ url, options }] = maps[0].setStyleCalls;
    expect(url).toContain("dark");
    // Ohne Diff: MapLibre feuert style.load und die Card legt fehlende Layer an
    // (ein per Diff übernommener Stil feuert kein style.load).
    expect(options.diff).toBe(false);
    return options.transformStyle;
  }

  it("übernimmt Quelle und alle eigenen Layer in Reihenfolge in den neuen Stil", async () => {
    const transformStyle = await transform();
    const next = transformStyle(
      { sources: { "ortsnetz-points": source, "ortsnetz-cluster-labels": labels }, layers: [{ id: "old-bg" }, ...own] },
      { glyphs: "https://example.org/{fontstack}/{range}.pbf", sources: { base: {} }, layers: [{ id: "background" }] },
    );
    expect(next.sources["ortsnetz-points"]).toBe(source);
    expect(next.sources["ortsnetz-cluster-labels"]).toBe(labels);
    expect(next.sources.base).toEqual({});
    expect(next.layers.map((item) => item.id)).toEqual(["background", "ortsnetz-clusters", "ortsnetz-cluster-count", "ortsnetz-points"]);
  });

  it("lässt den Zähler weg, wenn der neue Stil keine Glyphen hat", async () => {
    const transformStyle = await transform();
    const next = transformStyle(
      { sources: { "ortsnetz-points": source, "ortsnetz-cluster-labels": labels }, layers: own },
      { sources: {}, layers: [{ id: "background" }] },
    );
    expect(Object.keys(next.sources)).toEqual(["ortsnetz-points"]);
    expect(next.layers.map((item) => item.id)).toEqual(["background", "ortsnetz-clusters", "ortsnetz-points"]);
  });

  it("wartet nicht auf idle, sondern legt fehlende Layer bei style.load wieder an", async () => {
    await transform();
    const map = maps[0];
    expect(map.handlers.idle || []).toHaveLength(0);
  });
});

// ---- Daten -----------------------------------------------------------------------

describe("Abruf der Messwerte", () => {
  it("verwirft eine ältere Antwort, die nach einer neueren eintrifft", async () => {
    const pending = [];
    const card = newCard();
    card._hass = makeHass({
      connection: { sendMessagePromise: () => new Promise((resolve) => pending.push(resolve)) },
    });
    card._statusElement = document.createElement("div");

    const older = card._loadMeasurements();
    const newer = card._loadMeasurements();
    pending[1]({ points: [{ id: "neu" }] });
    pending[0]({ points: [{ id: "alt" }] });
    await Promise.all([older, newer]);

    expect(card._currentData.points[0].id).toBe("neu");
  });

  it("unterscheidet fehlende Daten und fehlende Integration", async () => {
    const card = newCard();
    card._statusElement = document.createElement("div");
    for (const [code, text] of [
      ["no_data", "Keine Daten von ortsnetz-auslastung.de – später erneut versuchen"],
      ["not_loaded", "Integration Ortsnetz Map nicht eingerichtet"],
      ["other", "Backend nicht erreichbar – Integration prüfen"],
    ]) {
      card._hass = makeHass({ connection: { sendMessagePromise: () => Promise.reject({ code }) } });
      vi.spyOn(console, "error").mockImplementation(() => {});
      await card._loadMeasurements();
      expect(card._statusElement.textContent).toBe(text);
    }
  });
});

// ---- Touch-Bedienung --------------------------------------------------------------

describe("Touch-Bedienung", () => {
  async function mapFor(config) {
    window.maplibregl = fakeMapLibre;
    const card = newCard();
    card.setConfig(config);
    card.hass = makeHass();
    document.body.appendChild(card);
    await flush();
    return maps[0];
  }

  it("sperrt Drehen und Kippen", async () => {
    const map = await mapFor({});
    expect(map.options).toMatchObject({ dragRotate: false, pitchWithRotate: false, touchPitch: false });
    expect(map.touchZoomRotate.rotationDisabled).toBe(true);
    expect(map.keyboard.rotationDisabled).toBe(true);
  });

  it("nutzt standardmäßig kooperative Gesten mit deutschen Hinweisen", async () => {
    const map = await mapFor({});
    expect(map.options.cooperativeGestures).toBe(true);
    expect(map.options.locale).toEqual({
      "CooperativeGesturesHandler.WindowsHelpText": "Strg + Mausrad zum Zoomen der Karte",
      "CooperativeGesturesHandler.MacHelpText": "⌘ + Mausrad zum Zoomen der Karte",
      "CooperativeGesturesHandler.MobileHelpText": "Karte mit zwei Fingern bewegen",
    });
  });

  it("verzichtet mit cooperative_gestures: false darauf, Drehen bleibt gesperrt", async () => {
    const map = await mapFor({ cooperative_gestures: false });
    expect(map.options.cooperativeGestures).toBeFalsy();
    expect(map.options.dragRotate).toBe(false);
    expect(map.touchZoomRotate.rotationDisabled).toBe(true);
  });

  it("schlägt die Option im Kartenpicker vor", () => {
    expect(customElements.get("ortsnetz-map-card").getStubConfig().cooperative_gestures).toBe(true);
  });

  it("zeigt im Editor eine angehakte Checkbox und schreibt false beim Abwählen", () => {
    const editor = document.createElement("ortsnetz-map-card-editor");
    editor.setConfig({});
    editor.hass = makeHass();
    const box = editor.shadowRoot.querySelector('[data-key="cooperative_gestures"]');
    expect(box.checked).toBe(true);
    expect(box.closest("label").textContent).toContain("Zwei Finger zum Verschieben");
    const events = [];
    editor.addEventListener("config-changed", (event) => events.push(event.detail.config));
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(events.at(-1).cooperative_gestures).toBe(false);
  });
});

// ---- Fehlerverhalten beim Abruf -------------------------------------------------------

describe("Abruf nach Fehlern", () => {
  let handlers;
  let calls;
  let answers;

  async function mounted() {
    handlers = {};
    calls = 0;
    const connection = {
      sendMessagePromise: vi.fn(() => {
        calls += 1;
        const answer = answers.shift() ?? "fail";
        return answer === "fail" ? Promise.reject({ code: "other" }) : Promise.resolve(answer);
      }),
      addEventListener: vi.fn((type, handler) => { (handlers[type] ||= []).push(handler); }),
      removeEventListener: vi.fn((type, handler) => { handlers[type] = (handlers[type] || []).filter((h) => h !== handler); }),
    };
    window.maplibregl = fakeMapLibre;
    const card = newCard();
    card.hass = makeHass({ connection });
    document.body.appendChild(card);
    await vi.advanceTimersByTimeAsync(0);
    return { card, connection };
  }
  const status = (card) => card.querySelector(".ortsnetz-status").textContent;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("versucht es nach 15, 30 und 60 s erneut, danach nur im normalen Intervall", async () => {
    answers = [];
    await mounted();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(14000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(30000);
    expect(calls).toBe(3);
    await vi.advanceTimersByTimeAsync(60000);
    expect(calls).toBe(4);
    // Keine weitere Wiederholung, erst das Intervall (300 s ab Start).
    await vi.advanceTimersByTimeAsync(180000);
    expect(calls).toBe(4);
    await vi.advanceTimersByTimeAsync(20000);
    expect(calls).toBe(5);
  });

  it("wiederholt nicht bei verborgenem Tab", async () => {
    answers = [];
    await mounted();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    try {
      await vi.advanceTimersByTimeAsync(16000);
      expect(calls).toBe(1);
    } finally {
      delete document.hidden;
    }
  });

  it("zeigt „Lade …“ nur beim ersten Laden und bei Fehlern den letzten Stand", async () => {
    vi.setSystemTime(new Date("2026-10-12T09:40:00"));
    answers = [{ points: [{ public_id: "a" }] }];
    const { card } = await mounted();
    expect(status(card)).toBe("1 Messpunkte · 09:40");
    vi.setSystemTime(new Date("2026-10-12T09:45:00"));
    const loading = card._loadMeasurements();
    expect(status(card)).toBe("1 Messpunkte · 09:40");
    await loading;
    expect(status(card)).toBe("Aktualisierung fehlgeschlagen, zeige Stand 09:40");
    expect(card._currentData.points).toHaveLength(1);
  });

  it("setzt die Wiederholung nach Erfolg zurück", async () => {
    answers = ["fail", { points: [] }];
    await mounted();
    await vi.advanceTimersByTimeAsync(15000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(100000);
    expect(calls).toBe(2);
  });

  it("ruft nach Wiederverbindung des WebSockets sofort ab und meldet sich beim Entfernen ab", async () => {
    answers = [{ points: [] }, { points: [] }];
    const { card, connection } = await mounted();
    expect(connection.addEventListener).toHaveBeenCalledWith("ready", expect.any(Function));
    handlers.ready.forEach((handler) => handler());
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    card.remove();
    expect(handlers.ready).toHaveLength(0);
  });
});

// ---- Diagnose ----------------------------------------------------------------------

describe("Diagnosezeile", () => {
  it("ist ohne debug ausgeblendet", async () => {
    window.maplibregl = fakeMapLibre;
    const card = newCard();
    card.setConfig({});
    card.hass = makeHass();
    document.body.appendChild(card);
    await flush();
    expect(card.querySelector(".ortsnetz-debug").hidden).toBe(true);
  });

  it("zeigt mit debug: true Zoom, gesetzte Punkte, Cluster und sichtbare Einzelpunkte", async () => {
    window.maplibregl = fakeMapLibre;
    const card = newCard();
    card.setConfig({ debug: true });
    card.hass = makeHass();
    document.body.appendChild(card);
    await flush();
    const map = maps[0];
    map.zoom = 8.43;
    map.fire("style.load");
    card._renderPoints({ points: [POINT] });
    const points = { id: "ortsnetz-points" };
    const clusters = { id: "ortsnetz-clusters" };
    map.renderedFeatures = [
      { layer: points, properties: { public_id: "a" } },
      { layer: points, properties: { public_id: "b" } },
      { layer: points, properties: { public_id: "b" } }, // Kachelgrenze: doppelt geliefert
      { layer: clusters, properties: { cluster_id: 1, point_count: 5 } },
      { layer: clusters, properties: { cluster_id: 2, point_count: 7 } },
    ];
    card._allFeatures = new Array(312);
    map.fire("idle");
    const element = card.querySelector(".ortsnetz-debug");
    expect(element.hidden).toBe(false);
    expect(element.textContent).toBe("Zoom 8,4 · 312 Punkte gesetzt · 2 Cluster (12 Punkte) · 2 Einzel sichtbar");
  });
});

// ---- Editor ------------------------------------------------------------------------

describe("Editor", () => {
  it("behält Eingabefelder bei hass-Updates", () => {
    const editor = document.createElement("ortsnetz-map-card-editor");
    editor.setConfig({ zoom: 10 });
    editor.hass = makeHass();
    const zoom = editor.shadowRoot.querySelector('[data-key="zoom"]');

    editor.hass = makeHass();
    editor.setConfig({ zoom: 10 });
    expect(editor.shadowRoot.querySelector('[data-key="zoom"]')).toBe(zoom);

    editor.setConfig({ zoom: 12 });
    expect(editor.shadowRoot.querySelector('[data-key="zoom"]').value).toBe("12");
  });
});
