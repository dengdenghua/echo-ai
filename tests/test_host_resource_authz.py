"""Shared users must not acquire unscoped host resources through HTTP adapters."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.safety.auth import Identity, IdentityStore


class _AsyncBytes(httpx.AsyncByteStream):
    async def __aiter__(self):
        yield b'{"ok": true}'


@pytest.fixture
def host_client(tmp_path, monkeypatch, request):
    from runtime.execution.suckers import storage_skills, verify_skills
    from runtime.sensing.gateway import a2a_router, agent_world_router, enterprise_assets_router
    from runtime.sensing.gateway.openai_gateway import mix
    from runtime.sensing.gateway.openai_gateway_router import create_openai_router
    from runtime.sensing.gateway.storage_proxy_router import create_storage_proxy_router
    from runtime.sensing.gateway.verify_router import create_verify_router

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(a2a_router, "_REGISTRY_DIR", tmp_path / "a2a")
    effects = {
        "registry": Mock(return_value={"agents": []}),
        "detect": Mock(return_value=SimpleNamespace(kind="fixture", root="fixture", checks=[])),
        "run": Mock(return_value=[]),
        "storage": Mock(
            return_value=httpx.Response(
                200, stream=_AsyncBytes(), headers={"Content-Type": "application/json"}
            )
        ),
        "enterprise": Mock(return_value={"available": True, "data": {"items": []}}),
        "mix": Mock(side_effect=lambda value: value),
        "promote": Mock(return_value={"agent_id": "fixture"}),
    }
    monkeypatch.setattr(a2a_router, "_load_registry", effects["registry"])
    monkeypatch.setattr(verify_skills, "detect_project", effects["detect"])
    monkeypatch.setattr(verify_skills, "run_checks", effects["run"])
    monkeypatch.setattr(storage_skills, "_base_url", lambda: "http://storage.invalid")
    monkeypatch.setattr(storage_skills, "_storage_token", lambda: "host-private-token")
    monkeypatch.setattr(enterprise_assets_router, "_enterprise_get", effects["enterprise"])
    monkeypatch.setattr(mix, "save_mix_config", effects["mix"])
    monkeypatch.setattr(mix, "load_mix_config", lambda: {})
    monkeypatch.setattr(
        "runtime.execution.subagents.get_subagent_registry",
        lambda: SimpleNamespace(
            has=lambda _name: True, get=lambda name: SimpleNamespace(name=name)
        ),
    )
    monkeypatch.setattr(
        "runtime.execution.subagents.market_bridge.promote_definition_to_market", effects["promote"]
    )
    monkeypatch.setattr(agent_world_router, "default_agents_root", lambda: tmp_path / "agents")

    identities = IdentityStore()
    for name, roles in (
        ("alice", ()),
        ("bob", ()),
        ("operator", ("operator",)),
        ("admin", ("admin",)),
    ):
        identities.add(
            Identity(actor_id=name, roles=roles, metadata={"tenant_id": f"tenant-{name}"}),
            api_key_plaintext=f"sk-{name}",
        )
    secured = dict(identity_store=identities, require_auth=getattr(request, "param", True))
    upstream = httpx.AsyncClient(transport=httpx.MockTransport(effects["storage"]))
    app = FastAPI()
    app.include_router(create_verify_router(**secured))
    app.include_router(create_storage_proxy_router(**secured, http_client=upstream))
    app.include_router(a2a_router.create_a2a_router(**secured))
    app.include_router(enterprise_assets_router.create_enterprise_assets_router(**secured))
    app.include_router(agent_world_router.create_agent_world_router(**secured))
    app.include_router(
        create_openai_router(
            SimpleNamespace(registry=SimpleNamespace(all_names=lambda: [])), **secured
        )
    )
    with TestClient(app) as client:
        yield client, effects
    asyncio.run(upstream.aclose())


_HOST_ROUTES = [
    ("POST", "/api/verify/detect", {"workspace": "/another-user"}),
    ("POST", "/api/verify/run", {"workspace": "/another-user"}),
    ("GET", "/api/a2a/agents", None),
    ("POST", "/api/a2a/agents/register", {"url": "http://remote.invalid"}),
    ("POST", "/api/a2a/agents/other-agent/send", {"text": "run a task"}),
    ("GET", "/api/agent-market/enterprise", None),
    ("GET", "/api/agent-market/enterprise/private-role", None),
    ("PUT", "/api/mix-config", {"n": 6}),
    ("POST", "/api/agent-market/from-subagent", {"name": "fixture"}),
    *[
        (method, "/api/storage/v1/files/private", None)
        for method in ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE")
    ],
]


@pytest.mark.parametrize("token,status", [(None, 401), ("sk-alice", 403), ("sk-bob", 403)])
@pytest.mark.parametrize("method,path,body", _HOST_ROUTES)
def test_host_resources_reject_unprivileged_callers_before_effects(
    host_client, token, status, method, path, body
):
    client, effects = host_client
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    # Client-supplied role/tenant hints must not grant access to the host.
    headers.update({"X-Role": "admin", "X-Tenant-ID": "tenant-admin"})
    response = client.request(method, path, headers=headers, json=body)
    assert response.status_code == status, response.text
    for effect in effects.values():
        effect.assert_not_called()


@pytest.mark.parametrize("role", ["operator", "admin"])
def test_authorized_operators_reach_the_host_adapters(host_client, role):
    client, effects = host_client
    headers = {"Authorization": f"Bearer sk-{role}"}
    assert (
        client.post("/api/verify/run", headers=headers, json={"workspace": "fixture"}).status_code
        == 200
    )
    assert client.get("/api/a2a/agents", headers=headers).status_code == 200
    assert client.get("/api/agent-market/enterprise", headers=headers).status_code == 200
    assert client.put("/api/mix-config", headers=headers, json={"n": 2}).status_code == 200
    assert client.get("/api/storage/v1/files/private", headers=headers).status_code == 200
    for name in ("detect", "run", "registry", "enterprise", "mix", "storage"):
        effects[name].assert_called_once()
    request = effects["storage"].call_args.args[0]
    assert request.headers["authorization"] == "Bearer host-private-token"


def test_only_admin_can_promote_to_the_shared_role_catalog(host_client):
    client, effects = host_client
    path = "/api/agent-market/from-subagent"
    body = {"name": "fixture"}
    assert (
        client.post(path, headers={"Authorization": "Bearer sk-operator"}, json=body).status_code
        == 403
    )
    effects["promote"].assert_not_called()
    assert (
        client.post(path, headers={"Authorization": "Bearer sk-admin"}, json=body).status_code
        == 200
    )
    effects["promote"].assert_called_once()


def test_public_model_metadata_stays_available_to_authenticated_users(host_client):
    client, _effects = host_client
    headers = {"Authorization": "Bearer sk-alice"}
    for path in ("/v1/models", "/api/models", "/api/mix-config"):
        assert client.get(path, headers=headers).status_code == 200


@pytest.mark.parametrize("host_client", [False], indirect=True)
def test_development_mode_keeps_host_adapters_available(host_client):
    client, effects = host_client
    for method, path, body in (
        ("POST", "/api/verify/run", {"workspace": "fixture"}),
        ("GET", "/api/a2a/agents", None),
        ("GET", "/api/agent-market/enterprise", None),
        ("PUT", "/api/mix-config", {"n": 2}),
        ("GET", "/api/storage/v1/files/private", None),
        ("POST", "/api/agent-market/from-subagent", {"name": "fixture"}),
    ):
        response = client.request(method, path, json=body)
        assert response.status_code == 200, response.text
    for effect in effects.values():
        effect.assert_called_once()
