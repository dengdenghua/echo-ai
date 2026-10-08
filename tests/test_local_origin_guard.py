"""Host / Origin guard for the unauthenticated local-mode server.

With control-plane auth off, any web page the user visits could open
``ws://127.0.0.1:8310/api/terminal/ws/x`` (WebSocket handshakes bypass
CORS), fire no-cors POSTs, or DNS-rebind its hostname onto loopback.
These tests lock the guard installed by ``setup_app`` for that mode and
confirm authenticated deployments retain browser Origin protection.
"""

from __future__ import annotations

from functools import lru_cache

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from runtime.platform.ui._app_setup import setup_app
from runtime.platform.ui.local_origin_guard import (
    ALLOWED_HOSTS_ENV,
    ALLOWED_ORIGINS_ENV,
    LocalOriginGuardMiddleware,
    is_loopback_hostname,
)
from runtime.sensing.gateway import terminal_router
from runtime.sensing.gateway.terminal_router import mount_terminal_routes

LOOPBACK = "http://127.0.0.1:8310"


@pytest.fixture(autouse=True)
def _no_ambient_allowlists(monkeypatch):
    # conftest allowlists the TestClient ``testserver`` host for the rest of
    # the suite; these tests assert the production default instead.
    monkeypatch.delenv(ALLOWED_HOSTS_ENV, raising=False)
    monkeypatch.delenv(ALLOWED_ORIGINS_ENV, raising=False)


@lru_cache(maxsize=2)
def _app(*, require_auth: bool) -> FastAPI:
    # Built once per posture: the guard re-reads its env allowlists per
    # request, so monkeypatched env still applies to a cached app.
    ctx = setup_app(
        journal_path=None,
        journal=None,
        registry=None,
        stack=None,
        cocoloop_identity_store=None,
        cocoloop_require_auth=require_auth,
        allow_local_workspace_access=False,
        oct_config=None,
        oct_jwt_secret=None,
        local_auth_config=None,
    )
    app = ctx.app

    @app.get("/probe")
    def probe_get() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/probe")
    def probe_post() -> dict[str, bool]:
        return {"ok": True}

    @app.websocket("/probe/ws")
    async def probe_ws(ws: WebSocket) -> None:
        await ws.accept()
        await ws.send_text("hello")
        await ws.close()

    return app


def _client(*, require_auth: bool = False, base_url: str = LOOPBACK) -> TestClient:
    return TestClient(_app(require_auth=require_auth), base_url=base_url)


def _ws_code(client: TestClient, headers: dict[str, str] | None = None) -> int | str:
    """Return the text a successful handshake yields, else the close code."""
    # websocket_connect resolves relative paths against ``ws://testserver``;
    # use the client's own host so the Host header matches ``base_url``.
    scheme = "wss" if client.base_url.scheme == "https" else "ws"
    url = str(client.base_url.copy_with(scheme=scheme, path="/probe/ws"))
    try:
        with client.websocket_connect(url, headers=headers or {}) as ws:
            return ws.receive_text()
    except WebSocketDisconnect as exc:
        return exc.code


# ── Host (DNS rebinding) ───────────────────────────────────────


@pytest.mark.parametrize(
    "base_url",
    [
        "http://127.0.0.1:8310",
        "http://127.8.9.10:8310",
        "http://localhost:3310",
        "http://echo.localhost",
    ],
)
def test_loopback_host_allowed_when_auth_off(base_url: str):
    assert _client(base_url=base_url).get("/probe").status_code == 200


def test_ipv6_loopback_host_allowed_when_auth_off():
    # TestClient cannot parse a bracketed netloc; send the header directly.
    response = _client().get("/probe", headers={"Host": "[::1]:8310"})
    assert response.status_code == 200


@pytest.mark.parametrize(
    "base_url", ["http://evil.example", "http://testserver", "http://192.168.1.5:8310"]
)
def test_foreign_host_rejected_when_auth_off(base_url: str):
    response = _client(base_url=base_url).get("/probe")
    assert response.status_code == 403
    assert response.headers["content-type"].startswith("text/plain")
    # The security-header middleware still wraps the early refusal.
    assert response.headers["x-content-type-options"] == "nosniff"


def test_foreign_host_rejected_for_websocket_when_auth_off():
    client = _client(base_url="http://evil.example")
    assert _ws_code(client) == 4403


def test_host_allowlist_env(monkeypatch):
    monkeypatch.setenv(ALLOWED_HOSTS_ENV, " echo.lan:8310 , other.lan")
    assert _client(base_url="http://echo.lan:8310").get("/probe").status_code == 200
    assert _client(base_url="http://Other.LAN").get("/probe").status_code == 200
    assert _client(base_url="http://evil.example").get("/probe").status_code == 403


