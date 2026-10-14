"""Unit tests for the shared WebSocket handshake gate.

``authenticate_websocket`` must reuse the HTTP session/token verification
(``resolve_principal``) unchanged, apply the same Origin policy as the HTTP
guard, and refuse with close code 1008 *before* ``accept()`` so no endpoint
state is ever created for a refused client.
"""

from __future__ import annotations

import base64
import time
from typing import Any

import pytest
from fastapi import APIRouter, Depends, FastAPI, HTTPException, WebSocket
from fastapi.testclient import TestClient
from starlette.requests import HTTPConnection
from starlette.websockets import WebSocketDisconnect

from runtime.safety.auth import Identity, IdentityStore, encode_jwt_hs256
from runtime.safety.auth.principal import SESSION_COOKIE_NAME
from runtime.safety.auth.websocket_auth import (
    APP_STATE_ATTR,
    OPERATOR_ROLES,
    WS_POLICY_VIOLATION,
    WebSocketAuthConfig,
    WebSocketCredential,
    authenticate_websocket,
    require_connection_principal,
    websocket_auth_config_from_app,
)

SECRET = "unit-test-websocket-gate-secret-0123456789"
ISSUER = "echo-test"
AUDIENCE = "echo-ws"


def _store() -> IdentityStore:
    store = IdentityStore()
    store.add(Identity(actor_id="alice", roles=("operator",)), api_key_plaintext="sk-alice")
    store.add(Identity(actor_id="mallory"), api_key_plaintext="sk-mallory")
    return store


def _jwt(sub: str = "alice", *, exp_offset: int = 300) -> str:
    now = int(time.time())
    return encode_jwt_hs256(
        {"sub": sub, "iat": now, "exp": now + exp_offset, "iss": ISSUER, "aud": AUDIENCE},
        secret=SECRET,
    )


def _config(store: IdentityStore | None, *, require_auth: bool = True) -> WebSocketAuthConfig:
    return WebSocketAuthConfig(
        identity_store=store,
        require_auth=require_auth,
        jwt_secret=SECRET,
        jwt_issuer=ISSUER,
        jwt_audience=AUDIENCE,
    )


def _app(
    config: WebSocketAuthConfig | None,
    *,
    credential: WebSocketCredential = WebSocketCredential.SESSION,
    roles: tuple[str, ...] = (),
) -> tuple[FastAPI, list[str]]:
    """A probe endpoint that records every handshake it actually accepted."""

    app = FastAPI()
    accepted: list[str] = []

    @app.websocket("/probe")
    async def probe(ws: WebSocket) -> None:
        auth = await authenticate_websocket(ws, config=config, credential=credential, roles=roles)
        if auth is None:
            return
        accepted.append(auth.actor_id or "<anonymous>")
        await ws.accept(subprotocol=auth.subprotocol)
        await ws.send_json({"actor": auth.actor_id, "tenant": auth.tenant_id})
        await ws.close()

    return app, accepted


def _refusal(client: TestClient, **kwargs: Any) -> tuple[int, str]:
    with (
        pytest.raises(WebSocketDisconnect) as exc_info,
        client.websocket_connect("/probe", **kwargs),
    ):
        pass
    return exc_info.value.code, exc_info.value.reason


def _b64(token: str) -> str:
    return base64.urlsafe_b64encode(token.encode("utf-8")).decode("ascii").rstrip("=")


# ── Valid sessions pass, through every HTTP credential transport ─────


@pytest.mark.parametrize(
    "transport",
    ["authorization_header", "bearer_b64_subprotocol", "session_cookie", "api_key"],
)
def test_valid_session_is_admitted(transport: str) -> None:
    app, accepted = _app(_config(_store()))
    client = TestClient(app)
    kwargs: dict[str, Any] = {}
    expected_subprotocol = None
    if transport == "authorization_header":
        kwargs["headers"] = {"Authorization": f"Bearer {_jwt()}"}
    elif transport == "bearer_b64_subprotocol":
        kwargs["subprotocols"] = ["bearer.b64", _b64(_jwt())]
        expected_subprotocol = "bearer.b64"
    elif transport == "session_cookie":
        client.cookies.set(SESSION_COOKIE_NAME, _jwt())
    else:
        kwargs["headers"] = {"Authorization": "Bearer sk-alice"}

    with client.websocket_connect("/probe", **kwargs) as ws:
        assert ws.accepted_subprotocol == expected_subprotocol
        assert ws.receive_json() == {"actor": "alice", "tenant": "legacy:alice"}
    assert accepted == ["alice"]


def test_query_string_token_is_never_a_credential() -> None:
    # ``?token=`` would leak into access/proxy logs, so it is ignored.
    app, accepted = _app(_config(_store()))
    with (
        pytest.raises(WebSocketDisconnect) as exc_info,
        TestClient(app).websocket_connect("/probe?token=sk-alice"),
    ):
        pass
    assert (exc_info.value.code, exc_info.value.reason) == (
        WS_POLICY_VIOLATION,
        "authentication required",
    )
    assert accepted == []


