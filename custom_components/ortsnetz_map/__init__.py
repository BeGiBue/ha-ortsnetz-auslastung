"""Ortsnetz Map backend integration."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
import logging
from pathlib import Path
from time import monotonic
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.loader import async_get_integration

from .const import (
    API_URL,
    CACHE_MAX_AGE_SECONDS,
    CARD_URL_PATH,
    CONF_CACHE_MAX_AGE,
    CONF_RETRY_AFTER_ERROR,
    DATA_CARD_REGISTERED,
    DATA_STATIC_PATHS_REGISTERED,
    DOMAIN,
    FORCED_REFRESH_MIN_AGE_SECONDS,
    HISTORY_CACHE_MAX_ENTRIES,
    HISTORY_ID_PATTERN,
    HISTORY_URL_TEMPLATE,
    MAPLIBRE_URL_PATH,
    REQUEST_TIMEOUT_SECONDS,
    RETRY_AFTER_ERROR_SECONDS,
    STATS_URL,
)

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

WWW_DIR = Path(__file__).parent / "www"
CARD_FILE = WWW_DIR / "ortsnetz-map-card.js"
MAPLIBRE_DIR = WWW_DIR / "maplibre"


class OrtsnetzDataCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Fetch map points from ortsnetz-auslastung.de on demand and cache them.

    Es gibt kein festes Polling-Intervall (update_interval=None). Abgerufen wird
    nur, wenn ein Client Daten anfragt und der Cache veraltet ist.
    """

    def __init__(self, hass: HomeAssistant, entry: OrtsnetzMapConfigEntry) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            logger=_LOGGER,
            name="Ortsnetz Map data",
            config_entry=entry,
            update_interval=None,
        )
        self._cache_max_age: int = entry.options.get(CONF_CACHE_MAX_AGE, CACHE_MAX_AGE_SECONDS)
        self._retry_after_error: int = entry.options.get(
            CONF_RETRY_AFTER_ERROR, RETRY_AFTER_ERROR_SECONDS
        )
        self._lock = asyncio.Lock()
        self._last_success: float | None = None
        self._last_attempt: float | None = None
        # Zähler der letzten 24 Stunden: eigener Cache, damit ein Ausfall dieses
        # (optionalen) Abrufs die Kartenpunkte nicht beeinträchtigt.
        self._stats_lock = asyncio.Lock()
        self._stats: dict[str, Any] | None = None
        self._stats_success: float | None = None
        self._stats_attempt: float | None = None
        self._stats_failed = False
        # Verläufe einzelner Standorte: erst beim Öffnen eines Popups abgerufen.
        # Ein Lock je Standort, damit ein langsamer Standort die anderen nicht blockiert.
        self._history_locks: dict[str, asyncio.Lock] = {}
        self._history: OrderedDict[str, dict[str, Any]] = OrderedDict()
        # public_ids der zuletzt geladenen Punktliste (nur diese sind abfragbar).
        self._known_ids: frozenset[str] = frozenset()
        self._known_ids_source: Any = None

    async def _fetch_json(self, url: str) -> Any:
        """Fetch a JSON document from the external API."""
        session = async_get_clientsession(self.hass)
        async with (
            asyncio.timeout(REQUEST_TIMEOUT_SECONDS),
            session.get(url, headers={"Accept": "application/json"}) as response,
        ):
            response.raise_for_status()
            return await response.json(content_type=None)

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch current map data."""
        try:
            data = await self._fetch_json(API_URL)
        except Exception as err:  # noqa: BLE001
            raise UpdateFailed(f"Could not fetch Ortsnetz map data: {err}") from err

        if not isinstance(data, dict) or not isinstance(data.get("points"), list):
            raise UpdateFailed("Unexpected response from Ortsnetz map API")
        return data

    async def async_get_data(self, force: bool = False) -> dict[str, Any] | None:
        """Return cached data and refresh it first if needed.

        - Frischer Cache: keine Anfrage an die externe API.
        - Veralteter/leerer Cache: genau ein Abruf, parallele Anfragen warten
          auf dasselbe Ergebnis.
        - Schlägt der Abruf fehl, werden vorhandene Daten weiter ausgeliefert.
        """
        async with self._lock:
            now = monotonic()
            max_age = FORCED_REFRESH_MIN_AGE_SECONDS if force else self._cache_max_age
            cache_fresh = (
                self.data is not None
                and self._last_success is not None
                and now - self._last_success < max_age
            )
            in_error_cooldown = (
                not self.last_update_success
                and self._last_attempt is not None
                and now - self._last_attempt < self._retry_after_error
            )
            if not cache_fresh and not in_error_cooldown:
                self._last_attempt = monotonic()
                await self.async_refresh()
                if self.last_update_success:
                    self._last_success = monotonic()
            return self.data

    async def async_get_threshold_stats(self, force: bool = False) -> dict[str, Any] | None:
        """Return the 24-hour status counters, cached like the map points.

        Der Abruf ist optional: Schlägt er fehl, werden vorhandene (ältere)
        Zähler oder None geliefert und frühestens nach der Fehlerpause erneut
        versucht.
        """
        async with self._stats_lock:
            now = monotonic()
            max_age = FORCED_REFRESH_MIN_AGE_SECONDS if force else self._cache_max_age
            cache_fresh = (
                self._stats is not None
                and self._stats_success is not None
                and now - self._stats_success < max_age
            )
            in_error_cooldown = (
                self._stats_failed
                and self._stats_attempt is not None
                and now - self._stats_attempt < self._retry_after_error
            )
            if not cache_fresh and not in_error_cooldown:
                self._stats_attempt = monotonic()
                try:
                    data = await self._fetch_json(STATS_URL)
                    if not isinstance(data, dict):
                        raise ValueError("unexpected response type")
                except Exception as err:  # noqa: BLE001
                    self._stats_failed = True
                    _LOGGER.debug("Could not fetch Ortsnetz threshold stats: %s", err)
                else:
                    self._stats = data
                    self._stats_success = monotonic()
                    self._stats_failed = False
            return self._stats

    async def async_is_known_site(self, public_id: str) -> bool:
        """Return whether public_id belongs to a site in the current point list.

        Nur Standorte aus der Punktliste dürfen einen Verlauf abrufen. Ist die
        Liste noch nicht geladen, wird sie dafür geladen (mit Cache und
        Fehlerpause wie bei einer Card-Anfrage).
        """
        data = self.data if self.data is not None else await self.async_get_data()
        if data is None:
            return False
        if data is not self._known_ids_source:
            self._known_ids = frozenset(
                str(point["public_id"])
                for point in data.get("points", [])
                if isinstance(point, dict) and point.get("public_id") not in (None, "")
            )
            self._known_ids_source = data
        return public_id in self._known_ids

    def _cached_history(self, public_id: str, now: float) -> tuple[bool, dict[str, Any] | None]:
        """Return (usable, data) for a cached history without waiting."""
        entry = self._history.get(public_id)
        if entry is None:
            return False, None
        fresh = entry["data"] is not None and now - entry["success"] < self._cache_max_age
        cooling_down = entry["failed"] and now - entry["attempt"] < self._retry_after_error
        if fresh or cooling_down:
            self._history.move_to_end(public_id)
            return True, entry["data"]
        return False, None

    async def async_get_history(self, public_id: str) -> dict[str, Any] | None:
        """Return the 24-hour history of one site, cached per site.

        Abgerufen wird nur auf Anfrage (Popup). Frische Einträge kommen ohne
        Wartezeit aus dem Cache; Abrufe sind je Standort serialisiert, sodass ein
        langsamer Standort andere nicht aufhält. Nach einem Fehler gilt dieselbe
        Pause wie bei den Kartenpunkten. Es werden höchstens
        HISTORY_CACHE_MAX_ENTRIES Standorte gemerkt.
        """
        usable, data = self._cached_history(public_id, monotonic())
        if usable:
            return data

        lock = self._history_locks.setdefault(public_id, asyncio.Lock())
        async with lock:
            # Ein paralleler Aufruf kann den Eintrag inzwischen geladen haben.
            usable, data = self._cached_history(public_id, monotonic())
            if usable:
                return data

            entry = self._history.get(public_id) or {
                "data": None,
                "success": 0.0,
                "attempt": 0.0,
                "failed": False,
            }
            entry["attempt"] = monotonic()
            try:
                data = await self._fetch_json(
                    HISTORY_URL_TEMPLATE.format(public_id=public_id)
                )
                if not isinstance(data, dict) or not isinstance(data.get("samples"), list):
                    raise ValueError("unexpected response")
            except Exception as err:  # noqa: BLE001
                entry["failed"] = True
                _LOGGER.debug("Could not fetch Ortsnetz history for a site: %s", err)
            else:
                entry["data"] = data
                entry["success"] = monotonic()
                entry["failed"] = False

            self._history[public_id] = entry
            self._history.move_to_end(public_id)
            while len(self._history) > HISTORY_CACHE_MAX_ENTRIES:
                evicted, _ = self._history.popitem(last=False)
                evicted_lock = self._history_locks.get(evicted)
                if evicted_lock is not None and not evicted_lock.locked():
                    del self._history_locks[evicted]
            return entry["data"]


type OrtsnetzMapConfigEntry = ConfigEntry[OrtsnetzDataCoordinator]


def _loaded_coordinator(hass: HomeAssistant) -> OrtsnetzDataCoordinator | None:
    """Return the coordinator of the loaded config entry, if any."""
    entries = hass.config_entries.async_loaded_entries(DOMAIN)
    return entries[0].runtime_data if entries else None


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Register the authenticated WebSocket API."""
    websocket_api.async_register_command(hass, ws_get_points)
    websocket_api.async_register_command(hass, ws_get_history)
    return True


