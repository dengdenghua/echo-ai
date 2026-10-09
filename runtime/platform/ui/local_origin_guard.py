"""Host / Origin guard for the unauthenticated local-mode server.

With control-plane auth off (the default local profile) every route —
including the persistent-shell ``/api/terminal/ws`` and the realtime /
screen-stream WebSockets — trusts whoever can reach the loopback port.
Browsers can: any page the user visits may open
``ws://127.0.0.1:8310/...`` (WebSocket handshakes are exempt from CORS),
fire no-cors ``POST``s, or DNS-rebind its own hostname onto 127.0.0.1.

``LocalOriginGuardMiddleware`` is a pure ASGI middleware (so it sees
``websocket`` scopes too). Authenticated deployments also check Origin,
because their HTTP/WebSocket routes can accept browser session cookies:

* **Host** (http + websocket): the Host hostname must be loopback
  (``localhost``, ``*.localhost``, ``127.0.0.0/8``, ``::1``) or listed in
  ``ECHO_ALLOWED_HOSTS``. This defeats DNS rebinding.
* **Origin** (websocket always; http for non-safe methods): when present,
  the Origin host must be loopback (HTTP(S) or Capacitor, any port, so the Vite dev
  server, the backend-served ``/ui`` and ``capacitor://localhost`` pass),
  match the full request origin, or be listed in ``ECHO_ALLOWED_ORIGINS``.
  Non-loopback cross-port frontends must be explicitly allowlisted.
  ``Origin: null`` (sandboxed frames, ``file:``, redirects) is refused. A
  missing Origin is allowed — browsers always send one on WebSocket
  handshakes and cross-origin POSTs, so its absence means a non-browser
  client (CLI, SDK, tests).

Both allowlists are comma-separated and re-read per request so an
operator (or test harness) can adjust them without rebuilding the app.
"""

from __future__ import annotations

import logging

from starlette.types import ASGIApp, Receive, Scope, Send

from runtime.safety.auth.origin_policy import (
    ALLOWED_HOSTS_ENV,
    ALLOWED_ORIGINS_ENV,
    host_rejection,
    is_loopback_hostname,
    origin_rejection,
)
from runtime.safety.auth.websocket_auth import WS_POLICY_VIOLATION

_log = logging.getLogger(__name__)

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


class LocalOriginGuardMiddleware:
    """Check browser origins; additionally constrain Host in local no-auth mode."""

    def __init__(self, app: ASGIApp, *, require_local_host: bool = True) -> None:
        self.app = app
        self.require_local_host = require_local_host

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        scope_type = scope.get("type")
        if scope_type not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        reason = self._rejection(scope)
        if reason is None:
            await self.app(scope, receive, send)
            return

        _log.warning(
            "local origin guard refused %s %s: %s",
            scope_type,
            scope.get("path") or "",
            reason,
        )
        if scope_type == "websocket":
            # Close before accept: the handshake answers 403 and no route
            # handler (shell, realtime session) ever runs. 1008 (policy
            # violation) is the shared pre-accept refusal code.
            await receive()  # the initial websocket.connect
            await send({"type": "websocket.close", "code": WS_POLICY_VIOLATION, "reason": reason})
            return
        body = f"Forbidden: {reason}".encode()
        await send(
            {
                "type": "http.response.start",
                "status": 403,
                "headers": [
                    (b"content-type", b"text/plain; charset=utf-8"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    def _rejection(self, scope: Scope) -> str | None:
        # The policy lives in runtime.safety.auth.origin_policy so the
        # per-endpoint WebSocket gate (authenticate_websocket) applies the
        # exact same allowlists.
        reason = host_rejection(scope, require_local_host=self.require_local_host)
        if reason is not None:
            return reason
        if scope["type"] == "http" and str(scope.get("method") or "").upper() in _SAFE_METHODS:
            return None
        return origin_rejection(scope)


__all__ = [
    "ALLOWED_HOSTS_ENV",
    "ALLOWED_ORIGINS_ENV",
    "LocalOriginGuardMiddleware",
    "is_loopback_hostname",
]