def test_authenticated_app_accepts_remote_host_but_checks_browser_origin():
    client = _client(require_auth=True, base_url="https://echo.example")
    assert client.get("/probe").status_code == 200
    assert client.post("/probe", headers={"Origin": "https://echo.example"}).status_code == 200
    assert client.post("/probe", headers={"Origin": "https://evil.example"}).status_code == 403
    assert _ws_code(client, {"Origin": "https://evil.example"}) == 4403
    assert _ws_code(client, {"Origin": "null"}) == 4403
    assert _ws_code(client, {"Origin": "https://echo.example"}) == "hello"
    assert _ws_code(client, {"Origin": "https://echo.example:443"}) == "hello"
    assert _ws_code(client, {"Origin": "http://echo.example"}) == 4403
    assert _ws_code(client, {"Origin": "https://echo.example:8443"}) == 4403


# ── Origin on WebSocket handshakes ─────────────────────────────


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:3310",  # Vite dev server
        "http://127.0.0.1:8310",  # backend-served /ui
        "http://[::1]:3310",
        "capacitor://localhost",  # mobile shell
        "echo-app://app",  # packaged Electron renderer
    ],
)
def test_websocket_first_party_origin_allowed(origin: str):
    assert _ws_code(_client(), {"Origin": origin}) == "hello"


def test_websocket_without_origin_allowed():
    # Non-browser clients (CLI, SDK) send no Origin.
    assert _ws_code(_client()) == "hello"


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.com",
        "null",
        "http://127.0.0.1.evil.com",
        "not a url",
        "https://evil.com@localhost",
        "http://localhost/forged",
        "evil://localhost",
    ],
)
def test_websocket_foreign_or_opaque_origin_rejected(origin: str):
    assert _ws_code(_client(), {"Origin": origin}) == 4403


def test_websocket_same_host_origin_allowed_for_allowlisted_host(monkeypatch):
    monkeypatch.setenv(ALLOWED_HOSTS_ENV, "echo.lan")
    client = _client(base_url="http://echo.lan:8310")
    assert _ws_code(client, {"Origin": "http://echo.lan:8310"}) == "hello"
    assert _ws_code(client, {"Origin": "http://echo.lan:3310"}) == 4403
    monkeypatch.setenv(ALLOWED_ORIGINS_ENV, "http://echo.lan:3310")
    assert _ws_code(client, {"Origin": "http://echo.lan:3310"}) == "hello"
    assert _ws_code(client, {"Origin": "http://evil.lan"}) == 4403


def test_origin_allowlist_env(monkeypatch):
    monkeypatch.setenv(ALLOWED_ORIGINS_ENV, "https://Tools.Example.com:8443")
    client = _client()
    assert _ws_code(client, {"Origin": "https://tools.example.com:8443"}) == "hello"
    assert _ws_code(client, {"Origin": "https://tools.example.com"}) == 4403


# ── Origin on HTTP (CSRF) ──────────────────────────────────────


def test_post_with_foreign_origin_rejected():
    client = _client()
    response = client.post("/probe", headers={"Origin": "https://evil.com"})
    assert response.status_code == 403
    assert response.text == "Forbidden: origin not allowed"
    assert client.post("/probe", headers={"Origin": "null"}).status_code == 403


def test_post_with_first_party_or_missing_origin_allowed():
    client = _client()
    assert client.post("/probe", headers={"Origin": "http://localhost:3310"}).status_code == 200
    assert client.post("/probe").status_code == 200


def test_safe_methods_ignore_origin():
    client = _client()
    assert client.get("/probe", headers={"Origin": "https://evil.com"}).status_code == 200
    assert client.get("/probe", headers={"Origin": "null"}).status_code == 200


# ── End to end: the unsandboxed terminal shell ─────────────────


def test_terminal_ws_refuses_cross_site_page_before_spawning(monkeypatch):
    monkeypatch.setattr(terminal_router, "_sessions", {})
    app = FastAPI()
    mount_terminal_routes(app, identity_store=None, require_auth=False)
    app.add_middleware(LocalOriginGuardMiddleware)
    client = TestClient(app, base_url=LOOPBACK)
    with (
        pytest.raises(WebSocketDisconnect) as ei,
        client.websocket_connect(
            "/api/terminal/ws/pwn",
            headers={"Origin": "https://evil.com"},
        ) as ws,
    ):
        ws.receive_text()
    assert ei.value.code == 4403
    assert terminal_router._sessions == {}  # no shell was ever created


def test_is_loopback_hostname():
    for host in ("localhost", "LOCALHOST.", "a.b.localhost", "127.0.0.1", "::1", "[::1]"):
        assert is_loopback_hostname(host), host
    assert is_loopback_hostname("::ffff:127.0.0.1")
    for host in ("", "localhost.evil.com", "evilocalhost", "10.0.0.1", "0.0.0.0", "testserver"):
        assert not is_loopback_hostname(host), host
