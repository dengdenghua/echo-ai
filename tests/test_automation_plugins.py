from __future__ import annotations

import inspect
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.execution.suckers.registry import Skill, SkillRegistry
from runtime.platform.plugins.automation import (
    configure_computer_vision,
    prepare_automation_plugins,
    register_managed_group,
)
from runtime.platform.plugins.bundled.browser_control import BrowserControlPlugin
from runtime.platform.plugins.bundled.computer_control import ComputerControlPlugin
from runtime.platform.plugins.plugin_hub import PluginHub
from runtime.platform.runtime_policy import capabilities

BUNDLED = Path(__file__).parents[1] / "runtime/platform/plugins/bundled"


@pytest.fixture
def host(tmp_path, monkeypatch):
    monkeypatch.setattr(capabilities, "_store_path", lambda: tmp_path / "capabilities.json")

    def make(*, enable_web=True):
        registry = SkillRegistry()
        hub = PluginHub(
            plugin_dir=tmp_path / "plugins",
            bundled_plugin_dir=BUNDLED,
            skill_registry=registry,
            activation_root=tmp_path / "activation",
            data_root=tmp_path / "data",
        )
        prepare_automation_plugins(registry, enable_web=enable_web, hub=hub)
        return registry, hub

    return make


@pytest.fixture
def fake_drivers(monkeypatch):
    calls = []

    def collect(self, registry, groups):
        def action(value: str = "sample"):
            calls.append(value)
            return value

        registry.register(
            Skill(
                name=f"{self.name}_probe",
                handler=action,
                trusted_source="builtin://probe",
            ),
            verify_tests=False,
        )

    monkeypatch.setattr(ComputerControlPlugin, "collect_skills", collect)
    monkeypatch.setattr(BrowserControlPlugin, "collect_skills", collect)
    return calls


@pytest.mark.parametrize(
    "name,group",
    [
        ("computer_control", "computer"),
        ("browser_control", "browser"),
    ],
)
def test_lifecycle_revokes_cached_handlers_and_persists(host, fake_drivers, name, group):
    registry, hub = host()
    register_managed_group(registry, group)
    skill = registry.get(f"{name}_probe")
    assert str(inspect.signature(skill.handler)) == "(value: 'str' = 'sample')"
    assert skill.handler("before") == "before"
    hub.disable_plugin(name)
    assert not registry.has(skill.name)
    with pytest.raises(RuntimeError, match="revoked"):
        skill.handler("after")
    assert fake_drivers == ["before"]

    # All public catalog paths must honor the persistent plugin switch.
    from runtime.execution.all_skills import _register_groups, register_group, register_subset

    _register_groups(registry, {group})
    register_group(registry, group)
    register_subset(
        registry, {"computer_screenshot" if group == "computer" else "browser_navigate"}
    )
    assert not registry.has(skill.name)
    next_registry, next_hub = host()
    register_managed_group(next_registry, group)
    assert not next_registry.has(skill.name)
    next_hub.enable_plugin(name)
    assert next_registry.get(skill.name).handler("enabled") == "enabled"
    with pytest.raises(RuntimeError, match="revoked"):
        skill.handler()
    next_hub.uninstall_plugin(name)
    assert not next_registry.has(skill.name)
    third_registry, third_hub = host()
    assert third_hub.load(name) is None
    third_hub.install_plugin(name)
    assert third_registry.has(skill.name)


def test_stop_start_does_not_resurrect_old_generation(host, fake_drivers):
    registry, hub = host()
    register_managed_group(registry, "computer")
    old = registry.get("computer_control_probe")
    assert hub.stop("computer_control")
    assert not registry.has(old.name)
    assert hub.start("computer_control")
    assert registry.get(old.name).handler() == "sample"
    with pytest.raises(RuntimeError, match="revoked"):
        old.handler()


def test_partial_registration_failure_rolls_back_without_removing_foreign_skill(
    host, fake_drivers, monkeypatch
):
    registry, hub = host()
    other = Skill(name="z_conflict", handler=lambda: None, trusted_source="builtin://foreign")
    registry.register(other, verify_tests=False)

    def collect(self, staging, groups):
        staging.register(
            Skill(name="a_first", handler=lambda: None, trusted_source="builtin://first")
        )
        staging.register(other)

    monkeypatch.setattr(ComputerControlPlugin, "collect_skills", collect)
    assert hub.load("computer_control") is None
    assert not registry.has("a_first")
    assert registry.get("z_conflict") is other