# ── Missing, expired, revoked and unknown credentials are refused ─────


def test_missing_credentials_refused_before_accept() -> None:
    app, accepted = _app(_config(_store()))
    assert _refusal(TestClient(app)) == (WS_POLICY_VIOLATION, "authentication required")
    assert accepted == []  # the endpoint body never ran past the gate


def test_expired_session_refused() -> None:
    app, accepted = _app(_config(_store()))
    expired = _jwt(exp_offset=-60)
    assert _refusal(TestClient(app), headers={"Authorization": f"Bearer {expired}"}) == (
        WS_POLICY_VIOLATION,
        "invalid or expired credentials",
    )
    assert accepted == []


def test_revoked_session_refused() -> None:
    store = _store()
    token = _jwt()
    app, accepted = _app(_config(store))
    client = TestClient(app)
    with client.websocket_connect("/probe", headers={"Authorization": f"Bearer {token}"}) as ws:
        assert ws.receive_json()["actor"] == "alice"

    # Logout revokes the presented session server-side (the HTTP path uses
    # the same IdentityStore.revoke_jwt); the socket gate must honour it.
    assert store.revoke_jwt(
        token, secret=SECRET, required_issuer=ISSUER, required_audience=AUDIENCE
    )
    client.cookies.set(SESSION_COOKIE_NAME, token)
    assert _refusal(client) == (WS_POLICY_VIOLATION, "invalid or expired credentials")
    assert accepted == ["alice"]


def test_unregistered_jwt_subject_refused() -> None:
    # Claims never synthesize an identity: the subject must be registered.
    app, accepted = _app(_config(_store()))
    stranger = _jwt(sub="nobody")
    assert _refusal(TestClient(app), headers={"Authorization": f"Bearer {stranger}"}) == (
        WS_POLICY_VIOLATION,
        "invalid or expired credentials",
    )
    assert accepted == []


def test_require_auth_without_identity_store_fails_closed() -> None:
    app, accepted = _app(_config(None))
    assert _refusal(TestClient(app), headers={"Authorization": "Bearer sk-alice"}) == (
        WS_POLICY_VIOLATION,
        "authentication unavailable",
    )
    assert accepted == []


def test_roles_are_enforced_after_authentication() -> None:
    app, accepted = _app(_config(_store()), roles=OPERATOR_ROLES)
    client = TestClient(app)
    assert _refusal(client, headers={"Authorization": "Bearer sk-mallory"}) == (
        WS_POLICY_VIOLATION,
        "admin/operator role required",
    )
    with client.websocket_connect("/probe", headers={"Authorization": "Bearer sk-alice"}) as ws:
        assert ws.receive_json()["actor"] == "alice"
    assert accepted == ["alice"]


def test_local_mode_admits_anonymous_but_still_resolves_presented_identity() -> None:
    app, accepted = _app(_config(_store(), require_auth=False), roles=OPERATOR_ROLES)
    client = TestClient(app)
    with client.websocket_connect("/probe") as ws:
        assert ws.receive_json() == {"actor": None, "tenant": None}
    with client.websocket_connect("/probe", headers={"Authorization": "Bearer sk-mallory"}) as ws:
        # Roles gate only shared (auth-on) deployments, as require_roles does.
        assert ws.receive_json()["actor"] == "mallory"
    assert accepted == ["<anonymous>", "mallory"]


# ── Origin: the HTTP guard's policy, enforced by the gate itself ─────


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example",
        "null",
        "http://127.0.0.1.evil.example",
        "https://evil.example@localhost",
        "not a url",
    ],
)
def test_foreign_origin_refused_even_with_a_valid_session(origin: str) -> None:
    app, accepted = _app(_config(_store()))
    headers = {"Authorization": "Bearer sk-alice", "Origin": origin}
    assert _refusal(TestClient(app), headers=headers) == (
        WS_POLICY_VIOLATION,
        "origin not allowed",
    )
    assert accepted == []


@pytest.mark.parametrize(
    "credential",
    [WebSocketCredential.DEVICE, WebSocketCredential.TRUSTED_LOCAL],
)
def test_foreign_origin_refused_for_exempt_credentials_too(credential: WebSocketCredential) -> None:
    app, accepted = _app(_config(_store()), credential=credential)
    app.state.echo_allow_local_workspace_access = True
    assert _refusal(TestClient(app), headers={"Origin": "https://evil.example"}) == (
        WS_POLICY_VIOLATION,
        "origin not allowed",
    )
    assert accepted == []


@pytest.mark.parametrize(
    "origin",
    ["http://localhost:3310", "http://127.0.0.1:8310", "capacitor://localhost", "echo-app://app"],
)
def test_first_party_origins_admitted(origin: str) -> None:
    app, accepted = _app(_config(_store()))
    headers = {"Authorization": "Bearer sk-alice", "Origin": origin}
    with TestClient(app).websocket_connect("/probe", headers=headers) as ws:
        assert ws.receive_json()["actor"] == "alice"
    assert accepted == ["alice"]


