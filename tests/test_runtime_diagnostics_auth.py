"""Detailed runtime diagnostics require an operator; public health stays minimal."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.platform.ui import health_router
from runtime.safety.auth import Identity, IdentityStore


@pytest.fixture
def identities():
    store = IdentityStore()
    store.add(Identity(actor_id="reader"), api_key_plaintext="test-reader-key")
    store.add(
        Identity(actor_id="operator", roles=("operator",)), api_key_plaintext="test-operator-key"
    )
    return store


def _client(monkeypatch, identities=None, *, require_auth=True):
    monkeypatch.setattr(
        health_router, "build_runtime_self_check", lambda **_: {"diagnostics": True}
    )
    monkeypatch.setattr(
        "runtime.sensing.gateway.storage_supervisor.storage_status", lambda: {"up": True}
    )
    state = SimpleNamespace(
        registry=[], journal=SimpleNamespace(read_all=lambda: []), journal_path=None
    )
    app = FastAPI()
    app.include_router(
        health_router.create_health_router(
            state=state, identity_store=identities, require_auth=require_auth
        )
    )
    return TestClient(app)


@pytest.mark.parametrize("path", ["/api/runtime/self-check", "/api/status", "/api/storage/status"])
def test_diagnostics_reject_anonymous_invalid_and_nonoperator(monkeypatch, identities, path):
    client = _client(monkeypatch, identities)
    assert client.get(path).status_code == 401
    assert client.get(path, headers={"Authorization": "Bearer invalid-key"}).status_code == 401
    assert client.get(path, headers={"Authorization": "Bearer test-reader-key"}).status_code == 403


@pytest.mark.parametrize("path", ["/api/runtime/self-check", "/api/status", "/api/storage/status"])
def test_diagnostics_allow_operator(monkeypatch, identities, path):
    client = _client(monkeypatch, identities)
    response = client.get(path, headers={"Authorization": "Bearer test-operator-key"})
    assert response.status_code == 200


def test_diagnostics_fail_closed_without_identity_store(monkeypatch):
    client = _client(monkeypatch)
    assert client.get("/api/runtime/self-check").status_code == 401


def test_authenticated_public_health_never_reads_runtime_state(monkeypatch):
    app = FastAPI()
    app.include_router(health_router.create_health_router(state=object(), require_auth=True))
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert set(data) == {"status", "ts", "runtime"}
    assert data["status"] == "ok"
    assert data["runtime"] == health_router._runtime_identity()
    assert set(data["runtime"]["kernel"]) <= {
        "manifestVersion",
        "revision",
        "deviceProtocolVersion",
        "securityContractVersion",
        "sourceScopeVerified",
    }
    assert set(data["runtime"]) <= {
        "name",
        "product",
        "version",
        "sourceId",
        "verifiedBundle",
        "kernel",
    }


def test_local_health_and_diagnostics_keep_existing_behavior(monkeypatch):
    client = _client(monkeypatch, require_auth=False)
    assert client.get("/api/runtime/self-check").json() == {"diagnostics": True}
    data = client.get("/api/health").json()
    assert {"skills", "journal_events", "agents", "channels", "groups", "lifecycle"} <= data.keys()
