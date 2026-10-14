"""Alice/Bob workspace isolation regression tests."""

from __future__ import annotations

import ipaddress
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.platform import feature_flags as ff
from runtime.platform.io.lease import LeaseStore
from runtime.safety.auth import Identity, IdentityStore, url_guard
from runtime.safety.auth.scope import TenantScope
from runtime.sensing.gateway.workspace_api_router import create_workspace_api_router
from runtime.sensing.server.mount_backend import (
    LocalMountBackend,
    MountBackend,
    MountBackendRegistry,
)
from runtime.workspace import WorkspaceStore


def _client(tmp_path: Path) -> tuple[TestClient, WorkspaceStore, IdentityStore]:
    store = WorkspaceStore(db_path=tmp_path / "workspaces.db")
    identity_store = IdentityStore()
    # Creating a server-local mount is operator-only; alice stays the owner.
    identity_store.add(
        Identity(actor_id="alice", roles=("operator",)), api_key_plaintext="sk-alice"
    )
    identity_store.add(Identity(actor_id="bob"), api_key_plaintext="sk-bob")
    registry = MountBackendRegistry()
    registry.register("local", LocalMountBackend)
    app = FastAPI()
    app.include_router(
        create_workspace_api_router(
            workspace_store=store,
            lease_store=LeaseStore(db_path=tmp_path / "leases.db"),
            registry=registry,
            identity_store=identity_store,
            require_auth=True,
        )
    )
    return TestClient(app), store, identity_store


def test_workspace_acl_uses_principal_and_not_body_identity(tmp_path: Path, monkeypatch) -> None:
    original_specs = dict(ff._SPECS)
    original_snapshot = ff._SNAPSHOT
    original_file = ff._FILE_PATH
    monkeypatch.setenv("ECHO_FF_UI_REMOTE_WORKSPACE", "1")
    ff.reload()
    try:
        client, store, _ = _client(tmp_path)
        alice = {"Authorization": "Bearer sk-alice"}
        bob = {"Authorization": "Bearer sk-bob"}
        mount = tmp_path / "mount"
        mount.mkdir()

        created = client.post(
            "/api/workspaces",
            headers=alice,
            json={
                "name": "alice-ws",
                "mount_type": "local",
                "mount_target": str(mount),
                "owner_id": "alice",
            },
        )
        assert created.status_code == 200
        workspace_id = created.json()["workspace"]["id"]

        assert client.get(f"/api/workspaces/{workspace_id}", headers=alice).status_code == 200
        assert client.get(f"/api/workspaces/{workspace_id}", headers=bob).status_code == 404
        assert client.get("/api/workspaces", headers=alice).json()["workspaces"]
        assert client.get("/api/workspaces", headers=bob).json()["workspaces"] == []
        assert client.get("/api/workspaces?user_id=alice", headers=bob).status_code == 403

        spoofed = client.post(
            "/api/workspaces",
            headers=alice,
            json={
                "name": "spoofed",
                "mount_type": "local",
                "mount_target": str(mount),
                "owner_id": "bob",
            },
        )
        assert spoofed.status_code == 403

        store.add_member(workspace_id, "bob", role="viewer")
        assert client.get(f"/api/workspaces/{workspace_id}", headers=bob).status_code == 200
        assert (
            client.post(
                f"/api/workspaces/{workspace_id}/members",
                headers=bob,
                json={"member_id": "mallory", "role": "viewer"},
            ).status_code
            == 403
        )
        assert client.delete(f"/api/workspaces/{workspace_id}", headers=bob).status_code == 403
        assert (
            client.post(
                f"/api/workspaces/{workspace_id}/lease",
                headers=bob,
                json={"file_path": "x", "holder_id": "bob"},
            ).status_code
            == 403
        )
    finally:
        ff._SPECS.clear()
        ff._SPECS.update(original_specs)
        ff._SNAPSHOT = original_snapshot
        ff._FILE_PATH = original_file


