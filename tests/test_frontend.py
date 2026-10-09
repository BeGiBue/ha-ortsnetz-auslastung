"""Tests for serving and registering the dashboard card."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ortsnetz_map import CARD_FILE, MAPLIBRE_DIR
from custom_components.ortsnetz_map.const import CARD_URL_PATH, MAPLIBRE_URL_PATH


def test_card_file_ships_with_the_integration() -> None:
    """The card is part of the integration folder."""
    assert CARD_FILE.is_file()
    assert CARD_FILE.parent.name == "www"
    assert "ortsnetz-map-card" in CARD_FILE.read_text(encoding="utf-8")


async def test_card_registered_once_even_after_reload(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """The static path and the extra JS URL are registered once per start."""
    hass.http = MagicMock()
    hass.http.async_register_static_paths = AsyncMock()

    with patch("homeassistant.components.frontend.add_extra_js_url") as add_url:
        config_entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(config_entry.entry_id)
        await hass.async_block_till_done()
        assert config_entry.state is ConfigEntryState.LOADED

        assert await hass.config_entries.async_reload(config_entry.entry_id)
        await hass.async_block_till_done()

    hass.http.async_register_static_paths.assert_awaited_once()
    (configs,) = hass.http.async_register_static_paths.await_args.args
    assert configs[0].url_path == CARD_URL_PATH
    assert Path(configs[0].path) == CARD_FILE
    assert configs[1].url_path == MAPLIBRE_URL_PATH
    assert Path(configs[1].path) == MAPLIBRE_DIR

    add_url.assert_called_once()
    assert add_url.call_args.args[1].startswith(f"{CARD_URL_PATH}?v=")


async def test_setup_works_without_http_server(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Without an HTTP server the integration still sets up."""
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    assert config_entry.state is ConfigEntryState.LOADED


def test_maplibre_ships_with_the_integration() -> None:
    """MapLibre GL is served locally instead of from a CDN."""
    for name in ("maplibre-gl.js", "maplibre-gl.css", "LICENSE.txt"):
        assert (MAPLIBRE_DIR / name).is_file()
    card = CARD_FILE.read_text(encoding="utf-8")
    # Card und Backend verwenden denselben Pfad.
    assert f'const MAPLIBRE_BASE = "{MAPLIBRE_URL_PATH}";' in card
    assert "unpkg.com" not in card


async def test_card_unregistered_when_integration_removed(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """Removing the integration stops loading the card in the frontend."""
    hass.http = MagicMock()
    hass.http.async_register_static_paths = AsyncMock()

    with (
        patch("homeassistant.components.frontend.add_extra_js_url") as add_url,
        patch("homeassistant.components.frontend.remove_extra_js_url") as remove_url,
    ):
        config_entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(config_entry.entry_id)
        await hass.async_block_till_done()
        url = add_url.call_args.args[1]

        assert await hass.config_entries.async_remove(config_entry.entry_id)
        await hass.async_block_till_done()

    remove_url.assert_called_once_with(hass, url)


async def test_card_registration_error_does_not_reregister_paths(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """A failing frontend call keeps setup working and registers paths once."""
    hass.http = MagicMock()
    hass.http.async_register_static_paths = AsyncMock()

    with patch(
        "homeassistant.components.frontend.add_extra_js_url", side_effect=KeyError("frontend")
    ):
        config_entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(config_entry.entry_id)
        await hass.async_block_till_done()
        assert config_entry.state is ConfigEntryState.LOADED
        assert await hass.config_entries.async_reload(config_entry.entry_id)
        await hass.async_block_till_done()

    hass.http.async_register_static_paths.assert_awaited_once()
