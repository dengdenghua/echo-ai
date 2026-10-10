"""Environment overrides ``echo serve`` applies to a loaded config."""

from __future__ import annotations

import os
from typing import Any

from runtime.platform.config import ConfigLoadError


def apply_tentacle_ws_port_override(cfg: Any) -> Any:
    """Honour ``ECHO_TENTACLE_WS_PORT`` without rewriting a user-owned config.

    Development launchers use it to isolate device listeners. The value is
    validated before use; an invalid one raises :class:`ConfigLoadError`.
    """
    override = os.environ.get("ECHO_TENTACLE_WS_PORT")
    if override is None:
        return cfg
    if not override.isascii() or not override.isdecimal():
        raise ConfigLoadError("ECHO_TENTACLE_WS_PORT must be a TCP port")
    ws_port = int(override)
    if not 1 <= ws_port <= 65535:
        raise ConfigLoadError("ECHO_TENTACLE_WS_PORT must be between 1 and 65535")
    return cfg.model_copy(update={"tentacle": cfg.tentacle.model_copy(update={"ws_port": ws_port})})
