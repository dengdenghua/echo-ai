"""Long-tail bundled plugins are installed on demand, not loaded at startup.

Covers the fresh-install default, live install/uninstall through PluginHub,
persistence across a restart, the one-time upgrade rule for existing users,
and the design canvas companions.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.execution.suckers.registry import SkillRegistry
from runtime.platform.plugins.optional_plugins import (
    MIGRATION_FILE,
    OPTIONAL_PLUGINS,
    install_companions,
)
from runtime.platform.plugins.plugin_hub import PluginHub
from runtime.platform.plugins.workbench_activation import WorkbenchActivationStore
from runtime.platform.ui._app_routers_extra import _load_startup_plugins

BUNDLED = Path(__file__).parents[1] / "runtime/platform/plugins/bundled"
CORE = {"computer_control", "browser_control"}
LONG_TAIL = {
    "clip_studio",
    "comfyui_bridge",
    "director_stage",
    "github",
    "mx2025_viewer",
    "paper_trading_replica",
    "project_wiki",
    "whale_eye",
}


@pytest.fixture(autouse=True)
def _isolated_home(tmp_path, monkeypatch):
    # mx2025_viewer evidence lives under ~/.echo; never read the real home.
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    return home


def _data(tmp_path: Path) -> Path:
    return tmp_path / "data"


def _hub(tmp_path: Path, *, app: FastAPI | None = None) -> PluginHub:
    data = _data(tmp_path)
    return PluginHub(
        plugin_dir=data / "plugins",
        bundled_plugin_dir=BUNDLED,
        skill_registry=SkillRegistry(),
        fastapi_app=app,
        activation_root=data / "plugins" / "workbench",
        data_root=data,
    )


def _store(tmp_path: Path) -> WorkbenchActivationStore:
    data = _data(tmp_path)
    return WorkbenchActivationStore(
        root=data / "plugins" / "workbench",
        data_root=data,
        factory_root=BUNDLED,
    )


def _write(path: Path, text: str = "{}") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_every_bundled_startup_plugin_is_core_or_on_demand() -> None:
    for manifest_path in sorted(BUNDLED.glob("*/plugin.yaml")):
        manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
        name = manifest["name"]
        if manifest.get("delivery") == "remote" or manifest.get("activation") == "on_demand":
            continue
        assert name in CORE | set(OPTIONAL_PLUGINS), f"classify bundled plugin {name}"
    assert set(OPTIONAL_PLUGINS) == LONG_TAIL
    for name, spec in OPTIONAL_PLUGINS.items():
        manifest = yaml.safe_load((BUNDLED / name / "plugin.yaml").read_text(encoding="utf-8"))
        assert manifest["version"] == spec.version, name


def test_fresh_install_lists_long_tail_as_available_and_loads_only_core(tmp_path) -> None:
    hub = _hub(tmp_path)

    assert hub.migrate_optional_plugins() == []
    discovered = {item["id"]: item for item in hub.discover()}
    for name in LONG_TAIL:
        assert discovered[name]["optional"] is True
        assert discovered[name]["installed"] is False
        assert discovered[name]["enabled"] is False
    for name in CORE:
        assert discovered[name]["optional"] is False
        assert discovered[name]["installed"] is True

    assert set(hub.load_all()) == CORE
    listed = {row["id"]: row for row in hub.list_plugins()}
    assert {listed[name]["lifecycle_state"] for name in LONG_TAIL} == {"available"}
    assert hub.load("github") is None


def test_install_goes_live_without_restart_and_persists(tmp_path) -> None:
    app = FastAPI()
    hub = _hub(tmp_path, app=app)
    hub.migrate_optional_plugins()

    result = hub.install_plugin("project_wiki")

    assert result["installed"] is True
    assert result["loaded"] is True and result["started"] is True
    assert result["restart_required"] is False
    assert TestClient(app).get("/api/plugins/project-wiki/contract").status_code == 200

    restarted_app = FastAPI()
    restarted = _hub(tmp_path, app=restarted_app)
    restarted.migrate_optional_plugins()
    assert "project_wiki" in restarted.load_all()
    contract = "/api/plugins/project-wiki/contract"
    assert TestClient(restarted_app).get(contract).status_code == 200

    restarted.uninstall_plugin("project_wiki")
    assert restarted.get_plugin("project_wiki") is None
    assert TestClient(restarted_app).get(contract).status_code == 404
    after_uninstall = _hub(tmp_path)
    assert "project_wiki" not in after_uninstall.load_all()


def test_disable_and_enable_on_demand_plugin(tmp_path) -> None:
    hub = _hub(tmp_path)
    hub.install_plugin("github")

    disabled = hub.disable_plugin("github")
    assert disabled["installed"] is True and disabled["enabled"] is False
    assert hub.get_plugin("github") is None

    enabled = hub.enable_plugin("github")
    assert enabled["enabled"] is True and enabled["started"] is True


def test_failed_install_leaves_the_plugin_available(tmp_path, monkeypatch) -> None:
    hub = _hub(tmp_path)

    def broken(name: str) -> dict:
        raise RuntimeError(f"failed to start plugin: {name}")

    monkeypatch.setattr(hub, "activate_plugin", broken)
    with pytest.raises(RuntimeError):
        hub.install_plugin("whale_eye")

    state = _store(tmp_path).state("whale_eye")
    assert state["installed"] is False
    assert state["explicit"] is False
    assert not Path(state["activation_path"]).exists()


def test_upgrade_keeps_plugins_that_hold_user_data(tmp_path, _isolated_home) -> None:
    data = _data(tmp_path)
    _write(data / "design" / "director-scenes" / "scene-1.json", '{"id": "scene-1"}')
    _write(_isolated_home / ".echo" / "data" / "mx2025_viewer" / "groups.json", "[]")
    # Directories plugins create on load are not evidence of use.
    (data / "design" / "clip-studio-projects").mkdir(parents=True)
    _write(_isolated_home / ".echo" / "data" / "mx2025_viewer" / "cloud-sync.sqlite3", "x")
    store = _store(tmp_path)

    assert store.migrate_optional_plugins() == ["director_stage", "mx2025_viewer"]

    assert store.state("director_stage")["installed"] is True
    assert store.state("mx2025_viewer")["enabled"] is True
    assert store.state("clip_studio")["installed"] is False
    marker = json.loads((store.root / MIGRATION_FILE).read_text(encoding="utf-8"))
    assert marker["kept_installed"] == {
        "director_stage": "data:design/director-scenes",
        "mx2025_viewer": "data:~/.echo/data/mx2025_viewer/groups.json",
    }

    # The rule runs once: later data never installs a plugin by itself.
    _write(data / "design" / "clip-studio-projects" / "project-a.json")
    assert store.migrate_optional_plugins() == []
    assert store.state("clip_studio")["installed"] is False


def test_upgrade_keeps_design_canvas_companions(tmp_path) -> None:
    store = _store(tmp_path)
    _write(store.root / "design" / "app.json", '{"id": "design"}')

    assert store.migrate_optional_plugins() == ["clip_studio", "comfyui_bridge", "director_stage"]
    hub = _hub(tmp_path)
    loaded = set(hub.load_all())
    assert {"clip_studio", "comfyui_bridge", "director_stage"} <= loaded
    assert not loaded & {"github", "whale_eye", "project_wiki"}


def test_upgrade_respects_an_explicit_uninstall(tmp_path) -> None:
    store = _store(tmp_path)
    store.install("director_stage")
    store.uninstall("director_stage")
    _write(_data(tmp_path) / "design" / "director-scenes" / "scene-1.json")

    assert store.migrate_optional_plugins() == []
    assert store.state("director_stage")["installed"] is False


def test_uninstall_can_trash_and_restore_nested_plugin_data(tmp_path) -> None:
    store = _store(tmp_path)
    works = _data(tmp_path) / "design" / "clip-studio-projects"
    _write(works / "project-a.json", '{"id": "project-a"}')
    store.install("clip_studio")

    removed = store.uninstall("clip_studio", data_policy="trash", confirm_data_move=True)

    assert removed["data"]["status"] == "trashed"
    assert not works.exists()
    restored = store.install("clip_studio", restore_data=True)
    assert restored["data"]["status"] == "restored"
    assert (works / "project-a.json").is_file()


class _RecordingHub:
    def __init__(self, *, fail_migration: bool = False) -> None:
        self.calls: list[str] = []
        self.fail_migration = fail_migration

    def migrate_optional_plugins(self) -> list[str]:
        self.calls.append("migrate")
        if self.fail_migration:
            raise OSError("read-only data directory")
        return ["director_stage"]

    def load_all(self) -> list[str]:
        self.calls.append("load_all")
        return ["computer_control"]


@pytest.mark.parametrize("fail_migration", [False, True])
def test_startup_settles_upgrade_state_before_loading(fail_migration: bool) -> None:
    hub = _RecordingHub(fail_migration=fail_migration)

    assert _load_startup_plugins(hub) == ["computer_control"]
    assert hub.calls == ["migrate", "load_all"]


class _CompanionHub:
    def __init__(self, states: dict[str, bool], *, broken: str | None = None) -> None:
        self.states = states
        self.broken = broken
        self.installed: list[str] = []
        self.discovered = 0

    def discover(self) -> list[dict]:
        self.discovered += 1
        return [{"id": name, "installed": value} for name, value in self.states.items()]

    def install_plugin(self, name: str) -> dict:
        if name == self.broken:
            raise RuntimeError("failed to start plugin")
        self.installed.append(name)
        return {"ok": True}


def test_design_install_brings_its_companions() -> None:
    hub = _CompanionHub(
        {"clip_studio": False, "director_stage": True, "comfyui_bridge": False},
        broken="comfyui_bridge",
    )

    assert install_companions(hub, "design") == ["clip_studio"]
    assert hub.installed == ["clip_studio"]

    other = _CompanionHub({"clip_studio": False})
    assert install_companions(other, "projects") == []
    assert other.discovered == 0
