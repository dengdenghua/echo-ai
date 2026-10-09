"""Every WebSocket endpoint goes through the shared handshake gate.

WebSocket handshakes bypass the HTTP auth middleware, so each endpoint has to
authenticate itself — and new ones keep forgetting. This suite locks the
contract on the *complete* app built by ``create_app`` with host auth on:

* every mounted WebSocket route refuses an anonymous handshake before
  ``accept()`` with close code 1008, unless it is listed in
  ``WEBSOCKET_AUTH_EXEMPTIONS`` with a reason;
* exempt routes still refuse anonymous clients through their own declared
  credential (e.g. a device must open with a valid ``device/hello``);
* every route refuses a foreign browser Origin even when the caller holds a
  valid operator session — enforced by the endpoint gate itself: the global
  ``LocalOriginGuardMiddleware`` is stripped from the app under test so a
  route that relied on it alone would fail here;
* a static scan catches WebSocket routes that this app does not mount
  (plugins, conditional routers) but that never call the gate.

A new WebSocket endpoint that skips ``authenticate_websocket`` fails the first
test (it accepts the anonymous handshake) and the static scan.
"""

from __future__ import annotations

import ast
import contextlib
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.routing import APIWebSocketRoute
from fastapi.testclient import TestClient
from starlette.routing import WebSocketRoute
from starlette.websockets import WebSocketDisconnect

from runtime.safety.auth import Identity, IdentityStore
from runtime.safety.auth.websocket_auth import (
    WEBSOCKET_AUTH_EXEMPTIONS,
    WS_POLICY_VIOLATION,
    WebSocketCredential,
)
from tests.route_utils import iter_routes

REPO_ROOT = Path(__file__).resolve().parents[1]

# Routes the auth-on app must mount. Guards the enumeration itself: if route
# discovery silently broke, the per-route assertions would pass vacuously.
EXPECTED_ROUTES = frozenset(
    {
        "/api/realtime",
        "/api/remote-backends/{backend_id}/realtime",
        "/api/android/ws/{device_id}",
        "/api/browser/relay/ws",
        "/api/browser/relay/status/ws",
        "/api/terminal/ws/{session_id}",
        "/api/tentacle/pc-screen/stream",
        "/api/tentacle/screen/stream",
        "/api/tentacle/device/ws",
        "/api/teams/{team_id}/ws",
    }
)

# Exempt routes that only exist under a deployment posture the auth-on test
# app does not have; their registration is verified separately below.
CONDITIONAL_EXEMPT_ROUTES = frozenset(
    {"/api/plugins/paper-trading/origin/socket.io/{ws_path:path}"}
)

# Positive-control exclusions: accepting these starts real side effects.
_POSITIVE_CONTROL_SKIP = {
    # A real shell process; the admitted path is locked without spawning in
    # tests/test_terminal_ws_auth.py (foreign-owner + subprotocol tests).
    "/api/terminal/ws/{session_id}",
}

_ROUTE_FACTORIES = frozenset(
    {"websocket", "add_websocket_route", "websocket_route", "WebSocketRoute", "APIWebSocketRoute"}
)
_GATE_CALLS = frozenset(
    {"authenticate_websocket", "check_websocket_auth", "require_connection_principal"}
)
# Route modules whose handler hands the socket to a sibling module that runs
# the gate (kept explicit so a new delegation is a reviewed decision).
_GATE_DELEGATES = {
    "runtime/sensing/gateway/realtime_gateway.py": "runtime/sensing/gateway/_realtime_gateway_session.py",
    "runtime/sensing/gateway/team_rooms_router.py": "runtime/sensing/gateway/team_rooms_ws.py",
}


@pytest.fixture(scope="module")
def full_app(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Any]:
    tmp = tmp_path_factory.mktemp("ws-auth-coverage")
    with pytest.MonkeyPatch.context() as mp:
        mp.chdir(tmp)
        mp.setenv("ECHO_HOME", str(tmp / "echo-home"))
        from runtime.platform.ui.app import create_app
        from runtime.platform.ui.local_origin_guard import LocalOriginGuardMiddleware

        identities = IdentityStore()
        identities.add(Identity(actor_id="alice"), api_key_plaintext="sk-alice")
        identities.add(
            Identity(actor_id="operator", roles=("operator",)),
            api_key_plaintext="sk-operator",
        )
        app = create_app(cocoloop_require_auth=True, cocoloop_identity_store=identities)
        # Prove the endpoint gates on their own: without the global guard the
        # only Origin check left is the one inside authenticate_websocket.
        app.user_middleware = [
            m for m in app.user_middleware if m.cls is not LocalOriginGuardMiddleware
        ]
        yield app


