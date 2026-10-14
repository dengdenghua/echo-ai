from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from runtime.adapters.mcp_client import (
    MCPServerConfig,
    MCPTool,
    MockMCPClient,
    PersistentStdioMCPClient,
    register_mcp_tools_as_skills,
)
from runtime.execution.suckers import SkillRegistry
from runtime.execution.suckers.codex_plugin_skills import load_codex_plugin_skills
from runtime.platform.config.schema import MCPServerConfigEntry
from runtime.platform.plugins.codex_discovery import discover_codex_plugins
from tools.install_personal_cad_plugins import PLUGINS, echo_entry, merge_config

ROOT = Path(__file__).resolve().parents[1]


def test_registration_never_executes_cad_tools():
    calls = []
    client = MockMCPClient(
        server_name="cad",
        tools=[MCPTool(name="new_document")],
        tool_handlers={"new_document": lambda args: calls.append(args)},
    )
    registry = SkillRegistry()
    names = register_mcp_tools_as_skills(registry, client, require_trust=False)
    assert names == ["mcp_cad_new_document"]
    assert calls == []
    registry.get(names[0]).handler()
    assert calls == [{}]


def test_mcp_parameter_schema_reaches_model_catalog():
    from runtime.execution.tool_spec_builder import build_anthropic_tool_specs

    schema = {
        "type": "object",
        "properties": {"mode": {"type": "string", "enum": ["extension", "standalone"]}},
        "required": ["mode"],
        "additionalProperties": False,
    }
    client = MockMCPClient(
        server_name="zemax",
        tools=[MCPTool(name="connect", input_schema=schema)],
    )
    registry = SkillRegistry()
    register_mcp_tools_as_skills(registry, client, require_trust=False)
    specs = build_anthropic_tool_specs(registry)
    assert specs[0].input_schema == schema
    specs[0].input_schema["properties"]["mode"]["enum"].append("invalid")
    assert registry.get("mcp_zemax_connect").input_schema == schema


def test_local_stdio_preserves_plugin_working_directory(tmp_path, monkeypatch):
    monkeypatch.setattr("runtime.safety.sandboxing.sandbox.process_sandbox_required", lambda: False)
    client = PersistentStdioMCPClient.__new__(PersistentStdioMCPClient)
    client.config = MCPServerConfig(name="cad", command="python", cwd=str(tmp_path))
    params = client._stdio_parameters(lambda **kwargs: kwargs)
    assert params["cwd"] == str(tmp_path)


def test_active_echo_home_plugin_overrides_legacy_copy(tmp_path, monkeypatch):
    import runtime.platform.plugins.codex_discovery as discovery

    monkeypatch.setenv("ECHO_HOME", str(tmp_path / "active"))
    monkeypatch.delenv("ECHO_DATA_DIR", raising=False)
    monkeypatch.setattr(discovery, "project_root", lambda _: tmp_path / "repo")
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "user")
    roots = discovery._default_plugin_roots()
    for root, version in [(roots[1], "0.1.0"), (roots[2], "0.2.0")]:
        manifest = root / "cad/.codex-plugin/plugin.json"
        manifest.parent.mkdir(parents=True)
        manifest.write_text(json.dumps({"name": "cad", "version": version}), "utf-8")
    found = discover_codex_plugins()
    assert found[0]["version"] == "0.2.0"
    assert Path(found[0]["path"]).is_relative_to(tmp_path / "active")


@pytest.mark.parametrize("plugin_id,server", PLUGINS.items())
def test_packages_load_in_echo(plugin_id, server):
    root = ROOT / "extensions/codex-plugins"
    plugins = {p["id"]: p for p in discover_codex_plugins([root])}
    plugin = plugins[plugin_id]
    assert plugin["smoke"]["ok"], plugin["smoke"]["issues"]
    registry = SkillRegistry()
    report = load_codex_plugin_skills(registry, [plugin_id], roots=[root])
    assert report.loads[0].loaded_actions
    assert not report.loads[0].error
    config = json.loads((root / plugin_id / ".mcp.json").read_text("utf-8"))["mcpServers"][server]
    serialized = json.dumps(config)
    assert ".codex" not in serialized
    entry = MCPServerConfigEntry.model_validate(echo_entry(server, config))
    assert entry.timeout_ms == int(config.get("tool_timeout_sec", 30) * 1000)


def test_install_config_preserves_other_servers_and_is_idempotent():
    existing = {"name": "other", "command": "unchanged"}
    config = {"mcp_servers": [existing], "immunity": {"trusted_sources": ["skill://public/*"]}}
    entries = [echo_entry("zemax", {"command": "python", "tool_timeout_sec": 600})]
    merged = merge_config(config, entries)
    assert merged["mcp_servers"] == [existing, *entries]
    assert merged["immunity"]["trusted_sources"] == ["skill://public/*", "mcp://zemax/*"]
    assert merge_config(merged, entries) == merged
    assert config["mcp_servers"] == [existing]


def test_builder_preserves_cad_startup_options(monkeypatch):
    from runtime.adapters import mcp_client
    from runtime.platform.config.builder import _register_mcp_server

    captured = {}

    def connect(config, *, connect_timeout_ms):
        captured.update(config=config, connect_timeout_ms=connect_timeout_ms)
        return MockMCPClient(tools=[])

    monkeypatch.setattr(mcp_client, "PersistentStdioMCPClient", connect)
    monkeypatch.setattr(mcp_client, "register_mcp_tools_as_skills", lambda *args, **kwargs: [])
    client = _register_mcp_server(
        SkillRegistry(),
        MCPServerConfigEntry(
            name="zemax",
            command="python",
            cwd="optics",
            timeout_ms=600_000,
            connect_timeout_ms=30_000,
        ),
    )
    assert client is not None
    assert captured["config"].cwd == "optics"
    assert captured["config"].timeout_ms == 600_000
    assert captured["connect_timeout_ms"] == 30_000


def test_real_stdio_sdk_schema_error_and_clean_reconnect(tmp_path, monkeypatch):
    monkeypatch.setattr("runtime.safety.sandboxing.sandbox.process_sandbox_required", lambda: False)
    script = tmp_path / "probe.py"
    script.write_text(
        """import json, sys
for line in sys.stdin:
    request = json.loads(line)
    if "id" not in request:
        continue
    method = request["method"]
    if method == "initialize":
        result = {"protocolVersion": request["params"]["protocolVersion"],
                  "capabilities": {"tools": {}}, "serverInfo": {"name": "probe", "version": "1"}}
    elif method == "tools/list":
        result = {"tools": [{"name": "probe", "description": "read only",
                            "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}}}]}
    elif method == "tools/call":
        result = {"isError": True, "content": [{"type": "text", "text": "expected failure"}]}
    else:
        result = {}
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)
""",
        "utf-8",
    )
    client = PersistentStdioMCPClient(
        MCPServerConfig(name="probe", command=sys.executable, args=["probe.py"], cwd=str(tmp_path))
    )
    try:
        tools = client.list_tools()
        assert tools[0].input_schema["properties"]["path"]["type"] == "string"
        result = client.call_tool("probe", {})
        assert not result.success
        assert result.error == "expected failure"
        client._run_in_loop(client._reconnect_async(), 10)
        assert client.list_tools()[0].name == "probe"
    finally:
        client.close()
    assert client._connection_task is None
    assert client._loop.is_closed()
