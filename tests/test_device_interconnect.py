"""Real socket tests for the common AI/OS/mobile wire contract.

The Android endpoint here is a protocol fixture, not an Android emulator.
Desktop endpoints run the production client and perform real temporary file I/O.
"""

from __future__ import annotations

import asyncio
import contextlib
import json

import pytest
import pytest_asyncio
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from runtime.tentacle.base import ToolCall
from runtime.tentacle.coordinator import TentacleCoordinator
from runtime.tentacle.device_client import DesktopTools, DeviceClient, validate_url
from runtime.tentacle.transport.device_protocol import normalize_hello

TOKEN = "test-device-token-not-a-production-credential"


@pytest_asyncio.fixture
async def hub(monkeypatch):
    monkeypatch.setenv(
        "ECHO_DEVICE_PEER_GRANTS",
        json.dumps(
            {
                "android-emulator-1": {"vm-1": ["workspace.write_text", "workspace.read_text"]},
                "vm-1": {"android-emulator-1": ["android.get_screen_info"]},
            }
        ),
    )
    coordinator = TentacleCoordinator(
        host="127.0.0.1", port=0, dashboard_port=None, auth_token=TOKEN
    )
    await coordinator.start()
    port = coordinator.ws_server._server.sockets[0].getsockname()[1]
    yield coordinator, f"ws://127.0.0.1:{port}"
    await coordinator.stop()


async def register(ws, device_id="android-emulator-1", token=TOKEN):
    await ws.send(
        json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "device/hello",
                "id": "hello",
                "params": {
                    "protocol_version": "1.0",
                    "tentacle_id": device_id,
                    "auth_token": token,
                    "device_meta": {
                        "brand": "Google",
                        "model": "Same Emulator Model",
                        "device_kind": "emulator",
                    },
                    "capabilities": ["android.get_screen_info"],
                    "nonce": "test-nonce",
                },
            }
        )
    )
    return json.loads(await asyncio.wait_for(ws.recv(), 3))


@pytest.mark.asyncio
async def test_phone_and_vm_exchange_tools_and_real_file_results(hub, tmp_path):
    coordinator, url = hub
    vm = DeviceClient(
        url=url,
        token=TOKEN,
        device_id="vm-1",
        device_kind="vm",
        tools=DesktopTools(workspace=tmp_path),
    )
    task = asyncio.create_task(vm.run_once())
    try:
        await asyncio.wait_for(vm.ready.wait(), 3)
        device = coordinator.pool.get("vm-1")
        assert device.tentacle_type.value == "desktop"
        assert device.meta["device_kind"] == "vm"
        assert "android.tap" not in device.capabilities
        async with connect(url) as phone:
            ack = await register(phone)
            assert ack["result"]["nonce"] == "test-nonce"
            assert coordinator.pool.get("android-emulator-1").meta["model"] == "Same Emulator Model"
            await phone.send(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": "write",
                        "method": "device/call",
                        "params": {
                            "target_device_id": "vm-1",
                            "tool": "workspace.write_text",
                            "args": {"path": "from-phone.txt", "text": "来自手机的任务\n第二行"},
                        },
                    }
                )
            )
            response = json.loads(await asyncio.wait_for(phone.recv(), 3))
            assert response["id"] == "write" and response["result"]["success"] is True
            written = (tmp_path / "from-phone.txt").read_bytes()
            assert written == "来自手机的任务\n第二行".encode()
            assert response["result"]["data"]["bytes"] == len(written)
            request = asyncio.create_task(
                vm.call_peer("android-emulator-1", "android.get_screen_info", {})
            )
            forwarded = json.loads(await asyncio.wait_for(phone.recv(), 3))
            assert forwarded["params"]["tentacle_id"] == "android-emulator-1"
            await phone.send(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "method": "tool/result",
                        "params": {
                            "call_id": forwarded["id"],
                            "success": True,
                            "data": {"fixture_screen": "home"},
                        },
                    }
                )
            )
            assert (await asyncio.wait_for(request, 3))["data"] == {"fixture_screen": "home"}
            await phone.send(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": "denied",
                        "method": "device/call",
                        "params": {
                            "target_device_id": "vm-1",
                            "tool": "keyboard_type",
                            "args": {"text": "forbidden"},
                        },
                    }
                )
            )
            assert json.loads(await asyncio.wait_for(phone.recv(), 3))["error"]["code"] == -32099
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


