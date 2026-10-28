from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.safety.auth import Identity, IdentityStore
from runtime.tentacle.dashboard import create_tentacle_router
from runtime.tentacle.remote_desktop import RemoteDesktopHost
from tests.test_remote_desktop import Peer, Socket


@pytest.mark.parametrize("token,code", [(None, 401), ("wrong", 401), ("user", 403), ("admin", 200)])
def test_remote_host_settings_require_operator(tmp_path, token, code):
    store = IdentityStore()
    store.add(Identity(actor_id="owner", roles=("admin",)), api_key_plaintext="admin")
    store.add(Identity(actor_id="visitor", roles=("user",)), api_key_plaintext="user")
    remote = RemoteDesktopHost(
        SimpleNamespace(_connections={"phone": Socket()}),
        tmp_path / "permissions.json",
        peer_factory=Peer,
    )
    coordinator = SimpleNamespace(remote_desktop=remote)
    app = FastAPI()
    app.include_router(create_tentacle_router(coordinator, identity_store=store, require_auth=True))
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    assert client.get("/api/tentacle/remote-desktop/status", headers=headers).status_code == code
    result = client.put(
        "/api/tentacle/remote-desktop/permissions/phone", headers=headers, json={"mode": "control"}
    )
    assert result.status_code == code
    assert remote.permissions == ({"phone": "control"} if code == 200 else {})
    assert not remote.sessions


def test_main_coordinator_wires_and_stops_host_without_extra_listener(tmp_path, monkeypatch):
    from runtime.tentacle.coordinator import TentacleCoordinator

    monkeypatch.setenv("ECHO_DATA_DIR", str(tmp_path))
    coordinator = TentacleCoordinator(host="127.0.0.1", port=0, dashboard_port=None)
    assert coordinator.ws_server.on_custom.__self__ is coordinator.remote_desktop
    assert coordinator.remote_desktop.server is coordinator.ws_server
    assert not coordinator.remote_desktop.sessions
