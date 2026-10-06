"""Fixtures for Ortsnetz Map tests."""

from __future__ import annotations

import pytest

from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ortsnetz_map.const import DOMAIN


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Enable loading of custom_components in all tests."""
    return


@pytest.fixture
def config_entry() -> MockConfigEntry:
    """Return a config entry for the integration."""
    return MockConfigEntry(domain=DOMAIN, title="Ortsnetz Map", data={})


@pytest.fixture
def api_payload() -> dict:
    """Return a minimal valid API response."""
    return {
        "points": [{"latitude": 52.5, "longitude": 13.4, "l1_v": 231.2}],
        "scale": {"criticalLow": 207},
        "phase": "L1",
    }