@pytest.mark.asyncio
async def test_same_model_devices_do_not_collide_and_forged_result_is_rejected(hub):
    coordinator, url = hub
    async with connect(url) as first, connect(url) as second:
        await register(first, "phone-1")
        await register(second, "phone-2")
        assert coordinator.pool.stats()["online"] == 2
        pending = asyncio.create_task(
            coordinator.ws_server.send_tool_execute(
                "phone-1",
                ToolCall("actual-call", "phone-1", "android.get_screen_info"),
                timeout_ms=3000,
            )
        )
        message = json.loads(await asyncio.wait_for(first.recv(), 3))
        result = {
            "jsonrpc": "2.0",
            "method": "tool/result",
            "params": {
                "call_id": message["id"],
                "success": True,
                "data": "actual receiver",
            },
        }
        await second.send(json.dumps(result))
        assert json.loads(await asyncio.wait_for(second.recv(), 3))["error"]["code"] == -32099
        assert not pending.done()
        await first.send(json.dumps(result))
        assert (await pending).data == "actual receiver"
        async with connect(url) as duplicate:
            rejected = await register(duplicate, "phone-1")
            assert "error" in rejected
        assert coordinator.pool.get("phone-1").is_online


@pytest.mark.asyncio
async def test_disconnect_completes_pending_call_and_reconnects(hub):
    coordinator, url = hub
    async with connect(url) as phone:
        await register(phone)
        call = ToolCall("lost-call", "android-emulator-1", "android.get_screen_info")
        pending = asyncio.create_task(
            coordinator.ws_server.send_tool_execute(call.tentacle_id, call)
        )
        await asyncio.wait_for(phone.recv(), 3)
    assert (await asyncio.wait_for(pending, 3)).error_code == -32011
    async with connect(url) as replacement:
        assert (await register(replacement))["result"]["registered"] is True


@pytest.mark.asyncio
async def test_wrong_token_and_identity_switch_are_rejected(hub):
    _, url = hub
    async with connect(url) as bad:
        assert "error" in await register(bad, token="wrong-token")
    async with connect(url) as phone:
        await register(phone)
        with pytest.raises(ConnectionClosed):
            await register(phone, "different-phone")


def test_workspace_scope_and_explicit_capabilities(tmp_path):
    tools = DesktopTools(workspace=tmp_path)
    with pytest.raises(ValueError, match="outside"):
        tools.read_text({"path": "../secret.txt"})
    tools.write_text({"path": "existing.txt", "text": "keep"})
    with pytest.raises(FileExistsError):
        tools.write_text({"path": "existing.txt", "text": "overwrite"})
    assert "keyboard_type" not in tools.handlers


@pytest.mark.parametrize(
    "url",
    [
        "ws://example.com:8765",
        "wss://name:secret@example.com/ws",
        "wss://example.com/ws?token=secret",
    ],
)
def test_remote_transport_requires_tls_without_url_secrets(url):
    with pytest.raises(ValueError):
        validate_url(url)


def test_metadata_cannot_override_identity_or_protocol():
    hello = normalize_hello(
        {"tentacle_id": "real", "device_meta": {"tentacle_id": "fake", "auth_token": "fake"}}
    )
    assert hello["tentacle_id"] == "real" and "auth_token" not in hello
    with pytest.raises(ValueError, match="version"):
        normalize_hello({"tentacle_id": "phone", "protocol_version": "99.0"})
