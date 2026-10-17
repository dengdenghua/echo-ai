"""The hotspot's OpenCode role answers with its owner's saved OpenCode Zen key."""

import contextlib

import pytest
from fastapi.testclient import TestClient

from runtime.execution import opencode_backend as native
from runtime.execution import opencode_hotspot
from runtime.platform.capabilities.tenant_context import use_capability_scope
from runtime.platform.connectors import credential_store
from runtime.platform.connectors.credential_store import CredentialStore
from runtime.safety.auth.scope import TenantScope
from runtime.sensing.gateway.codex_hotspot import create_hotspot, owner_token
from runtime.sensing.gateway.hotspot_store import HotspotStore

OWNER = TenantScope("local", "owner-1")


class _Auth:
    def __init__(self, home):
        self.home = home

    async def refresh(self, **kwargs):
        pass

    def headers(self):
        return {}


@pytest.fixture
def engine(tmp_path, monkeypatch):
    """A fake OpenCode engine that records the key each server is started with."""
    monkeypatch.setattr(credential_store, "CONNECTOR_ROOT", tmp_path / "connectors")
    monkeypatch.setattr(native, "executable", lambda: "opencode")
    started: list[str | None] = []

    @contextlib.asynccontextmanager
    async def managed_server(command, root, key, model, **kwargs):
        started.append(key)
        yield object()

    async def validate(client, model, *, free_only=False):
        pass

    async def session_for_thread(client, root, **kwargs):
        return "session"

    async def stream_prompt(client, session, **kwargs):
        yield {"type": "text_delta", "delta": "hi"}
        yield {"type": "react_completed"}

    monkeypatch.setattr(native, "managed_server", managed_server)
    monkeypatch.setattr(native, "validate_catalog_model", validate)
    monkeypatch.setattr(native, "session_for_thread", session_for_thread)
    monkeypatch.setattr(native, "stream_prompt", stream_prompt)
    return started


def _save_zen_key(scope, key):
    with use_capability_scope(scope):
        CredentialStore().set_secret("opencode-zen", "api_key", key)


async def _run(config, workspace):
    return [
        event
        async for event in opencode_hotspot.stream_opencode(
            config, prompt="hello", workspace=workspace
        )
    ]


@pytest.mark.asyncio
async def test_role_starts_opencode_with_the_owners_zen_key(tmp_path, engine):
    _save_zen_key(OWNER, "zen-owner-key")
    _save_zen_key(TenantScope("local", "someone-else"), "zen-other-key")
    config = opencode_hotspot.OpenCodeRemoteConfig(tmp_path / "member", owner_scope=lambda: OWNER)

    events = await _run(config, tmp_path)

    assert engine == ["zen-owner-key"]
    assert events[-1]["result"] == "hi"


@pytest.mark.asyncio
async def test_role_without_a_saved_key_says_how_to_connect_zen(tmp_path, engine):
    config = opencode_hotspot.OpenCodeRemoteConfig(tmp_path / "member", owner_scope=lambda: OWNER)

    with pytest.raises(native.OpenCodeError, match="连接 OpenCode Zen"):
        await _run(config, tmp_path)
    assert engine == []


def test_invitation_records_the_owner_and_never_the_key(tmp_path, monkeypatch):
    monkeypatch.setattr(native, "executable", lambda: "opencode")
    app = create_hotspot(tmp_path, auth=_Auth(tmp_path))
    owner = {"Authorization": "Bearer " + owner_token(tmp_path)}
    with TestClient(app, base_url="http://127.0.0.1:8322") as client:
        assert client.post("/admin/enabled", json={"enabled": True}, headers=owner).is_success
        grant = client.post(
            "/admin/members",
            json={
                "label": "local",
                "task_engine": "opencode",
                "owner": {"tenant_id": OWNER.tenant_id, "actor_id": OWNER.actor_id},
            },
            headers=owner,
        ).json()
        bad = client.post(
            "/admin/members",
            json={"label": "bad", "task_engine": "opencode", "owner": {"tenant_id": 1}},
            headers=owner,
        )
        assert bad.status_code == 400
        # A role opened before owners were recorded gets one later.
        legacy = HotspotStore(tmp_path).invite("legacy")
        assert HotspotStore(tmp_path).owner_scope(legacy["id"]) is None
        assert client.put(
            f"/admin/members/{legacy['id']}/owner",
            json={"tenant_id": OWNER.tenant_id, "actor_id": OWNER.actor_id},
            headers=owner,
        ).is_success
        assert client.put(f"/admin/members/{legacy['id']}/owner", json={}).status_code == 401

    store = HotspotStore(tmp_path)
    assert store.owner_scope(grant["id"]) == OWNER
    assert store.owner_scope(legacy["id"]) == OWNER
    assert "zen" not in (tmp_path / "hotspot.db").read_bytes().decode("latin-1").lower()


def test_owner_comes_from_the_signed_in_principal_not_the_body(monkeypatch):
    from types import SimpleNamespace

    from fastapi import APIRouter, FastAPI

    from runtime.sensing.gateway import a2a_router, hotspot_control

    sent = []

    async def control(method, path, body=None):
        sent.append((method, path, body))
        return {"task_url": "http://127.0.0.1:8322/members/abc123", "token": "t"}

    async def resolve(url, token=None):
        return {"name": "OpenCode"}

    existing = {
        "agent_id": "a2a_1",
        "base_url": "http://127.0.0.1:8322/members/abc123",
        "hotspot_local_role": True,
        "hotspot_task_engine": "opencode",
    }
    monkeypatch.setattr(hotspot_control, "control", control)
    monkeypatch.setattr(a2a_router, "_resolve_agent_card", resolve)
    monkeypatch.setattr(a2a_router, "_load_registry", lambda: {"agents": [existing]})
    monkeypatch.setattr("runtime.sensing.gateway.remote_credentials.read_token", lambda entry: "t")
    app = FastAPI()

    @app.middleware("http")
    async def principal(request, call_next):
        request.state.principal = SimpleNamespace(tenant_id="local", actor_id="owner-1")
        return await call_next(request)

    router = APIRouter()
    hotspot_control.mount_control(router)
    app.include_router(router)
    expected = {"tenant_id": "local", "actor_id": "owner-1"}
    with TestClient(app) as client:
        client.post(
            "/hotspot/members",
            json={"label": "x", "task_engine": "opencode", "owner": {"actor_id": "spoof"}},
        )
        assert client.post("/hotspot/local-role", json={"task_engine": "opencode"}).is_success

    assert sent[0] == (
        "POST",
        "members",
        {"label": "x", "task_engine": "opencode", "owner": expected},
    )
    assert sent[1] == ("PUT", "members/abc123/owner", expected)
