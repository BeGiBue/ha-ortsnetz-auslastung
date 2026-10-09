// Ortsnetz Map Card v2.0.0-beta.2
// MapLibre GL wird von der Integration selbst ausgeliefert (kein externes CDN).
const MAPLIBRE_VERSION = "5.7.1";
const MAPLIBRE_BASE = "/ortsnetz_map/maplibre";
const MAPLIBRE_JS = `${MAPLIBRE_BASE}/maplibre-gl.js?v=${MAPLIBRE_VERSION}`;
const MAPLIBRE_CSS = `${MAPLIBRE_BASE}/maplibre-gl.css?v=${MAPLIBRE_VERSION}`;
const OPENFREEMAP_LIGHT_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const OPENFREEMAP_DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";

const SOURCE_ID = "ortsnetz-points";
const LAYER_ID = "ortsnetz-points";
// Ab diesem Zoom wird nicht mehr zusammengefasst (Einzelpunkte ab Zoom 12).
const CLUSTER_MAX_ZOOM = 12;
const STALE_AFTER_MS = 20 * 60 * 1000;

const HISTORY_GAP_MS = 12 * 60 * 1000; // größere Lücken unterbrechen die Linie
const PHASE_COLORS = ["#2563eb", "#db2777", "#0d9488"];
const BAND_COLORS = { warn: "rgba(245,158,11,0.28)", crit: "rgba(185,28,28,0.32)" };

const DEFAULT_SCALE = { criticalLow: 207, warningLow: 218, warningHigh: 242, criticalHigh: 253 };

// Reihenfolge = Rangfolge bei Gleichstand (Unterspannung vor Überspannung).
const STATUSES = [
  { key: "crit_low", group: "Unterspannung", label: "unter 207 V", color: "#1d4ed8", severity: 2, low: true },
  { key: "warn_low", group: "Unterspannung", label: "207 – 218 V", color: "#38bdf8", severity: 1, low: true },
  { key: "normal", group: "Normalzustand", label: "218 – 242 V", color: "#16a34a", severity: 0, low: false },
  { key: "warn_high", group: "Überspannung", label: "242 – 253 V", color: "#f59e0b", severity: 1, low: false },
  { key: "crit_high", group: "Überspannung", label: "über 253 V", color: "#b91c1c", severity: 2, low: false },
];
const STATUS_BY_KEY = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
const LEGEND_GROUPS = ["Normalzustand", "Unterspannung", "Überspannung"];

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
};

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

