from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from runtime.execution.agents.loader import parse_template
from runtime.execution.suckers.codex_plugin_skills import load_codex_plugin_skills
from runtime.execution.suckers.registry import SkillRegistry
from runtime.execution.tool_engine.host_tool_broker import _load_selected_plugin_actions
from runtime.platform.plugins import codex_discovery
from tools.install_personal_cad_plugins import ALL_PLUGINS
from tools.migrate_personal_optics_library import snapshot_library

ROOT = Path(__file__).resolve().parents[1]


def test_kane_binds_all_seven_packages_and_preserves_identity():
    registry = SkillRegistry()
    report = load_codex_plugin_skills(
        registry, list(ALL_PLUGINS), roots=[ROOT / "extensions/codex-plugins"]
    )
    actions = [name for load in report.loads for name in load.loaded_actions]
    assert all(load.found and not load.error for load in report.loads)
    assert len(actions) == 20
    template = parse_template(ROOT / "agents/kane", ROOT / "agents/_shared")
    assert template.agent_id == "kane"
    assert template.display_name == "Kane"
    assert set(actions).issubset(template.private_skills)
    assert "光机电" in template.soul
    assert "先读 optics_graph_stats 和 optics_search_memory" in template.soul
    assert len(template.dependencies["mcp_servers"]) == 6


def test_role_plugin_load_does_not_grant_sibling_actions(tmp_path, monkeypatch):
    plugin = tmp_path / "demo"
    manifest = plugin / ".codex-plugin/plugin.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text(json.dumps({"name": "demo", "version": "1.0.0"}), "utf-8")
    for action in ("read", "write"):
        skill = plugin / "skills" / action / "SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text(f"---\nname: {action}\ndescription: {action}\n---\n{action}", "utf-8")
    discovered = codex_discovery.discover_codex_plugins([tmp_path])
    monkeypatch.setattr(codex_discovery, "discover_codex_plugins", lambda roots=None: discovered)
    registry = SkillRegistry()
    actions = _load_selected_plugin_actions(
        registry, goal="read", context={}, role_skills=("demo__read",)
    )
    assert actions == ("demo__read",)
    assert _load_selected_plugin_actions(registry, goal="read", context={}) == ()
    assert set(
        _load_selected_plugin_actions(registry, goal="read", context={"plugin_grants": ["demo"]})
    ) == {"demo__read", "demo__write"}


def test_recovered_workbench_is_bound_separately_from_lens_library():
    registry = SkillRegistry()
    report = load_codex_plugin_skills(
        registry, ["optics-workbench"], roots=[ROOT / "extensions/codex-plugins"]
    )
    load = report.loads[0]
    assert load.found and not load.error
    assert len(load.loaded_actions) == 2
    template = parse_template(ROOT / "agents/kane", ROOT / "agents/_shared")
    assert set(load.loaded_actions).issubset(template.private_skills)
    assert "mcp_optics_workbench_optics_graph_stats" in template.private_skills
    assert "mcp_optics_workbench_optics_search_memory" in template.private_skills


def test_private_library_consistent_snapshot_and_no_source_overwrite(tmp_path):
    source = tmp_path / "original"
    source.mkdir()
    database = source / "lens_library.sqlite"
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        for table in ("knowledge", "cases", "surfaces", "catalog_cases"):
            connection.execute(f"CREATE TABLE {table}(id INTEGER)")
            connection.execute(f"INSERT INTO {table} VALUES (1)")
        connection.commit()
        destination = tmp_path / "snapshot"
        report = snapshot_library(source, destination)
        assert set(report["counts"].values()) == {1}
        with sqlite3.connect(destination / database.name) as copied:
            assert copied.execute("SELECT id FROM knowledge").fetchone() == (1,)
        assert connection.execute("SELECT id FROM knowledge").fetchone() == (1,)
    with pytest.raises(FileExistsError):
        snapshot_library(source, destination)
    with pytest.raises(ValueError):
        snapshot_library(source, source / "nested")
