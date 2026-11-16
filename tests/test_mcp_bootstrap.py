"""Exercise MCP discovery/close interleavings without launching external servers."""

import threading
from types import SimpleNamespace
from unittest.mock import Mock

from runtime.execution.suckers import Skill, SkillRegistry
from runtime.platform.config import builder
from runtime.platform.config.schema import MCPServerConfigEntry


def test_late_connection_is_closed_without_publishing_or_starting_next(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    registry, clients = SkillRegistry(), []
    client = Mock()
    calls = []

    def connect(staged, server):
        calls.append(server.name)
        entered.set()
        assert release.wait(5)
        staged.register(
            Skill(name="late_tool", handler=lambda: "late", trusted_source="mcp://test/late")
        )
        return client

    monkeypatch.setattr(builder, "_register_mcp_server", connect)
    worker = builder._start_mcp_bootstrap(
        [MCPServerConfigEntry(name="slow"), MCPServerConfigEntry(name="next")],
        registry,
        clients,
    )
    assert worker is not None
    real_join = worker.join
    stack = SimpleNamespace(mcp_bootstrap=worker, mcp_clients=clients, plugin_hub=None)
    try:
        assert entered.wait(5)
        # Model the bounded join returning while a transport is still blocked.
        monkeypatch.setattr(worker, "join", lambda timeout: None)
        builder.BuiltStack.close_mcp_clients(stack)
        assert worker.is_alive()
    finally:
        release.set()
        real_join(timeout=5)
    assert not worker.is_alive()
    assert calls == ["slow"]
    assert clients == []
    assert not registry.has("late_tool")
    client.close.assert_called_once()


def test_completed_connection_publishes_and_closes_once(monkeypatch):
    registry, clients = SkillRegistry(), []
    client = Mock()

    def connect(staged, server):
        staged.register(
            Skill(name="ready_tool", handler=lambda: "ready", trusted_source="mcp://test/ready")
        )
        return client

    monkeypatch.setattr(builder, "_register_mcp_server", connect)
    worker = builder._start_mcp_bootstrap([MCPServerConfigEntry(name="ready")], registry, clients)
    assert worker is not None
    worker.join(timeout=5)
    assert registry.get("ready_tool").handler() == "ready"
    assert clients == [client]
    worker.close()
    worker.close()
    assert clients == []
    client.close.assert_called_once()


def test_failed_server_does_not_prevent_later_connection(monkeypatch):
    registry, clients = SkillRegistry(), []
    client = Mock()

    def connect(staged, server):
        if server.name == "bad":
            raise OSError("unavailable")
        staged.register(
            Skill(name="ready_tool", handler=lambda: "ready", trusted_source="mcp://test/ready")
        )
        return client

    monkeypatch.setattr(builder, "_register_mcp_server", connect)
    worker = builder._start_mcp_bootstrap(
        [MCPServerConfigEntry(name="bad"), MCPServerConfigEntry(name="good")],
        registry,
        clients,
    )
    assert worker is not None
    try:
        worker.join(timeout=5)
        assert registry.has("ready_tool")
        assert clients == [client]
    finally:
        worker.close()


def test_discovery_error_closes_the_connected_client(monkeypatch):
    from runtime.adapters import mcp_client
    from runtime.adapters.mcp_client import client as client_module

    client = Mock()
    client.list_tools.side_effect = mcp_client.MCPClientError("discovery failed")
    monkeypatch.setattr(client_module, "STDIO_AVAILABLE", True)
    monkeypatch.setattr(mcp_client, "PersistentStdioMCPClient", lambda *args, **kwargs: client)
    result = builder._register_mcp_server(SkillRegistry(), MCPServerConfigEntry(name="bad"))
    assert result is None
    client.close.assert_called_once()
