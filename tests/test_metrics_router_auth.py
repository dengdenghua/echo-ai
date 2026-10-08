"""/metrics and /api/metrics/json are admin-only when shared auth is on.

Unauthenticated scraping stays available with auth off (local single-user)
or via the explicit ``public`` / ``ECHO_METRICS_PUBLIC`` opt-in used by the
bundled docker-compose Prometheus.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.platform.observability.metrics import MetricsRegistry
from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.metrics_router import METRICS_PUBLIC_ENV, create_metrics_router

_PATHS = ("/metrics", "/api/metrics", "/api/metrics/json")


def _client(**kwargs) -> TestClient:
    store = IdentityStore()
    store.add(Identity(actor_id="root", roles=("admin",)), api_key_plaintext="sk-admin")
    store.add(Identity(actor_id="user", roles=("user",)), api_key_plaintext="sk-user")
    registry = MetricsRegistry()
    registry.counter("echo_test_total", "test").inc()
    app = FastAPI()
    app.include_router(create_metrics_router(registry=registry, identity_store=store, **kwargs))
    return TestClient(app)


@pytest.fixture(autouse=True)
def _no_env_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(METRICS_PUBLIC_ENV, raising=False)


@pytest.mark.parametrize("path", _PATHS)
def test_metrics_require_admin_when_auth_enabled(path: str) -> None:
    client = _client(require_auth=True)
    assert client.get(path).status_code == 401
    assert client.get(path, headers={"Authorization": "Bearer sk-user"}).status_code == 403
    ok = client.get(path, headers={"Authorization": "Bearer sk-admin"})
    assert ok.status_code == 200
    assert "echo_test_total" in ok.text


@pytest.mark.parametrize("path", _PATHS)
def test_metrics_open_when_auth_disabled(path: str) -> None:
    assert _client(require_auth=False).get(path).status_code == 200


def test_metrics_public_opt_in_flag() -> None:
    client = _client(require_auth=True, public=True)
    assert client.get("/metrics").status_code == 200


def test_metrics_public_opt_in_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(METRICS_PUBLIC_ENV, "1")
    assert _client(require_auth=True).get("/metrics").status_code == 200
    monkeypatch.setenv(METRICS_PUBLIC_ENV, "0")
    assert _client(require_auth=True).get("/metrics").status_code == 401
