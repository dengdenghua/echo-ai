"""Thread manifests and mount entities keep independent routes and authority."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.platform import feature_flags
from runtime.platform.io.lease import LeaseStore
from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.workspace_api_router import create_workspace_api_router
from runtime.sensing.gateway.workspaces_router import create_workspaces_router
from runtime.workspace import WorkspaceStore


@pytest.mark.parametrize("entity_first", [False, True])
@pytest.mark.parametrize("mounts_enabled", [False, True])
def test_shared_id_routes_are_order_independent_and_keep_permissions(
    tmp_path, monkeypatch, entity_first, mounts_enabled
):
    monkeypatch.setattr(
        feature_flags, "is_on", lambda name: mounts_enabled and name == "ui.remote_workspace"
    )
    store = WorkspaceStore(tmp_path / "workspaces.db")
    store.create_workspace(
        name="Mount",
        workspace_id="shared-id",
        mount_type="local",
        mount_target=str(tmp_path / "mount"),
        owner_id="alice",
        tenant_id="tenant-a",
    )
    store.add_member("shared-id", "bob", role="viewer")
    store.add_member("shared-id", "outsider", role="viewer")
    identities = IdentityStore()
    for actor, tenant in (("alice", "tenant-a"), ("bob", "tenant-a"), ("outsider", "tenant-b")):
        identities.add(
            Identity(actor_id=actor, metadata={"tenant_id": tenant}),
            api_key_plaintext=f"key-{actor}",
        )
    threads = SimpleNamespace(
        get=lambda thread_id: (
            {"metadata": {"owner_actor_id": "alice", "tenant_id": "tenant-a"}}
            if thread_id == "shared-id"
            else None
        )
    )
    manifests = tmp_path / "thread-manifests"
    thread_router = create_workspaces_router(
        workspace_root=manifests,
        thread_store=threads,
        identity_store=identities,
        require_auth=True,
        include_legacy_info_route=False,
    )
    entity_router = create_workspace_api_router(
        workspace_store=store,
        lease_store=LeaseStore(tmp_path / "leases.db"),
        identity_store=identities,
        require_auth=True,
    )
    app = FastAPI()
    for router in (
        (entity_router, thread_router) if entity_first else (thread_router, entity_router)
    ):
        app.include_router(router)
    assert "/api/workspaces/{thread_id}" not in app.openapi()["paths"]
    with TestClient(app) as client:
        for actor in ("bob", "outsider"):
            headers = {"Authorization": f"Bearer key-{actor}"}
            entity = client.get("/api/workspaces/shared-id", headers=headers)
            assert entity.status_code == (
                200 if mounts_enabled and actor == "bob" else 404 if mounts_enabled else 403
            )
            if entity.status_code == 200:
                assert entity.json()["workspace"]["name"] == "Mount"
            assert (
                client.get("/api/threads/shared-id/workspace", headers=headers).status_code == 404
            )
        assert not (manifests / "shared-id").exists()
        assert client.get("/api/workspaces/shared-id").status_code == 401
        assert client.get("/api/threads/shared-id/workspace").status_code == 401
        owner = client.get(
            "/api/threads/shared-id/workspace", headers={"Authorization": "Bearer key-alice"}
        )
        assert owner.status_code == 200, owner.text
        assert owner.json()["thread_id"] == "shared-id"
        assert owner.json()["manifest"]["schema"] == "echo.workspace.v1"
        assert "workspace" not in owner.json()
        entity = client.get(
            "/api/workspaces/shared-id", headers={"Authorization": "Bearer key-alice"}
        )
        assert entity.status_code == (200 if mounts_enabled else 403)
        if mounts_enabled:
            assert entity.json()["workspace"]["id"] == "shared-id"
            assert "thread_id" not in entity.json()