def _websocket_routes(app: Any) -> dict[str, Any]:
    return {
        route.path: route
        for route in iter_routes(app)
        if isinstance(route, (WebSocketRoute, APIWebSocketRoute))
    }


def _concrete(path: str) -> str:
    """Fill every ``{param}`` / ``{param:conv}`` with a harmless value."""
    return re.sub(r"\{[^}]+\}", "probe", path)


def _handshake(client: TestClient, path: str, headers: dict[str, str]) -> tuple[str, Any]:
    """``("refused", (code, reason))`` before accept, else ``("accepted", ws)``."""
    try:
        session = client.websocket_connect(_concrete(path), headers=headers)
        ws = session.__enter__()
    except WebSocketDisconnect as exc:
        return "refused", (exc.code, exc.reason)
    return "accepted", (session, ws)


def _close(accepted: Any) -> None:
    session, _ws = accepted
    with contextlib.suppress(WebSocketDisconnect):
        session.__exit__(None, None, None)


def test_full_app_mounts_the_known_websocket_routes(full_app: Any) -> None:
    mounted = set(_websocket_routes(full_app))
    assert mounted >= EXPECTED_ROUTES, sorted(EXPECTED_ROUTES - mounted)


def test_every_websocket_route_refuses_anonymous_handshake(full_app: Any) -> None:
    client = TestClient(full_app, raise_server_exceptions=False)
    failures: list[str] = []
    for path in sorted(_websocket_routes(full_app)):
        if path in WEBSOCKET_AUTH_EXEMPTIONS:
            continue
        outcome, detail = _handshake(client, path, headers={})
        if outcome == "accepted":
            _close(detail)
            failures.append(f"{path}: accepted an anonymous handshake")
        elif detail[0] != WS_POLICY_VIOLATION:
            failures.append(f"{path}: refused with {detail!r}, expected close code 1008")
    assert not failures, "\n".join(failures)


def test_every_websocket_route_refuses_foreign_origin_with_valid_session(
    full_app: Any,
) -> None:
    client = TestClient(full_app, raise_server_exceptions=False)
    headers = {"Authorization": "Bearer sk-operator", "Origin": "https://evil.example"}
    failures: list[str] = []
    for path in sorted(_websocket_routes(full_app)):
        outcome, detail = _handshake(client, path, headers=headers)
        if outcome == "accepted":
            _close(detail)
            failures.append(f"{path}: accepted a cross-site handshake")
        elif detail != (WS_POLICY_VIOLATION, "origin not allowed"):
            failures.append(f"{path}: refused with {detail!r}, expected the Origin refusal")
    assert not failures, "\n".join(failures)


def test_operator_session_passes_the_gate_of_session_routes(full_app: Any) -> None:
    """Positive control: the gate is not simply refusing everything.

    Handlers may still close for their own reasons afterwards (feature flag
    off, unknown room, missing relay), but never with the gate's refusal.
    """
    client = TestClient(full_app, raise_server_exceptions=False)
    gate_reasons = {
        "authentication required",
        "invalid or expired credentials",
        "authentication unavailable",
        "admin/operator role required",
        "origin not allowed",
    }
    failures: list[str] = []
    for path in sorted(_websocket_routes(full_app)):
        if path in WEBSOCKET_AUTH_EXEMPTIONS or path in _POSITIVE_CONTROL_SKIP:
            continue
        outcome, detail = _handshake(client, path, {"Authorization": "Bearer sk-operator"})
        if outcome == "accepted":
            _close(detail)
        elif detail[1] in gate_reasons:
            failures.append(f"{path}: valid operator session refused by the gate: {detail!r}")
    assert not failures, "\n".join(failures)


