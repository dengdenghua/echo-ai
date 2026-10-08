"""Per-device Tentacle credentials: store semantics, hub wiring and operator API."""

from __future__ import annotations

import asyncio
import contextlib
import json
from urllib.parse import parse_qs, urlparse

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from runtime.safety.auth import Identity, IdentityStore
from runtime.tentacle.coordinator import TentacleCoordinator
from runtime.tentacle.dashboard import create_tentacle_router
from runtime.tentacle.device_client import DesktopTools, DeviceClient
from runtime.tentacle.device_credentials import (
    DeviceCredentialStore,
    install_per_device_auth,
)

SHARED = "shared-join-token-for-tests-only"
SECRET = b"unit-test-device-credential-secret"
GRANTS = {"phone-1": {"vm-1": ["workspace.write_text"]}}


class _Clock:
    def __init__(self) -> None:
        self.now = 1_000_000.0

    def __call__(self) -> float:
        return self.now


def _store(tmp_path, clock=None) -> DeviceCredentialStore:
    return DeviceCredentialStore(tmp_path / "creds.json", secret=SECRET, clock=clock or _Clock())


# ── store ────────────────────────────────────────────────


def test_invite_is_single_use_and_binds_device(tmp_path):
    store = _store(tmp_path)
    token = store.create_invite()["token"]
    assert store.authenticate("phone-1", token)
    assert store.authenticate("phone-1", token)  # now the bound credential
    assert not store.authenticate("phone-2", token)  # invite already consumed
    assert store.verify("phone-1", token) and not store.verify("phone-2", token)
    raw = (tmp_path / "creds.json").read_text(encoding="utf-8")
    assert token not in raw and "credentialDigest" in raw
    # Persistence: a fresh store with the same secret still verifies.
    assert _store(tmp_path).verify("phone-1", token)
    # Wrong secret cannot verify a copied state file.
    other = DeviceCredentialStore(tmp_path / "creds.json", secret=b"x" * 32)
    assert not other.verify("phone-1", token)


def test_invite_expires(tmp_path):
    clock = _Clock()
    store = _store(tmp_path, clock)
    token = store.create_invite()["token"]
    clock.now += 301
    assert not store.authenticate("phone-1", token)
    assert store.pending_invites() == 0


def test_prebound_invite_rejects_other_device(tmp_path):
    store = _store(tmp_path)
    token = store.create_invite(device_id="phone-1")["token"]
    assert not store.authenticate("phone-2", token)
    assert store.authenticate("phone-1", token)


def test_rotate_and_revoke(tmp_path):
    store = _store(tmp_path)
    old = store.create_invite()["token"]
    assert store.authenticate("phone-1", old)
    generation = store.pairing_generation("phone-1")
    new = store.rotate("phone-1")["token"]
    assert not store.verify("phone-1", old) and store.verify("phone-1", new)
    assert store.pairing_generation("phone-1") != generation
    assert store.revoke("phone-1")
    assert not store.authenticate("phone-1", new)
    assert store.list_devices() == []


def test_secret_file_is_created_and_reused(tmp_path):
    first = DeviceCredentialStore(tmp_path / "creds.json")
    token = first.create_invite()["token"]
    assert first.authenticate("phone-1", token)
    assert (tmp_path / "tentacle_device_credentials.key").exists()
    assert DeviceCredentialStore(tmp_path / "creds.json").verify("phone-1", token)


# ── hub ──────────────────────────────────────────────────


async def _start_hub(monkeypatch, tmp_path, *, per_device: bool):
    monkeypatch.delenv("ECHO_ALLOW_INSECURE_SHARED_TOKEN_PEER_CALLS", raising=False)
    monkeypatch.setenv("ECHO_DEVICE_PEER_GRANTS", json.dumps(GRANTS))
    coordinator = TentacleCoordinator(
        host="127.0.0.1", port=0, dashboard_port=None, auth_token=SHARED
    )
    auth = None
    if per_device:
        auth = install_per_device_auth(
            coordinator.ws_server, _store(tmp_path), allow_shared_token=True
        )
    await coordinator.start()
    port = coordinator.ws_server._server.sockets[0].getsockname()[1]
    return coordinator, auth, f"ws://127.0.0.1:{port}"