// Für setStyle: eigene Quelle und Ebene aus dem alten in den neuen Stil übernehmen.
function keepOwnLayer(previous, next) {
  const source = previous?.sources?.[SOURCE_ID];
  const layer = previous?.layers?.find((item) => item.id === LAYER_ID);
  if (!source || !layer) return next;
  return {
    ...next,
    sources: { ...next.sources, [SOURCE_ID]: source },
    layers: [...next.layers.filter((item) => item.id !== LAYER_ID), layer],
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
    this._mapLoaded = false;
    this._lastLoad = 0;
    this._scale = { ...DEFAULT_SCALE };
    this._colors = Object.fromEntries(STATUSES.map((s) => [s.key, s.color]));
    this._enabled = new Set(STATUSES.map((s) => s.key));
    this._legendOpen = true;
    this._clusterMarkers = new Map();
    this._maplibregl = null;
    this._onVisibilityChange = () => this._handleVisibility();
    this._allFeatures = [];
    this._onMapMoveEnd = () => this._updateClusters();
    // Erhöht sich bei jedem Auf- und Abbau; veraltete async-Schritte brechen damit ab.
    this._generation = 0;
    this._loadRequest = 0;
  }

  setConfig(config) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    merged.zoom = clamp(merged.zoom, 1, 19, 10);
    merged.refresh_interval = clamp(merged.refresh_interval, 60, 3600, 300);
    merged.phase = ["auto", "L1", "L2", "L3"].includes(String(merged.phase))
      ? String(merged.phase)
      : "auto";
    merged.show_status = merged.show_status !== false;
    merged.show_legend = merged.show_legend !== false;
    this._config = merged;

    if (this._initialized && this.isConnected && this._hass) this._reinitialize();
  }

  set hass(hass) {
    const firstSet = !this._hass;
    this._hass = hass;

    if (firstSet && this.isConnected) {
      this._initialize();
    } else if (this._map) {
      this._applyTheme();
    }
  }

  connectedCallback() {
    if (this._hass) this._initialize();
  }

  disconnectedCallback() {
    this._destroy();
  }

  async _reinitialize() {
    this._destroy(false);
    await this._initialize();
  }

  _destroy(clearMarkup = true) {
    this._generation += 1;
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    document.removeEventListener("visibilitychange", this._onVisibilityChange);
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._popup) {
      this._popup.remove();
      this._popup = null;
    }
    this._clearClusterMarkers();
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
    this._mapElement = null;
    this._statusElement = null;
    this._legendElement = null;
    this._initialized = false;
    this._mapLoaded = false;
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
          .ortsnetz-status { position:absolute; z-index:5; left:10px; bottom:28px; padding:6px 9px; border-radius:7px; font-size:11px; background:color-mix(in srgb, var(--card-background-color) 92%, transparent); color:var(--primary-text-color); box-shadow:0 1px 4px rgba(0,0,0,.2); pointer-events:none; }
          .ortsnetz-status[hidden] { display:none; }
          .ortsnetz-legend { position:absolute; z-index:5; right:10px; bottom:28px; max-width:min(240px, calc(100% - 20px)); max-height:calc(100% - 60px); overflow:auto; box-sizing:border-box; padding:8px 11px; border-radius:8px; font-size:12px; line-height:1.35; background:color-mix(in srgb, var(--card-background-color) 94%, transparent); color:var(--primary-text-color); box-shadow:0 1px 6px rgba(0,0,0,.25); }
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
          .ortsnetz-cluster { position:relative; box-sizing:border-box; border:2px solid #fff; border-radius:50%; overflow:hidden; cursor:pointer; box-shadow:0 1px 4px rgba(0,0,0,.35); }
          .ortsnetz-cluster svg { display:block; }
          .ortsnetz-cluster span { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; font-size:13px; text-shadow:0 0 3px rgba(0,0,0,.55); pointer-events:none; }
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
          .popup-charts { margin-top:10px; min-width:260px; }
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
        </div>
      </ha-card>`;

    this._mapElement = this.querySelector(".ortsnetz-map");
    this._statusElement = this.querySelector(".ortsnetz-status");
    this._legendElement = this.querySelector(".ortsnetz-legend");
    this._legendOpen = this._mapElement.clientWidth >= 520;
    this._installLegendEvents();
    this._renderLegend();

    try {
      const maplibregl = await loadMapLibre();
      // Während des Ladens entfernt oder neu aufgebaut: dieser Aufbau ist überholt.
      if (generation !== this._generation || !this.isConnected) return;
      this._maplibregl = maplibregl;
      const latitude = Number(this._config.latitude ?? this._hass.config.latitude);
      const longitude = Number(this._config.longitude ?? this._hass.config.longitude);
      const dark = this._isDarkTheme();
      this._lastThemeDark = dark;

      this._map = new maplibregl.Map({
        container: this._mapElement,
        style: dark ? OPENFREEMAP_DARK_STYLE : OPENFREEMAP_LIGHT_STYLE,
        center: [longitude, latitude],
        zoom: Number(this._config.zoom),
        attributionControl: true,
      });

      this._map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

      this._map.on("load", async () => {
        this._mapLoaded = true;
        this._installPointInteractions(maplibregl);
        await this._loadMeasurements();
      });

      this._map.on("style.load", () => {
        if (!this._mapLoaded) return;
        this._renderPoints(this._currentData);
      });

      this._map.on("moveend", this._onMapMoveEnd);

      const refreshSeconds = Math.max(60, Number(this._config.refresh_interval) || 300);
      // Bedarfsgesteuert: nur abrufen, solange der Tab sichtbar ist.
      this._refreshTimer = setInterval(() => {
        if (!document.hidden) this._loadMeasurements();
      }, refreshSeconds * 1000);
      document.addEventListener("visibilitychange", this._onVisibilityChange);

      this._resizeObserver = new ResizeObserver(() => this._map?.resize());
      this._resizeObserver.observe(this._mapElement);
      setTimeout(() => this._map?.resize(), 250);
    } catch (error) {
      if (generation !== this._generation) return;
      this._setStatus(`Fehler: ${error?.message || error}`);
      console.error("Ortsnetz Map initialization failed", error);
    }
  }

  _handleVisibility() {
    if (document.hidden || !this._map || !this._mapLoaded) return;
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
    this._map.on("mouseenter", LAYER_ID, () => {
      this._map.getCanvas().style.cursor = "pointer";
    });
    this._map.on("mouseleave", LAYER_ID, () => {
      this._map.getCanvas().style.cursor = "";
    });
    this._map.on("click", LAYER_ID, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const p = feature.properties || {};
      if (this._popup) this._popup.remove();
      this._popup = new maplibregl.Popup({ closeButton: true, maxWidth: "320px" })
        .setLngLat(feature.geometry.coordinates)
        .setHTML(this._popupHtml(p))
        .addTo(this._map);
      if (p.public_id) this._loadHistory(this._popup, String(p.public_id));
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
      if (container.isConnected) container.innerHTML = '<span class="popup-muted">Verlauf nicht verfügbar</span>';
    }
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

  // ---- Cluster als Tortendiagramme ----------------------------------------

  _clearClusterMarkers() {
    for (const marker of this._clusterMarkers.values()) marker.remove();
    this._clusterMarkers.clear();
  }

  _clusterElement(counts, total) {
    const size = Math.round(Math.min(72, 28 + 4 * Math.sqrt(total)));
    const r = size / 2;
    const parts = STATUSES.map((s) => ({ color: this._color(s.key), n: counts[s.key] || 0 })).filter((p) => p.n > 0);
    let shapes = "";
    if (parts.length <= 1) {
      shapes = `<circle cx="${r}" cy="${r}" r="${r}" fill="${escapeHtml(parts[0]?.color || this._color("normal"))}"/>`;
    } else {
      let angle = -Math.PI / 2;
      for (const part of parts) {
        const next = angle + (part.n / total) * 2 * Math.PI;
        const x1 = r + r * Math.cos(angle);
        const y1 = r + r * Math.sin(angle);
        const x2 = r + r * Math.cos(next);
        const y2 = r + r * Math.sin(next);
        const large = next - angle > Math.PI ? 1 : 0;
        shapes += `<path d="M${r} ${r} L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${escapeHtml(part.color)}"/>`;
        angle = next;
      }
    }
    const element = document.createElement("div");
    element.className = "ortsnetz-cluster";
    element.style.width = `${size}px`;
    element.style.height = `${size}px`;
    element.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${shapes}</svg><span>${total}</span>`;
    return element;
  }

  // Eigene Cluster-Berechnung auf allen Punkten (statt querySourceFeatures, das nur
  // bereits geladene Kacheln kennt und dadurch Marker beim Herauszoomen verlieren kann).
  _computeClusters() {
    const map = this._map;
    const radius = 45;
    const features = this._allFeatures;
    if (map.getZoom() >= CLUSTER_MAX_ZOOM) return { clusters: [], singles: features };

    const cells = new Map();
    const clusters = [];
    for (const feature of features) {
      const [lng, lat] = feature.geometry.coordinates;
      const { x, y } = map.project([lng, lat]);
      const cx = Math.floor(x / radius);
      const cy = Math.floor(y / radius);

      let target = null;
      for (let dx = -1; dx <= 1 && !target; dx++) {
        for (let dy = -1; dy <= 1 && !target; dy++) {
          for (const cluster of cells.get(`${cx + dx}:${cy + dy}`) || []) {
            if (Math.hypot(cluster.x - x, cluster.y - y) <= radius) { target = cluster; break; }
          }
        }
      }
      if (target) {
        target.members.push(feature);
        target.lng += lng;
        target.lat += lat;
      } else {
        const cluster = { x, y, lng, lat, members: [feature] };
        clusters.push(cluster);
        const key = `${cx}:${cy}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(cluster);
      }
    }

    const singles = [];
    const real = [];
    for (const cluster of clusters) {
      if (cluster.members.length === 1) singles.push(cluster.members[0]);
      else real.push(cluster);
    }
    return { clusters: real, singles };
  }

  _updateClusters() {
    if (!this._map || !this._maplibregl || !this._mapLoaded) return;
    const source = this._map.getSource(SOURCE_ID);
    if (!source) return;

    const { clusters, singles } = this._computeClusters();
    source.setData({ type: "FeatureCollection", features: singles });

    // Marker nur für den sichtbaren Bereich (mit Rand) anlegen.
    const bounds = this._map.getBounds();
    const padLng = (bounds.getEast() - bounds.getWest()) * 0.15;
    const padLat = (bounds.getNorth() - bounds.getSouth()) * 0.15;
    const seen = new Set();

    for (const cluster of clusters) {
      const total = cluster.members.length;
      const lng = cluster.lng / total;
      const lat = cluster.lat / total;
      if (
        lng < bounds.getWest() - padLng || lng > bounds.getEast() + padLng ||
        lat < bounds.getSouth() - padLat || lat > bounds.getNorth() + padLat
      ) continue;

      const counts = Object.fromEntries(STATUSES.map((s) => [s.key, 0]));
      for (const member of cluster.members) counts[member.properties.status] += 1;
      // Farben gehören zur Kennung, damit geänderte API-Farben die Marker neu zeichnen.
      const id = `${lng.toFixed(5)}:${lat.toFixed(5)}:${STATUSES.map((s) => `${counts[s.key]}${this._color(s.key)}`).join(",")}`;
      seen.add(id);
      if (this._clusterMarkers.has(id)) continue;

      const element = this._clusterElement(counts, total);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const box = new this._maplibregl.LngLatBounds();
        for (const member of cluster.members) box.extend(member.geometry.coordinates);
        const current = this._map.getZoom();
        let camera = null;
        try { camera = this._map.cameraForBounds(box, { padding: 60, maxZoom: 17 }); } catch (error) { /* ignore */ }
        const zoom = Math.max(camera?.zoom ?? 0, current + 1.5);
        this._map.easeTo({ center: camera?.center ?? [lng, lat], zoom: Math.min(zoom, 18) });
      });
      this._clusterMarkers.set(
        id,
        new this._maplibregl.Marker({ element }).setLngLat([lng, lat]).addTo(this._map)
      );
    }

    for (const [id, marker] of this._clusterMarkers) {
      if (!seen.has(id)) {
        marker.remove();
        this._clusterMarkers.delete(id);
      }
    }
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
    // Eigene Quelle und Ebene in den neuen Stil übernehmen; ohne transformStyle
    // entfernt MapLibre sie beim Stil-Diff und die Einzelpunkte verschwinden.
    this._map.setStyle(dark ? OPENFREEMAP_DARK_STYLE : OPENFREEMAP_LIGHT_STYLE, {
      transformStyle: keepOwnLayer,
    });
    this._map.once("idle", () => this._renderPoints(this._currentData));
  }

  // ---- Daten ---------------------------------------------------------------

  async _loadMeasurements() {
    if (!this._hass?.connection) return;
    this._setStatus("Lade Messwerte …");
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
      const time = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      this._setStatus(`${data.points?.length ?? 0} Messpunkte · ${time}`);
    } catch (error) {
      if (request !== this._loadRequest || generation !== this._generation) return;
      console.error("Could not load Ortsnetz points", error);
      this._setStatus(loadErrorText(error));
    }
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

  _renderPoints(data) {
    if (!this._map || !this._mapLoaded || !Array.isArray(data?.points)) return;
    if (!this._map.isStyleLoaded()) return;

    const features = [];
    for (const point of data.points) {
      if (point.latitude == null || point.longitude == null) continue;
      const status = this._pointStatus(point);
      if (!status || !this._enabled.has(status.key)) continue;

      const properties = {
        status: status.key,
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

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [Number(point.longitude), Number(point.latitude)] },
        properties,
      });
    }

    this._allFeatures = features;
    if (this._map.getSource(SOURCE_ID)) {
      this._updateClusters();
      return;
    }

    this._map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    this._map.addLayer({
      id: LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
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
    });
    this._updateClusters();
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
    if (this._statusElement) this._statusElement.textContent = text;
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

  static getConfigElement() { return document.createElement("ortsnetz-map-card-editor"); }

  static getStubConfig() {
    return { zoom: 10, phase: "auto", refresh_interval: 300, show_status: true, show_legend: true };
  }
}

class OrtsnetzMapCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { ...DEFAULT_CONFIG };
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
    const next = { ...DEFAULT_CONFIG, ...config };
    const changed = JSON.stringify(next) !== JSON.stringify(this._config);
    this._config = next;
    if (changed || !this._rendered) this._render();
  }
  _usesHaLocation() { return this._config.latitude == null || this._config.longitude == null; }

  _render() {
    if (!this.shadowRoot) return;
    this._rendered = true;
    const useHaLocation = this._usesHaLocation();
    const lat = useHaLocation ? (this._hass?.config?.latitude ?? "") : this._config.latitude;
    const lon = useHaLocation ? (this._hass?.config?.longitude ?? "") : this._config.longitude;

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
            <label class="field">Zoom<input data-key="zoom" type="number" min="1" max="19" step="1" value="${escapeHtml(this._config.zoom)}"></label>
            <label class="field">Phase für Markerfarbe<select data-key="phase">
              <option value="auto" ${this._config.phase === "auto" ? "selected" : ""}>Alle Phasen (schlechtester Wert)</option>
              <option value="L1" ${this._config.phase === "L1" ? "selected" : ""}>L1</option>
              <option value="L2" ${this._config.phase === "L2" ? "selected" : ""}>L2</option>
              <option value="L3" ${this._config.phase === "L3" ? "selected" : ""}>L3</option>
            </select></label>
            <label class="field">Aktualisierung<div class="value-row"><input data-key="refresh_interval" type="number" min="60" max="3600" step="60" value="${escapeHtml(this._config.refresh_interval)}"><span class="unit">s</span></div></label>
          </div>
          <label class="check"><input data-key="show_status" type="checkbox" ${this._config.show_status !== false ? "checked" : ""}>Status unten links anzeigen</label>
          <label class="check"><input data-key="show_legend" type="checkbox" ${this._config.show_legend !== false ? "checked" : ""}>Legende unten rechts anzeigen</label>
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

  _valueChanged(event) {
    const target = event.currentTarget;
    const key = target.dataset.key;
    if (!key) return;
    const next = { ...this._config };

    if (key === "use_ha_location") {
      if (target.checked) {
        delete next.latitude;
        delete next.longitude;
      } else {
        next.latitude = Number(this._hass?.config?.latitude ?? 0);
        next.longitude = Number(this._hass?.config?.longitude ?? 0);
      }
    } else if (key === "show_status" || key === "show_legend") {
      next[key] = target.checked;
    } else if (["zoom", "refresh_interval", "latitude", "longitude"].includes(key)) {
      next[key] = Number(target.value);
    } else {
      next[key] = target.value;
    }

    this._config = next;
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: next }, bubbles: true, composed: true,
    }));
    if (key === "use_ha_location") this._render();
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