def test_host_web_ceiling_applies_to_plugin_enable(host, fake_drivers):
    registry, hub = host(enable_web=False)
    register_managed_group(registry, "browser")
    assert not registry.has("browser_control_probe")
    with pytest.raises(RuntimeError):
        hub.enable_plugin("browser_control")
    assert not registry.has("browser_control_probe")
    register_managed_group(registry, "computer")
    assert registry.has("computer_control_probe")


def test_settings_hot_reload_uses_plugin_ownership(host, fake_drivers):
    from runtime.sensing.gateway._agents_endpoints_system import _reconcile_automation_registry

    registry, hub = host()
    register_managed_group(registry, "browser")
    old = registry.get("browser_control_probe")
    caps = capabilities.Capabilities(browser_automation=False, desktop_automation=True)
    capabilities.save(caps)
    result = _reconcile_automation_registry(registry, caps)
    assert old.name in result["removed"]
    with pytest.raises(RuntimeError, match="revoked"):
        old.handler()
    capabilities.save(capabilities.Capabilities.defaults())
    result = _reconcile_automation_registry(registry, capabilities.load())
    assert old.name in result["registered"]
    hub.disable_plugin("browser_control")
    _reconcile_automation_registry(registry, capabilities.load())
    assert not registry.has(old.name)


def test_late_vision_wiring_respects_disabled_plugin_and_survives_reenable(host, fake_drivers):
    registry, hub = host()
    register_managed_group(registry, "computer")
    configure_computer_vision(registry, object())
    old = registry.get("computer_use_loop")
    hub.disable_plugin("computer_control")
    configure_computer_vision(registry, object())
    assert not registry.has("computer_use_loop")
    with pytest.raises(RuntimeError, match="revoked"):
        old.handler(goal="do not execute")
    hub.enable_plugin("computer_control")
    # The fake driver doesn't collect the loop, so explicitly exercise late injection.
    configure_computer_vision(registry, registry.automation_runtime.vision_planner)
    assert registry.has("computer_use_loop")


def test_real_registrars_match_legacy_tool_surface(host):
    from runtime.execution.suckers.browser_act_skills import register_browser_act_skills
    from runtime.execution.suckers.browser_skills import register_browser_skills
    from runtime.execution.suckers.computer_skills import register_computer_skills

    expected = SkillRegistry()
    register_browser_skills(expected)
    register_browser_act_skills(expected)
    register_computer_skills(expected, verify_tests=False)
    registry, hub = host()
    for group in ("computer", "browser", "browser_act"):
        register_managed_group(registry, group)
    assert set(registry.all_names()) == set(expected.all_names())
    assert registry.all_names()
    for name in registry.all_names():
        assert inspect.signature(registry.get(name).handler) == inspect.signature(
            expected.get(name).handler
        )
    configure_computer_vision(registry, object())
    hub.disable_plugin("computer_control")
    hub.enable_plugin("computer_control")
    assert registry.has("computer_use_loop")


def test_shared_hub_and_management_routes_gate_host_transports(host, fake_drivers, monkeypatch):
    from runtime.platform.ui.browser_router import create_browser_router
    from runtime.sensing.gateway.computer_router import create_computer_router
    from runtime.sensing.gateway.plugin_hub_router import create_plugin_hub_router

    registry, hub = host()
    for group in ("computer", "browser"):
        register_managed_group(registry, group)
    app = FastAPI()
    hub.bind_host_services(fastapi_app=app)
    assert hub.get_plugin("computer_control").ctx.fastapi_app is app
    assert prepare_automation_plugins(registry, enable_web=True) is hub
    with pytest.raises(ValueError, match="already bound"):
        hub.bind_host_services(fastapi_app=FastAPI())
    app.state.plugin_hub = hub
    app.include_router(create_browser_router())
    app.include_router(create_computer_router())
    app.include_router(create_plugin_hub_router(hub))
    with TestClient(app) as client:
        listing = client.get("/api/plugin-hub/plugins").json()
        assert {"computer_control", "browser_control"} <= {item["id"] for item in listing}
        # Status is read-only: never operate the actual desktop in regression tests.
        assert client.get("/api/computer/status").status_code == 200
        for name in ("computer_control", "browser_control"):
            assert client.post(f"/api/plugin-hub/plugins/{name}/disable").status_code == 200
        for path, body in (("/api/browser/action", {}), ("/api/computer/actions/execute", {})):
            assert client.post(path, json=body).status_code == 503
        assert client.post("/api/plugin-hub/plugins/computer_control/enable").status_code == 200
        assert client.get("/api/computer/status").status_code == 200


