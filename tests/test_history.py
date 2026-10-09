"""Tests for the on-demand 24-hour history of a single site."""

from __future__ import annotations

import asyncio
from datetime import timedelta

from freezegun.api import FrozenDateTimeFactory

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.ortsnetz_map import OrtsnetzDataCoordinator
from custom_components.ortsnetz_map.const import (
    API_URL,
    DOMAIN,
    HISTORY_CACHE_MAX_ENTRIES,
    HISTORY_URL_TEMPLATE,
)

SITE = "6TVDhwT4hmihNBIz"
HISTORY_PAYLOAD = {
    "start": "2026-10-05T16:42:22Z",
    "end": "2026-10-06T16:42:22Z",
    "samples": [
        {
            "at": "2026-10-05T16:43:01Z",
            "l1_v": 234.6,
            "l2_v": 237.7,
            "l3_v": 231.4,
            "grid_frequency_hz": 49.9,
        }
    ],
}


POINTS_PAYLOAD = {
    "points": [{"latitude": 52.5, "longitude": 13.4, "l1_v": 231.2, "public_id": SITE}],
}


def _url(public_id: str = SITE) -> str:
    return HISTORY_URL_TEMPLATE.format(public_id=public_id)


def _calls(mock: AiohttpClientMocker, url: str) -> int:
    return sum(1 for call in mock.mock_calls if str(call[1]) == url)


async def _setup(hass: HomeAssistant, entry: MockConfigEntry) -> OrtsnetzDataCoordinator:
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    return entry.runtime_data


async def test_history_is_cached_per_site(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    freezer: FrozenDateTimeFactory,
) -> None:
    """A site's history is fetched once and then served from the cache."""
    aioclient_mock.get(_url(), json=HISTORY_PAYLOAD)
    coordinator = await _setup(hass, config_entry)

    assert await coordinator.async_get_history(SITE) == HISTORY_PAYLOAD
    freezer.tick(timedelta(seconds=299))
    await coordinator.async_get_history(SITE)
    assert _calls(aioclient_mock, _url()) == 1

    freezer.tick(timedelta(seconds=2))
    await coordinator.async_get_history(SITE)
    assert _calls(aioclient_mock, _url()) == 2


async def test_history_error_serves_old_data_and_cools_down(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    freezer: FrozenDateTimeFactory,
) -> None:
    """After a failure old data is served and retries pause for 60 s."""
    aioclient_mock.get(_url(), json=HISTORY_PAYLOAD)
    coordinator = await _setup(hass, config_entry)
    await coordinator.async_get_history(SITE)

    aioclient_mock.clear_requests()
    aioclient_mock.get(_url(), status=500)
    freezer.tick(timedelta(seconds=301))
    assert await coordinator.async_get_history(SITE) == HISTORY_PAYLOAD
    assert _calls(aioclient_mock, _url()) == 1

    freezer.tick(timedelta(seconds=59))
    await coordinator.async_get_history(SITE)
    assert _calls(aioclient_mock, _url()) == 1

    freezer.tick(timedelta(seconds=2))
    await coordinator.async_get_history(SITE)
    assert _calls(aioclient_mock, _url()) == 2


async def test_history_failure_returns_none(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
) -> None:
    """Without a successful fetch there is no history."""
    aioclient_mock.get(_url(), status=404)
    coordinator = await _setup(hass, config_entry)
    assert await coordinator.async_get_history(SITE) is None


async def test_history_cache_is_bounded(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
) -> None:
    """Only a limited number of sites is kept in the cache."""
    coordinator = await _setup(hass, config_entry)
    for index in range(HISTORY_CACHE_MAX_ENTRIES + 5):
        public_id = f"site{index:04d}abcd"
        aioclient_mock.get(_url(public_id), json=HISTORY_PAYLOAD)
        await coordinator.async_get_history(public_id)
    assert len(coordinator._history) == HISTORY_CACHE_MAX_ENTRIES


