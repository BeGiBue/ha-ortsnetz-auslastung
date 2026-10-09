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
    this.sources = {};
    this.layers = [];
    this.removed = false;
    this.setStyleCalls = [];
    maps.push(this);
  }
  on(event, ...args) {
    const handler = args[args.length - 1];
    (this.handlers[event] ||= []).push(handler);
    return this;
  }
  once(event, handler) {
    return this.on(event, handler);
  }
  fire(event) {
    for (const handler of this.handlers[event] || []) handler();
  }
  addControl() {}
  remove() { this.removed = true; }
  resize() {}
  getZoom() { return this.zoom; }
  project([lng, lat]) { return { x: lng * 1000, y: lat * 1000 }; }
  getBounds() {
    return { getWest: () => -180, getEast: () => 180, getSouth: () => -90, getNorth: () => 90 };
  }
  getSource(id) { return this.sources[id]; }
  addSource(id, source) { this.sources[id] = { ...source, setData: (data) => { this.sources[id].data = data; } }; }
  addLayer(layer) { this.layers.push(layer); }
  isStyleLoaded() { return true; }
  getCanvas() { return { style: {} }; }
  setStyle(url, options) { this.setStyleCalls.push({ url, options }); }
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
    const cluster = card._clusterElement({ normal: 2, warn_high: 1 }, 3);
    expect(cluster.innerHTML).not.toContain("onmouseover");
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
    card._map = map;
    card._maplibregl = fakeMapLibre;
    card._mapLoaded = true;
    card._renderPoints({ points: [{ latitude: 52, longitude: 13, l1_v: 230, forecast_yield: 4.2 }] });
    const [feature] = map.sources["ortsnetz-points"].data.features;
    expect(feature.properties.forecast_yield).toBe(4.2);
    expect(card._popupHtml(feature.properties)).toContain("4.20 kWh/kWp/Tag");
  });
});

// ---- Cluster -------------------------------------------------------------------

describe("Cluster", () => {
  const features = [
    { geometry: { coordinates: [13.0, 52.0] }, properties: { status: "normal" } },
    { geometry: { coordinates: [13.001, 52.001] }, properties: { status: "normal" } },
  ];

  it("fasst bis unter Zoom 12 zusammen und zeigt ab Zoom 12 Einzelpunkte", () => {
    const card = newCard();
    card._allFeatures = features;
    card._map = new FakeMap({ zoom: 11.9 });
    expect(card._computeClusters().clusters).toHaveLength(1);
    card._map.zoom = 12;
    const result = card._computeClusters();
    expect(result.clusters).toHaveLength(0);
    expect(result.singles).toHaveLength(2);
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

describe("Theme-Wechsel", () => {
  it("übernimmt die eigene Quelle und Ebene in den neuen Stil", async () => {
    window.maplibregl = fakeMapLibre;
    const card = newCard();
    card.hass = makeHass();
    document.body.appendChild(card);
    await flush();

    card.hass = makeHass({ themes: { darkMode: true } });
    const [{ url, options }] = maps[0].setStyleCalls;
    expect(url).toContain("dark");

    const source = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    const layer = { id: "ortsnetz-points", type: "circle", source: "ortsnetz-points" };
    const next = options.transformStyle(
      { sources: { "ortsnetz-points": source }, layers: [layer] },
      { sources: { base: {} }, layers: [{ id: "background" }] },
    );
    expect(next.sources["ortsnetz-points"]).toBe(source);
    expect(next.layers.map((item) => item.id)).toEqual(["background", "ortsnetz-points"]);
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