async def _async_register_card(hass: HomeAssistant) -> None:
    """Serve the dashboard card and MapLibre, and load the card in the frontend.

    Die statischen Pfade werden einmal pro Start registriert, die Card wird bei
    jeder Einrichtung (wieder) ins Frontend eingetragen. Fehler hier dürfen die
    Einrichtung nicht verhindern: Ohne Card funktionieren Abruf und
    WebSocket-API weiter.
    """
    if getattr(hass, "http", None) is None:
        _LOGGER.debug("HTTP server not available, dashboard card not registered")
        return

    try:
        if not hass.data.get(DATA_STATIC_PATHS_REGISTERED):
            from homeassistant.components.http import StaticPathConfig  # noqa: PLC0415

            await hass.http.async_register_static_paths(
                [
                    StaticPathConfig(CARD_URL_PATH, str(CARD_FILE), False),
                    StaticPathConfig(MAPLIBRE_URL_PATH, str(MAPLIBRE_DIR), True),
                ]
            )
            hass.data[DATA_STATIC_PATHS_REGISTERED] = True

        if hass.data.get(DATA_CARD_REGISTERED):
            return
        from homeassistant.components.frontend import add_extra_js_url  # noqa: PLC0415

        url = await _async_card_url(hass)
        add_extra_js_url(hass, url)
    except Exception:  # noqa: BLE001
        _LOGGER.warning("Could not register the Ortsnetz Map dashboard card", exc_info=True)
        return

    hass.data[DATA_CARD_REGISTERED] = url


