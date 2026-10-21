"""Exercise the actual discovery methods without starting subprocesses or HTTP servers."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from runtime.adapters.mcp_client import (
    HttpMCPClient,
    MCPServerConfig,
    PersistentStdioMCPClient,
    StdioMCPClient,
    register_mcp_tools_as_skills,
)
from runtime.execution.suckers import SkillRegistry


@pytest.mark.parametrize("client_type", [StdioMCPClient, PersistentStdioMCPClient, HttpMCPClient])
@pytest.mark.parametrize("hint", [True, False, None])
def test_discovery_preserves_sdk_annotation_aliases(client_type, hint, monkeypatch):
    mcp = pytest.importorskip("mcp")
    from mcp.types import Tool, ToolAnnotations

    annotations = (
        ToolAnnotations(readOnlyHint=hint, destructiveHint=False, idempotentHint=True)
        if hint is not None
        else None
    )
    sdk_tool = Tool(
        name="scene",
        description="Scene data",
        inputSchema={"type": "object"},
        annotations=annotations,
    )

    class Session:
        async def initialize(self):
            return None

        async def list_tools(self):
            return SimpleNamespace(tools=[sdk_tool])

    session = Session()

    @asynccontextmanager
    async def fake_session(*_args):
        yield session

    @asynccontextmanager
    async def fake_transport(*_args):
        yield None, None

    monkeypatch.setattr(mcp, "ClientSession", fake_session)
    monkeypatch.setattr("mcp.client.stdio.stdio_client", fake_transport)
    client = object.__new__(client_type)
    client.config = MCPServerConfig(name="read-server", command="unused")
    client._session = session
    client._transport = fake_transport
    client._stdio_env = lambda: {}
    discovered = asyncio.run(client._list_tools_async())
    tool = discovered[0]
    assert tool.input_schema == {"type": "object"}
    assert tool.server_name == "read-server"
    if hint is None:
        assert tool.annotations == {}
    else:
        assert tool.annotations["readOnlyHint"] is hint
        assert tool.annotations["destructiveHint"] is False
        assert tool.annotations["idempotentHint"] is True
    client.list_tools = lambda: discovered
    registry = SkillRegistry()
    names = register_mcp_tools_as_skills(registry, client, require_trust=False)
    assert ("read" in registry.get(names[0]).affinity) is (hint is True)


def test_discovery_accepts_dictionary_annotations():
    from runtime.adapters.mcp_client.client import _tool_from_sdk

    tool = _tool_from_sdk(
        SimpleNamespace(name="read", description=None, annotations={"readOnlyHint": True}),
        "server",
    )
    assert tool.annotations == {"readOnlyHint": True}
