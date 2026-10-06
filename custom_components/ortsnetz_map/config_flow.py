"""Config flow for Ortsnetz Map."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector

from .const import (
    CACHE_MAX_AGE_RANGE,
    CACHE_MAX_AGE_SECONDS,
    CONF_CACHE_MAX_AGE,
    CONF_RETRY_AFTER_ERROR,
    DOMAIN,
    RETRY_AFTER_ERROR_RANGE,
    RETRY_AFTER_ERROR_SECONDS,
)


def _seconds_selector(limits: tuple[int, int]) -> selector.NumberSelector:
    return selector.NumberSelector(
        selector.NumberSelectorConfig(
            min=limits[0],
            max=limits[1],
            step=1,
            unit_of_measurement="s",
            mode=selector.NumberSelectorMode.BOX,
        )
    )


class OrtsnetzMapConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Ortsnetz Map."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> OrtsnetzMapOptionsFlow:
        """Return the options flow."""
        return OrtsnetzMapOptionsFlow()

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial setup step."""
        if user_input is not None:
            return self.async_create_entry(title="Ortsnetz Map", data={})

        return self.async_show_form(step_id="user")


class OrtsnetzMapOptionsFlow(config_entries.OptionsFlowWithReload):
    """Change cache and retry timing; the entry reloads after saving."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Show and store the options."""
        if user_input is not None:
            return self.async_create_entry(
                data={key: int(value) for key, value in user_input.items()}
            )

        options = self.config_entry.options
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_CACHE_MAX_AGE,
                    default=options.get(CONF_CACHE_MAX_AGE, CACHE_MAX_AGE_SECONDS),
                ): _seconds_selector(CACHE_MAX_AGE_RANGE),
                vol.Required(
                    CONF_RETRY_AFTER_ERROR,
                    default=options.get(CONF_RETRY_AFTER_ERROR, RETRY_AFTER_ERROR_SECONDS),
                ): _seconds_selector(RETRY_AFTER_ERROR_RANGE),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