def test_workspace_and_lease_store_views_enforce_tenant_scope(tmp_path: Path) -> None:
    alice_scope = TenantScope(tenant_id="tenant-a", actor_id="alice")
    bob_scope = TenantScope(tenant_id="tenant-b", actor_id="bob")
    workspace_store = WorkspaceStore(db_path=tmp_path / "workspaces.db")
    alice_store = workspace_store.with_scope(alice_scope)
    bob_store = workspace_store.with_scope(bob_scope)
    ws = alice_store.create_workspace(
        name="scoped",
        mount_type="local",
        mount_target=str(tmp_path),
        owner_id="alice",
    )
    assert bob_store.get_workspace(ws.id) is None
    assert bob_store.list_workspaces() == []
    assert bob_store.list_members(ws.id) == []
    assert bob_store.delete_workspace(ws.id) is False

    lease_store = LeaseStore(db_path=tmp_path / "leases.db")
    lease = lease_store.with_scope(alice_scope).acquire(ws.id, "a.txt", "alice")
    bob_leases = lease_store.with_scope(bob_scope)
    assert bob_leases.list_active() == []
    assert bob_leases.release(lease.lease_id) is False


def test_workspace_acl_rejects_cross_tenant_membership(tmp_path: Path, monkeypatch) -> None:
    original_specs = dict(ff._SPECS)
    original_snapshot = ff._SNAPSHOT
    original_file = ff._FILE_PATH
    monkeypatch.setenv("ECHO_FF_UI_REMOTE_WORKSPACE", "1")
    ff.reload()
    try:
        store = WorkspaceStore(db_path=tmp_path / "workspaces.db")
        identities = IdentityStore()
        identities.add(
            Identity(actor_id="alice", roles=("operator",), metadata={"tenant_id": "tenant-a"}),
            api_key_plaintext="sk-alice",
        )
        identities.add(
            Identity(actor_id="carol", metadata={"tenant_id": "tenant-a"}),
            api_key_plaintext="sk-carol",
        )
        identities.add(
            Identity(actor_id="bob", metadata={"tenant_id": "tenant-b"}),
            api_key_plaintext="sk-bob",
        )
        registry = MountBackendRegistry()
        registry.register("local", LocalMountBackend)
        app = FastAPI()
        app.include_router(
            create_workspace_api_router(
                workspace_store=store,
                lease_store=LeaseStore(db_path=tmp_path / "leases.db"),
                registry=registry,
                identity_store=identities,
                require_auth=True,
            )
        )
        client = TestClient(app)
        mount = tmp_path / "mount"
        mount.mkdir()
        created = client.post(
            "/api/workspaces",
            headers={"Authorization": "Bearer sk-alice"},
            json={
                "name": "tenant-a-ws",
                "mount_type": "local",
                "mount_target": str(mount),
                "owner_id": "alice",
            },
        )
        assert created.status_code == 200
        workspace_id = created.json()["workspace"]["id"]
        store.add_member(workspace_id, "carol", role="viewer")
        store.add_member(workspace_id, "bob", role="viewer")

        assert (
            client.get(
                f"/api/workspaces/{workspace_id}",
                headers={"Authorization": "Bearer sk-carol"},
            ).status_code
            == 200
        )
        assert (
            client.get(
                f"/api/workspaces/{workspace_id}",
                headers={"Authorization": "Bearer sk-bob"},
            ).status_code
            == 404
        )
    finally:
        ff._SPECS.clear()
        ff._SPECS.update(original_specs)
        ff._SNAPSHOT = original_snapshot
        ff._FILE_PATH = original_file


