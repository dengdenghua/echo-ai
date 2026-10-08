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

import ipaddress
import logging
import os
from functools import lru_cache
from urllib.parse import urlsplit

from starlette.types import ASGIApp, Receive, Scope, Send

_log = logging.getLogger(__name__)

ALLOWED_HOSTS_ENV = "ECHO_ALLOWED_HOSTS"
ALLOWED_ORIGINS_ENV = "ECHO_ALLOWED_ORIGINS"

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
# The packaged Electron shell serves the renderer from this privileged
# custom scheme (frontend/electron/desktop-protocol.cjs). No web page can
# claim it, so it is first-party by construction.
_FIRST_PARTY_ORIGINS = frozenset({"echo-app://app"})


def _clean_host(host: str) -> str:
    return host.strip().lower().rstrip(".").strip("[]")


def _host_from_header(value: str) -> str:
    """Hostname of a ``Host`` header value (``h``, ``h:p``, ``[v6]:p``)."""
    text = value.strip()
    if not text:
        return ""
    try:
        return _clean_host(urlsplit(f"//{text}").hostname or "")
    except ValueError:
        return ""


def is_loopback_hostname(host: str) -> bool:
    cleaned = _clean_host(host)
    if not cleaned:
        return False
    if cleaned == "localhost" or cleaned.endswith(".localhost"):
        return True
    try:
        addr = ipaddress.ip_address(cleaned)
    except ValueError:
        # Other names are network-resolvable; trusting them is exactly
        # what DNS rebinding exploits.
        return False
    mapped = getattr(addr, "ipv4_mapped", None)
    return addr.is_loopback or bool(mapped is not None and mapped.is_loopback)


@lru_cache(maxsize=8)
def _parse_hosts(raw: str) -> frozenset[str]:
    return frozenset(h for h in (_host_from_header(part) for part in raw.split(",")) if h)


@lru_cache(maxsize=8)
def _parse_origins(raw: str) -> frozenset[str]:
    return frozenset(o for o in (_normalize_origin(part) for part in raw.split(",")) if o)


def _normalize_origin(value: str) -> str:
    """``scheme://host[:port]`` lowercased, or ``""`` when unparsable."""
    text = value.strip()
    if not text or text.lower() == "null":
        return ""
    try:
        parts = urlsplit(text)
        port = parts.port
    except ValueError:
        return ""
    host = _clean_host(parts.hostname or "")
    if (
        not parts.scheme
        or not host
        or parts.username
        or parts.password
        or parts.path
        or parts.query
        or parts.fragment
    ):
        return ""
    if (parts.scheme.lower(), port) in {("http", 80), ("https", 443)}:
        port = None
    netloc = f"[{host}]" if ":" in host else host
    if port is not None:
        netloc = f"{netloc}:{port}"
    return f"{parts.scheme.lower()}://{netloc}"


def _header(scope: Scope, name: bytes) -> str | None:
    for key, value in scope.get("headers") or ():
        if key.lower() == name:
            return value.decode("latin-1")
    return None


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
            # handler (shell, realtime session) ever runs.
            await receive()  # the initial websocket.connect
            await send({"type": "websocket.close", "code": 4403, "reason": reason})
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
        allowed_hosts = _parse_hosts(os.environ.get(ALLOWED_HOSTS_ENV, ""))
        raw_host = _header(scope, b"host")
        request_host = _host_from_header(raw_host) if raw_host is not None else ""
        # A missing Host (HTTP/1.0, raw ASGI callers) cannot be a rebinding
        # browser; a present one must be local or explicitly allowed.
        if (
            (self.require_local_host or allowed_hosts)
            and raw_host is not None
            and not (is_loopback_hostname(request_host) or request_host in allowed_hosts)
        ):
            return "host not allowed"

        if scope["type"] == "http" and str(scope.get("method") or "").upper() in _SAFE_METHODS:
            return None
        origin = _header(scope, b"origin")
        if origin is None:
            return None
        normalized = _normalize_origin(origin)
        if not normalized:
            return "origin not allowed"
        if normalized in _FIRST_PARTY_ORIGINS:
            return None
        if normalized in _parse_origins(os.environ.get(ALLOWED_ORIGINS_ENV, "")):
            return None
        origin_host = _clean_host(urlsplit(normalized).hostname or "")
        if urlsplit(normalized).scheme in {"http", "https", "capacitor"} and is_loopback_hostname(
            origin_host
        ):
            return None
        scheme = {"ws": "http", "wss": "https"}.get(
            scope.get("scheme", ""), scope.get("scheme", "")
        )
        if raw_host and normalized == _normalize_origin(f"{scheme}://{raw_host}"):
            return None
        return "origin not allowed"


__all__ = [
    "ALLOWED_HOSTS_ENV",
    "ALLOWED_ORIGINS_ENV",
    "LocalOriginGuardMiddleware",
    "is_loopback_hostname",
]