@pytest_asyncio.fixture
async def hub(monkeypatch, tmp_path):
    coordinator, auth, url = await _start_hub(monkeypatch, tmp_path, per_device=True)
    yield coordinator, auth, url
    await coordinator.stop()


@pytest_asyncio.fixture
async def shared_hub(monkeypatch, tmp_path):
    coordinator, _auth, url = await _start_hub(monkeypatch, tmp_path, per_device=False)
    yield coordinator, url
    await coordinator.stop()


async def hello(ws, device_id, token):
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
                    "platform": "android",
                    "capabilities": [],
                },
            }
        )
    )
    return json.loads(await asyncio.wait_for(ws.recv(), 3))


async def peer_write(ws, request_id="call"):
    await ws.send(
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "device/call",
                "params": {
                    "target_device_id": "vm-1",
                    "tool": "workspace.write_text",
                    "args": {"path": "peer.txt", "text": "hi"},
                },
            }
        )
    )
    return json.loads(await asyncio.wait_for(ws.recv(), 3))


@contextlib.asynccontextmanager
async def _vm(url, token, workspace):
    workspace.mkdir(parents=True, exist_ok=True)
    vm = DeviceClient(
        url=url,
        token=token,
        device_id="vm-1",
        device_kind="vm",
        tools=DesktopTools(workspace=workspace),
    )
    task = asyncio.create_task(vm.run_once())
    try:
        await asyncio.wait_for(vm.ready.wait(), 3)
        yield vm
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


@pytest.mark.asyncio
async def test_wrong_token_and_spoofed_device_id_rejected(hub):
    _coordinator, auth, url = hub
    token = auth.store.create_invite()["token"]
    async with connect(url) as phone:
        assert (await hello(phone, "phone-1", token))["result"]["registered"] is True
    async with connect(url) as bad:
        assert (await hello(bad, "phone-1", "w" * 43))["error"]["code"] == -32099
    # phone-1's credential cannot be used to claim vm-1 ...
    async with connect(url) as spoof:
        assert (await hello(spoof, "vm-1", token))["error"]["code"] == -32099
    # ... and the shared token cannot claim a paired id either.
    async with connect(url) as spoof:
        assert (await hello(spoof, "phone-1", SHARED))["error"]["code"] == -32099


@pytest.mark.asyncio
async def test_peer_call_allowed_only_with_per_device_auth_and_grant(hub, tmp_path):
    coordinator, auth, url = hub
    vm_token = auth.store.create_invite()["token"]
    phone_token = auth.store.create_invite()["token"]
    async with _vm(url, vm_token, tmp_path / "ws"):
        async with connect(url) as phone:
            await hello(phone, "phone-1", phone_token)
            assert auth.auth_mode("phone-1", coordinator.ws_server._connections["phone-1"]) == (
                "per-device"
            )
            ok = await peer_write(phone)
            assert ok["result"]["success"] is True
            assert (tmp_path / "ws" / "peer.txt").read_text(encoding="utf-8") == "hi"
        # vm-1 has no grant towards anything → denied.
        async with connect(url) as other:
            other_token = auth.store.create_invite()["token"]
            await hello(other, "phone-2", other_token)
            assert (await peer_write(other))["error"]["code"] == -32099
        # Shared-token sockets stay refused even while the hub is per-device.
        async with connect(url) as legacy:
            await hello(legacy, "phone-legacy", SHARED)
            assert (await peer_write(legacy))["error"]["code"] == -32098


