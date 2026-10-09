"""Tests for on-demand fetching and the WebSocket API of Ortsnetz Map."""

from __future__ import annotations

import asyncio
from datetime import timedelta

from freezegun.api import FrozenDateTimeFactory
import pytest

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.ortsnetz_map import OrtsnetzDataCoordinator
from custom_components.ortsnetz_map.const import API_URL, DOMAIN, STATS_URL


def _calls(mock: AiohttpClientMocker, url: str) -> int:
    """Count requests made to exactly this URL."""
    return sum(1 for call in mock.mock_calls if str(call[1]) == url)


async def _setup(hass: HomeAssistant, entry: MockConfigEntry) -> OrtsnetzDataCoordinator:
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    return entry.runtime_data


async def test_setup_does_not_fetch(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    freezer: FrozenDateTimeFactory,
) -> None:
    """Setup and idle time cause no request to the external API."""
    aioclient_mock.get(API_URL, json={"points": []})
    coordinator = await _setup(hass, config_entry)

    freezer.tick(timedelta(hours=1))
    await hass.async_block_till_done()

    assert aioclient_mock.call_count == 0
    assert coordinator.data is None


async def test_parallel_requests_fetch_once(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    api_payload: dict,
) -> None:
    """Parallel first requests trigger exactly one fetch."""
    aioclient_mock.get(API_URL, json=api_payload)
    coordinator = await _setup(hass, config_entry)

    results = await asyncio.gather(*(coordinator.async_get_data() for _ in range(5)))

    assert aioclient_mock.call_count == 1
    assert all(result == api_payload for result in results)


async def test_fresh_cache_is_served(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    freezer: FrozenDateTimeFactory,
    api_payload: dict,
) -> None:
    """Data younger than the cache age is served without a fetch."""
    aioclient_mock.get(API_URL, json=api_payload)
    coordinator = await _setup(hass, config_entry)

    await coordinator.async_get_data()
    freezer.tick(timedelta(seconds=299))
    await coordinator.async_get_data()
    assert aioclient_mock.call_count == 1

    freezer.tick(timedelta(seconds=2))
    await coordinator.async_get_data()
    assert aioclient_mock.call_count == 2


async def test_forced_refresh_minimum_age(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    freezer: FrozenDateTimeFactory,
    api_payload: dict,
) -> None:
    """A forced refresh only fetches once the cache is at least 60 s old."""
    aioclient_mock.get(API_URL, json=api_payload)
    coordinator = await _setup(hass, config_entry)

    await coordinator.async_get_data()
    freezer.tick(timedelta(seconds=59))
    await coordinator.async_get_data(force=True)
    assert aioclient_mock.call_count == 1

    freezer.tick(timedelta(seconds=2))
    await coordinator.async_get_data(force=True)
    assert aioclient_mock.call_count == 2


async def test_error_serves_stale_data_and_cools_down(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    freezer: FrozenDateTimeFactory,
    api_payload: dict,
) -> None:
    """After a failure, old data is served and no retry happens for 60 s."""
    aioclient_mock.get(API_URL, json=api_payload)
    coordinator = await _setup(hass, config_entry)
    await coordinator.async_get_data()

    aioclient_mock.clear_requests()
    aioclient_mock.get(API_URL, status=500)
    freezer.tick(timedelta(seconds=301))
    assert await coordinator.async_get_data() == api_payload
    assert aioclient_mock.call_count == 1

    freezer.tick(timedelta(seconds=59))
    assert await coordinator.async_get_data() == api_payload
    assert aioclient_mock.call_count == 1

    freezer.tick(timedelta(seconds=2))
    assert await coordinator.async_get_data() == api_payload
    assert aioclient_mock.call_count == 2


async def test_initial_error_returns_none_and_cools_down(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    freezer: FrozenDateTimeFactory,
    api_payload: dict,
) -> None:
    """A failed first fetch yields None and the retry pause still applies."""
    aioclient_mock.get(API_URL, status=500)
    coordinator = await _setup(hass, config_entry)

    assert await coordinator.async_get_data() is None
    assert await coordinator.async_get_data() is None
    assert aioclient_mock.call_count == 1

    aioclient_mock.clear_requests()
    aioclient_mock.get(API_URL, json=api_payload)
    freezer.tick(timedelta(seconds=61))
    assert await coordinator.async_get_data() == api_payload
    assert aioclient_mock.call_count == 1


@pytest.mark.parametrize(
    "payload", [{"points": "nope"}, ["not", "a", "dict"]], ids=["points", "type"]
)
async def test_invalid_payload_is_failure(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    payload,
) -> None:
    """An unexpected response counts as a failed fetch."""
    aioclient_mock.get(API_URL, json=payload)
    coordinator = await _setup(hass, config_entry)

    assert await coordinator.async_get_data() is None
    assert coordinator.last_update_success is False


async def test_reload_and_unload(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
) -> None:
    """Reload and unload work without fetching."""
    await _setup(hass, config_entry)

    assert await hass.config_entries.async_reload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert config_entry.state is ConfigEntryState.LOADED

    assert await hass.config_entries.async_unload(config_entry.entry_id)
    await hass.async_block_till_done()
    assert config_entry.state is ConfigEntryState.NOT_LOADED
    assert hass.config_entries.async_loaded_entries(DOMAIN) == []
    assert aioclient_mock.call_count == 0


async def test_ws_not_loaded(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator
) -> None:
    """The WebSocket command reports a missing config entry."""
    assert await async_setup_component(hass, DOMAIN, {})
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "ortsnetz_map/get_points"})
    msg = await client.receive_json()

    assert not msg["success"]
    assert msg["error"]["code"] == "not_loaded"


async def test_ws_no_data(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """The WebSocket command reports when no data could be fetched."""
    aioclient_mock.get(API_URL, status=500)
    aioclient_mock.get(STATS_URL, status=500)
    await _setup(hass, config_entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "ortsnetz_map/get_points"})
    msg = await client.receive_json()

    assert not msg["success"]
    assert msg["error"]["code"] == "no_data"


async def test_ws_success_and_refresh(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    hass_ws_client: WebSocketGenerator,
    freezer: FrozenDateTimeFactory,
    api_payload: dict,
) -> None:
    """The WebSocket command returns data and honours the refresh flag."""
    aioclient_mock.get(API_URL, json=api_payload)
    aioclient_mock.get(STATS_URL, status=500)
    await _setup(hass, config_entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "ortsnetz_map/get_points"})
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"] == api_payload
    assert _calls(aioclient_mock, API_URL) == 1

    await client.send_json_auto_id({"type": "ortsnetz_map/get_points", "refresh": True})
    msg = await client.receive_json()
    assert msg["success"]
    assert _calls(aioclient_mock, API_URL) == 1

    freezer.tick(timedelta(seconds=61))
    await client.send_json_auto_id({"type": "ortsnetz_map/get_points", "refresh": True})
    msg = await client.receive_json()
    assert msg["success"]
    assert _calls(aioclient_mock, API_URL) == 2
