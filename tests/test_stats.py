"""Tests for the optional 24-hour status counters of Ortsnetz Map."""

from __future__ import annotations

from datetime import timedelta

from freezegun.api import FrozenDateTimeFactory

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.ortsnetz_map import OrtsnetzDataCoordinator
from custom_components.ortsnetz_map.const import API_URL, DOMAIN, STATS_URL

STATS_PAYLOAD = {
    "start": "2026-10-05T16:00:56Z",
    "end": "2026-10-06T16:00:56Z",
    "warning_measurements": 8302,
    "critical_measurements": 7,
    "normal_measurements": 164364,
    "under_voltage_warning_measurements": 225,
    "under_voltage_critical_measurements": 0,
    "over_voltage_warning_measurements": 8077,
    "over_voltage_critical_measurements": 7,
}


def _calls(mock: AiohttpClientMocker, url: str) -> int:
    """Count requests made to exactly this URL."""
    return sum(1 for call in mock.mock_calls if str(call[1]) == url)


async def _setup(hass: HomeAssistant, entry: MockConfigEntry) -> OrtsnetzDataCoordinator:
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    return entry.runtime_data


async def test_setup_does_not_fetch_stats(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
) -> None:
    """Setup causes no request for the counters."""
    aioclient_mock.get(STATS_URL, json=STATS_PAYLOAD)
    await _setup(hass, config_entry)
    assert _calls(aioclient_mock, STATS_URL) == 0


async def test_stats_are_cached(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    freezer: FrozenDateTimeFactory,
) -> None:
    """Counters are served from the cache for 300 s."""
    aioclient_mock.get(STATS_URL, json=STATS_PAYLOAD)
    coordinator = await _setup(hass, config_entry)

    assert await coordinator.async_get_threshold_stats() == STATS_PAYLOAD
    freezer.tick(timedelta(seconds=299))
    await coordinator.async_get_threshold_stats()
    assert _calls(aioclient_mock, STATS_URL) == 1

    freezer.tick(timedelta(seconds=2))
    await coordinator.async_get_threshold_stats()
    assert _calls(aioclient_mock, STATS_URL) == 2


async def test_stats_error_keeps_old_data_and_cools_down(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    freezer: FrozenDateTimeFactory,
) -> None:
    """A failed counter fetch serves old data and pauses for 60 s."""
    aioclient_mock.get(STATS_URL, json=STATS_PAYLOAD)
    coordinator = await _setup(hass, config_entry)
    await coordinator.async_get_threshold_stats()

    aioclient_mock.clear_requests()
    aioclient_mock.get(STATS_URL, status=500)
    freezer.tick(timedelta(seconds=301))
    assert await coordinator.async_get_threshold_stats() == STATS_PAYLOAD
    assert _calls(aioclient_mock, STATS_URL) == 1

    freezer.tick(timedelta(seconds=59))
    await coordinator.async_get_threshold_stats()
    assert _calls(aioclient_mock, STATS_URL) == 1

    freezer.tick(timedelta(seconds=2))
    await coordinator.async_get_threshold_stats()
    assert _calls(aioclient_mock, STATS_URL) == 2


async def test_stats_failure_returns_none(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
) -> None:
    """Without any successful fetch the counters are None."""
    aioclient_mock.get(STATS_URL, status=500)
    coordinator = await _setup(hass, config_entry)
    assert await coordinator.async_get_threshold_stats() is None


async def test_ws_includes_stats(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    hass_ws_client: WebSocketGenerator,
    api_payload: dict,
) -> None:
    """The WebSocket result carries the counters as an extra field."""
    aioclient_mock.get(API_URL, json=api_payload)
    aioclient_mock.get(STATS_URL, json=STATS_PAYLOAD)
    await _setup(hass, config_entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "ortsnetz_map/get_points"})
    msg = await client.receive_json()

    assert msg["success"]
    assert msg["result"]["threshold_stats"] == STATS_PAYLOAD
    assert msg["result"]["points"] == api_payload["points"]


async def test_ws_without_stats_keeps_format(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    hass_ws_client: WebSocketGenerator,
    api_payload: dict,
) -> None:
    """If the counters fail, the response is exactly the points payload."""
    aioclient_mock.get(API_URL, json=api_payload)
    aioclient_mock.get(STATS_URL, status=500)
    await _setup(hass, config_entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "ortsnetz_map/get_points"})
    msg = await client.receive_json()

    assert msg["success"]
    assert msg["result"] == api_payload
