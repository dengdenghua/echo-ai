"""Shared inbound-webhook authentication helpers for channel adapters.

Three building blocks:

* :func:`secrets_match` — constant-time comparison for shared secrets/tokens
  (never compare secrets with ``==``/``!=``).
* :func:`check_webhook_secret` — optional operator-configured shared secret for
  platforms that cannot sign their webhooks.  Accepted from the
  ``X-Echo-Webhook-Secret`` header, ``Authorization: Bearer <secret>``, or the
  ``webhook_secret`` query parameter (for platforms whose webhook config only
  takes a URL).  When a secret is configured it is always required.
* :func:`verify_rs256_jwt` + :class:`RemoteKeySet` — RS256 JWT verification
  against a remotely published key set (Bot Framework JWKS, Google certs),
  implemented on ``cryptography`` (a core dependency) so no extra JWT package
  is needed.

Every rejection raises a ``ValueError`` subclass whose message contains the
word "signature" so the inbound router maps it to HTTP 401.
"""

from __future__ import annotations

import base64
import hmac
import json
import threading
import time
from collections.abc import Callable, Iterable, Mapping
from typing import Any
from urllib.parse import urlsplit

WEBHOOK_SECRET_HEADER = "x-echo-webhook-secret"
WEBHOOK_SECRET_QUERY = "webhook_secret"


class WebhookAuthError(ValueError):
    """Inbound webhook failed authentication (maps to HTTP 401)."""


def secrets_match(provided: Any, expected: Any) -> bool:
    """Constant-time secret comparison; empty/non-string values never match."""
    if not isinstance(provided, str) or not isinstance(expected, str):
        return False
    if not provided or not expected:
        return False
    return hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8"))


def header_value(headers: Mapping[str, str] | None, name: str) -> str:
    """Case-insensitive header lookup (the router lower-cases, tests may not)."""
    if not headers:
        return ""
    target = name.lower()
    for key, value in headers.items():
        if str(key).lower() == target:
            return str(value or "")
    return ""


def bearer_token(headers: Mapping[str, str] | None) -> str:
    raw = header_value(headers, "authorization").strip()
    if raw[:7].lower() == "bearer ":
        return raw[7:].strip()
    return ""


def check_webhook_secret(
    expected: str,
    *,
    headers: Mapping[str, str] | None,
    query: Mapping[str, str] | None = None,
    error_cls: type[ValueError] = WebhookAuthError,
) -> None:
    """Require the configured shared secret when one is set (fail closed)."""
    if not expected:
        return
    candidates = [
        header_value(headers, WEBHOOK_SECRET_HEADER),
        bearer_token(headers),
        str((query or {}).get(WEBHOOK_SECRET_QUERY) or ""),
    ]
    # Evaluate every candidate so timing does not reveal which one matched.
    matched = False
    for candidate in candidates:
        matched = secrets_match(candidate, expected) or matched
    if not matched:
        raise error_cls("webhook secret signature mismatch")


def host_allowed(url: str, allowed_hosts: Iterable[str]) -> bool:
    """True when *url* is https and its host matches the allowlist.

    Entries starting with ``.`` match that domain's subdomains
    (``.botframework.com`` matches ``smba.botframework.com``); other entries
    must equal the host exactly.  Userinfo and non-default ports are refused.
    """
    try:
        parts = urlsplit(str(url or "").strip())
        port = parts.port
    except ValueError:
        return False
    if parts.scheme.lower() != "https" or parts.username or parts.password:
        return False
    if port not in (None, 443):
        return False
    host = (parts.hostname or "").lower().rstrip(".")
    if not host:
        return False
    for entry in allowed_hosts:
        pattern = str(entry or "").strip().lower()
        if not pattern:
            continue
        if pattern.startswith("."):
            if host.endswith(pattern) and len(host) > len(pattern):
                return True
        elif host == pattern:
            return True
    return False


# ── RS256 JWT verification ───────────────────────────────────────────


def _b64url_decode(segment: str) -> bytes:
    padded = segment + "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def _b64url_uint(segment: str) -> int:
    return int.from_bytes(_b64url_decode(segment), "big")


def rsa_key_from_jwk(jwk: Mapping[str, Any]) -> Any:
    from cryptography.hazmat.primitives.asymmetric import rsa

    if jwk.get("kty") != "RSA":
        raise ValueError("unsupported JWK key type")
    n = jwk.get("n")
    e = jwk.get("e")
    if not isinstance(n, str) or not isinstance(e, str):
        raise ValueError("JWK missing modulus/exponent")
    return rsa.RSAPublicNumbers(_b64url_uint(e), _b64url_uint(n)).public_key()


def rsa_key_from_pem_cert(pem: str) -> Any:
    from cryptography import x509

    return x509.load_pem_x509_certificate(pem.encode("utf-8")).public_key()


def keys_from_jwks(jwks: Mapping[str, Any]) -> dict[str, tuple[Any, dict[str, Any]]]:
    keys: dict[str, tuple[Any, dict[str, Any]]] = {}
    for jwk in jwks.get("keys") or ():
        if not isinstance(jwk, dict):
            continue
        kid = jwk.get("kid")
        if not isinstance(kid, str) or not kid:
            continue
        try:
            keys[kid] = (rsa_key_from_jwk(jwk), dict(jwk))
        except (ValueError, TypeError):
            continue
    return keys


