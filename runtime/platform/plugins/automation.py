"""Compose the bundled automation plugins before tools are exposed to agents.

The web application reuses this hub; there must never be a second owner of
the desktop/browser registrations. Low-level registrar APIs remain available
for standalone embedders and tests.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

AUTOMATION_GROUPS = frozenset({"computer", "browser", "browser_act"})
PLUGIN_GROUPS = {
    "computer_control": frozenset({"computer"}),
    "browser_control": frozenset({"browser", "browser_act"}),
}


@dataclass
class AutomationRuntime:
    allowed_groups: frozenset[str]
    hub: Any
    vision_planner: Any = None
    journal: Any = None


def prepare_automation_plugins(registry: Any, *, enable_web: bool, hub: Any = None) -> Any:
    """Bind one hub and a host ceiling before any catalog registration."""
    existing = getattr(registry, "automation_runtime", None)
    if existing is not None:
        return existing.hub
    if hub is None:
        from runtime.platform.plugins.plugin_hub import PluginHub
        from runtime.platform.process.paths import app_paths

        hub = PluginHub(
            plugin_dir=app_paths().data_dir / "plugins",
            bundled_plugin_dir=Path(__file__).parent / "bundled",
            skill_registry=registry,
        )
    allowed = AUTOMATION_GROUPS if enable_web else frozenset({"computer"})
    registry.automation_runtime = AutomationRuntime(allowed_groups=allowed, hub=hub)
    return hub


def register_managed_group(registry: Any, group: str) -> bool:
    """Return whether a group belongs to the hub, even when disabled."""
    runtime = getattr(registry, "automation_runtime", None)
    if runtime is None or group not in AUTOMATION_GROUPS:
        return False
    for name, groups in PLUGIN_GROUPS.items():
        if group in groups and group in runtime.allowed_groups:
            if runtime.hub.get_plugin(name) is None:
                # load() checks persisted install/enable state. Never call
                # enable_plugin here: refreshing a catalog cannot grant access.
                plugin = runtime.hub.load(name)
                if plugin is not None and not runtime.hub.start(name):
                    runtime.hub.unload(name)
            break
    return True


def configure_computer_vision(registry: Any, planner: Any, *, journal: Any = None) -> None:
    runtime = getattr(registry, "automation_runtime", None)
    if runtime is None:
        # Compatibility for small standalone stacks, outside PluginHub.
        from runtime.execution.suckers.computer_use_loop import register_computer_use_loop
        from runtime.platform.runtime_policy.capabilities import load

        if "computer" not in load().disabled_skill_groups():
            register_computer_use_loop(registry, planner, journal=journal)
        return
    runtime.vision_planner = planner
    runtime.journal = journal
    plugin = runtime.hub.get_plugin("computer_control")
    if plugin is not None and plugin.active:
        plugin.register_vision_loop()


def reconcile_automation_plugins(registry: Any, caps: Any) -> dict[str, list[str]] | None:
    runtime = getattr(registry, "automation_runtime", None)
    if runtime is None:
        return None
    before = set(registry.all_names())
    disabled = caps.disabled_skill_groups()
    for name, groups in PLUGIN_GROUPS.items():
        if not (groups & runtime.allowed_groups - disabled):
            runtime.hub.unload(name)
        else:
            register_managed_group(registry, sorted(groups)[0])
    after = set(registry.all_names())
    return {"registered": sorted(after - before), "removed": sorted(before - after)}


def automation_cancellation_check(connection: Any, name: str):
    hub = getattr(connection.app.state, "plugin_hub", None)
    if hub is None:
        return lambda: False
    plugin = hub.get_plugin(name)
    return plugin.cancellation_check() if plugin is not None else lambda: True


def require_automation_plugin(connection: Any, name: str) -> None:
    """Gate host HTTP transports as well as agent tools in managed apps."""
    from fastapi import HTTPException, WebSocketException

    hub = getattr(connection.app.state, "plugin_hub", None)
    if hub is None:
        return  # Standalone router embedders retain their existing auth policy.
    plugin = hub.get_plugin(name)
    if plugin is not None and getattr(plugin, "active", False) and plugin.permitted_groups():
        return
    detail = f"{name} is disabled or unavailable; enable it in Plugins"
    if connection.scope["type"] == "websocket":
        raise WebSocketException(code=4403, reason=detail)
    raise HTTPException(status_code=503, detail=detail)
