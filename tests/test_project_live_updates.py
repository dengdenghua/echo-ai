"""Actual authenticated socket delivery and canonical project revalidation."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from anyio import BrokenResourceError, ClosedResourceError, EndOfStream
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from runtime.projectos.model import Project
from runtime.projectos.store import ProjectStore
from runtime.safety.auth import Identity, IdentityStore
from runtime.safety.auth.websocket_auth import WebSocketAuthConfig
from runtime.sensing.gateway import _projects_live_updates
from runtime.sensing.gateway.projects_router import create_projects_router


@pytest.fixture
def project_app(tmp_path):
    store = ProjectStore(tmp_path)
    project = store.save_project(
        Project(id="project-a", name="A", goal="goal", owner_id="alice", tenant_id="tenant-a")
    )
    identities = IdentityStore()
    for actor, tenant in (("alice", "tenant-a"), ("bob", "tenant-a"), ("outsider", "tenant-b")):
        identities.add(
            Identity(actor_id=actor, metadata={"tenant_id": tenant}),
            api_key_plaintext=f"key-{actor}",
        )
    app = FastAPI()
    app.include_router(
        create_projects_router(store=store, identity_store=identities, require_auth=True)
    )
    with TestClient(app) as client:
        yield client, store, identities, project


def test_owner_receives_real_commit_hint_and_can_fetch_updated_source(project_app):
    client, store, _, project = project_app
    headers = {"Authorization": "Bearer key-alice"}
    with client.websocket_connect("/api/projects/project-a/updates", headers=headers) as socket:
        assert socket.receive_json() == {"type": "project:ready", "project_id": project.id}
        project.name = "Updated"
        store.save_project(project)
        assert socket.receive_json() == {"type": "project:update", "project_id": project.id}
        response = client.get("/api/projects/project-a", headers=headers)
        assert response.status_code == 200
        assert store.get_project(project.id).name == "Updated"


@pytest.mark.parametrize("actor", [None, "bob", "outsider"])
def test_anonymous_and_other_owners_cannot_subscribe(project_app, actor):
    client, _, _, _ = project_app
    headers = {"Authorization": f"Bearer key-{actor}"} if actor else {}
    with (
        pytest.raises(WebSocketDisconnect) as refused,
        client.websocket_connect("/api/projects/project-a/updates", headers=headers),
    ):
        pass
    assert refused.value.code == 1008


def test_revoked_tenant_identity_closes_before_sending_new_hint(project_app):
    client, store, identities, project = project_app
    headers = {"Authorization": "Bearer key-alice"}
    with client.websocket_connect("/api/projects/project-a/updates", headers=headers) as socket:
        assert socket.receive_json()["type"] == "project:ready"
        assert identities.remove("alice")
        identities.add(
            Identity(actor_id="alice", metadata={"tenant_id": "tenant-b"}),
            api_key_plaintext="key-alice",
        )
        project.name = "Owner-only result"
        store.save_project(project)
        with pytest.raises(WebSocketDisconnect) as refused:
            socket.receive_json()
        assert refused.value.code == 1008


def test_update_socket_does_not_accept_execution_commands(project_app):
    client, store, _, project = project_app
    headers = {"Authorization": "Bearer key-alice"}
    with client.websocket_connect("/api/projects/project-a/updates", headers=headers) as socket:
        assert socket.receive_json()["type"] == "project:ready"
        socket.send_json({"type": "run", "project_id": "other-tenant"})
        with pytest.raises(WebSocketDisconnect) as refused:
            socket.receive_json()
        assert refused.value.code == 1008
    assert store.get_project(project.id).status == "planning"


@pytest.mark.parametrize("transport_error", [BrokenResourceError, ClosedResourceError, EndOfStream])
def test_closed_transport_releases_subscription_without_leaking_receiver_error(
    monkeypatch, transport_error
):
    unsubscribe = Mock()
    feed = SimpleNamespace(subscribe=Mock(return_value=unsubscribe))
    deps = SimpleNamespace(project_or_404=Mock())
    authenticated = SimpleNamespace(principal=object(), subprotocol=None)
    monkeypatch.setattr(
        _projects_live_updates,
        "authenticate_websocket",
        AsyncMock(return_value=authenticated),
    )
    socket = SimpleNamespace(
        scope={"type": "websocket", "headers": []},
        accept=AsyncMock(),
        send_json=AsyncMock(),
        receive=AsyncMock(side_effect=transport_error()),
    )
    router = _projects_live_updates.create_project_live_router(deps, feed, WebSocketAuthConfig())
    asyncio.run(router.routes[0].endpoint(socket, "project-a"))
    socket.send_json.assert_awaited_once_with({"type": "project:ready", "project_id": "project-a"})
    unsubscribe.assert_called_once_with()