def test_device_route_refuses_unauthenticated_device(full_app: Any) -> None:
    exemption = WEBSOCKET_AUTH_EXEMPTIONS["/api/tentacle/device/ws"]
    assert exemption.credential is WebSocketCredential.DEVICE
    client = TestClient(full_app, raise_server_exceptions=False)
    outcome, detail = _handshake(client, "/api/tentacle/device/ws", headers={})
    if outcome == "refused":
        # No device token configured: refused outright, before accept.
        assert detail[0] == WS_POLICY_VIOLATION
        return
    session, ws = detail
    try:
        # A host session is not a device credential, and anything but a valid
        # device/hello is refused by the device protocol itself.
        ws.send_json({"jsonrpc": "2.0", "id": 1, "method": "device/heartbeat", "params": {}})
        with pytest.raises(WebSocketDisconnect) as exc_info:
            while True:
                ws.receive_text()
        assert exc_info.value.code == WS_POLICY_VIOLATION
    finally:
        _close((session, ws))


def test_exemptions_are_explained_and_current(full_app: Any) -> None:
    mounted = set(_websocket_routes(full_app))
    for path, exemption in WEBSOCKET_AUTH_EXEMPTIONS.items():
        assert exemption.credential is not WebSocketCredential.SESSION, path
        assert len(exemption.reason.split()) >= 12, f"{path}: exemption needs a real reason"
        assert path in mounted or path in CONDITIONAL_EXEMPT_ROUTES, f"stale exemption: {path}"


def test_conditional_paper_trading_exemption_matches_its_route(tmp_path: Path) -> None:
    from fastapi import FastAPI

    from runtime.platform.plugins.bundled.paper_trading import PaperTradingPlugin
    from runtime.platform.plugins.plugin_base import ModuleContext

    plugin_dir = REPO_ROOT / "runtime" / "platform" / "plugins" / "bundled" / "paper_trading"

    app = FastAPI()
    app.state.echo_require_auth = True
    app.state.echo_allow_local_workspace_access = True
    plugin = PaperTradingPlugin()
    plugin.on_load(
        ModuleContext(
            plugin_name="paper_trading",
            plugin_dir=str(plugin_dir),
            manifest=None,
            fastapi_app=app,
            config={
                "data_dir": str(tmp_path / "pt"),
                "base_url": "https://up.test/api",
                "proxy_origin": True,
                "allow_same_origin_third_party_scripts": True,
                "trusted_single_user_local_proxy": True,
            },
        )
    )
    try:
        assert set(_websocket_routes(app)) >= CONDITIONAL_EXEMPT_ROUTES
        client = TestClient(app, raise_server_exceptions=False)
        path = next(iter(CONDITIONAL_EXEMPT_ROUTES))
        # Origin is enforced even in the trusted-local posture ...
        outcome, detail = _handshake(client, path, {"Origin": "https://evil.example"})
        assert outcome == "refused"
        assert detail == (WS_POLICY_VIOLATION, "origin not allowed")
        # ... and once the plugin drops the trusted bit, a session is required.
        plugin.on_stop(plugin.ctx)
        outcome, detail = _handshake(client, path, {})
        assert outcome == "refused"
        assert detail[0] == WS_POLICY_VIOLATION
    finally:
        plugin.on_unload(plugin.ctx)


def _route_definitions(tree: ast.AST) -> list[int]:
    """Line numbers of WebSocket route registrations in a module."""
    lines: list[int] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
            if name in _ROUTE_FACTORIES:
                lines.append(node.lineno)
    return lines


def _calls_gate(tree: ast.AST) -> bool:
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
            if name in _GATE_CALLS:
                return True
    return False


def _parse(rel: str) -> ast.AST:
    return ast.parse((REPO_ROOT / rel).read_text(encoding="utf-8"))


def test_every_websocket_route_module_calls_the_gate() -> None:
    offenders: list[str] = []
    for path in sorted((REPO_ROOT / "runtime").rglob("*.py")):
        rel = path.relative_to(REPO_ROOT).as_posix()
        if "all_skills" in rel or "__pycache__" in rel:
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        definitions = _route_definitions(tree)
        if not definitions:
            continue
        delegate = _GATE_DELEGATES.get(rel)
        if _calls_gate(tree) or (delegate is not None and _calls_gate(_parse(delegate))):
            continue
        offenders.append(f"{rel}:{definitions[0]}")
    assert not offenders, (
        "WebSocket routes that never call authenticate_websocket "
        f"(or declare an exemption with a reason): {offenders}"
    )
