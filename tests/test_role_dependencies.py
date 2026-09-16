import json
from pathlib import Path

import pytest

from runtime.execution.agents.dependencies import normalize_role_dependencies
from runtime.execution.agents.loader import parse_template
from runtime.execution.misc.agent_packs import import_agent_from_pack, scan_agent_pack


def _pack(root: Path, dependencies=None):
    (root / ".codebuddy-plugin").mkdir(parents=True)
    (root / "agents").mkdir()
    (root / ".codebuddy-plugin/plugin.json").write_text(
        json.dumps({"name": "research", "dependencies": dependencies}), encoding="utf-8"
    )
    (root / "agents/research.md").write_text(
        "---\nname: research\ndescription: Research\n---\nResearch the supplied materials.",
        encoding="utf-8",
    )


def test_workbuddy_dependencies_survive_import_and_role_loading(tmp_path):
    pack = tmp_path / "pack"
    _pack(pack, {"connectors": ["feishu", "dingtalk", "feishu"], "mcpServers": "connections.json"})
    (pack / "connections.json").write_text(
        json.dumps({"mcpServers": {"research-db": {"url": "https://example.invalid/mcp", "headers": {"Authorization": "do-not-copy"}}}}),
        encoding="utf-8",
    )
    preview = scan_agent_pack(pack)
    assert [item.name for item in preview.mcp_servers] == ["research-db"]
    result = import_agent_from_pack(pack, "research", tmp_path / "agents", tmp_path / "skills")
    role_dir = Path(result.agent_path)
    profile = json.loads((role_dir / "profile.jsonc").read_text(encoding="utf-8"))
    expected = {"connectors": ["feishu", "dingtalk"], "mcp_servers": ["research-db"]}
    assert profile["dependencies"] == expected
    template = parse_template(role_dir, tmp_path / "shared")
    assert template.dependencies == expected
    assert "do-not-copy" not in (role_dir / "profile.jsonc").read_text(encoding="utf-8")
    assert not (tmp_path / "agents/.mcp.json").exists()


@pytest.mark.parametrize("dependencies", [
    {"connectors": "feishu"}, {"connectors": ["../feishu"]},
    {"connectors": ["x" * 129]}, {"connectors": [None]},
    {"connectors": ["a"] * 65}, {"mcpServers": "../outside.json"},
    {"mcpServers": "missing.json"}, {"mcpServers": {"url": "https://example.invalid"}},
    {"mcpServers": ["a"] * 65},
])
def test_invalid_required_dependencies_prevent_partial_install(tmp_path, dependencies):
    pack = tmp_path / "pack"
    _pack(pack, dependencies)
    (tmp_path / "outside.json").write_text('{"mcpServers": {}}', encoding="utf-8")
    with pytest.raises(ValueError, match="invalid role dependencies"):
        import_agent_from_pack(pack, "research", tmp_path / "agents", tmp_path / "skills")
    assert not (tmp_path / "agents").exists()
    assert not (tmp_path / "skills").exists()


def test_malformed_mcp_does_not_silently_drop_a_required_connection(tmp_path):
    pack = tmp_path / "pack"
    _pack(pack)
    (pack / ".mcp.json").write_text("not json", encoding="utf-8")
    with pytest.raises(ValueError, match="invalid role dependencies"):
        import_agent_from_pack(pack, "research", tmp_path / "agents", tmp_path / "skills")


def test_legacy_pack_without_dependencies_remains_supported(tmp_path):
    pack = tmp_path / "pack"
    _pack(pack)
    result = import_agent_from_pack(pack, "research", tmp_path / "agents", tmp_path / "skills")
    assert parse_template(Path(result.agent_path), tmp_path / "shared").dependencies == {
        "connectors": [], "mcp_servers": []
    }


def test_dependencies_carry_ids_only():
    assert normalize_role_dependencies({"connectors": ["feishu"], "url": "https://example.invalid"}) == {
        "connectors": ["feishu"], "mcp_servers": []
    }
