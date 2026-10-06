"""Tests for the Ortsnetz Map config and options flow."""

from __future__ import annotations

from datetime import timedelta

from freezegun.api import FrozenDateTimeFactory

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.ortsnetz_map.const import (
    API_URL,
    CONF_CACHE_MAX_AGE,
    CONF_RETRY_AFTER_ERROR,
    DOMAIN,
)


async def test_user_flow_creates_entry(hass: HomeAssistant) -> None:
    """The setup flow creates an entry without data."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.FORM

    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == {}


async def test_options_flow_defaults_and_save(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> None:
    """The options form shows the defaults and stores new values."""
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()

    result = await hass.config_entries.options.async_init(config_entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    defaults = {key.schema: key.default() for key in result["data_schema"].schema}
    assert defaults == {CONF_CACHE_MAX_AGE: 300, CONF_RETRY_AFTER_ERROR: 60}

    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_CACHE_MAX_AGE: 900.0, CONF_RETRY_AFTER_ERROR: 120.0}
    )
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert config_entry.options == {CONF_CACHE_MAX_AGE: 900, CONF_RETRY_AFTER_ERROR: 120}


async def test_options_apply_after_reload(
    hass: HomeAssistant,
    config_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
    freezer: FrozenDateTimeFactory,
    api_payload: dict,
) -> None:
    """Saved options reload the entry and change the cache and retry timing."""
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()

    result = await hass.config_entries.options.async_init(config_entry.entry_id)
    await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_CACHE_MAX_AGE: 900, CONF_RETRY_AFTER_ERROR: 120}
    )
    await hass.async_block_till_done()
    coordinator = hass.data[DOMAIN][config_entry.entry_id]

    aioclient_mock.get(API_URL, json=api_payload)
    await coordinator.async_get_data()
    freezer.tick(timedelta(seconds=600))
    await coordinator.async_get_data()
    assert aioclient_mock.call_count == 1

    freezer.tick(timedelta(seconds=301))
    aioclient_mock.clear_requests()
    aioclient_mock.get(API_URL, status=500)
    assert await coordinator.async_get_data() == api_payload
    freezer.tick(timedelta(seconds=90))
    await coordinator.async_get_data()
    assert aioclient_mock.call_count == 1

    freezer.tick(timedelta(seconds=31))
    await coordinator.async_get_data()
    assert aioclient_mock.call_count == 2


async def test_minimum_cache_age(
    hass: HomeAssistant,
    aioclient_mock: AiohttpClientMocker,
    freezer: FrozenDateTimeFactory,
    api_payload: dict,
) -> None:
    """The shortest allowed cache age of 60 s refetches after one minute."""
    entry = MockConfigEntry(
        domain=DOMAIN, data={}, options={CONF_CACHE_MAX_AGE: 60, CONF_RETRY_AFTER_ERROR: 30}
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    coordinator = hass.data[DOMAIN][entry.entry_id]

    aioclient_mock.get(API_URL, json=api_payload)
    await coordinator.async_get_data()
    freezer.tick(timedelta(seconds=61))
    await coordinator.async_get_data()
    assert aioclient_mock.call_count == 2