def keys_from_x509_map(certs: Mapping[str, Any]) -> dict[str, tuple[Any, dict[str, Any]]]:
    keys: dict[str, tuple[Any, dict[str, Any]]] = {}
    for kid, pem in certs.items():
        if not isinstance(kid, str) or not isinstance(pem, str):
            continue
        try:
            keys[kid] = (rsa_key_from_pem_cert(pem), {})
        except (ValueError, TypeError):
            continue
    return keys


class RemoteKeySet:
    """Thread-safe cache of ``kid -> (public_key, jwk)`` from a remote source.

    Refreshes every ``max_age`` seconds and on an unknown ``kid`` — but at most
    once per ``min_refresh_interval`` so forged ``kid`` values cannot turn every
    request into an outbound fetch.
    """

    def __init__(
        self,
        fetch: Callable[[], dict[str, tuple[Any, dict[str, Any]]]],
        *,
        max_age: float = 24 * 3600.0,
        min_refresh_interval: float = 300.0,
    ) -> None:
        self._fetch = fetch
        self._max_age = max_age
        self._min_refresh_interval = min_refresh_interval
        self._keys: dict[str, tuple[Any, dict[str, Any]]] = {}
        self._fetched_at = 0.0
        self._last_attempt = 0.0
        self._lock = threading.Lock()

    def _refresh_locked(self, now: float) -> None:
        self._last_attempt = now
        keys = self._fetch()
        if keys:
            self._keys = dict(keys)
            self._fetched_at = now

    def get(self, kid: str) -> tuple[Any, dict[str, Any]] | None:
        now = time.monotonic()
        with self._lock:
            stale = not self._keys or now - self._fetched_at > self._max_age
            missing = kid not in self._keys
            may_refresh = (
                self._last_attempt == 0.0 or now - self._last_attempt >= self._min_refresh_interval
            )
            if (stale or missing) and may_refresh:
                try:
                    self._refresh_locked(now)
                except Exception:  # noqa: BLE001 — keep serving cached keys on fetch failure
                    if not self._keys:
                        raise
            return self._keys.get(kid)


def verify_rs256_jwt(
    token: str,
    *,
    resolve_key: Callable[[str], tuple[Any, dict[str, Any]] | None],
    issuers: Iterable[str],
    audiences: Iterable[str],
    leeway_seconds: float = 300.0,
    now: float | None = None,
    error_cls: type[ValueError] = WebhookAuthError,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Verify an RS256 JWT and return ``(claims, jwk)``; raise *error_cls* otherwise."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    def fail(reason: str) -> ValueError:
        return error_cls(f"token signature verification failed: {reason}")

    if not isinstance(token, str) or token.count(".") != 2:
        raise fail("malformed token")
    header_b64, payload_b64, sig_b64 = token.split(".")
    try:
        header = json.loads(_b64url_decode(header_b64))
        claims = json.loads(_b64url_decode(payload_b64))
        signature = _b64url_decode(sig_b64)
    except (ValueError, UnicodeDecodeError) as exc:
        raise fail("undecodable token") from exc
    if not isinstance(header, dict) or not isinstance(claims, dict):
        raise fail("malformed token")
    # Pin the algorithm: never honour "none"/HS256 key-confusion tricks.
    if header.get("alg") != "RS256":
        raise fail("unexpected alg")
    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        raise fail("missing kid")
    try:
        resolved = resolve_key(kid)
    except Exception as exc:  # noqa: BLE001 — key fetch errors must fail closed
        raise fail("signing keys unavailable") from exc
    if resolved is None:
        raise fail("unknown signing key")
    public_key, jwk = resolved
    try:
        public_key.verify(
            signature,
            f"{header_b64}.{payload_b64}".encode("ascii"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
    except (InvalidSignature, ValueError, TypeError) as exc:
        raise fail("bad signature") from exc

    current = time.time() if now is None else now
    issuer_set = {str(i) for i in issuers if i}
    if claims.get("iss") not in issuer_set:
        raise fail("unexpected issuer")
    aud = claims.get("aud")
    aud_values = {aud} if isinstance(aud, str) else set(aud) if isinstance(aud, list) else set()
    if not aud_values.intersection({str(a) for a in audiences if a}):
        raise fail("unexpected audience")
    exp = claims.get("exp")
    if not isinstance(exp, (int, float)) or current > float(exp) + leeway_seconds:
        raise fail("token expired")
    nbf = claims.get("nbf")
    if isinstance(nbf, (int, float)) and current < float(nbf) - leeway_seconds:
        raise fail("token not yet valid")
    return claims, jwk


__all__ = [
    "WEBHOOK_SECRET_HEADER",
    "WEBHOOK_SECRET_QUERY",
    "RemoteKeySet",
    "WebhookAuthError",
    "bearer_token",
    "check_webhook_secret",
    "header_value",
    "host_allowed",
    "keys_from_jwks",
    "keys_from_x509_map",
    "rsa_key_from_jwk",
    "secrets_match",
    "verify_rs256_jwt",
]
