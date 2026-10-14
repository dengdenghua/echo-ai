"""What the store shows for each engine.

``source`` says where the executable the runtime would use comes from:
``bundled`` (the full offline installer ships it), ``installed`` (from the
store), ``configured`` (an ``ECHO_*`` variable points at it), ``system`` (found
on this computer, outside strict desktop mode) or ``None`` (none yet).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .installer import EngineInstaller, engine_installer
from .lock import ENGINES, platform_key
from .store import EXECUTABLE_ENV, read_installed

BUNDLED_ENV = "ECHO_ENGINES_BUNDLED"
"""Comma-separated engines the desktop app supplied from its own resources."""


def _resolved(engine_id: str) -> str | None:
    try:
        if engine_id == "codex":
            from runtime.execution.codex_backend.command import resolve_codex_app_server_command

            return resolve_codex_app_server_command()[0]
        from runtime.execution.opencode_backend import executable

        return executable()
    except Exception:  # noqa: BLE001 — any resolution failure means "not available here"
        return None


def _same_file(left: str, right: Path) -> bool:
    try:
        return Path(left).resolve() == right.resolve()
    except OSError:
        return False


def engine_status(engine_id: str, installer: EngineInstaller | None = None) -> dict[str, Any]:
    spec = ENGINES[engine_id]
    artifact = spec.artifact()
    job = (installer or engine_installer()).job(engine_id)
    running = job is not None and job.running
    installed = read_installed(engine_id)
    current = (
        installed is not None
        and installed.version == spec.version
        and installed.platform == platform_key()
    )
    resolved = _resolved(engine_id)
    bundled = {item.strip() for item in os.environ.get(BUNDLED_ENV, "").split(",")}
    source: str | None
    if resolved is None:
        source = None
    elif os.environ.get(EXECUTABLE_ENV[engine_id]):
        source = "bundled" if engine_id in bundled else "configured"
    elif current and installed is not None and _same_file(resolved, installed.executable):
        source = "installed"
    else:
        source = "system"
    if running:
        state = "installing"
    elif source is not None:
        state = "ready"
    elif installed is not None:
        state = "update_available"
    else:
        state = "not_installed"
    return {
        "id": spec.id,
        "name": spec.name,
        "version": spec.version,
        "license": spec.license,
        "homepage": spec.homepage,
        "supported": artifact is not None,
        "download_size": artifact.size if artifact else None,
        "state": state,
        "source": source,
        "installed_version": installed.version if installed else None,
        "installed_size": installed.size if installed else None,
        "update_available": installed is not None and not current,
        "can_uninstall": installed is not None and not running,
        "job": job.snapshot() if job else None,
    }


def engine_statuses(installer: EngineInstaller | None = None) -> list[dict[str, Any]]:
    return [engine_status(engine_id, installer) for engine_id in ENGINES]


__all__ = ["BUNDLED_ENV", "engine_status", "engine_statuses"]
