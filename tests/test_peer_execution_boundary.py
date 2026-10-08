"""Peer dispatch shares host device lease and receipt enforcement."""

import asyncio
import json
from unittest.mock import AsyncMock

from runtime.tentacle.base import Heartbeat, TentacleType, ToolResult
from runtime.tentacle.contract import ActionSpec, DeviceManifest
from runtime.tentacle.execution import DeviceActionExecutor, ExecutionReceiptLedger
from runtime.tentacle.pool import TentaclePool
from runtime.tentacle.transport.ws_server import TentacleWebSocketServer


class _Socket:
    def __init__(self):
        self.sent = []

    async def send(self, value):
        self.sent.append(json.loads(value))


class _Device:
    tentacle_id = "target"
    tentacle_type = TentacleType.DESKTOP
    platform = "windows"
    capabilities = ["test.read"]
    manifest = DeviceManifest(
        device_id="target", kind="desktop", platform="windows", actions=(ActionSpec("test.read"),)
    )

    def __init__(self):
        self.executed = []

    async def heartbeat(self):
        return Heartbeat(self.tentacle_id, 0, True)

    async def execute(self, call):
        self.executed.append(call)
        return ToolResult.ok(call.call_id, {"value": "read"})


def _message(tool="test.read"):
    return {
        "id": "request",
        "params": {"target_device_id": "target", "tool": tool, "args": {}},
    }


def _server(monkeypatch, executor=None):
    monkeypatch.delenv("ECHO_ALLOW_INSECURE_SHARED_TOKEN_PEER_CALLS", raising=False)
    monkeypatch.setenv("ECHO_DEVICE_PEER_GRANTS", '{"source":{"target":["test.read"]}}')
    server = TentacleWebSocketServer(
        host="127.0.0.1", auth_token="test-pairing", action_executor=executor
    )
    socket = _Socket()
    server._connections["source"] = socket
    server.send_tool_execute = AsyncMock(return_value=ToolResult.ok("fallback"))
    return server, socket


def test_shared_pairing_token_does_not_authorize_peer_execution(monkeypatch):
    server, socket = _server(monkeypatch)
    asyncio.run(server._handle_peer_call(socket, _message(), "source"))
    assert socket.sent[0]["error"]["code"] == -32098
    server.send_tool_execute.assert_not_awaited()


def test_replaced_connection_cannot_issue_peer_calls(monkeypatch):
    server, socket = _server(monkeypatch)
    server.is_per_device_auth = True
    server._connections["source"] = _Socket()
    asyncio.run(server._handle_peer_call(socket, _message(), "source"))
    assert socket.sent == []
    server.send_tool_execute.assert_not_awaited()


def test_explicit_shared_token_override_still_requires_tool_grant(monkeypatch):
    server, socket = _server(monkeypatch)
    monkeypatch.setenv("ECHO_ALLOW_INSECURE_SHARED_TOKEN_PEER_CALLS", "1")
    asyncio.run(server._handle_peer_call(socket, _message("test.write"), "source"))
    assert socket.sent[0]["error"]["code"] == -32099
    server.send_tool_execute.assert_not_awaited()


def test_foreign_device_lease_blocks_before_execution(monkeypatch):
    async def scenario():
        pool = TentaclePool()
        device = _Device()
        await pool.register(device)
        executor = DeviceActionExecutor(pool)
        server, socket = _server(monkeypatch, executor)
        server.is_per_device_auth = True
        assert await pool.acquire_lock("target", "task:other", "other-task")
        await server._handle_peer_call(socket, _message(), "source")
        assert socket.sent[0]["error"]["code"] == -32016
        assert not device.executed
        assert not executor.ledger.list()
        server.send_tool_execute.assert_not_awaited()

    asyncio.run(scenario())


def test_authorized_peer_uses_device_executor_and_records_owned_lease(monkeypatch):
    async def scenario():
        pool = TentaclePool()
        device = _Device()
        await pool.register(device)
        observed = []
        executor = DeviceActionExecutor(pool, ExecutionReceiptLedger(on_append=observed.append))
        server, socket = _server(monkeypatch, executor)
        server.is_per_device_auth = True
        assert await pool.acquire_lock("target", "device:source", "peer-task")
        await server._handle_peer_call(socket, _message(), "source")
        assert socket.sent[0]["result"]["success"] is True
        receipt = executor.ledger.list()[0]
        assert observed == [receipt]
        assert receipt.trace_id == "device:source"
        assert receipt.lease_id == pool.lock_holder("target").lease_id
        assert socket.sent[0]["result"]["execution_receipt_id"] == receipt.receipt_id
        assert len(device.executed) == 1
        server.send_tool_execute.assert_not_awaited()

    asyncio.run(scenario())


def test_coordinator_peer_execution_keeps_receipt_telemetry(monkeypatch, tmp_path):
    from runtime.tentacle.coordinator import TentacleCoordinator

    async def scenario():
        monkeypatch.setenv("ECHO_DATA_DIR", str(tmp_path / "data"))
        monkeypatch.setenv("ECHO_DEVICE_PEER_GRANTS", '{"source":{"target":["test.read"]}}')
        coordinator = TentacleCoordinator(
            host="127.0.0.1",
            dashboard_port=None,
            auth_token="test-pairing",
            procedure_checkpoint_dir=tmp_path / "procedures",
        )
        server = coordinator.ws_server
        assert server.action_executor is coordinator.device_executor
        server.is_per_device_auth = True
        socket = _Socket()
        server._connections["source"] = socket
        await coordinator.pool.register(_Device())
        await server._handle_peer_call(socket, _message(), "source")
        assert socket.sent[0]["result"]["success"] is True
        assert coordinator.telemetry.samples("target", metric="action_success")[0]["value"] is True
        assert len(coordinator.device_executor.ledger.list()) == 1

    asyncio.run(scenario())
