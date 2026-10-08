from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.memory.threads import ThreadStateStore
from runtime.platform.io.lease import LeaseStore
from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.thread_state_router import create_thread_state_router
from runtime.workspace import WorkspaceStore


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr("runtime.sensing.gateway.thread_shared_spaces._require_flag", lambda: None)
    identities = IdentityStore()
    for actor, tenant in [("alice", "team"), ("bob", "team"), ("eve", "other")]:
        identities.add(
            Identity(actor_id=actor, metadata={"tenant_id": tenant}),
            api_key_plaintext=f"sk-{actor}",
        )
    threads, spaces = ThreadStateStore(), WorkspaceStore(tmp_path / "spaces.db")
    app = FastAPI()
    app.include_router(
        create_thread_state_router(
            store=threads,
            identity_store=identities,
            require_auth=True,
            workspace_root=tmp_path / "tasks",
            workspace_store=spaces,
            lease_store=LeaseStore(tmp_path / "leases.db"),
        )
    )
    client = TestClient(app)
    client.headers["Authorization"] = "Bearer sk-alice"
    response = client.post("/api/threads", json={})
    assert response.status_code == 200, response.text
    task = response.json()
    shared = tmp_path / "shared"
    shared.mkdir()
    ws = spaces.create_workspace(
        name="Team",
        mount_type="local",
        mount_target=str(shared),
        mount_options={},
        owner_id="alice",
        tenant_id="team",
    )
    base = f"/api/threads/{task['thread_id']}/shared-spaces"
    return client, threads, spaces, task, ws, shared, base


def test_attach_sync_detach_preserves_project(setup):
    client, threads, spaces, task, ws, shared, base = setup
    local = Path(task["metadata"]["workspace_path"])
    (local / "project.txt").write_text("first")
    assert client.put(f"{base}/{ws.id}").status_code == 200
    assert client.get(base).json()["spaces"][0]["path"] == str(shared.resolve())
    url = f"{base}/{ws.id}/sync"
    preview = client.post(url, json={}).json()
    assert not (shared / "project.txt").exists()
    result = client.post(url, json={"token": preview["token"]})
    assert result.status_code == 200, result.text
    assert (shared / "project.txt").read_text() == "first"
    (shared / "project.txt").write_text("second")
    preview = client.post(url, json={}).json()
    assert client.post(url, json={"token": preview["token"]}).status_code == 200
    assert (local / "project.txt").read_text() == "second"
    current = threads.get(task["thread_id"])["metadata"]
    assert current["workspace_path"] == str(local)
    assert client.delete(f"{base}/{ws.id}").status_code == 200
    assert client.get(base).json()["spaces"] == []
    assert (shared / "project.txt").exists()
    assert client.post(url, json={}).status_code == 409


def test_stale_preview_and_revoked_membership(setup):
    client, _, spaces, task, ws, shared, base = setup
    local = Path(task["metadata"]["workspace_path"])
    (local / "project.txt").write_text("before")
    client.put(f"{base}/{ws.id}")
    url = f"{base}/{ws.id}/sync"
    preview = client.post(url, json={}).json()
    (local / "project.txt").write_text("after")
    assert client.post(url, json={"token": preview["token"]}).status_code == 409
    assert not (shared / "project.txt").exists()
    # Downgrade on every action, not only at attachment time.
    spaces.add_member(ws.id, "alice", role="viewer")
    assert client.post(url, json={}).status_code == 403


def test_thread_owner_tenant_and_protected_metadata(setup):
    client, threads, spaces, task, ws, shared, base = setup
    for actor in ("bob", "eve"):
        client.headers["Authorization"] = f"Bearer sk-{actor}"
        assert client.put(f"{base}/{ws.id}").status_code == 404
        assert client.get(base).status_code == 404
    client.headers["Authorization"] = "Bearer sk-alice"
    foreign = spaces.create_workspace(
        name="Other",
        mount_type="local",
        mount_target=str(shared),
        mount_options={},
        owner_id="alice",
        tenant_id="other",
    )
    assert client.put(f"{base}/{foreign.id}").status_code == 404
    response = client.post(
        f"/api/threads/{task['thread_id']}/state",
        json={
            "metadata": {
                "shared_workspace_ids": [ws.id],
                "shared_sync_baselines": {ws.id: {"f": "fake"}},
            }
        },
    )
    assert response.status_code == 200
    assert not threads.get(task["thread_id"])["metadata"].get("shared_workspace_ids")


def test_unavailable_directory_and_feature_gate(setup, monkeypatch):
    from fastapi import HTTPException

    client, _, _, _, ws, shared, base = setup
    shared.rmdir()
    assert client.put(f"{base}/{ws.id}").status_code == 409
    assert not shared.exists()

    def disabled():
        raise HTTPException(403, "disabled")

    monkeypatch.setattr("runtime.sensing.gateway.thread_shared_spaces._require_flag", disabled)
    assert client.get(base).status_code == 403


def test_sync_respects_editor_lease_and_releases_own_leases(setup):
    client, _, _, task, ws, shared, base = setup
    local = Path(task["metadata"]["workspace_path"])
    (local / "file").write_text("new")
    client.put(f"{base}/{ws.id}")
    url = f"{base}/{ws.id}/sync"
    token = client.post(url, json={}).json()["token"]
    leases = LeaseStore(shared.parent / "leases.db")
    reservation = leases.acquire(ws.id, "file", "bob")
    assert client.post(url, json={"token": token}).status_code == 409
    assert not (shared / "file").exists()
    assert leases.get_by_path(ws.id, "file").holder_id == "bob"
    leases.release(reservation.lease_id)
    assert client.post(url, json={"token": token}).status_code == 200
    assert leases.get_by_path(ws.id, "file") is None


def test_reviewer_cannot_attach_writable_space(setup):
    client, _, spaces, _, ws, _, base = setup
    spaces.add_member(ws.id, "alice", role="reviewer")
    assert client.put(f"{base}/{ws.id}").status_code == 403
