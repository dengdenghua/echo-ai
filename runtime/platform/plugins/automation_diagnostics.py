"""Read-only dependency/connection checks, separate from plugin enablement.

No screenshots, clicks, browser launches or model calls are performed here.
A package import or a connected relay is not proof of successful automation.
"""

from __future__ import annotations

import platform
from typing import Any

from runtime.platform.plugins.automation import PLUGIN_GROUPS


def _desktop_checks(plugin: Any) -> list[dict[str, str]]:
    from runtime.execution.suckers.computer_skills import _check_pyautogui
    from runtime.execution.suckers.computer_uia_skills import _computer_uia_status

    runtime = getattr(
        getattr(getattr(plugin, "ctx", None), "skill_registry", None), "automation_runtime", None
    )
    return [
        {"id": "pyautogui", "status": "available" if _check_pyautogui() is None else "unavailable"},
        {
            "id": "uia",
            "status": (
                "unsupported"
                if platform.system() != "Windows"
                else "available"
                if _computer_uia_status()["available"]
                else "unavailable"
            ),
        },
        {
            "id": "vision",
            "status": "configured"
            if getattr(runtime, "vision_planner", None) is not None
            else "unconfigured",
        },
        {"id": "desktop_session", "status": "unverified"},
    ]


def _browser_checks() -> list[dict[str, str]]:
    from runtime.execution.suckers.browser_backends import ElectronBackend, ExtensionBackend
    from runtime.execution.suckers.browser_skills import PLAYWRIGHT_AVAILABLE

    checks = [
        {"id": "playwright", "status": "available" if PLAYWRIGHT_AVAILABLE else "unavailable"}
    ]
    for name, backend in (("electron", ElectronBackend), ("relay", ExtensionBackend)):
        try:
            connected = backend().available()
            checks.append({"id": name, "status": "connected" if connected else "disconnected"})
        except Exception:
            # Do not expose tokens, URLs or credentials from transport exceptions.
            checks.append({"id": name, "status": "disconnected"})
    checks.append({"id": "browser_execution", "status": "unverified"})
    return checks


def automation_diagnostics(hub: Any, name: str) -> dict[str, Any]:
    if name not in PLUGIN_GROUPS or hub.get_plugin_detail(name) is None:
        raise KeyError(name)
    plugin = hub.get_plugin(name)
    active = bool(plugin and plugin.active and plugin.permitted_groups())
    checks = _desktop_checks(plugin) if name == "computer_control" else _browser_checks()
    drivers = [
        row
        for row in checks
        if row["id"] in {"pyautogui", "uia", "playwright", "electron", "relay"}
    ]
    usable_driver = any(row["status"] in {"available", "connected"} for row in drivers)
    return {
        "plugin_id": name,
        "lifecycle_active": active,
        "execution_status": "unverified" if active and usable_driver else "blocked",
        "checks": checks,
        "verification": "dependencies_and_connections_only",
    }
