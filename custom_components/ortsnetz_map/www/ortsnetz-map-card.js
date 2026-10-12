// Ortsnetz Map Card v2.0.2
// MapLibre GL wird von der Integration selbst ausgeliefert (kein externes CDN).
const MAPLIBRE_VERSION = "5.7.1";
const MAPLIBRE_BASE = "/ortsnetz_map/maplibre";
const MAPLIBRE_JS = `${MAPLIBRE_BASE}/maplibre-gl.js?v=${MAPLIBRE_VERSION}`;
const MAPLIBRE_CSS = `${MAPLIBRE_BASE}/maplibre-gl.css?v=${MAPLIBRE_VERSION}`;
const OPENFREEMAP_LIGHT_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const OPENFREEMAP_DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";
// Lädt der Stil nicht (Pi-hole, offline, App ohne Internet), zeigt die Karte die
// Punkte auf einem neutralen Hintergrund. Ohne glyphs entfällt der Zähler-Layer.
const STYLE_TIMEOUT_MS = 10000;
const BASEMAP_PROBLEM = "Kartenhintergrund nicht erreichbar (tiles.openfreemap.org)";
function fallbackStyle(dark) {
  return {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": dark ? "#1f2937" : "#e5e7eb" } }],
  };
}

const SOURCE_ID = "ortsnetz-points";
// Eigene Quelle (gleiche Daten und Cluster-Einstellungen) nur für den Zähler: Kann
// MapLibre die Schrift nicht laden, verwirft es die ganze Kachel dieser Quelle.
// So fehlt dann nur die Zahl, Cluster und Einzelpunkte bleiben sichtbar.
const LABEL_SOURCE_ID = "ortsnetz-cluster-labels";
const CLUSTER_LAYER_ID = "ortsnetz-clusters";
const COUNT_LAYER_ID = "ortsnetz-cluster-count";
const LAYER_ID = "ortsnetz-points"; // Einzelpunkte
// Eigene Layer von unten nach oben.
const OWN_LAYER_IDS = [CLUSTER_LAYER_ID, COUNT_LAYER_ID, LAYER_ID];
// MapLibre fasst bis Zoom 11 zusammen, ab Zoom 12 erscheinen nur Einzelpunkte.
const CLUSTER_MAX_ZOOM = 11;
const CLUSTER_RADIUS = 45;
// Schrift aus dem Glyphensatz beider OpenFreeMap-Stile (Liberty und Dark).
const COUNT_FONT = ["Noto Sans Regular"];
// Treffbereich um den Tipp- bzw. Klickpunkt in Pixeln (Touch).
const HIT_TOLERANCE = 10;
// Abstand des Popups zum Kartenrand in Pixeln.
const POPUP_MARGIN = 12;
const STALE_AFTER_MS = 20 * 60 * 1000;

const HISTORY_GAP_MS = 12 * 60 * 1000; // größere Lücken unterbrechen die Linie
const PHASE_COLORS = ["#2563eb", "#db2777", "#0d9488"];
const BAND_COLORS = { warn: "rgba(245,158,11,0.28)", crit: "rgba(185,28,28,0.32)" };

const DEFAULT_SCALE = { criticalLow: 207, warningLow: 218, warningHigh: 242, criticalHigh: 253 };

// Reihenfolge = Rangfolge bei Gleichstand (Unterspannung vor Überspannung).
// rank: Farbe eines Clusters = höchster Rang seiner Punkte (schlechtester Wert,
// bei gleicher Schwere Unterspannung).
const STATUSES = [
  { key: "crit_low", group: "Unterspannung", label: "unter 207 V", color: "#1d4ed8", severity: 2, low: true, rank: 4 },
  { key: "warn_low", group: "Unterspannung", label: "207 – 218 V", color: "#38bdf8", severity: 1, low: true, rank: 2 },
  { key: "normal", group: "Normalzustand", label: "218 – 242 V", color: "#16a34a", severity: 0, low: false, rank: 0 },
  { key: "warn_high", group: "Überspannung", label: "242 – 253 V", color: "#f59e0b", severity: 1, low: false, rank: 1 },
  { key: "crit_high", group: "Überspannung", label: "über 253 V", color: "#b91c1c", severity: 2, low: false, rank: 3 },
];
const STATUS_BY_KEY = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
const LEGEND_GROUPS = ["Normalzustand", "Unterspannung", "Überspannung"];

// Je Cluster: Anzahl Punkte je Status (für die Tortendiagramme) und der höchste Rang.
const CLUSTER_PROPERTIES = {
  ...Object.fromEntries(
    STATUSES.map((s) => [s.key, ["+", ["case", ["==", ["get", "status"], s.key], 1, 0]]]),
  ),
  worst: ["max", ["get", "rank"]],
};

// Zuordnung der Zähler aus /v1/map/threshold-stats (Messungen der letzten 24 Stunden).
const STATS_FIELDS = {
  crit_low: "under_voltage_critical_measurements",
  warn_low: "under_voltage_warning_measurements",
  normal: "normal_measurements",
  warn_high: "over_voltage_warning_measurements",
  crit_high: "over_voltage_critical_measurements",
};

const DEFAULT_CONFIG = {
  zoom: 10,
  phase: "auto",
  refresh_interval: 300,
  show_status: true,
  show_legend: true,
  // Ein Finger scrollt die Seite, zwei Finger bewegen die Karte (Strg + Mausrad zoomt).
  cooperative_gestures: true,
  debug: false,
};

// Eingaben der Konfiguration: Zahlenbereiche [min, max].
const CONFIG_RANGES = { zoom: [1, 19], refresh_interval: [60, 3600], latitude: [-90, 90], longitude: [-180, 180] };