async def _async_card_url(hass: HomeAssistant) -> str:
    """Return the card URL; the version keeps browsers from using an old card."""
    integration = await async_get_integration(hass, DOMAIN)
    return f"{CARD_URL_PATH}?v={integration.version}"


async def async_setup_entry(hass: HomeAssistant, entry: OrtsnetzMapConfigEntry) -> bool:
    """Set up Ortsnetz Map from a config entry."""
    await _async_register_card(hass)
    # Bewusst kein Abruf beim Start: Daten werden erst bei der ersten Card-Anfrage geladen.
    entry.runtime_data = OrtsnetzDataCoordinator(hass, entry)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: OrtsnetzMapConfigEntry) -> bool:
    """Unload a config entry."""
    return True


async def async_remove_entry(hass: HomeAssistant, entry: OrtsnetzMapConfigEntry) -> None:
    """Stop loading the card in the frontend once the integration is removed."""
    url = hass.data.pop(DATA_CARD_REGISTERED, None)
    if not url:
        return
    try:
        from homeassistant.components.frontend import remove_extra_js_url  # noqa: PLC0415

        remove_extra_js_url(hass, url)
    except Exception:  # noqa: BLE001
        _LOGGER.debug("Could not unregister the Ortsnetz Map dashboard card", exc_info=True)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ortsnetz_map/get_points",
        vol.Optional("refresh", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_get_points(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return cached Ortsnetz map data to an authenticated frontend client."""
    coordinator = _loaded_coordinator(hass)
    if coordinator is None:
        connection.send_error(msg["id"], "not_loaded", "Ortsnetz Map backend is not configured")
        return

    data, stats = await asyncio.gather(
        coordinator.async_get_data(force=msg["refresh"]),
        coordinator.async_get_threshold_stats(force=msg["refresh"]),
    )

    if data is None:
        connection.send_error(msg["id"], "no_data", "No Ortsnetz data available")
        return

    # Zusatzfeld "threshold_stats" nur, wenn die Zähler verfügbar sind; das
    # übrige Antwortformat bleibt unverändert.
    connection.send_result(msg["id"], {**data, "threshold_stats": stats} if stats else data)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "ortsnetz_map/get_history",
        vol.Required("public_id"): vol.All(str, vol.Match(HISTORY_ID_PATTERN)),
    }
)
@websocket_api.async_response
async def ws_get_history(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the cached 24-hour history of one site to an authenticated client."""
    coordinator = _loaded_coordinator(hass)
    if coordinator is None:
        connection.send_error(msg["id"], "not_loaded", "Ortsnetz Map backend is not configured")
        return

    # Nur Standorte aus der Punktliste: beliebige IDs würden sonst jeweils einen
    # externen Abruf auslösen und den Cache verdrängen.
    if not await coordinator.async_is_known_site(msg["public_id"]):
        connection.send_error(msg["id"], "not_found", "Unknown Ortsnetz site")
        return

    data = await coordinator.async_get_history(msg["public_id"])

    if data is None:
        connection.send_error(msg["id"], "no_data", "No history available for this site")
        return

    connection.send_result(msg["id"], data)
