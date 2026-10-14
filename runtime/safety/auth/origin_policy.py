"""Browser Host / Origin policy shared by the HTTP guard and WebSocket auth.

One source of truth for which browser origins may drive this server, so the
ASGI ``LocalOriginGuardMiddleware`` (HTTP and WebSocket scopes) and the
per-endpoint WebSocket handshake gate (``websocket_auth``) can never drift:

* **Host**: the Host hostname must be loopback (``localhost``,
  ``*.localhost``, ``127.0.0.0/8``, ``::1``) or listed in
  ``ECHO_ALLOWED_HOSTS``. This defeats DNS rebinding of an unauthenticated
  local server.
* **Origin**: when present, the Origin must be first-party (the packaged
  Electron ``echo-app://app`` scheme), listed in ``ECHO_ALLOWED_ORIGINS``,
  loopback over HTTP(S)/Capacitor (any port), or equal to the request's own
  origin. ``Origin: null`` and unparsable values are refused. A missing
  Origin is allowed: browsers always send one on WebSocket handshakes and
  cross-origin POSTs, so its absence means a non-browser client.

Both allowlists are comma-separated and re-read per request so an operator
(or a test harness) can adjust them without rebuilding the app.
"""

from __future__ import annotations

import ipaddress
import os
from collections.abc import Mapping
from functools import lru_cache
from typing import Any
from urllib.parse import urlsplit

ALLOWED_HOSTS_ENV = "ECHO_ALLOWED_HOSTS"
ALLOWED_ORIGINS_ENV = "ECHO_ALLOWED_ORIGINS"

# The packaged Electron shell serves the renderer from this privileged
# custom scheme (frontend/electron/desktop-protocol.cjs). No web page can
# claim it, so it is first-party by construction.
FIRST_PARTY_ORIGINS = frozenset({"echo-app://app"})

_LOOPBACK_ORIGIN_SCHEMES = frozenset({"http", "https", "capacitor"})


def _clean_host(host: str) -> str:
    return host.strip().lower().rstrip(".").strip("[]")


def host_from_header(value: str) -> str:
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


def normalize_origin(value: str) -> str:
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


@lru_cache(maxsize=8)
def _parse_hosts(raw: str) -> frozenset[str]:
    return frozenset(h for h in (host_from_header(part) for part in raw.split(",")) if h)


@lru_cache(maxsize=8)
def _parse_origins(raw: str) -> frozenset[str]:
    return frozenset(o for o in (normalize_origin(part) for part in raw.split(",")) if o)


def allowed_hosts() -> frozenset[str]:
    return _parse_hosts(os.environ.get(ALLOWED_HOSTS_ENV, ""))


def allowed_origins() -> frozenset[str]:
    return _parse_origins(os.environ.get(ALLOWED_ORIGINS_ENV, ""))


def scope_header(scope: Mapping[str, Any], name: bytes) -> str | None:
    """Return one raw ASGI header (latin-1 decoded), or ``None`` if absent."""
    for key, value in scope.get("headers") or ():
        if key.lower() == name:
            return value.decode("latin-1")
    return None


def host_rejection(scope: Mapping[str, Any], *, require_local_host: bool) -> str | None:
    """Reason to refuse the request's Host, or ``None`` when it is allowed."""
    hosts = allowed_hosts()
    raw_host = scope_header(scope, b"host")
    request_host = host_from_header(raw_host) if raw_host is not None else ""
    # A missing Host (HTTP/1.0, raw ASGI callers) cannot be a rebinding
    # browser; a present one must be local or explicitly allowed.
    if (
        (require_local_host or hosts)
        and raw_host is not None
        and not (is_loopback_hostname(request_host) or request_host in hosts)
    ):
        return "host not allowed"
    return None


def origin_rejection(scope: Mapping[str, Any]) -> str | None:
    """Reason to refuse the browser Origin, or ``None`` when it is allowed."""
    origin = scope_header(scope, b"origin")
    if origin is None:
        return None
    normalized = normalize_origin(origin)
    if not normalized:
        return "origin not allowed"
    if normalized in FIRST_PARTY_ORIGINS or normalized in allowed_origins():
        return None
    parts = urlsplit(normalized)
    if parts.scheme in _LOOPBACK_ORIGIN_SCHEMES and is_loopback_hostname(parts.hostname or ""):
        return None
    raw_scheme = str(scope.get("scheme") or "")
    scheme = {"ws": "http", "wss": "https"}.get(raw_scheme, raw_scheme)
    raw_host = scope_header(scope, b"host")
    if raw_host and normalized == normalize_origin(f"{scheme}://{raw_host}"):
        return None
    return "origin not allowed"


__all__ = [
    "ALLOWED_HOSTS_ENV",
    "ALLOWED_ORIGINS_ENV",
    "FIRST_PARTY_ORIGINS",
    "allowed_hosts",
    "allowed_origins",
    "host_from_header",
    "host_rejection",
    "is_loopback_hostname",
    "normalize_origin",
    "origin_rejection",
    "scope_header",
]
