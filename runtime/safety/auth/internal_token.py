"""Internal, same-process service token for agent→gateway calls.

Why this exists
----------------

Some skill handlers (e.g. the computer-automation bridge in
``runtime.execution.suckers.computer_api_skills``) call back into the
*local* gateway over loopback HTTP (``http://127.0.0.1:8310/api/...``)
instead of driving the host directly.  When the gateway runs with
``require_auth=True`` (the packaged desktop app does), those loopback
calls hit the auth gate and get rejected with ``401 missing
Authorization: Bearer <token>`` — the very failure that broke the
``computer_observe`` tool.

The bridge is an *internal* caller living in the same backend process,
so it can mint a short-lived JWT signed with the gateway's own
``jwt_secret``.  As long as the subject is a registered identity (and
carries an operator/admin role when the route demands one — the desktop
config grants admin to every local login via ``admin_usernames: ["*"]``),
the gateway accepts the call exactly as it would an external client's.

Design notes
------------

* Process-wide singleton: the backend is a single process and its app
  context is built once, so a module-level signer config is sufficient.
* Nothing is forged for anonymous/dev runs: ``require_auth=False`` means
  the gateway never checks, and if no signer is configured we simply
  send no header (status quo, no regression).
* The token is scoped to ``aud`` ``echo:internal-bridge`` so it is
  distinct from user-facing session tokens and cannot be replayed
  against unrelated routes that don't require that audience.  The
  gateway's ``verify_jwt`` requires the matching ``aud`` only when the
  router was created with a ``jwt_audience``; we therefore mirror the
  gateway's own issuer/audience so the token is accepted there.
"""

from __future__ import annotations

import time

from .identity import encode_jwt_hs256

# Process-wide signer config, populated exactly once at app setup.
_signer_secret: str | None = None
_signer_issuer: str | None = None
_signer_audience: str | None = None


def configure_internal_token_signer(
    *,
    secret: str | None,
    issuer: str | None = None,
    audience: str | None = None,
) -> None:
    """Install the JWT signer used for internal loopback calls.

    Called from ``runtime.platform.ui._app_setup`` after the gateway
    ``jwt_secret``/``jwt_issuer``/``jwt_audience`` are resolved.  Passing
    ``secret=None`` (or nothing) disables signing — callers then send no
    Authorization header and rely on the gateway's friction-free path.
    """
    global _signer_secret, _signer_issuer, _signer_audience
    _signer_secret = secret or None
    _signer_issuer = issuer or None
    _signer_audience = audience or None


def internal_token_signer_configured() -> bool:
    """Whether an internal signer secret is currently installed."""
    return bool(_signer_secret)


def mint_internal_session_token(
    actor: str | None,
    *,
    lifetime_seconds: int = 120,
) -> str | None:
    """Mint a short-lived internal JWT for *actor*, or ``None``.

    Returns ``None`` when no signer is configured or the actor is unknown
    (callers should then send no header — identical to the pre-fix
    behaviour, so there is no regression in anonymous/dev runs).
    """
    if not _signer_secret or not actor:
        return None
    now = int(time.time())
    claims: dict[str, object] = {
        "sub": actor,
        "iat": now,
        "exp": now + max(1, lifetime_seconds),
        "provider": "echo-internal-bridge",
    }
    if _signer_issuer is not None:
        claims["iss"] = _signer_issuer
    if _signer_audience is not None:
        claims["aud"] = _signer_audience
    return encode_jwt_hs256(claims, secret=_signer_secret)


__all__ = [
    "configure_internal_token_signer",
    "internal_token_signer_configured",
    "mint_internal_session_token",
]