def test_same_host_and_allowlisted_origins_admitted(monkeypatch: pytest.MonkeyPatch) -> None:
    app, _accepted = _app(_config(_store()))
    client = TestClient(app, base_url="https://echo.example")
    url = "wss://echo.example/probe"
    auth = {"Authorization": "Bearer sk-alice"}
    with client.websocket_connect(url, headers={**auth, "Origin": "https://echo.example"}) as ws:
        assert ws.receive_json()["actor"] == "alice"
    with (
        pytest.raises(WebSocketDisconnect) as exc_info,
        client.websocket_connect(url, headers={**auth, "Origin": "https://tools.example"}),
    ):
        pass
    assert exc_info.value.code == WS_POLICY_VIOLATION

    monkeypatch.setenv("ECHO_ALLOWED_ORIGINS", "https://tools.example")
    with client.websocket_connect(url, headers={**auth, "Origin": "https://tools.example"}) as ws:
        assert ws.receive_json()["actor"] == "alice"


# ── Declared credential kinds ─────────────────────────────────────────


def test_device_credential_skips_host_session_only() -> None:
    app, accepted = _app(_config(_store()), credential=WebSocketCredential.DEVICE)
    with TestClient(app).websocket_connect("/probe") as ws:
        assert ws.receive_json() == {"actor": None, "tenant": None}
    assert accepted == ["<anonymous>"]


def test_trusted_local_requires_the_validated_local_posture() -> None:
    app, accepted = _app(_config(_store()), credential=WebSocketCredential.TRUSTED_LOCAL)
    client = TestClient(app)
    assert _refusal(client) == (WS_POLICY_VIOLATION, "trusted local host required")
    app.state.echo_allow_local_workspace_access = True
    with client.websocket_connect("/probe") as ws:
        assert ws.receive_json()["actor"] is None
    assert accepted == ["<anonymous>"]


# ── Host config published on app.state ────────────────────────────────


def test_missing_host_config_fails_closed_when_host_declares_auth() -> None:
    app, accepted = _app(None)
    app.state.echo_require_auth = True
    assert _refusal(TestClient(app), headers={"Authorization": "Bearer sk-alice"}) == (
        WS_POLICY_VIOLATION,
        "authentication unavailable",
    )
    assert accepted == []


def test_published_host_config_is_used_by_default() -> None:
    app, accepted = _app(None)
    setattr(app.state, APP_STATE_ATTR, _config(_store()))
    assert websocket_auth_config_from_app(app).require_auth is True
    client = TestClient(app)
    assert _refusal(client) == (WS_POLICY_VIOLATION, "authentication required")
    with client.websocket_connect("/probe", headers={"Authorization": "Bearer sk-alice"}) as ws:
        assert ws.receive_json()["actor"] == "alice"
    assert accepted == ["alice"]


def test_setup_app_publishes_the_http_auth_config() -> None:
    from runtime.platform.ui._app_setup import setup_app

    store = _store()
    ctx = setup_app(
        journal_path=None,
        journal=None,
        registry=None,
        stack=None,
        cocoloop_identity_store=store,
        cocoloop_require_auth=True,
        allow_local_workspace_access=False,
        oct_config=None,
        oct_jwt_secret=None,
        local_auth_config=None,
    )
    config = websocket_auth_config_from_app(ctx.app)
    assert config.identity_store is store
    assert config.require_auth is True
    assert (config.jwt_secret, config.jwt_issuer, config.jwt_audience) == (
        ctx.jwt_secret,
        ctx.jwt_issuer,
        ctx.jwt_audience,
    )


# ── Router-dependency form for mixed HTTP + WebSocket routers ─────────


def test_require_connection_principal_serves_http_and_websocket_routes() -> None:
    config = _config(_store())
    reached: list[str] = []

    def _dep(connection: HTTPConnection) -> None:
        require_connection_principal(connection, config)

    router = APIRouter(dependencies=[Depends(_dep)])

    @router.get("/http")
    def http_route() -> dict[str, bool]:
        return {"ok": True}

    @router.websocket("/probe")
    async def ws_route(ws: WebSocket) -> None:
        reached.append("ws")
        await ws.accept()
        await ws.send_text("hi")
        await ws.close()

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    assert client.get("/http").status_code == 401
    assert client.get("/http", headers={"Authorization": "Bearer sk-alice"}).json() == {"ok": True}
    assert _refusal(client) == (WS_POLICY_VIOLATION, "authentication required")
    assert _refusal(client, headers={"Authorization": "Bearer sk-alice", "Origin": "null"}) == (
        WS_POLICY_VIOLATION,
        "origin not allowed",
    )
    assert reached == []
    with client.websocket_connect("/probe", headers={"Authorization": "Bearer sk-alice"}) as ws:
        assert ws.receive_text() == "hi"
    assert reached == ["ws"]


def test_require_connection_principal_reports_http_401_unchanged() -> None:
    from starlette.requests import Request

    request = Request({"type": "http", "headers": [], "method": "GET", "path": "/"})
    with pytest.raises(HTTPException) as exc_info:
        require_connection_principal(request, _config(_store()))
    assert exc_info.value.status_code == 401