// Vollständige, bereinigte Konfiguration der Card (Standardwerte ergänzt).
function normalizeConfig(config) {
  const merged = { ...DEFAULT_CONFIG, ...config };
  merged.zoom = clamp(merged.zoom, 1, 19, 10);
  merged.refresh_interval = clamp(merged.refresh_interval, 60, 3600, 300);
  merged.phase = ["auto", "L1", "L2", "L3"].includes(String(merged.phase)) ? String(merged.phase) : "auto";
  merged.show_status = merged.show_status !== false;
  merged.show_legend = merged.show_legend !== false;
  merged.debug = merged.debug === true;
  merged.cooperative_gestures = merged.cooperative_gestures !== false;
  for (const key of ["latitude", "longitude"]) {
    const value = toNumber(merged[key]);
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

const CONFIG_KEYS = [...Object.keys(DEFAULT_CONFIG), "latitude", "longitude"];

// Hinweistexte der kooperativen Gesten (Schlüssel aus MapLibre 5.7.1).
const COOPERATIVE_LOCALE = {
  "CooperativeGesturesHandler.WindowsHelpText": "Strg + Mausrad zum Zoomen der Karte",
  "CooperativeGesturesHandler.MacHelpText": "⌘ + Mausrad zum Zoomen der Karte",
  "CooperativeGesturesHandler.MobileHelpText": "Karte mit zwei Fingern bewegen",
};

// Nach einem fehlgeschlagenen Abruf erneut versuchen (Sekunden), danach nur im Intervall.
const RETRY_DELAYS = [15, 30, 60];

let mapLibrePromise;

function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mapLibrePromise) return mapLibrePromise;

  mapLibrePromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${MAPLIBRE_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = MAPLIBRE_CSS;
      document.head.appendChild(link);
    }

    const fail = (script) => {
      // Fehlgeschlagenes Laden nicht zwischenspeichern, damit ein späterer Versuch neu lädt.
      mapLibrePromise = undefined;
      script?.remove();
      reject(new Error("MapLibre konnte nicht geladen werden"));
    };
    const done = () => {
      if (!window.maplibregl) return fail(null);
      // Danach genügt die Prüfung auf window.maplibregl.
      mapLibrePromise = undefined;
      resolve(window.maplibregl);
    };

    const existing = document.querySelector(`script[src="${MAPLIBRE_JS}"]`);
    if (existing) {
      if (window.maplibregl) {
        resolve(window.maplibregl);
      } else {
        existing.addEventListener("load", done, { once: true });
        existing.addEventListener("error", () => fail(existing), { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = MAPLIBRE_JS;
    script.onload = done;
    script.onerror = () => fail(script);
    document.head.appendChild(script);
  });

  return mapLibrePromise;
}

// Text für innerHTML/setHTML: API-Werte dürfen kein HTML einschleusen.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Nur einfache Farbwerte der API übernehmen (Hex, rgb/rgba, hsl/hsla), sonst null.
const COLOR_PATTERN = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/]+\))$/i;
function safeColor(value) {
  return typeof value === "string" && COLOR_PATTERN.test(value.trim()) ? value.trim() : null;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

// Leere Werte und -1 (nicht gemessen) ergeben null.
function toNumber(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toVoltage(value) {
  const number = toNumber(value);
  return number !== null && number > 0 ? number : null;
}

// Erwarteter spezifischer PV-Ertrag in kWh/kWp/Tag (null ohne Forecast).
function forecastValue(point) {
  for (const key of ["forecast_kwh_per_kwp_day", "forecast_yield"]) {
    const number = toNumber(point[key]);
    if (number !== null && number >= 0) return number;
  }
  return null;
}

// Für die Markergröße auf 0–10 begrenzt.
function forecastYield(point) {
  const value = forecastValue(point);
  return value === null ? null : Math.min(10, value);
}

function isStaleFlag(value) {
  return value === true || value === "true";
}

// [lng, lat] oder null: endliche Zahlen im gültigen Bereich, nicht beide 0.
function toCoordinate(point) {
  const lat = toNumber(point?.latitude);
  const lng = toNumber(point?.longitude);
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return [lng, lat];
}

// Verschiebung [dx, dy] für map.panBy, damit das Popup mit margin Pixeln Rand in der
// Karte liegt (panBy bewegt den Inhalt um -dx/-dy). Alle Werte in Pixeln relativ zur
// Karte. Ist das Popup zu groß, wird oben bzw. links ausgerichtet (Schließen-Kreuz und
// Anfang des Inhalts sichtbar). Der angetippte Punkt bleibt immer im Blickfeld.
function popupPanOffset(popup, view, point, margin = POPUP_MARGIN) {
  const axis = (start, end, size, at) => {
    let shift = 0;
    if (end - start > size - 2 * margin || start < margin) shift = start - margin;
    else if (end > size - margin) shift = end - (size - margin);
    const min = at - (size - margin);
    const max = at - margin;
    return Math.round(Math.min(max, Math.max(min, shift))) + 0;
  };
  return [axis(popup.left, popup.right, view.width, point.x), axis(popup.top, popup.bottom, view.height, point.y)];
}

// Kurzer Hash (cyrb53) zum Erkennen geänderter Daten.
function hashString(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length}:${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
}

// Für setStyle: eigene Quellen und alle eigenen Layer (in ihrer Reihenfolge) in den
// neuen Stil übernehmen. Ohne Glyphen im neuen Stil entfällt der Zähler (Symbol-Layer).
function keepOwnLayers(previous, next) {
  const source = previous?.sources?.[SOURCE_ID];
  if (!source) return next;
  const own = (previous.layers || []).filter(
    (layer) => OWN_LAYER_IDS.includes(layer.id) && (layer.type !== "symbol" || next.glyphs),
  );
  const sources = { ...next.sources, [SOURCE_ID]: source };
  const labels = previous.sources[LABEL_SOURCE_ID];
  if (labels && own.some((layer) => layer.source === LABEL_SOURCE_ID)) sources[LABEL_SOURCE_ID] = labels;
  return {
    ...next,
    sources,
    layers: [...next.layers.filter((layer) => !OWN_LAYER_IDS.includes(layer.id)), ...own],
  };
}

// Statustext je Fehlerursache des WebSocket-Befehls.
function loadErrorText(error) {
  switch (error?.code) {
    case "no_data":
      return "Keine Daten von ortsnetz-auslastung.de – später erneut versuchen";
    case "not_loaded":
    case "unknown_command":
      return "Integration Ortsnetz Map nicht eingerichtet";
    default:
      return "Backend nicht erreichbar – Integration prüfen";
  }
}

class OrtsnetzMapCard extends HTMLElement {
  constructor() {
    super();
    this._config = { ...DEFAULT_CONFIG };
    this._hass = null;
    this._map = null;
    this._resizeObserver = null;
    this._refreshTimer = null;
    this._lastThemeDark = null;
    this._currentData = null;
    this._initialized = false;
    this._popup = null;
    this._lastLoad = 0;
    this._scale = { ...DEFAULT_SCALE };
    this._colors = Object.fromEntries(STATUSES.map((s) => [s.key, s.color]));
    this._enabled = new Set(STATUSES.map((s) => s.key));
    this._legendOpen = true;
    this._maplibregl = null;
    this._onVisibilityChange = () => this._handleVisibility();
    // Nach Wiederverbindung des WebSockets sofort neu abrufen.
    this._onReconnect = () => {
      if (this._map) this._loadMeasurements();
    };
    // Zuletzt berechnete Features (immer aktuell) und der Stand in der Kartenquelle.
    this._allFeatures = [];
    this._featuresHash = null;
    this._sourceHash = null;
    this._paintedColors = null;
    // Erhöht sich bei jedem Auf- und Abbau; veraltete async-Schritte brechen damit ab.
    this._generation = 0;
    this._loadRequest = 0;
  }

  // Home Assistant ruft setConfig bei jeder Bearbeitung im Editor auf: Karte nie neu
  // aufbauen, sondern nur das Geänderte anpassen.
  setConfig(config) {
    const previous = this._config;
    this._config = normalizeConfig(config);
    if (this._initialized) this._applyConfigChange(previous, this._config);
  }

  _applyConfigChange(previous, next) {
    const changed = (key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]);
    if (!CONFIG_KEYS.some(changed)) return;
    if (this._statusElement) this._statusElement.hidden = !next.show_status;
    if (this._legendElement) {
      this._legendElement.hidden = !next.show_legend;
      this._renderLegend();
    }
    if (this._debugElement) this._debugElement.hidden = !next.debug;
    const map = this._map;
    if (!map) return;
    if (next.debug) {
      this._watchDebug();
      this._updateDebug();
    }
    if (["zoom", "latitude", "longitude"].some(changed)) {
      map.jumpTo({ center: this._initialCenter(), zoom: next.zoom });
    }
    if (changed("refresh_interval")) this._startRefreshTimer();
    if (changed("phase")) this._renderPoints(this._currentData);
    if (changed("cooperative_gestures")) {
      if (next.cooperative_gestures) map.cooperativeGestures.enable();
      else map.cooperativeGestures.disable();
    }
  }

  set hass(hass) {
    const firstSet = !this._hass;
    this._hass = hass;

    if (firstSet && this.isConnected) {
      this._initialize();
    } else if (this._map) {
      this._watchConnection();
      this._applyTheme();
    }
  }

  connectedCallback() {
    if (this._hass) this._initialize();
  }

  disconnectedCallback() {
    this._destroy();
  }

  _destroy(clearMarkup = true) {
    this._generation += 1;
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    document.removeEventListener("visibilitychange", this._onVisibilityChange);
    clearTimeout(this._retryTimer);
    this._retryTimer = null;
    this._retryCount = 0;
    this._connection?.removeEventListener?.("ready", this._onReconnect);
    this._connection = null;
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    this._cornerObserver?.disconnect();
    this._cornerObserver = null;
    if (this._popup) {
      this._popup.remove();
      this._popup = null;
    }
    this._sourceHash = null;
    this._paintedColors = null;
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
    this._mapElement = null;
    this._statusElement = null;
    this._debugElement = null;
    this._legendElement = null;
    this._initialized = false;
    this._debugWatched = false;
    clearTimeout(this._styleTimer);
    clearTimeout(this._problemTimer);
    this._problemTimer = null;
    this._mapProblem = null;
    this._styleReady = false;
    this._fallbackActive = false;
    this._lastThemeDark = null;
    if (clearMarkup) this.innerHTML = "";
  }

  async _initialize() {
    if (this._initialized || this._map || !this._hass) return;
    this._initialized = true;
    const generation = ++this._generation;

    this.innerHTML = `
      <ha-card>
        <style>
          @import url("${MAPLIBRE_CSS}");
          :host { display:block; width:100%; height:100%; min-height:0; }
          ha-card { display:block; box-sizing:border-box; width:100%; height:100%; min-height:0; overflow:hidden; }
          .ortsnetz-wrap { position:relative; overflow:hidden; border-radius:var(--ha-card-border-radius, 12px); width:100%; height:100%; min-height:168px; }
          .ortsnetz-map { width:100%; height:100%; min-height:168px; background:var(--primary-background-color); }
          .ortsnetz-status { white-space:pre-line; box-sizing:border-box; max-width:min(60%, calc(100% - 140px)); position:absolute; z-index:5; left:10px; bottom:var(--ortsnetz-overlay-bottom, 40px); padding:6px 9px; border-radius:7px; font-size:11px; background:color-mix(in srgb, var(--card-background-color) 92%, transparent); color:var(--primary-text-color); box-shadow:0 1px 4px rgba(0,0,0,.2); pointer-events:none; }
          .ortsnetz-status[hidden] { display:none; }
          .ortsnetz-debug { position:absolute; z-index:5; left:10px; top:10px; margin-left:44px; padding:4px 7px; border-radius:6px; font:11px/1.3 monospace; background:rgba(0,0,0,.72); color:#fff; pointer-events:none; }
          .ortsnetz-debug[hidden] { display:none; }
          .ortsnetz-legend { position:absolute; z-index:5; right:10px; bottom:var(--ortsnetz-overlay-bottom, 40px); max-width:min(240px, calc(100% - 20px)); max-height:calc(100% - var(--ortsnetz-overlay-bottom, 40px) - 32px); overflow:auto; box-sizing:border-box; padding:8px 11px; border-radius:8px; font-size:12px; line-height:1.35; background:color-mix(in srgb, var(--card-background-color) 94%, transparent); color:var(--primary-text-color); box-shadow:0 1px 6px rgba(0,0,0,.25); }
          .ortsnetz-legend[hidden] { display:none; }
          .legend-head { display:flex; align-items:center; justify-content:space-between; gap:12px; font-weight:700; font-size:13px; cursor:pointer; user-select:none; }
          .legend-toggle { font-weight:400; font-size:16px; line-height:1; opacity:.7; }
          .legend-sub { margin-top:2px; color:var(--secondary-text-color); }
          .legend-group { margin-top:8px; font-weight:700; }
          .legend-subgroup { margin-top:6px; font-weight:600; }
          .legend-row { display:flex; align-items:center; gap:7px; margin-top:3px; cursor:pointer; }
          .legend-dot { flex:0 0 auto; width:12px; height:12px; border-radius:50%; border:1.5px solid #fff; box-shadow:0 0 0 1px rgba(0,0,0,.25); }
          .legend-text { flex:1 1 auto; }
          .legend-count { font-variant-numeric:tabular-nums; font-weight:600; }
          .legend-row input { margin:0 0 0 4px; accent-color:var(--primary-color); }
          .legend-row.off { opacity:.45; }
          .legend-size { margin-top:8px; }
          /* Popup über Legende, Statuszeile (z-index 5) und Zoom-Schaltflächen. */
          .maplibregl-popup { z-index:6; }
          /* Hinweis der kooperativen Gesten unter Legende und Statuszeile (z-index 5). */
          .maplibregl-cooperative-gesture-screen { z-index:4; }
          .maplibregl-popup-content { background:var(--card-background-color); color:var(--primary-text-color); border-radius:10px; box-shadow:0 2px 10px rgba(0,0,0,.25); }
          .maplibregl-popup-anchor-bottom .maplibregl-popup-tip { border-top-color:var(--card-background-color); }
          .maplibregl-popup-anchor-top .maplibregl-popup-tip { border-bottom-color:var(--card-background-color); }
          .maplibregl-popup-anchor-left .maplibregl-popup-tip { border-right-color:var(--card-background-color); }
          .maplibregl-popup-anchor-right .maplibregl-popup-tip { border-left-color:var(--card-background-color); }
          .maplibregl-popup-close-button { color:var(--primary-text-color); font-size:18px; }
          .maplibregl-ctrl-group { background:var(--card-background-color); }
          .maplibregl-ctrl-group button { color:var(--primary-text-color); }
          .maplibregl-ctrl-attrib { background:color-mix(in srgb, var(--card-background-color) 88%, transparent) !important; color:var(--secondary-text-color); font-size:9px; }
          .maplibregl-ctrl-attrib a { color:var(--primary-color); }
          .popup-title { font-size:15px; font-weight:700; margin-bottom:8px; }
          .popup-value { font-weight:600; }
          .popup-phase { display:flex; align-items:center; gap:6px; }
          .popup-dot { display:inline-block; width:10px; height:10px; border-radius:50%; }
          .popup-muted { opacity:.6; font-weight:400; }
          .popup-time { margin-top:8px; font-size:11px; opacity:.7; }
          .popup-warning { margin-top:8px; font-size:12px; }
          .popup-charts { margin-top:10px; min-width:0; width:min(280px, calc(var(--ortsnetz-map-width, 400px) - 64px)); }
          /* Popup-Inhalt scrollt, wenn er höher als die Karte wäre (Spitze 10 px, Innenabstand 30 px,
             Rand 2 × 12 px). Das Schließen-Kreuz liegt außerhalb und bleibt sichtbar. */
          .popup-scroll { max-height:calc(var(--ortsnetz-map-height, 400px) - 64px); overflow:auto; overscroll-behavior:contain; }
          .chart-title { display:flex; justify-content:space-between; gap:8px; margin-top:6px; font-size:11px; font-weight:600; }
          .chart-title .phase { font-weight:700; margin-left:6px; }
          .chart-svg { display:block; width:100%; height:auto; }
          .chart-svg text { fill:currentColor; opacity:.65; font-size:9px; }
          .chart-svg .grid { stroke:currentColor; opacity:.15; }
        </style>
        <div class="ortsnetz-wrap">
          <div class="ortsnetz-map"></div>
          <div class="ortsnetz-status" ${this._config.show_status ? "" : "hidden"}>Lade Messwerte …</div>
          <div class="ortsnetz-legend" ${this._config.show_legend ? "" : "hidden"}></div>
          <div class="ortsnetz-debug" ${this._config.debug ? "" : "hidden"}></div>
        </div>
      </ha-card>`;

    this._mapElement = this.querySelector(".ortsnetz-map");
    this._statusElement = this.querySelector(".ortsnetz-status");
    this._debugElement = this.querySelector(".ortsnetz-debug");
    this._legendElement = this.querySelector(".ortsnetz-legend");
    this._legendOpen = this._mapElement.clientWidth >= 520;
    this._installLegendEvents();
    this._renderLegend();

    try {
      const maplibregl = await loadMapLibre();
      // Während des Ladens entfernt oder neu aufgebaut: dieser Aufbau ist überholt.
      if (generation !== this._generation || !this.isConnected) return;
      this._maplibregl = maplibregl;
      const dark = this._isDarkTheme();
      this._lastThemeDark = dark;

      this._map = new maplibregl.Map({
        container: this._mapElement,
        style: dark ? OPENFREEMAP_DARK_STYLE : OPENFREEMAP_LIGHT_STYLE,
        center: this._initialCenter(),
        zoom: Number(this._config.zoom),
        // Kompakt: nur das (i), die Quellenangabe klappt auf. Mit eigenem Eintrag, sonst
        // ließe MapLibre den MapLibre-Link weg und blendete die Angabe im Ersatzstil
        // (ohne Quellen) ganz aus.
        attributionControl: {
          compact: true,
          customAttribution: '<a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a>',
        },
        // Kein Drehen oder Kippen: ohne Kompass ließe sich das nicht zurücksetzen.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        // Deutsche Hinweise immer, damit sie auch nach späterem Einschalten passen.
        locale: COOPERATIVE_LOCALE,
        ...(this._config.cooperative_gestures ? { cooperativeGestures: true } : {}),
      });
      this._map.touchZoomRotate.disableRotation();
      this._map.keyboard.disableRotation();

      this._map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

      this._installMapEvents();
      this._installPointInteractions(maplibregl);
      this._watchStyle();
      this._watchConnection();
      // Daten unabhängig von der Karte laden: "load" feuert nicht, wenn Stil oder
      // Kacheln ausbleiben. Gezeichnet wird, sobald ein Stil da ist (style.load).
      this._loadMeasurements();

      this._startRefreshTimer();
      document.addEventListener("visibilitychange", this._onVisibilityChange);

      this._updateMapSize();
      this._resizeObserver = new ResizeObserver(() => {
        this._updateMapSize();
        this._map?.resize();
      });
      this._resizeObserver.observe(this._mapElement);
      // Legende und Statuszeile über der Quellenangabe halten, auch wenn sie aufklappt
      // oder umbricht.
      const corner = this._mapElement.querySelector(".maplibregl-ctrl-bottom-right");
      if (corner) {
        this._cornerObserver = new ResizeObserver(() => this._updateOverlayOffset());
        this._cornerObserver.observe(corner);
        this._updateOverlayOffset();
      }
      setTimeout(() => this._map?.resize(), 250);
    } catch (error) {
      if (generation !== this._generation) return;
      this._setStatus(`Fehler: ${error?.message || error}`);
      console.error("Ortsnetz Map initialization failed", error);
    }
  }

  // Abstand von Legende und Statuszeile zum unteren Rand: Höhe der Ecke unten rechts
  // (Quellenangabe samt Rand) plus 6 px, mindestens 28 px.
  _updateOverlayOffset() {
    const corner = this._mapElement?.querySelector(".maplibregl-ctrl-bottom-right");
    const wrap = this.querySelector(".ortsnetz-wrap");
    if (!corner || !wrap) return;
    wrap.style.setProperty("--ortsnetz-overlay-bottom", `${Math.max(28, corner.offsetHeight + 6)}px`);
  }

  // Bedarfsgesteuert: nur abrufen, solange der Tab sichtbar ist.
  _startRefreshTimer() {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    const refreshSeconds = Math.max(60, Number(this._config.refresh_interval) || 300);
    this._refreshTimer = setInterval(() => {
      if (!document.hidden) this._loadMeasurements();
    }, refreshSeconds * 1000);
  }

  // Diagnosezeile bei jedem idle aktualisieren; erst anmelden, wenn debug an ist.
  _watchDebug() {
    if (this._debugWatched || !this._map) return;
    this._debugWatched = true;
    this._map.on("idle", () => this._updateDebug());
  }

  // Kartengröße als CSS-Variablen für das Popup (Breite der Diagramme, maximale Höhe).
  _updateMapSize() {
    const wrap = this.querySelector(".ortsnetz-wrap");
    if (!wrap || !this._mapElement) return;
    const width = this._mapElement.clientWidth;
    const height = this._mapElement.clientHeight;
    wrap.style.setProperty("--ortsnetz-map-width", `${width}px`);
    wrap.style.setProperty("--ortsnetz-map-height", `${height}px`);
    this._popup?.setMaxWidth(this._popupMaxWidth());
  }

  _popupMaxWidth() {
    const width = this._mapElement?.clientWidth || 344;
    return `${Math.max(160, Math.min(320, width - 2 * POPUP_MARGIN))}px`;
  }

  // Kartenmittelpunkt: eigene Koordinaten der Konfiguration, sonst der HA-Standort.
  _initialCenter() {
    const own = toCoordinate({ latitude: this._config.latitude, longitude: this._config.longitude });
    return own ?? toCoordinate(this._hass?.config) ?? [10.45, 51.16];
  }

  _installMapEvents() {
    // Start und jeder Stilwechsel: fehlende Quelle/Layer anlegen, Daten nachziehen.
    this._map.on("style.load", () => {
      this._styleReady = true;
      clearTimeout(this._styleTimer);
      if (!this._fallbackActive) this._setMapProblem(null);
      this._syncSource();
    });
    // Mit eigenem Handler gibt MapLibre Fehler nicht mehr einzeln auf der Konsole aus.
    this._map.on("error", (event) => this._handleMapError(event));
    // Lädt wieder eine Kachel der Basiskarte, ist das Problem vorbei.
    this._map.on("sourcedata", (event) => {
      if (event?.tile && !this._fallbackActive && !this._isOwnSource(event.sourceId)) this._setMapProblem(null);
    });
    if (this._config.debug) this._watchDebug();
  }

  _isOwnSource(id) {
    return id === SOURCE_ID || id === LABEL_SOURCE_ID;
  }

  // Lädt der Stil nicht innerhalb von STYLE_TIMEOUT_MS, auf den Ersatzstil wechseln.
  _watchStyle() {
    this._styleReady = false;
    clearTimeout(this._styleTimer);
    this._styleTimer = setTimeout(() => {
      if (!this._styleReady) this._useFallbackStyle();
    }, STYLE_TIMEOUT_MS);
  }

  _handleMapError(event) {
    // Fehler der eigenen Quellen (z. B. Schrift für den Zähler) betreffen nicht die Basiskarte.
    if (this._isOwnSource(event?.sourceId)) return;
    if (!this._styleReady && !event?.sourceId) {
      this._useFallbackStyle();
      return;
    }
    this._setMapProblem(BASEMAP_PROBLEM);
  }

  _useFallbackStyle() {
    if (!this._map || this._fallbackActive) return;
    this._fallbackActive = true;
    clearTimeout(this._styleTimer);
    this._setMapProblem(BASEMAP_PROBLEM);
    // Eigene Quelle und Layer legt style.load danach neu an (_syncSource).
    this._map.setStyle(fallbackStyle(Boolean(this._lastThemeDark)), { diff: false });
  }

  // Beim WebSocket von Home Assistant für "ready" (Wiederverbindung) anmelden; wechselt
  // die Verbindung, beim alten Objekt abmelden.
  _watchConnection() {
    const connection = this._hass?.connection;
    if (connection === this._connection) return;
    this._connection?.removeEventListener?.("ready", this._onReconnect);
    this._connection = connection ?? null;
    this._connection?.addEventListener?.("ready", this._onReconnect);
  }

  _handleVisibility() {
    if (document.hidden || !this._map) return;
    const refreshMs = Math.max(60, Number(this._config.refresh_interval) || 300) * 1000;
    if (Date.now() - this._lastLoad >= refreshMs) this._loadMeasurements();
  }

  _color(key) {
    return this._colors[key] || STATUS_BY_KEY[key].color;
  }

  // ---- Status je Messpunkt -------------------------------------------------

  _phaseStatus(voltage) {
    const scale = this._scale;
    if (voltage < scale.criticalLow) return STATUS_BY_KEY.crit_low;
    if (voltage < scale.warningLow) return STATUS_BY_KEY.warn_low;
    if (voltage <= scale.warningHigh) return STATUS_BY_KEY.normal;
    if (voltage <= scale.criticalHigh) return STATUS_BY_KEY.warn_high;
    return STATUS_BY_KEY.crit_high;
  }

  _phaseKeys() {
    const phase = this._config.phase;
    return phase === "auto" ? ["l1_v", "l2_v", "l3_v"] : [`${phase.toLowerCase()}_v`];
  }

  // Schlechtester Wert aller gemessenen Phasen; bei gleicher Schwere gewinnt Unterspannung.
  _pointStatus(point) {
    let best = null;
    for (const key of this._phaseKeys()) {
      const voltage = toVoltage(point[key]);
      if (voltage === null) continue;
      const status = this._phaseStatus(voltage);
      if (
        !best ||
        status.severity > best.severity ||
        (status.severity === best.severity && status.low && !best.low)
      ) {
        best = status;
      }
    }
    return best;
  }

  _isStale(point) {
    if (point.stale !== undefined && point.stale !== null) return isStaleFlag(point.stale);
    const time = Date.parse(point.observed_at);
    return Number.isFinite(time) && Date.now() - time > STALE_AFTER_MS;
  }

  // ---- Karte ---------------------------------------------------------------

  _installPointInteractions(maplibregl) {
    const map = this._map;
    map.on("mousemove", (event) => {
      map.getCanvas().style.cursor = this._featureAt(event.point) ? "pointer" : "";
    });
    // Bewegt der Nutzer die Karte selbst, wird das offene Popup nicht mehr nachgeführt.
    map.on("movestart", (event) => {
      if (event?.originalEvent) this._popupUserMoved = true;
    });
    map.on("click", (event) => {
      const feature = this._featureAt(event.point);
      if (!feature) return;
      if (feature.layer?.id === CLUSTER_LAYER_ID) this._zoomIntoCluster(feature);
      else this._openPopup(maplibregl, feature);
    });
  }

  // Cluster oder Einzelpunkt am Tippunkt, mit HIT_TOLERANCE Pixeln Spielraum.
  // Bei mehreren Treffern gewinnt der, dessen Rand dem Tippunkt am nächsten ist.
  _featureAt(point) {
    const map = this._map;
    if (!map || !point) return null;
    const layers = [CLUSTER_LAYER_ID, LAYER_ID].filter((id) => map.getLayer(id));
    if (!layers.length) return null;
    const box = [
      [point.x - HIT_TOLERANCE, point.y - HIT_TOLERANCE],
      [point.x + HIT_TOLERANCE, point.y + HIT_TOLERANCE],
    ];
    let best = null;
    let bestDistance = Infinity;
    for (const feature of map.queryRenderedFeatures(box, { layers })) {
      const at = map.project(feature.geometry.coordinates);
      const distance = Math.hypot(at.x - point.x, at.y - point.y) - this._featureRadius(feature);
      if (distance < bestDistance) {
        best = feature;
        bestDistance = distance;
      }
    }
    return best;
  }

  // Gezeichneter Radius in Pixeln (wie in den Layer-Ausdrücken).
  _featureRadius(feature) {
    const p = feature.properties || {};
    if (feature.layer?.id === CLUSTER_LAYER_ID) return Math.min(36, 14 + 2 * Math.sqrt(Number(p.point_count) || 0));
    const yieldValue = toNumber(p.forecast_yield);
    return yieldValue === null ? 7 : 5 + (Math.min(10, Math.max(0, yieldValue)) / 10) * 9;
  }

  async _zoomIntoCluster(feature) {
    const map = this._map;
    const center = feature.geometry.coordinates;
    let zoom;
    try {
      zoom = await map.getSource(SOURCE_ID).getClusterExpansionZoom(feature.properties.cluster_id);
    } catch (error) {
      zoom = map.getZoom() + 2;
    }
    if (map !== this._map) return;
    map.easeTo({ center, zoom });
  }

  _openPopup(maplibregl, feature) {
    const p = feature.properties || {};
    if (this._popup) this._popup.remove();
    // Feste Ankerseite: unter dem Punkt in der oberen Kartenhälfte, sonst darüber. So
    // springt das Popup nicht, wenn es wächst oder die Karte verschoben wird.
    const at = this._map.project(feature.geometry.coordinates);
    const height = this._mapElement?.clientHeight || 0;
    this._popupUserMoved = false;
    const popup = new maplibregl.Popup({
      closeButton: true,
      maxWidth: this._popupMaxWidth(),
      anchor: at.y < height / 2 ? "top" : "bottom",
    })
      .setLngLat(feature.geometry.coordinates)
      .setHTML(`<div class="popup-scroll">${this._popupHtml(p)}</div>`)
      .addTo(this._map);
    this._popup = popup;
    this._keepPopupVisible(popup);
    if (p.public_id) this._loadHistory(popup, String(p.public_id));
  }

  // Verschiebt die Karte, bis das Popup mit Rand vollständig sichtbar ist. Aufruf nach
  // dem Öffnen und nach jedem Nachladen; nicht mehr, sobald der Nutzer die Karte bewegt.
  _keepPopupVisible(popup) {
    requestAnimationFrame(() => {
      const map = this._map;
      if (!map || popup !== this._popup || this._popupUserMoved) return;
      // Läuft noch eine Verschiebung, erst danach messen.
      if (map.isMoving()) {
        map.once("moveend", () => this._keepPopupVisible(popup));
        return;
      }
      const element = popup.getElement();
      if (!element?.isConnected || !this._mapElement) return;
      const box = this._mapElement.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const [dx, dy] = popupPanOffset(
        { left: rect.left - box.left, top: rect.top - box.top, right: rect.right - box.left, bottom: rect.bottom - box.top },
        { width: box.width, height: box.height },
        map.project(popup.getLngLat()),
      );
      if (dx || dy) map.panBy([dx, dy], { duration: 250 });
    });
  }

  _phaseRow(label, value) {
    const voltage = toVoltage(value);
    if (voltage === null) {
      return `<div class="popup-phase">${label}: <span class="popup-muted">nicht gemessen</span></div>`;
    }
    const status = this._phaseStatus(voltage);
    return `<div class="popup-phase"><span class="popup-dot" style="background:${escapeHtml(this._color(status.key))}"></span>${label}: <span class="popup-value">${voltage.toFixed(1)} V</span></div>`;
  }

  _popupHtml(p) {
    const frequency = toNumber(p.grid_frequency_hz);
    const yieldValue = toNumber(p.forecast_kwh_per_kwp_day);
    const forecastKwh = toNumber(p.pv_forecast_kwh);
    const sampleCount = toNumber(p.sample_count);
    const stale = isStaleFlag(p.stale);
    return `
      <div>
        <div class="popup-title">Ortsnetz-Messpunkt</div>
        ${this._phaseRow("L1", p.l1_v)}
        ${this._phaseRow("L2", p.l2_v)}
        ${this._phaseRow("L3", p.l3_v)}
        <div style="margin-top:8px">
          Frequenz: <span class="popup-value">${frequency !== null ? frequency.toFixed(2) + " Hz" : "–"}</span><br>
          ${yieldValue !== null ? `PV-Forecast: <span class="popup-value">${forecastKwh !== null ? forecastKwh.toFixed(1) + " kWh · " : ""}${yieldValue.toFixed(2)} kWh/kWp/Tag</span><br>` : ""}
          Messungen: <span class="popup-value">${sampleCount !== null ? Math.round(sampleCount) : "–"}</span>
        </div>
        ${stale ? '<div class="popup-warning">⚠️ Messwert möglicherweise veraltet</div>' : ""}
        <div class="popup-time">Letzte Messung: ${escapeHtml(this._formatDate(p.observed_at))}</div>
        ${p.public_id ? '<div class="popup-charts"><span class="popup-muted">Verlauf wird geladen …</span></div>' : ""}
      </div>`;
  }

  // ---- Verlauf im Popup -----------------------------------------------------

  async _loadHistory(popup, publicId) {
    const container = popup.getElement()?.querySelector(".popup-charts");
    if (!container || !this._hass?.connection) return;
    try {
      const history = await this._hass.connection.sendMessagePromise({
        type: "ortsnetz_map/get_history",
        public_id: publicId,
      });
      if (!container.isConnected) return;
      container.innerHTML = this._historyHtml(history);
    } catch (error) {
      if (!container.isConnected) return;
      container.innerHTML = '<span class="popup-muted">Verlauf nicht verfügbar</span>';
    }
    // Das Popup ist gewachsen: erneut prüfen, ob es noch in die Karte passt.
    this._keepPopupVisible(popup);
  }

  // Schlechtester Status über alle gemessenen Phasen: "crit", "warn" oder null.
  _worstSeverity(voltages) {
    let worst = 0;
    for (const voltage of voltages) {
      if (voltage === null) continue;
      worst = Math.max(worst, this._phaseStatus(voltage).severity);
    }
    return worst >= 2 ? "crit" : worst === 1 ? "warn" : null;
  }

  _historyHtml(history) {
    const samples = (Array.isArray(history?.samples) ? history.samples : [])
      .map((sample) => ({
        t: Date.parse(sample.at),
        v: [toVoltage(sample.l1_v), toVoltage(sample.l2_v), toVoltage(sample.l3_v)],
        f: (() => { const f = toNumber(sample.grid_frequency_hz); return f !== null && f > 0 ? f : null; })(),
      }))
      .filter((sample) => Number.isFinite(sample.t))
      .sort((a, b) => a.t - b.t);
    if (!samples.length) return '<span class="popup-muted">Keine Verlaufsdaten</span>';

    let end = Date.parse(history.end);
    let start = Date.parse(history.start);
    if (!Number.isFinite(end)) end = samples[samples.length - 1].t;
    if (!Number.isFinite(start) || start >= end) start = end - 24 * 3600 * 1000;

    // Gelbe und rote Hintergrundbereiche, wo ein Messwert eine Grenze verletzt (Rot hat Vorrang).
    const bands = [];
    samples.forEach((sample, index) => {
      const severity = this._worstSeverity(sample.v);
      if (!severity) return;
      const next = samples[index + 1]?.t ?? sample.t + 5 * 60 * 1000;
      bands.push({ from: sample.t, to: Math.min(next, sample.t + 10 * 60 * 1000), severity });
    });

    const phasesPresent = [0, 1, 2].filter((i) => samples.some((sample) => sample.v[i] !== null));
    const legend = phasesPresent
      .map((i) => `<span class="phase" style="color:${PHASE_COLORS[i]}">L${i + 1}</span>`)
      .join("");

    const voltageChart = this._lineChart({
      samples, start, end, bands,
      series: phasesPresent.map((i) => ({ color: PHASE_COLORS[i], value: (sample) => sample.v[i] })),
      minSpan: 8, decimals: 0,
    });
    const frequencyChart = this._lineChart({
      samples, start, end, bands: [],
      series: [{ color: "var(--primary-color, #03a9f4)", value: (sample) => sample.f }],
      minSpan: 0.2, decimals: 2,
    });

    return `
      <div class="chart-title"><span>Spannung (24 h)</span><span>${legend}</span></div>
      ${voltageChart || '<span class="popup-muted">Keine Spannungswerte</span>'}
      <div class="chart-title"><span>Netzfrequenz (24 h)</span><span>Hz</span></div>
      ${frequencyChart || '<span class="popup-muted">Keine Frequenzwerte</span>'}`;
  }

  _lineChart({ samples, series, start, end, bands, minSpan, decimals }) {
    const W = 300, H = 96, left = 30, right = 4, top = 6, bottom = 78;
    const values = [];
    for (const sample of samples) for (const item of series) {
      const value = item.value(sample);
      if (value !== null && value !== undefined) values.push(value);
    }
    if (!values.length) return "";

    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (hi - lo < minSpan) {
      const mid = (hi + lo) / 2;
      lo = mid - minSpan / 2;
      hi = mid + minSpan / 2;
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;

    const span = end - start;
    const x = (t) => left + ((Math.min(end, Math.max(start, t)) - start) / span) * (W - left - right);
    const y = (value) => bottom - ((value - lo) / (hi - lo)) * (bottom - top);

    let svg = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img">`;
    for (const band of bands) {
      const x1 = x(band.from);
      const width = Math.max(1.5, x(band.to) - x1);
      svg += `<rect x="${x1.toFixed(1)}" y="${top}" width="${width.toFixed(1)}" height="${bottom - top}" fill="${BAND_COLORS[band.severity]}"/>`;
    }
    svg += `<line class="grid" x1="${left}" y1="${top}" x2="${W - right}" y2="${top}"/><line class="grid" x1="${left}" y1="${bottom}" x2="${W - right}" y2="${bottom}"/>`;
    svg += `<text x="${left - 3}" y="${top + 3}" text-anchor="end">${hi.toFixed(decimals)}</text>`;
    svg += `<text x="${left - 3}" y="${bottom}" text-anchor="end">${lo.toFixed(decimals)}</text>`;

    for (const item of series) {
      let path = "";
      let previous = null;
      for (const sample of samples) {
        const value = item.value(sample);
        if (value === null || value === undefined) { previous = null; continue; }
        const command = previous === null || sample.t - previous > HISTORY_GAP_MS ? "M" : "L";
        path += `${command}${x(sample.t).toFixed(1)} ${y(value).toFixed(1)}`;
        previous = sample.t;
      }
      svg += `<path d="${path}" fill="none" stroke="${item.color}" stroke-width="1.3" stroke-linejoin="round"/>`;
    }

    const time = (t) => new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    svg += `<text x="${left}" y="${H - 3}" text-anchor="start">${time(start)}</text>`;
    svg += `<text x="${(left + W - right) / 2}" y="${H - 3}" text-anchor="middle">${time(start + span / 2)}</text>`;
    svg += `<text x="${W - right}" y="${H - 3}" text-anchor="end">${time(end)}</text>`;
    return svg + "</svg>";
  }

  // ---- Legende -------------------------------------------------------------

  _installLegendEvents() {
    if (!this._legendElement) return;
    this._legendElement.addEventListener("click", (event) => {
      if (event.target.closest(".legend-head")) {
        this._legendOpen = !this._legendOpen;
        this._renderLegend();
      }
    });
    this._legendElement.addEventListener("change", (event) => {
      const key = event.target?.dataset?.status;
      if (!key) return;
      if (event.target.checked) this._enabled.add(key);
      else this._enabled.delete(key);
      this._renderLegend();
      this._renderPoints(this._currentData);
    });
  }

  // Bevorzugt die Zähler der letzten 24 Stunden vom Server, sonst die aktuellen Messpunkte.
  _statusCounts() {
    const counts = Object.fromEntries(STATUSES.map((s) => [s.key, 0]));
    let withForecast = false;
    for (const point of this._currentData?.points || []) {
      if (forecastYield(point) !== null) withForecast = true;
    }

    const stats = this._currentData?.threshold_stats;
    const fromServer = stats && STATUSES.every((s) => Number.isFinite(Number(stats[STATS_FIELDS[s.key]])));
    if (fromServer) {
      for (const s of STATUSES) counts[s.key] = Number(stats[STATS_FIELDS[s.key]]);
    } else {
      for (const point of this._currentData?.points || []) {
        const status = this._pointStatus(point);
        if (status) counts[status.key] += 1;
      }
    }
    return { counts, withForecast, fromServer: Boolean(fromServer) };
  }

  _renderLegend() {
    if (!this._legendElement || !this._config.show_legend) return;
    const { counts, withForecast, fromServer } = this._statusCounts();
    const sites = this._currentData?.points?.length ?? 0;
    const toggle = this._legendOpen ? "–" : "+";

    let body = "";
    if (this._legendOpen) {
      body += `<div class="legend-sub">${sites} Standorte, Messung alle 5 Minuten</div>`;
      body += `<div class="legend-group">${fromServer ? "Messungen der letzten 24 Stunden:" : "Aktuelle Messpunkte:"}</div>`;
      for (const group of LEGEND_GROUPS) {
        const rows = STATUSES.filter((s) => s.group === group && (counts[s.key] > 0 || !this._enabled.has(s.key)));
        if (!rows.length) continue;
        body += `<div class="legend-subgroup">${group}:</div>`;
        for (const s of rows) {
          const on = this._enabled.has(s.key);
          body += `<label class="legend-row ${on ? "" : "off"}">
            <span class="legend-dot" style="background:${escapeHtml(this._color(s.key))}"></span>
            <span class="legend-text">${s.label}</span>
            <span class="legend-count">${counts[s.key]}</span>
            <input type="checkbox" data-status="${s.key}" ${on ? "checked" : ""}>
          </label>`;
        }
      }
      if (withForecast) {
        body += `<div class="legend-group legend-size">Markergröße:</div><div>erwarteter PV-Ertrag in kWh/kWp/Tag</div>`;
      }
    }

    this._legendElement.innerHTML = `<div class="legend-head"><span>Legende</span><span class="legend-toggle">${toggle}</span></div>${body}`;
  }

  // ---- Theme ---------------------------------------------------------------

  _isDarkTheme() {
    if (typeof this._hass?.themes?.darkMode === "boolean") return this._hass.themes.darkMode;

    const hostStyles = getComputedStyle(this);
    const bg = (
      hostStyles.getPropertyValue("--primary-background-color") ||
      getComputedStyle(document.documentElement).getPropertyValue("--primary-background-color")
    ).trim();

    const rgb = bg.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (rgb) {
      const brightness = (Number(rgb[1]) * 299 + Number(rgb[2]) * 587 + Number(rgb[3]) * 114) / 1000;
      return brightness < 128;
    }

    if (bg.startsWith("#")) {
      let hex = bg.slice(1);
      if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
      if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return (r * 299 + g * 587 + b * 114) / 1000 < 128;
      }
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  _applyTheme() {
    if (!this._map) return;
    const dark = this._isDarkTheme();
    if (dark === this._lastThemeDark) return;
    this._lastThemeDark = dark;
    // Auch nach einem Ausfall wieder den echten Stil versuchen.
    this._fallbackActive = false;
    this._watchStyle();
    // Eigene Quelle und Layer in den neuen Stil übernehmen; ohne transformStyle
    // entfernt MapLibre sie beim Stil-Diff und die Punkte verschwinden.
    // Danach legt style.load fehlende Quelle/Layer an (_syncSource). diff: false, weil
    // MapLibre einen per Diff übernommenen Stil ohne style.load einsetzt; dann fehlte
    // z. B. der Zähler, wenn der neue Stil Glyphen hat und der alte nicht.
    this._map.setStyle(dark ? OPENFREEMAP_DARK_STYLE : OPENFREEMAP_LIGHT_STYLE, {
      diff: false,
      transformStyle: keepOwnLayers,
    });
  }

  // ---- Daten ---------------------------------------------------------------

  async _loadMeasurements() {
    if (!this._hass?.connection) return;
    // "Lade …" nur beim ersten Laden; danach bleibt der letzte Stand sichtbar.
    if (!this._currentData) this._setStatus("Lade Messwerte …");
    // Nur die zuletzt gestartete Anfrage darf die Anzeige ändern.
    const request = ++this._loadRequest;
    const generation = this._generation;

    try {
      const data = await this._hass.connection.sendMessagePromise({ type: "ortsnetz_map/get_points" });
      if (request !== this._loadRequest || generation !== this._generation) return;
      this._lastLoad = Date.now();
      this._currentData = data;
      this._applyScale(data);
      this._renderLegend();
      this._renderPoints(data);
      this._dataTime = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      this._setStatus(`${data.points?.length ?? 0} Messpunkte · ${this._dataTime}`);
      this._retryCount = 0;
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    } catch (error) {
      if (request !== this._loadRequest || generation !== this._generation) return;
      console.error("Could not load Ortsnetz points", error);
      this._setStatus(
        this._currentData ? `Aktualisierung fehlgeschlagen, zeige Stand ${this._dataTime}` : loadErrorText(error),
      );
      this._scheduleRetry();
    }
  }

  // Nach einem Fehler nach 15, 30 und 60 s erneut versuchen (nur bei sichtbarem Tab);
  // danach übernimmt wieder das normale Intervall. Erfolg setzt die Zählung zurück.
  _scheduleRetry() {
    if (!this._map || this._retryTimer) return;
    const delay = RETRY_DELAYS[this._retryCount ?? 0];
    if (delay === undefined) return;
    this._retryCount = (this._retryCount ?? 0) + 1;
    const generation = this._generation;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (generation !== this._generation || document.hidden) return;
      this._loadMeasurements();
    }, delay * 1000);
  }

  _applyScale(data) {
    // Schwellwerte und Farben kommen von der API (Farben: unter 207, 207–218, normal, 242–253, über 253).
    // Ungültige Farben (kein einfacher Farbwert) werden durch die Standardfarbe ersetzt.
    const colors = data?.scale?.colors;
    if (Array.isArray(colors) && colors.length === 5) {
      STATUSES.forEach((status, index) => {
        this._colors[status.key] = safeColor(colors[index]) ?? status.color;
      });
    }
    const scale = data?.scale || {};
    const threshold = (key) => toNumber(scale[key]) ?? DEFAULT_SCALE[key];
    this._scale = {
      criticalLow: threshold("criticalLow"),
      warningLow: threshold("warningLow"),
      warningHigh: threshold("warningHigh"),
      criticalHigh: threshold("criticalHigh"),
    };
  }

  // Berechnet die Features aus den Daten (Status, Legendenfilter, Koordinatenprüfung)
  // und gibt sie an die Karte weiter. Die Features werden immer gemerkt, auch wenn
  // die Karte gerade nicht bereit ist; style.load holt das Zeichnen dann nach.
  _renderPoints(data) {
    if (Array.isArray(data?.points)) {
      const features = [];
      for (const point of data.points) {
        const coordinates = toCoordinate(point);
        if (!coordinates) continue;
        const status = this._pointStatus(point);
        if (!status || !this._enabled.has(status.key)) continue;

        const properties = {
          status: status.key,
          rank: status.rank,
          color: this._color(status.key),
          stale: this._isStale(point),
          l1_v: point.l1_v ?? "",
          l2_v: point.l2_v ?? "",
          l3_v: point.l3_v ?? "",
          grid_frequency_hz: point.grid_frequency_hz ?? "",
          sample_count: point.sample_count ?? "",
          observed_at: point.observed_at ?? "",
          forecast_yield: forecastYield(point) ?? "",
          // Marker und Popup lesen den Forecast aus denselben Feldern.
          forecast_kwh_per_kwp_day: forecastValue(point) ?? "",
          pv_forecast_kwh: point.pv_forecast_kwh ?? "",
          public_id: point.public_id ?? "",
        };
        features.push({ type: "Feature", geometry: { type: "Point", coordinates }, properties });
      }
      this._allFeatures = features;
      this._featuresHash = hashString(JSON.stringify(features));
    }
    this._syncSource();
  }

  _featureCollection() {
    return { type: "FeatureCollection", features: this._allFeatures };
  }

  // Quelle und Layer anlegen, sobald die Karte einen Stil hat. Ohne isStyleLoaded():
  // das ist nach jedem setData und während Kacheln laden false.
  _ensureSource() {
    const map = this._map;
    if (!map) return false;
    try {
      const style = map.getStyle();
      if (!style) return false;
      const withCount = Boolean(style.glyphs);
      const sourceIds = withCount ? [SOURCE_ID, LABEL_SOURCE_ID] : [SOURCE_ID];
      // Fehlt eine Quelle, bekommen alle beim nächsten _syncSource die aktuellen Daten.
      if (sourceIds.some((id) => !map.getSource(id))) this._sourceHash = null;
      for (const id of sourceIds) {
        if (map.getSource(id)) continue;
        map.addSource(id, {
          type: "geojson",
          data: this._featureCollection(),
          cluster: true,
          clusterRadius: CLUSTER_RADIUS,
          clusterMaxZoom: CLUSTER_MAX_ZOOM,
          clusterProperties: CLUSTER_PROPERTIES,
        });
      }
      const layers = this._layers(withCount);
      layers.forEach((layer, index) => {
        if (map.getLayer(layer.id)) return;
        // Vor dem nächsten vorhandenen eigenen Layer einfügen, damit die Reihenfolge stimmt.
        const before = layers.slice(index + 1).find((next) => map.getLayer(next.id));
        map.addLayer(layer, before?.id);
      });
      return true;
    } catch (error) {
      // Stil noch nicht bereit: style.load ruft erneut auf.
      return false;
    }
  }

  _syncSource() {
    if (!this._ensureSource()) return;
    const map = this._map;
    if (this._sourceHash !== this._featuresHash) {
      const data = this._featureCollection();
      for (const id of [SOURCE_ID, LABEL_SOURCE_ID]) map.getSource(id)?.setData(data);
      this._sourceHash = this._featuresHash;
    }
    const color = this._clusterColor();
    const colorKey = JSON.stringify(color);
    if (this._paintedColors !== colorKey) {
      if (this._paintedColors !== null) map.setPaintProperty(CLUSTER_LAYER_ID, "circle-color", color);
      this._paintedColors = colorKey;
    }
  }

  // Clusterfarbe nach dem höchsten Rang (siehe STATUSES.rank).
  _clusterColor() {
    const byRank = [...STATUSES].sort((a, b) => b.rank - a.rank);
    const expression = ["match", ["get", "worst"]];
    for (const status of byRank.slice(0, -1)) expression.push(status.rank, this._color(status.key));
    expression.push(this._color(byRank[byRank.length - 1].key));
    return expression;
  }

  _layers(withCount) {
    const layers = [
      {
        id: CLUSTER_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": this._clusterColor(),
          // 28–72 px Durchmesser, wachsend mit der Anzahl.
          "circle-radius": ["min", 36, ["+", 14, ["*", 2, ["sqrt", ["get", "point_count"]]]]],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": 0.95,
        },
      },
      {
        id: COUNT_LAYER_ID,
        type: "symbol",
        source: LABEL_SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": COUNT_FONT,
          "text-size": 13,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(0,0,0,0.55)",
          "text-halo-width": 1.2,
        },
      },
      {
        id: LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        paint: {
          // Radius nach erwartetem PV-Ertrag (0–10 kWh/kWp/Tag), ohne Forecast 7 px.
          "circle-radius": [
            "case",
            ["==", ["get", "forecast_yield"], ""],
            7,
            ["interpolate", ["linear"], ["to-number", ["get", "forecast_yield"], 0], 0, 5, 10, 14],
          ],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
          "circle-opacity": ["case", ["==", ["get", "stale"], true], 0.4, 0.95],
          "circle-stroke-opacity": ["case", ["==", ["get", "stale"], true], 0.5, 1],
        },
      },
    ];
    return withCount ? layers : layers.filter((layer) => layer.id !== COUNT_LAYER_ID);
  }

  // ---- Diagnose (Option debug) ----------------------------------------------

  // Zahlen für die Diagnosezeile: gesetzte Punkte, sichtbare Cluster und Einzelpunkte.
  _debugStats() {
    const map = this._map;
    const rendered = (layer, key) => {
      const found = new Map();
      if (!map?.getLayer(layer)) return found;
      // Features an Kachelgrenzen kommen mehrfach; je Kennung einmal zählen.
      for (const feature of map.queryRenderedFeatures({ layers: [layer] })) found.set(feature.properties?.[key], feature);
      return found;
    };
    const clusters = rendered(CLUSTER_LAYER_ID, "cluster_id");
    let clusterPoints = 0;
    for (const feature of clusters.values()) clusterPoints += Number(feature.properties.point_count) || 0;
    return {
      zoom: map ? map.getZoom() : 0,
      set: this._allFeatures.length,
      clusters: clusters.size,
      clusterPoints,
      singles: rendered(LAYER_ID, "public_id").size,
    };
  }

  _updateDebug() {
    if (!this._debugElement || !this._config.debug || !this._map) return;
    const stats = this._debugStats();
    const zoom = stats.zoom.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    this._debugElement.textContent =
      `Zoom ${zoom} · ${stats.set} Punkte gesetzt · ${stats.clusters} Cluster (${stats.clusterPoints} Punkte) · ${stats.singles} Einzel sichtbar`;
  }

  _fmtV(value) {
    const voltage = toVoltage(value);
    return voltage !== null ? `${voltage.toFixed(1)} V` : "–";
  }

  _formatDate(value) {
    if (!value) return "unbekannt";
    return new Date(value).toLocaleString("de-DE", {
      day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  }

  _setStatus(text) {
    this._statusText = text;
    this._renderStatus();
  }

  // Zweite Zeile der Statusanzeige für Probleme mit der Karte; entprellt, weil
  // MapLibre je fehlender Kachel einen Fehler meldet.
  _setMapProblem(text) {
    if ((this._mapProblem ?? null) === text) return;
    this._mapProblem = text;
    if (this._problemTimer) return;
    this._problemTimer = setTimeout(() => {
      this._problemTimer = null;
      this._renderStatus();
    }, 500);
  }

  _renderStatus() {
    if (!this._statusElement) return;
    const lines = [this._statusText, this._mapProblem].filter(Boolean);
    this._statusElement.textContent = lines.join("\n");
  }

  getCardSize() { return 6; }

  getGridOptions() {
    return {
      columns: 12,
      rows: 8,
      min_columns: 3,
      min_rows: 3,
    };
  }

  // Ohne DOM testbar (Vitest).
  static popupPanOffset(...args) { return popupPanOffset(...args); }

  static getConfigElement() { return document.createElement("ortsnetz-map-card-editor"); }

  static getStubConfig() {
    return { zoom: 10, phase: "auto", refresh_interval: 300, show_status: true, show_legend: true, cooperative_gestures: true };
  }
}

class OrtsnetzMapCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    // Konfiguration wie in der YAML (ohne ergänzte Standardwerte).
    this._config = {};
    this._hass = null;
  }

  // Nur beim ersten hass neu zeichnen: hass ändert sich mehrmals pro Sekunde und
  // ein Neuaufbau würde laufende Eingaben verwerfen.
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._render();
  }

  setConfig(config) {
    const next = { ...config };
    const changed = JSON.stringify(next) !== JSON.stringify(this._config);
    this._config = next;
    if (changed || !this._rendered) this._render();
  }

  // Werte für die Anzeige: Standardwerte ergänzt.
  get _view() { return normalizeConfig(this._config); }
  _usesHaLocation() { return this._view.latitude === undefined || this._view.longitude === undefined; }

  _render() {
    if (!this.shadowRoot) return;
    this._rendered = true;
    const view = this._view;
    const useHaLocation = this._usesHaLocation();
    const lat = useHaLocation ? (this._hass?.config?.latitude ?? "") : view.latitude;
    const lon = useHaLocation ? (this._hass?.config?.longitude ?? "") : view.longitude;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; color:var(--primary-text-color); }
        .editor { display:grid; gap:16px; padding:8px 0; }
        .section { display:grid; gap:12px; }
        .section-title { font-size:14px; font-weight:600; color:var(--primary-text-color); }
        .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
        label.field { display:grid; gap:6px; font-size:12px; color:var(--secondary-text-color); }
        input, select { box-sizing:border-box; width:100%; min-height:44px; padding:9px 12px; border:1px solid var(--divider-color); border-radius:8px; background:var(--card-background-color); color:var(--primary-text-color); font:inherit; font-size:14px; }
        input:focus, select:focus { outline:2px solid var(--primary-color); outline-offset:1px; }
        .check { display:flex; align-items:center; gap:10px; min-height:36px; font-size:14px; }
        .check input { width:20px; height:20px; min-height:0; }
        .hint { font-size:12px; line-height:1.4; color:var(--secondary-text-color); }
        .coords[hidden] { display:none; }
        .value-row { display:flex; gap:8px; align-items:center; }
        .value-row input { flex:1; }
        .unit { min-width:28px; color:var(--secondary-text-color); font-size:13px; }
        @media (max-width:520px) { .grid { grid-template-columns:1fr; } }
      </style>
      <div class="editor">
        <div class="section">
          <div class="section-title">Darstellung</div>
          <div class="grid">
            <label class="field">Zoom<input data-key="zoom" type="number" min="1" max="19" step="1" value="${escapeHtml(view.zoom)}"></label>
            <label class="field">Phase für Markerfarbe<select data-key="phase">
              <option value="auto" ${view.phase === "auto" ? "selected" : ""}>Alle Phasen (schlechtester Wert)</option>
              <option value="L1" ${view.phase === "L1" ? "selected" : ""}>L1</option>
              <option value="L2" ${view.phase === "L2" ? "selected" : ""}>L2</option>
              <option value="L3" ${view.phase === "L3" ? "selected" : ""}>L3</option>
            </select></label>
            <label class="field">Aktualisierung<div class="value-row"><input data-key="refresh_interval" type="number" min="60" max="3600" step="60" value="${escapeHtml(view.refresh_interval)}"><span class="unit">s</span></div></label>
          </div>
          <label class="check"><input data-key="show_status" type="checkbox" ${view.show_status ? "checked" : ""}>Status unten links anzeigen</label>
          <label class="check"><input data-key="show_legend" type="checkbox" ${view.show_legend ? "checked" : ""}>Legende unten rechts anzeigen</label>
          <label class="check"><input data-key="cooperative_gestures" type="checkbox" ${view.cooperative_gestures ? "checked" : ""}>Zwei Finger zum Verschieben (Seite lässt sich über die Karte scrollen)</label>
          <div class="hint">Angehakt bewegt ein Finger die Seite statt der Karte; die Karte verschiebt und zoomt man mit zwei Fingern, am Computer zoomt man mit Strg (Mac: ⌘) + Mausrad.</div>
          <div class="hint">Breite und Höhe werden ausschließlich über Home Assistants Tab „Layout“ eingestellt. Die Karte füllt den dort zugewiesenen Bereich automatisch vollständig aus.</div>
        </div>
        <div class="section">
          <div class="section-title">Kartenmittelpunkt</div>
          <label class="check"><input data-key="use_ha_location" type="checkbox" ${useHaLocation ? "checked" : ""}>Home-Assistant-Standort verwenden</label>
          <div class="grid coords" ${useHaLocation ? "hidden" : ""}>
            <label class="field">Breitengrad<input data-key="latitude" type="number" min="-90" max="90" step="0.000001" value="${escapeHtml(lat)}"></label>
            <label class="field">Längengrad<input data-key="longitude" type="number" min="-180" max="180" step="0.000001" value="${escapeHtml(lon)}"></label>
          </div>
          <div class="hint">Wenn aktiviert, folgt die Karte automatisch dem unter Einstellungen → System → Allgemein hinterlegten Home-Assistant-Standort.</div>
        </div>
      </div>`;

    this.shadowRoot.querySelectorAll("input, select").forEach((element) => {
      element.addEventListener("change", (event) => this._valueChanged(event));
    });
  }

  // Nur geänderte, gültige Werte schreiben; Standardwerte entfallen aus der YAML.
  _valueChanged(event) {
    const target = event.currentTarget;
    const key = target.dataset.key;
    if (!key) return;
    const next = { ...this._config };
    const setValue = (name, value) => {
      if (value === DEFAULT_CONFIG[name]) delete next[name];
      else next[name] = value;
    };
    let rerender = key === "use_ha_location";

    if (key === "use_ha_location") {
      if (target.checked) {
        delete next.latitude;
        delete next.longitude;
      } else {
        next.latitude = Number(this._hass?.config?.latitude ?? 0);
        next.longitude = Number(this._hass?.config?.longitude ?? 0);
      }
    } else if (["show_status", "show_legend", "cooperative_gestures"].includes(key)) {
      setValue(key, target.checked);
    } else if (key in CONFIG_RANGES) {
      const number = String(target.value).trim() === "" ? null : toNumber(target.value);
      if (number === null) {
        // Koordinaten: ungültige Eingabe verwerfen; Zoom/Intervall: zurück zum Standard.
        if (key === "latitude" || key === "longitude") {
          this._render();
          return;
        }
        delete next[key];
      } else {
        const [min, max] = CONFIG_RANGES[key];
        let value = Math.min(max, Math.max(min, number));
        if (key === "refresh_interval") value = Math.round(value);
        setValue(key, value);
        rerender = value !== number;
      }
    } else {
      setValue(key, target.value);
    }

    this._config = next;
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: next }, bubbles: true, composed: true,
    }));
    // Geklemmte Werte und den Standort-Bereich neu anzeigen.
    if (rerender) this._render();
  }
}

if (!customElements.get("ortsnetz-map-card-editor")) customElements.define("ortsnetz-map-card-editor", OrtsnetzMapCardEditor);
if (!customElements.get("ortsnetz-map-card")) customElements.define("ortsnetz-map-card", OrtsnetzMapCard);

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "ortsnetz-map-card")) {
  window.customCards.push({
    type: "ortsnetz-map-card",
    name: "Ortsnetz Map",
    description: "Zeigt Messpunkte von ortsnetz-auslastung.de rund um den Home-Assistant-Standort.",
    preview: false,
  });
}