@pytest.mark.asyncio
async def test_revoked_device_is_disconnected_and_cannot_reconnect(hub):
    coordinator, auth, url = hub
    token = auth.store.create_invite()["token"]
    async with connect(url) as phone:
        await hello(phone, "phone-1", token)
        result = await auth.revoke("phone-1")
        assert result == {"deviceId": "phone-1", "revoked": True, "disconnected": True}
        with pytest.raises(ConnectionClosed):
            await asyncio.wait_for(phone.recv(), 3)
    async with connect(url) as again:
        assert (await hello(again, "phone-1", token))["error"]["code"] == -32099


@pytest.mark.asyncio
async def test_shared_token_mode_still_refuses_peer_calls(shared_hub, tmp_path):
    coordinator, url = shared_hub
    assert coordinator.ws_server.is_per_device_auth is False
    async with _vm(url, SHARED, tmp_path / "ws"), connect(url) as phone:
        await hello(phone, "phone-1", SHARED)
        assert (await peer_write(phone))["error"]["code"] == -32098


# ── operator API ─────────────────────────────────────────


def _api(tmp_path):
    coordinator = TentacleCoordinator(
        host="127.0.0.1", port=0, dashboard_port=None, auth_token=SHARED
    )
    install_per_device_auth(coordinator.ws_server, _store(tmp_path), allow_shared_token=False)
    store = IdentityStore()
    store.add(Identity(actor_id="admin", roles=("admin",)), api_key_plaintext="sk-admin")
    store.add(Identity(actor_id="user", roles=("user",)), api_key_plaintext="sk-user")
    app = FastAPI()
    app.include_router(create_tentacle_router(coordinator, identity_store=store, require_auth=True))
    return coordinator, TestClient(app)


def test_api_requires_operator(tmp_path, monkeypatch):
    monkeypatch.setenv(
        "ECHO_TENTACLE_PUBLIC_WS_URL", "wss://hub.example.test/api/tentacle/device/ws"
    )
    _coordinator, client = _api(tmp_path)
    assert client.post("/api/tentacle/credentials/invites").status_code == 401
    user = {"Authorization": "Bearer sk-user"}
    assert client.post("/api/tentacle/credentials/invites", headers=user).status_code == 403
    assert client.get("/api/tentacle/credentials/devices", headers=user).status_code == 403
    assert client.delete("/api/tentacle/credentials/devices/x", headers=user).status_code == 403


def test_api_issues_lists_rotates_and_revokes(tmp_path, monkeypatch):
    ws_url = "wss://hub.example.test/api/tentacle/device/ws"
    monkeypatch.setenv("ECHO_TENTACLE_PUBLIC_WS_URL", ws_url)
    coordinator, client = _api(tmp_path)
    admin = {"Authorization": "Bearer sk-admin"}
    invite = client.post("/api/tentacle/credentials/invites", headers=admin, json={}).json()
    query = parse_qs(urlparse(invite["connectString"]).query)
    assert invite["connectString"].startswith("echo://join?") and query["ws"] == [ws_url]
    auth = coordinator.ws_server.device_credentials
    assert auth.store.authenticate("phone-1", query["token"][0])
    listing = client.get("/api/tentacle/credentials/devices", headers=admin).json()
    assert [d["id"] for d in listing["devices"]] == ["phone-1"]
    assert "credentialDigest" not in json.dumps(listing) and listing["sharedTokenAccepted"] is False
    rotated = client.post("/api/tentacle/credentials/devices/phone-1/rotate", headers=admin)
    new_token = parse_qs(urlparse(rotated.json()["connectString"]).query)["token"][0]
    assert auth.store.verify("phone-1", new_token)
    assert not auth.store.verify("phone-1", query["token"][0])
    assert client.delete("/api/tentacle/credentials/devices/phone-1", headers=admin).json()[
        "revoked"
    ]
    assert (
        client.delete("/api/tentacle/credentials/devices/phone-1", headers=admin).status_code == 404
    )