class _ProbeBackend(MountBackend):
    """Remote-style backend that records every probe."""

    probes: list[dict] = []

    def __init__(self, **options) -> None:
        self.options = options

    async def test_connection(self) -> bool:
        _ProbeBackend.probes.append(self.options)
        return True

    async def read_file(self, path: str) -> bytes:
        raise NotImplementedError

    async def write_file(self, path: str, content: bytes) -> None:
        raise NotImplementedError

    async def list_dir(self, path: str, depth: int = 1) -> list:
        raise NotImplementedError

    async def stat(self, path: str):
        raise NotImplementedError

    async def mkdir(self, path: str) -> None:
        raise NotImplementedError

    async def remove(self, path: str) -> None:
        raise NotImplementedError


def _mount_client(tmp_path: Path) -> tuple[TestClient, WorkspaceStore]:
    store = WorkspaceStore(db_path=tmp_path / "workspaces.db")
    identities = IdentityStore()
    identities.add(Identity(actor_id="mallory"), api_key_plaintext="sk-mallory")
    identities.add(Identity(actor_id="root", roles=("admin",)), api_key_plaintext="sk-root")
    registry = MountBackendRegistry()
    registry.register("local", LocalMountBackend)
    registry.register("nfs", _ProbeBackend)
    registry.register("webdav", _ProbeBackend)
    app = FastAPI()
    app.include_router(
        create_workspace_api_router(
            workspace_store=store,
            lease_store=LeaseStore(db_path=tmp_path / "leases.db"),
            registry=registry,
            identity_store=identities,
            require_auth=True,
        )
    )
    return TestClient(app), store


def test_server_local_mounts_require_admin_or_operator(tmp_path: Path, monkeypatch) -> None:
    original_specs = dict(ff._SPECS)
    original_snapshot = ff._SNAPSHOT
    original_file = ff._FILE_PATH
    monkeypatch.setenv("ECHO_FF_UI_REMOTE_WORKSPACE", "1")
    ff.reload()
    # Remote mounts by ordinary users must resolve to a public address.
    monkeypatch.setattr(
        url_guard, "_resolve_all", lambda _host: [ipaddress.ip_address("93.184.216.34")]
    )
    _ProbeBackend.probes = []
    try:
        client, store = _mount_client(tmp_path)
        mallory = {"Authorization": "Bearer sk-mallory"}
        secret = tmp_path / "server-secret"
        secret.mkdir()
        denied_bodies = [
            {"mount_type": "local", "mount_target": str(secret)},
            {"mount_type": "nfs", "mount_target": str(secret)},
            {
                "mount_type": "nfs",
                "mount_target": "nfs://host/export",
                "mount_options": {"mount_point": str(secret)},
            },
            {
                "mount_type": "webdav",
                "mount_target": "https://dav.example.test/share",
                "mount_options": {"filesystem_path": str(secret)},
            },
            {
                "mount_type": "webdav",
                "mount_target": "https://dav.example.test/share",
                "mount_options": {"allowed_write_roots": [str(secret)]},
            },
        ]
        for body in denied_bodies:
            response = client.post(
                "/api/workspaces",
                headers=mallory,
                json={"name": "grab", "owner_id": "mallory", **body},
            )
            assert response.status_code == 403, body
        # Rejected before probing or persisting anything.
        assert _ProbeBackend.probes == []
        assert store.list_workspaces() == []

        # Ordinary users can still create genuinely remote workspaces.
        remote = client.post(
            "/api/workspaces",
            headers=mallory,
            json={
                "name": "remote",
                "owner_id": "mallory",
                "mount_type": "webdav",
                "mount_target": "https://dav.example.test/share",
            },
        )
        assert remote.status_code == 200

        # Admins may map runtime-local directories.
        admin = client.post(
            "/api/workspaces",
            headers={"Authorization": "Bearer sk-root"},
            json={
                "name": "local",
                "owner_id": "root",
                "mount_type": "local",
                "mount_target": str(secret),
            },
        )
        assert admin.status_code == 200
    finally:
        ff._SPECS.clear()
        ff._SPECS.update(original_specs)
        ff._SNAPSHOT = original_snapshot
        ff._FILE_PATH = original_file