async def test_ws_history(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """The WebSocket command returns the history of a known site."""
    aioclient_mock.get(API_URL, json=POINTS_PAYLOAD)
    aioclient_mock.get(_url(), json=HISTORY_PAYLOAD)
    await _setup(hass, config_entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "ortsnetz_map/get_history", "public_id": SITE})
    msg = await client.receive_json()

    assert msg["success"]
    assert msg["result"] == HISTORY_PAYLOAD


async def test_ws_history_rejects_invalid_ids(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """IDs with unexpected characters never reach the external API."""
    await _setup(hass, config_entry)
    client = await hass_ws_client(hass)

    for bad_id in ("../config", "abc", "a/b/c/d/e/f/g/h", "x" * 100, "id with space", SITE + "\n"):
        await client.send_json_auto_id({"type": "ortsnetz_map/get_history", "public_id": bad_id})
        msg = await client.receive_json()
        assert not msg["success"]

    assert aioclient_mock.call_count == 0


async def test_ws_history_not_loaded(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator
) -> None:
    """Without a config entry the command reports not_loaded."""
    from homeassistant.setup import async_setup_component

    assert await async_setup_component(hass, DOMAIN, {})
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "ortsnetz_map/get_history", "public_id": SITE})
    msg = await client.receive_json()

    assert not msg["success"]
    assert msg["error"]["code"] == "not_loaded"


async def test_ws_history_rejects_unknown_sites(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """IDs that are not in the point list never reach the history endpoint."""
    aioclient_mock.get(API_URL, json=POINTS_PAYLOAD)
    await _setup(hass, config_entry)
    client = await hass_ws_client(hass)

    for index in range(HISTORY_CACHE_MAX_ENTRIES + 1):
        await client.send_json_auto_id(
            {"type": "ortsnetz_map/get_history", "public_id": f"aaaaaaaa{index:02d}"}
        )
        msg = await client.receive_json()
        assert not msg["success"]
        assert msg["error"]["code"] == "not_found"

    # Die Punktliste wird einmal geladen, Verläufe werden nie abgefragt.
    assert _calls(aioclient_mock, API_URL) == 1
    assert aioclient_mock.call_count == 1


async def test_ws_history_without_point_list(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """If the point list cannot be loaded, no site is considered known."""
    aioclient_mock.get(API_URL, status=500)
    await _setup(hass, config_entry)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "ortsnetz_map/get_history", "public_id": SITE})
    msg = await client.receive_json()

    assert msg["error"]["code"] == "not_found"
    assert _calls(aioclient_mock, _url()) == 0


async def test_slow_site_does_not_block_cached_sites(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
) -> None:
    """A hanging history request does not delay other sites."""
    other = "otherSite0001"
    aioclient_mock.get(_url(other), json=HISTORY_PAYLOAD)
    coordinator = await _setup(hass, config_entry)
    assert await coordinator.async_get_history(other) == HISTORY_PAYLOAD

    release = asyncio.Event()

    async def _hang(method, url, data):
        await release.wait()

    aioclient_mock.get(_url(), side_effect=_hang)
    slow = hass.async_create_task(coordinator.async_get_history(SITE))
    await asyncio.sleep(0)

    # Der Cache des anderen Standorts antwortet sofort, obwohl SITE noch hängt.
    async with asyncio.timeout(1):
        assert await coordinator.async_get_history(other) == HISTORY_PAYLOAD
    assert not slow.done()

    release.set()
    await slow


async def test_parallel_requests_for_one_site_fetch_once(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
) -> None:
    """Concurrent popups for the same site share a single fetch."""
    aioclient_mock.get(_url(), json=HISTORY_PAYLOAD)
    coordinator = await _setup(hass, config_entry)

    results = await asyncio.gather(*(coordinator.async_get_history(SITE) for _ in range(5)))

    assert all(result == HISTORY_PAYLOAD for result in results)
    assert _calls(aioclient_mock, _url()) == 1
