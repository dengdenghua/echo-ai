"""Authorized HTTP file writes wake only current workspace readers."""

from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from runtime.platform.io.lease import LeaseStore
from runtime.platform.process.invalidation_feed import InvalidationFeed
from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.fs_router import create_fs_router
from runtime.sensing.server.mount_backend import LocalMountBackend, MountBackendRegistry
from runtime.workspace.store import WorkspaceStore


@pytest.fixture
def workspace_app(tmp_path):
    mount = tmp_path / "mount"
    mount.mkdir()
    store = WorkspaceStore(tmp_path / "workspaces.db")
    workspace = store.create_workspace(
        name="Shared",
        mount_type="local",
        mount_target=str(mount),
        owner_id="alice",
        tenant_id="tenant-a",
        workspace_id="workspace-a",
    )
    store.add_member(workspace.id, "bob", role="viewer")
    store.add_member(workspace.id, "outsider", role="editor")
    identities = IdentityStore()
    for actor, tenant in (
        ("alice", "tenant-a"),
        ("bob", "tenant-a"),
        ("outsider", "tenant-b"),
        ("nonmember", "tenant-a"),
    ):
        identities.add(
            Identity(actor_id=actor, metadata={"tenant_id": tenant}),
            api_key_plaintext=f"key-{actor}",
        )
    registry = MountBackendRegistry()
    registry.register("local", LocalMountBackend)
    feed = InvalidationFeed("workspace:changed", scoped=True)
    app = FastAPI()
    app.include_router(
        create_fs_router(
            identity_store=identities,
            require_auth=True,
            workspace_store=store,
            mount_registry=registry,
            file_updates=feed,
            lease_store=LeaseStore(tmp_path / "leases.db"),
        )
    )
    with TestClient(app) as client:
        yield client, store, feed, mount, identities


def test_real_write_notifies_viewer_after_file_commit_without_path_or_content(workspace_app):
    client, _, _, mount, _ = workspace_app
    with client.websocket_connect(
        "/api/fs/workspaces/workspace-a/updates", headers={"Authorization": "Bearer key-bob"}
    ) as socket:
        assert socket.receive_json() == {"type": "workspace:ready", "workspace_id": "workspace-a"}
        written = client.post(
            "/api/fs/write",
            headers={"Authorization": "Bearer key-alice"},
            json={
                "path": "workspace-a:/result.txt",
                "content": "private source",
                "thread_id": "spoofed-other-thread",
            },
        )
        assert written.status_code == 200, written.text
        assert socket.receive_json() == {"type": "workspace:update", "workspace_id": "workspace-a"}
        assert (mount / "result.txt").read_text() == "private source"
        read = client.get(
            "/api/fs/read",
            headers={"Authorization": "Bearer key-bob"},
            params={"path": "workspace-a:/result.txt"},
        )
        assert read.status_code == 200
        assert read.json()["content"] == "private source"


@pytest.mark.parametrize("actor", [None, "nonmember", "outsider"])
def test_nonmembers_or_other_tenant_cannot_receive_workspace_hints(workspace_app, actor):
    client, _, _, _, _ = workspace_app
    headers = {"Authorization": f"Bearer key-{actor}"} if actor else {}
    with (
        pytest.raises(WebSocketDisconnect) as refused,
        client.websocket_connect("/api/fs/workspaces/workspace-a/updates", headers=headers),
    ):
        pass
    assert refused.value.code == 1008


@pytest.mark.parametrize("actor", ["bob", "outsider"])
def test_rejected_write_never_mutates_file_or_publishes_hint(workspace_app, monkeypatch, actor):
    client, _, feed, mount, _ = workspace_app
    notify = Mock()
    monkeypatch.setattr(feed, "notify", notify)
    written = client.post(
        "/api/fs/write",
        headers={"Authorization": f"Bearer key-{actor}"},
        json={"path": "workspace-a:/result.txt", "content": "forbidden"},
    )
    assert written.status_code == (403 if actor == "bob" else 404)
    assert not (mount / "result.txt").exists()
    notify.assert_not_called()


def test_revoked_member_closes_before_next_hint(workspace_app):
    client, store, feed, _, _ = workspace_app
    with client.websocket_connect(
        "/api/fs/workspaces/workspace-a/updates", headers={"Authorization": "Bearer key-bob"}
    ) as socket:
        assert socket.receive_json()["type"] == "workspace:ready"
        store.remove_member("workspace-a", "bob")
        feed.notify("workspace-a")
        with pytest.raises(WebSocketDisconnect) as revoked:
            socket.receive_json()
        assert revoked.value.code == 1008


def test_workspace_socket_never_accepts_a_write_command(workspace_app):
    client, _, _, mount, _ = workspace_app
    with client.websocket_connect(
        "/api/fs/workspaces/workspace-a/updates", headers={"Authorization": "Bearer key-alice"}
    ) as socket:
        socket.receive_json()
        socket.send_json({"type": "write", "content": "forbidden"})
        with pytest.raises(WebSocketDisconnect) as refused:
            socket.receive_json()
        assert refused.value.code == 1008
    assert list(mount.iterdir()) == []