def test_disabling_browser_closes_existing_relay_connection(host, fake_drivers):
    from starlette.websockets import WebSocketDisconnect

    from runtime.platform.ui.browser_router import create_browser_router

    registry, hub = host()
    register_managed_group(registry, "browser")
    app = FastAPI()
    app.state.plugin_hub = hub
    app.include_router(create_browser_router())
    with TestClient(app) as client:
        with client.websocket_connect("/api/browser/relay/ws") as websocket:
            hub.disable_plugin("browser_control")
            with pytest.raises(WebSocketDisconnect) as error:
                websocket.receive_json()
            assert error.value.code == 4403
        with (
            pytest.raises(WebSocketDisconnect) as error,
            client.websocket_connect("/api/browser/relay/ws"),
        ):
            pass
        assert error.value.code == 4403


def test_running_vision_loop_cannot_resume_after_disable_and_reenable(
    host, fake_drivers, monkeypatch, tmp_path
):
    from runtime.execution.suckers import computer_use_loop as loop

    registry, hub = host()
    register_managed_group(registry, "computer")
    actions = []
    monkeypatch.setattr(loop, "PYAUTOGUI_AVAILABLE", True)

    def capture(**kwargs):
        Path(kwargs["path"]).write_bytes(b"test screenshot")
        return {"path": kwargs["path"]}

    class Planner:
        def next_action(self, **kwargs):
            hub.disable_plugin("computer_control")
            hub.enable_plugin("computer_control")
            return {"action": "click", "x": 100, "y": 100}

    monkeypatch.setattr(loop, "_screen_capture", capture)
    monkeypatch.setattr(loop, "_dispatch_action", lambda action: actions.append(action) or {})
    configure_computer_vision(registry, Planner())
    result = registry.get("computer_use_loop").handler(goal="test", screenshot_dir=str(tmp_path))
    assert result["status"] == "cancelled"
    assert actions == []
    assert hub.get_plugin("computer_control").active


def test_diagnostics_do_not_confuse_enabled_plugin_with_available_driver(
    host, fake_drivers, monkeypatch
):
    from runtime.execution.suckers import computer_skills, computer_uia_skills
    from runtime.platform.plugins import automation_diagnostics as diagnostics
    from runtime.sensing.gateway.plugin_hub_router import create_plugin_hub_router

    _, hub = host()
    hub.activate_plugin("computer_control")
    monkeypatch.setattr(computer_skills, "_check_pyautogui", lambda: "missing")
    monkeypatch.setattr(computer_uia_skills, "_computer_uia_status", lambda: {"available": False})
    monkeypatch.setattr(diagnostics.platform, "system", lambda: "Windows")
    app = FastAPI()
    app.include_router(create_plugin_hub_router(hub))
    with TestClient(app) as client:
        path = "/api/plugin-hub/plugins/computer_control/diagnostics"
        body = client.get(path).json()
        assert body["lifecycle_active"] is True
        assert body["execution_status"] == "blocked"
        monkeypatch.setattr(computer_skills, "_check_pyautogui", lambda: None)
        body = client.get(path).json()
        assert body["execution_status"] == "unverified"
        assert {"id": "desktop_session", "status": "unverified"} in body["checks"]
        hub.disable_plugin("computer_control")
        assert client.get(path).json()["execution_status"] == "blocked"
        assert client.get("/api/plugin-hub/plugins/not-automation/diagnostics").status_code == 404


def test_browser_diagnostics_report_connection_failure_without_secrets(
    host, fake_drivers, monkeypatch
):
    from runtime.execution.suckers import browser_backends, browser_skills
    from runtime.platform.plugins.automation_diagnostics import automation_diagnostics

    _, hub = host()
    hub.activate_plugin("browser_control")
    monkeypatch.setattr(browser_skills, "PLAYWRIGHT_AVAILABLE", True)
    monkeypatch.setattr(browser_backends.ElectronBackend, "available", lambda _: False)

    def broken(_):
        raise RuntimeError("token=secret-do-not-expose")

    monkeypatch.setattr(browser_backends.ExtensionBackend, "available", broken)
    body = automation_diagnostics(hub, "browser_control")
    assert body["execution_status"] == "unverified"
    assert {"id": "relay", "status": "disconnected"} in body["checks"]
    assert "secret" not in str(body)
