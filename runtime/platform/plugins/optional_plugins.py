"""Bundled plugins that ship with ECHO AI but are installed on demand.

Only the automation plugins (``computer_control``, ``browser_control``) are
live from the first start. The long-tail plugins below stay in the build as
immutable factory seeds: the store lists them as installable, installing one
activates it in the running process, and its activation descriptor keeps it
installed across restarts. A plugin that is not installed is never imported,
so it costs nothing at startup.

Upgrade rule (runs once per data directory, before the first startup load):
a plugin without an activation descriptor is kept installed when

* it has user data in one of its data locations, or
* it is a runtime companion of an installed workbench package (the design
  canvas embeds the clip editor, the director stage and the ComfyUI bridge).

An existing descriptor is the user's explicit choice and is never rewritten.
Everything else starts as "available": listed in the store, not imported.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from runtime.platform.io import atomic_write_json, read_json_with_backup

_LOG = logging.getLogger(__name__)

MIGRATION_SCHEMA = "echo.optional_plugins_migration.v1"
MIGRATION_FILE = ".optional-plugins-migration.json"


@dataclass(frozen=True)
class OptionalPlugin:
    """Install-on-demand policy for one bundled plugin."""

    version: str
    # Primary data location relative to the app data directory. Uninstall
    # keeps it unless the user explicitly moves it to the recoverable trash.
    data_dir_name: str
    # Further locations whose content proves earlier use. ``~/`` paths are
    # resolved against the user's home (some plugins predate ECHO_DATA_DIR).
    evidence: tuple[str, ...] = ()
    # Workbench packages whose pages call this plugin's routes directly.
    companion_of: tuple[str, ...] = ()


OPTIONAL_PLUGINS: dict[str, OptionalPlugin] = {
    "clip_studio": OptionalPlugin(
        "0.7.0",
        "design/clip-studio-projects",
        evidence=("design/clip-studio-exports",),
        companion_of=("design",),
    ),
    "director_stage": OptionalPlugin(
        "0.6.0",
        "design/director-scenes",
        companion_of=("design",),
    ),
    "comfyui_bridge": OptionalPlugin(
        "0.8.0",
        "design/comfyui-workflows",
        evidence=("comfyui",),
        companion_of=("design",),
    ),
    "mx2025_viewer": OptionalPlugin(
        "0.5.0",
        "mx2025_viewer",
        # The viewer creates its sqlite outbox on every load; only the files a
        # user action writes count as use.
        evidence=(
            "~/.echo/data/mx2025_viewer/groups.json",
            "~/.echo/data/mx2025_viewer/cloud-sync.json",
        ),
    ),
    # Agent-tool plugins without data of their own. The core project Wiki
    # (wiki_router) imports project_wiki.service directly and keeps working
    # whether or not the plugin is installed.
    "github": OptionalPlugin("0.1.0", "plugin-data/github"),
    "project_wiki": OptionalPlugin("1.0.0", "plugin-data/project_wiki"),
    "whale_eye": OptionalPlugin("1.0.0", "plugin-data/whale_eye"),
    "paper_trading_replica": OptionalPlugin("0.1.0", "plugin-data/paper_trading_replica"),
}


def is_optional_plugin(plugin_id: str) -> bool:
    return plugin_id in OPTIONAL_PLUGINS


def factory_specs() -> dict[str, dict[str, str]]:
    """Return the activation-store rows for every optional plugin."""

    return {
        name: {
            "version": spec.version,
            "data_dir_name": spec.data_dir_name,
            "default": "available",
        }
        for name, spec in OPTIONAL_PLUGINS.items()
    }


def _has_content(path: Path) -> bool:
    try:
        if path.is_symlink():
            return False
        if path.is_file():
            return path.stat().st_size > 0
        return path.is_dir() and any(path.iterdir())
    except OSError:
        return False


def _resolve(data_root: Path, location: str) -> Path:
    if location.startswith("~/"):
        return Path.home() / location[2:]
    return data_root / location


def usage_evidence(
    plugin_id: str,
    *,
    data_root: Path,
    workbench_root: Path,
) -> str | None:
    """Return why an upgraded install keeps ``plugin_id``, or ``None``."""

    spec = OPTIONAL_PLUGINS[plugin_id]
    for location in (spec.data_dir_name, *spec.evidence):
        if _has_content(_resolve(data_root, location)):
            return f"data:{location}"
    for package_id in spec.companion_of:
        if (workbench_root / package_id / "app.json").is_file():
            return f"companion:{package_id}"
    return None


def migrate(
    *,
    root: Path,
    data_root: Path,
    has_descriptor: Callable[[str], bool],
    available: Callable[[str], bool],
    keep_installed: Callable[[str], None],
) -> list[str]:
    """Settle install state for optional plugins once per data directory.

    ``root`` is the activation root (``<data>/plugins/workbench``), which is
    also where workbench packages are installed. Returns the plugin ids kept
    installed. A failed run writes no marker, so the next start retries.
    """

    marker = root / MIGRATION_FILE
    current = read_json_with_backup(marker, default=None)
    if isinstance(current, dict) and current.get("schema") == MIGRATION_SCHEMA:
        return []
    kept: dict[str, str] = {}
    for plugin_id in OPTIONAL_PLUGINS:
        if has_descriptor(plugin_id) or not available(plugin_id):
            continue
        reason = usage_evidence(plugin_id, data_root=data_root, workbench_root=root)
        if reason is not None:
            keep_installed(plugin_id)
            kept[plugin_id] = reason
    root.mkdir(parents=True, exist_ok=True)
    atomic_write_json(
        marker,
        {
            "schema": MIGRATION_SCHEMA,
            "completed_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "kept_installed": kept,
        },
        sort_keys=True,
    )
    return sorted(kept)


def install_companions(hub: Any, package_id: str) -> list[str]:
    """Install the bundled plugins a newly installed workbench package embeds.

    Installing the design canvas is consent to the editors it opens; without
    them its clip editor and director stage would load routes that do not
    exist. A companion the user already installed (or disabled) is left as it
    is. Failures are logged and never undo the package install.
    """

    names = [name for name, spec in OPTIONAL_PLUGINS.items() if package_id in spec.companion_of]
    if not names or not callable(getattr(hub, "install_plugin", None)):
        return []
    try:
        states = {str(item.get("id")): item for item in hub.discover()}
    except Exception as exc:  # noqa: BLE001 — plugin discovery is best-effort here
        _LOG.warning("Cannot read plugin states for %s companions: %s", package_id, exc)
        return []
    installed: list[str] = []
    for name in names:
        state = states.get(name)
        if state is None or state.get("installed"):
            continue
        try:
            hub.install_plugin(name)
        except Exception as exc:  # noqa: BLE001 — one companion never blocks the package
            _LOG.warning("Companion plugin %s for %s did not install: %s", name, package_id, exc)
            continue
        installed.append(name)
    return installed


__all__ = [
    "MIGRATION_FILE",
    "MIGRATION_SCHEMA",
    "OPTIONAL_PLUGINS",
    "OptionalPlugin",
    "factory_specs",
    "install_companions",
    "is_optional_plugin",
    "migrate",
    "usage_evidence",
]