def test_pending_workspace_keys_and_consumers_are_bounded_and_scoped():
    feed = InvalidationFeed("workspace:changed", scoped=True, max_pending=2, max_subscribers=2)
    received = []
    feed.subscribe(lambda: received.append("a"), key="a")
    feed.subscribe(lambda: received.append("b"), key="b")
    for key in ("a", "a", "b", "c", "", "x" * 257):
        feed.notify(key)
    assert feed.dropped == 1
    assert feed._keys == {"a", "b"}
    feed._remote({"kind": "workspace:changed", "payload": {"key": "b"}})
    assert received == ["b"]
    for frame in (
        {"kind": "wrong", "payload": {"key": "a"}},
        {"kind": "workspace:changed", "payload": {"key": "a", "content": "private"}},
        {"kind": "workspace:changed", "payload": {"key": 3}},
    ):
        feed._remote(frame)
    assert received == ["b"]
    with pytest.raises(OverflowError):
        feed.subscribe(lambda: None, key="a")
    feed.close()


@pytest.mark.parametrize(
    "path",
    [
        "../outside.txt",
        "/../outside.txt",
        "C:/outside.txt",
        "//server/share/file",
        "\\\\server\\share\\file",
        "~/outside.txt",
        "result.txt:stream",
    ],
)
def test_mount_relative_paths_reject_host_paths_and_traversal_before_writing(workspace_app, path):
    client, _, _, mount, _ = workspace_app
    written = client.post(
        "/api/fs/write",
        headers={"Authorization": "Bearer key-alice"},
        json={"path": f"workspace-a:{path}", "content": "forbidden"},
    )
    assert written.status_code == 400
    assert list(mount.iterdir()) == []


def test_alias_paths_share_the_same_exclusive_file_lease(workspace_app):
    client, store, _, mount, _ = workspace_app
    store.add_member("workspace-a", "bob", role="editor")
    owner = client.post(
        "/api/fs/write",
        headers={"Authorization": "Bearer key-alice"},
        json={"path": "workspace-a:/result.txt", "content": "owner"},
    )
    assert owner.status_code == 200, owner.text
    other = client.post(
        "/api/fs/write",
        headers={"Authorization": "Bearer key-bob"},
        json={"path": "workspace-a:./result.txt", "content": "other"},
    )
    assert other.status_code == 409, other.text
    assert (mount / "result.txt").read_text() == "owner"


def test_active_legacy_lease_is_not_bypassed_by_path_normalization(workspace_app):
    client, store, _, mount, _ = workspace_app
    store.add_member("workspace-a", "bob", role="editor")
    old_leases = LeaseStore(store.db_path.with_name("leases.db"))
    original = old_leases.acquire("workspace-a", "/result.txt", "alice")
    other = client.post(
        "/api/fs/write",
        headers={"Authorization": "Bearer key-bob"},
        json={"path": "workspace-a:result.txt", "content": "forbidden"},
    )
    assert other.status_code == 409
    assert not (mount / "result.txt").exists()
    assert old_leases.get_by_path("workspace-a", "/result.txt").lease_id == original.lease_id


def test_full_application_workspace_api_and_fs_share_existing_stores(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from runtime.execution.agents import AgentRegistry
    from runtime.platform import feature_flags
    from runtime.platform.ui.app import create_app
    from runtime.sensing.model_router import MockModelRouter

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ECHO_HOME", str(tmp_path))
    monkeypatch.setattr(feature_flags, "is_on", lambda name: name == "ui.remote_workspace")
    monkeypatch.setattr("runtime.execution.agents.watcher.start_agent_watcher", lambda **_: None)
    stack = SimpleNamespace(
        journal=None,
        executor=SimpleNamespace(journal=None, registry=None),
        runtime=SimpleNamespace(journal=None),
        planner=SimpleNamespace(router=MockModelRouter(), planner_model=None),
        config=SimpleNamespace(mcp_servers=None),
        is_llm_planner=False,
    )
    mount = tmp_path / "actual-mount"
    mount.mkdir()
    app = create_app(stack=stack, agent_registry=AgentRegistry(), tentacle_enabled=False)
    with TestClient(app) as client:
        created = client.post(
            "/api/workspaces",
            json={
                "name": "Real",
                "mount_type": "local",
                "mount_target": str(mount),
                "owner_id": "alice",
            },
        )
        assert created.status_code == 200, created.text
        workspace_id = created.json()["workspace"]["id"]
        with client.websocket_connect(f"/api/fs/workspaces/{workspace_id}/updates") as socket:
            assert socket.receive_json()["type"] == "workspace:ready"
            written = client.post(
                "/api/fs/write",
                json={
                    "path": f"{workspace_id}:/result.txt",
                    "user_id": "alice",
                    "content": "created through production API",
                },
            )
            assert written.status_code == 200, written.text
            assert socket.receive_json() == {
                "type": "workspace:update",
                "workspace_id": workspace_id,
            }
            assert (mount / "result.txt").read_text() == "created through production API"
