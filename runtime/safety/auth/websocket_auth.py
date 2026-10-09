"""One handshake gate for every WebSocket endpoint.

HTTP routes authenticate through :func:`resolve_principal` (``Authorization``
header, the browser-safe ``bearer.b64`` subprotocol, or the HttpOnly session
cookie) and browser Origins are policed by ``LocalOriginGuardMiddleware``.
WebSocket handlers used to re-implement both, each a little differently
(some ignored the cookie or the base64url transport, some accepted before
refusing). :func:`authenticate_websocket` is now the single entry:

1. **Origin** - the exact policy the HTTP guard applies
   (:func:`runtime.safety.auth.origin_policy.origin_rejection`), so a
   cookie-authenticated socket cannot be hijacked cross-site.
2. **Credential** - the endpoint declares what it needs
   (:class:`WebSocketCredential`). ``SESSION`` reuses ``resolve_principal``
   unchanged, so JWT expiry, server-side revocation and API-key checks are
   the HTTP ones. Other kinds must be listed in
   :data:`WEBSOCKET_AUTH_EXEMPTIONS` with the reason they skip the host
   session; ``tests/test_websocket_auth_coverage.py`` enforces that.
3. **Roles** - optional, enforced only when host auth is on (as
   ``require_roles`` does for HTTP).
4. **Refusal** - always before ``accept()``, with close code 1008 (policy
   violation), so no handler state (shell, stream, relay) is ever created.

Callers accept with :attr:`WebSocketAuthResult.subprotocol`; it echoes only
the non-secret auth marker a browser offered, never the token.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Mapping
from contextlib import suppress
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Any

from .origin_policy import origin_rejection
from .principal import CurrentPrincipal, resolve_principal
from .websocket import accepted_auth_subprotocol

try:
    from starlette.exceptions import WebSocketException as _WebSocketException
except ImportError:  # pragma: no cover - keeps the core auth package optional

    class _WebSocketException(Exception):  # type: ignore[no-redef]
        def __init__(self, code: int, reason: str | None = None) -> None:
            super().__init__(reason or "")
            self.code = code
            self.reason = reason or ""


_log = logging.getLogger(__name__)

#: RFC 6455 "policy violation": the one pre-accept refusal code for auth and
#: Origin failures. (Before ``accept()`` the ASGI server answers the upgrade
#: with HTTP 403, so browsers only observe a failed handshake either way.)
WS_POLICY_VIOLATION = 1008

#: ``app.state`` attribute holding the host's :class:`WebSocketAuthConfig`.
APP_STATE_ATTR = "echo_websocket_auth"

OPERATOR_ROLES: tuple[str, ...] = ("admin", "operator")

_REFUSAL_REASONS = {
    "missing Authorization: Bearer <token>": "authentication required",
    "invalid token": "invalid or expired credentials",
    "identity store required for authentication": "authentication unavailable",
}


class WebSocketCredential(StrEnum):
    """What a WebSocket endpoint accepts as proof of identity."""

    #: Host login session or API key, verified before ``accept()``.
    SESSION = "session"
    #: A device credential carried in the endpoint's own first frame (e.g.
    #: tentacle ``device/hello``) and verified by that protocol. The gate
    #: still enforces Origin; the endpoint must refuse unverified devices.
    DEVICE = "device"
    #: No per-connection host credential, permitted only while the host has
    #: published its validated single-user local + loopback posture. Without
    #: host auth it behaves exactly like ``SESSION``.
    TRUSTED_LOCAL = "trusted_local"


@dataclass(frozen=True)
class WebSocketAuthConfig:
    """The host auth settings shared with the HTTP ``resolve_principal``."""

    identity_store: Any = None
    require_auth: bool = False
    jwt_secret: str | None = None
    jwt_issuer: str | None = None
    jwt_audience: str | None = None
    jwt_leeway_seconds: int = 0


@dataclass(frozen=True)
class WebSocketExemption:
    """Why a WebSocket route does not take a host session at the handshake."""

    credential: WebSocketCredential
    reason: str


#: Every WebSocket route that does not use ``WebSocketCredential.SESSION``.
#: A route missing here must refuse an anonymous handshake when host auth is
#: on; ``tests/test_websocket_auth_coverage.py`` fails otherwise.
WEBSOCKET_AUTH_EXEMPTIONS: Mapping[str, WebSocketExemption] = MappingProxyType(
    {
        "/api/tentacle/device/ws": WebSocketExemption(
            WebSocketCredential.DEVICE,
            "Device pairing: phones hold no host login. The first frame must be a "
            "device/hello carrying the shared pairing token or a per-device credential "
            "(TentacleWebSocketServer._check_auth, brute-force throttled); anything "
            "else is closed with 1008 before any other message is processed, and the "
            "route refuses outright when no device token is configured.",
        ),
        "/api/plugins/paper-trading/origin/socket.io/{ws_path:path}": WebSocketExemption(
            WebSocketCredential.TRUSTED_LOCAL,
            "Same-origin relay of the third-party platform's socket.io feed for the "
            "paper-trading iframe. On an authenticated host it exists only with "
            "trusted_single_user_local_proxy on a validated local + loopback "
            "single-user host, mirroring the HTTP /origin exemption in "
            "platform/ui/_app_auth.py; otherwise it requires a host session. The "
            "upstream credential is the platform's own sign/token, never Echo's.",
        ),
    }
)


class WebSocketAuthError(_WebSocketException):
    """Refuse a handshake; Starlette closes it with 1008 before ``accept()``."""

    def __init__(self, reason: str) -> None:
        super().__init__(code=WS_POLICY_VIOLATION, reason=reason)


@dataclass(frozen=True)
class WebSocketAuthResult:
    """An admitted handshake: who connected and the subprotocol to accept."""

    principal: CurrentPrincipal | None
    credential: WebSocketCredential
    subprotocol: str | None

    @property
    def actor_id(self) -> str | None:
        return self.principal.actor_id if self.principal is not None else None

    @property
    def tenant_id(self) -> str | None:
        return self.principal.tenant_id if self.principal is not None else None


def _connection_scope(connection: Any) -> Mapping[str, Any]:
    scope = getattr(connection, "scope", None)
    return scope if isinstance(scope, Mapping) else {}


def websocket_auth_config_from_app(app: Any) -> WebSocketAuthConfig:
    """The host's config, published by ``setup_app`` on ``app.state``.

    Embedders that never ran ``setup_app`` still fail closed when they
    declared host auth (``app.state.echo_require_auth``): no identity store
    means no credential can verify.
    """

    state = getattr(app, "state", None)
    config = getattr(state, APP_STATE_ATTR, None)
    if isinstance(config, WebSocketAuthConfig):
        return config
    return WebSocketAuthConfig(require_auth=bool(getattr(state, "echo_require_auth", False)))


def _session_principal(connection: Any, config: WebSocketAuthConfig) -> CurrentPrincipal | None:
    try:
        return resolve_principal(
            connection,
            config.identity_store,
            config.require_auth,
            jwt_secret=config.jwt_secret,
            jwt_issuer=config.jwt_issuer,
            jwt_audience=config.jwt_audience,
            jwt_leeway_seconds=config.jwt_leeway_seconds,
        )
    except Exception as exc:
        # resolve_principal reports every authentication failure as an
        # HTTP 401; anything else is a real fault and must not be masked.
        if not isinstance(getattr(exc, "status_code", None), int):
            raise
        detail = str(getattr(exc, "detail", "") or "unauthorized")
        raise WebSocketAuthError(_REFUSAL_REASONS.get(detail, detail[:100])) from exc


def _require_roles(
    principal: CurrentPrincipal | None,
    roles: Iterable[str],
    config: WebSocketAuthConfig,
) -> None:
    allowed = frozenset(str(role).strip().lower() for role in roles if str(role).strip())
    if not allowed or not config.require_auth:
        return
    if principal is None or not principal.roles.intersection(allowed):
        raise WebSocketAuthError(f"{'/'.join(sorted(allowed))} role required")


def _trusted_local_host(connection: Any) -> bool:
    app = _connection_scope(connection).get("app")
    state = getattr(app, "state", None)
    return bool(getattr(state, "echo_allow_local_workspace_access", False))


def check_websocket_auth(
    websocket: Any,
    *,
    config: WebSocketAuthConfig | None = None,
    credential: WebSocketCredential = WebSocketCredential.SESSION,
    roles: Iterable[str] = (),
) -> WebSocketAuthResult:
    """Decide a handshake without touching the socket.

    Raises :class:`WebSocketAuthError` (a Starlette ``WebSocketException``, so
    a FastAPI dependency may simply let it propagate) when the handshake must
    be refused. ``config`` defaults to the host config on ``app.state``.
    """

    reason = origin_rejection(_connection_scope(websocket))
    if reason is not None:
        raise WebSocketAuthError(reason)
    kind = WebSocketCredential(credential)
    resolved = config or websocket_auth_config_from_app(_connection_scope(websocket).get("app"))
    principal: CurrentPrincipal | None = None
    if kind is WebSocketCredential.DEVICE:
        pass  # verified by the endpoint's own device handshake
    elif kind is WebSocketCredential.TRUSTED_LOCAL and resolved.require_auth:
        if not _trusted_local_host(websocket):
            raise WebSocketAuthError("trusted local host required")
    else:
        principal = _session_principal(websocket, resolved)
        _require_roles(principal, roles, resolved)
    return WebSocketAuthResult(
        principal=principal,
        credential=kind,
        subprotocol=accepted_auth_subprotocol(websocket),
    )


def require_connection_principal(
    connection: Any,
    config: WebSocketAuthConfig,
) -> CurrentPrincipal | None:
    """Router-dependency form for routers that mix HTTP and WebSocket routes.

    FastAPI evaluates router-level dependencies for WebSocket routes too.
    HTTP requests go straight to ``resolve_principal`` (401 on failure);
    WebSocket handshakes go through :func:`check_websocket_auth`, whose
    :class:`WebSocketAuthError` Starlette turns into a 1008 close before
    ``accept()``.
    """

    if _connection_scope(connection).get("type") == "websocket":
        return check_websocket_auth(connection, config=config).principal
    return resolve_principal(
        connection,
        config.identity_store,
        config.require_auth,
        jwt_secret=config.jwt_secret,
        jwt_issuer=config.jwt_issuer,
        jwt_audience=config.jwt_audience,
        jwt_leeway_seconds=config.jwt_leeway_seconds,
    )


async def refuse_websocket(websocket: Any, reason: str) -> None:
    """Close a not-yet-accepted handshake with the shared policy code."""

    _log.info(
        "websocket handshake refused %s: %s",
        _connection_scope(websocket).get("path") or "",
        reason,
    )
    with suppress(Exception):
        await websocket.close(code=WS_POLICY_VIOLATION, reason=reason)


async def authenticate_websocket(
    websocket: Any,
    *,
    config: WebSocketAuthConfig | None = None,
    credential: WebSocketCredential = WebSocketCredential.SESSION,
    roles: Iterable[str] = (),
) -> WebSocketAuthResult | None:
    """Authenticate a handshake before ``accept()``; ``None`` means refused.

    On refusal the socket is already closed with 1008 and the caller must
    return without touching it. On success the caller accepts with
    ``result.subprotocol`` and may use ``result.principal`` (``None`` only
    when host auth is off and no credential was presented, or for
    ``DEVICE``/``TRUSTED_LOCAL`` endpoints).
    """

    try:
        return check_websocket_auth(websocket, config=config, credential=credential, roles=roles)
    except WebSocketAuthError as exc:
        await refuse_websocket(websocket, str(exc.reason or "unauthorized"))
        return None


__all__ = [
    "APP_STATE_ATTR",
    "OPERATOR_ROLES",
    "WEBSOCKET_AUTH_EXEMPTIONS",
    "WS_POLICY_VIOLATION",
    "WebSocketAuthConfig",
    "WebSocketAuthError",
    "WebSocketAuthResult",
    "WebSocketCredential",
    "WebSocketExemption",
    "authenticate_websocket",
    "check_websocket_auth",
    "refuse_websocket",
    "require_connection_principal",
    "websocket_auth_config_from_app",
]
