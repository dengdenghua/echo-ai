from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from runtime.adapters.integrations.oct.client import OctClientError
from runtime.adapters.integrations.oct.config import OctConfig
from runtime.adapters.integrations.oct.links import OctLinkStore
from runtime.adapters.integrations.oct.router_auth import create_auth_router
from runtime.cloud_edge.accounts import create_account_router
from runtime.safety.auth.login_throttle import AuthAttemptLimiter


def request(peer="127.0.0.1"):
    return Request({"type": "http", "client": (peer, 1234), "headers": []})


def test_windows_expire_and_live_buckets_cannot_be_evicted():
    now = [1.0]
    limiter = AuthAttemptLimiter(
        ip_limit=10, subject_limit=1, window_s=30, max_keys=2, clock=lambda: now[0]
    )
    limiter.check(request(), " User@example.com ")
    with pytest.raises(HTTPException) as blocked:
        limiter.check(request(), "user@EXAMPLE.com")
    assert blocked.value.status_code == 429
    with pytest.raises(HTTPException):
        limiter.check(request("192.0.2.2"), "other")
    now[0] += 31
    limiter.check(request("192.0.2.2"), "other")


def test_limit_is_atomic_across_request_threads():
    limiter = AuthAttemptLimiter(ip_limit=100, subject_limit=8, window_s=300)

    def attempt(_):
        try:
            limiter.check(request(), "alice")
            return True
        except HTTPException:
            return False

    with ThreadPoolExecutor(max_workers=16) as pool:
        assert sum(pool.map(attempt, range(64))) == 8


@pytest.mark.parametrize(("endpoint", "limit"), [("send", 3), ("login", 8)])
def test_oct_limits_before_upstream_and_ignores_forwarded_headers(
    tmp_path, monkeypatch, endpoint, limit
):
    upstream = Mock(side_effect=OctClientError("invalid code", status_code=401))
    monkeypatch.setattr("runtime.adapters.integrations.oct.router_auth.post_public", upstream)
    app = FastAPI()
    app.include_router(
        create_auth_router(
            config=OctConfig(enabled=True), link_store=OctLinkStore(path=tmp_path / "links.json")
        )
    )
    with TestClient(app) as client:
        for index in range(limit + 1):
            response = client.post(
                f"/api/auth/oct/email/{endpoint}",
                json={"email": "a@example.com" if index % 2 else "A@EXAMPLE.COM", "code": "000000"},
                headers={"X-Forwarded-For": f"192.0.2.{index}"},
            )
            assert response.status_code == (
                429 if index == limit else (502 if endpoint == "send" else 401)
            )
        assert response.headers["Retry-After"] == "300"
        assert upstream.call_count == limit


def test_oct_ip_limit_survives_rotating_emails(tmp_path, monkeypatch):
    upstream = Mock(return_value={"ok": True})
    monkeypatch.setattr("runtime.adapters.integrations.oct.router_auth.post_public", upstream)
    app = FastAPI()
    app.include_router(
        create_auth_router(
            config=OctConfig(enabled=True), link_store=OctLinkStore(path=tmp_path / "links.json")
        )
    )
    with TestClient(app) as client:
        for index in range(6):
            response = client.post(
                "/api/auth/oct/email/send",
                json={"email": f"user{index}@example.com"},
                headers={"X-Forwarded-For": f"192.0.2.{index}"},
            )
            assert response.status_code == (200 if index < 5 else 429)
    assert upstream.call_count == 5


@pytest.mark.parametrize(
    ("endpoint", "limit", "body", "method"),
    [
        (
            "register",
            3,
            {"username": "alice", "password": "long-password-123", "registration_code": "bad-code"},
            "register",
        ),
        ("login", 8, {"username": "alice", "password": "wrong"}, "authenticate"),
        (
            "refresh",
            10,
            {"refresh_token": "invalid-refresh-token-with-enough-length"},
            "consume_session",
        ),
    ],
)
def test_cloud_account_attempt_limits(endpoint, limit, body, method):
    store = Mock()
    store.authenticate.return_value = None
    store.consume_session.return_value = None
    app = FastAPI()
    app.include_router(
        create_account_router(
            store=store, auth=SimpleNamespace(tenant_id="tenant"), registration_code="correct-code"
        )
    )
    with TestClient(app) as client:
        for index in range(limit + 1):
            response = client.post(f"/v1/accounts/{endpoint}", json=body)
            assert response.status_code == (
                429 if index == limit else (403 if endpoint == "register" else 401)
            )
    assert getattr(store, method).call_count == (0 if endpoint == "register" else limit)
