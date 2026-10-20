"""Direct unit coverage for the cloud-edge token/password core.

``runtime/cloud_edge/security.py`` signs every device token and verifies every
account password in the cloud-edge surface, yet nothing tested it directly:
its behaviour was only ever observed through the router, where a token that
fails to decode looks identical to one that is missing.  A security core that
is only exercised end-to-end has no net for the failure modes that matter —
tampered signatures, wrong issuers, expired claims, malformed input.

The encoding is hand-rolled (base64url segments + HMAC-SHA256), so these tests
pin the *contract* rather than the implementation: round-trip fidelity,
rejection of every tampering vector, and — see ``test_non_object_claims_raise_token_error``
— that a malformed token fails closed instead of crashing the caller.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

import pytest

from runtime.cloud_edge.security import (
    TokenError,
    decode_token,
    encode_token,
    hash_password,
    secret_digest,
    verify_password,
)

SECRET = "cloud-edge-security-unit-secret"
OTHER_SECRET = "a-completely-different-secret"
ISSUER = "echo-cloud-edge"
AUDIENCE = "echo-devices"


def _b64url(raw: bytes) -> str:
    """The signer's own base64url encoding, without touching private helpers."""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _token(claims: dict[str, Any], *, secret: str = SECRET) -> str:
    return encode_token(claims, secret)


def _valid_claims(**overrides: Any) -> dict[str, Any]:
    claims = {
        "sub": "device-42",
        "iss": ISSUER,
        "aud": AUDIENCE,
        "exp": int(time.time()) + 3600,
    }
    claims.update(overrides)
    return claims


def test_token_round_trip_preserves_every_claim() -> None:
    claims = _valid_claims(scope="pairing", nested={"device": ["a", "b"]})

    decoded = decode_token(_token(claims), secret=SECRET, issuer=ISSUER, audience=AUDIENCE)

    assert decoded == claims


def test_tampered_payload_is_rejected_even_with_the_right_secret() -> None:
    header, payload, signature = _token(_valid_claims()).split(".")
    forged = f"{header}.{payload}x.{signature}"

    with pytest.raises(TokenError):
        decode_token(forged, secret=SECRET, issuer=ISSUER, audience=AUDIENCE)


def test_token_signed_with_a_different_secret_is_rejected() -> None:
    token = _token(_valid_claims(), secret=OTHER_SECRET)

    with pytest.raises(TokenError):
        decode_token(token, secret=SECRET, issuer=ISSUER, audience=AUDIENCE)


def test_issuer_and_audience_must_match_the_verifier() -> None:
    token = _token(_valid_claims())

    with pytest.raises(TokenError):
        decode_token(token, secret=SECRET, issuer="someone-else", audience=AUDIENCE)
    with pytest.raises(TokenError):
        decode_token(token, secret=SECRET, issuer=ISSUER, audience="someone-else")


def test_expired_token_is_rejected_and_a_fresh_one_is_accepted() -> None:
    expired = _token(_valid_claims(exp=int(time.time()) - 1))

    with pytest.raises(TokenError):
        decode_token(expired, secret=SECRET, issuer=ISSUER, audience=AUDIENCE)
    # The same claims, re-issued with a live expiry, decode cleanly.
    decode_token(
        _token(_valid_claims(exp=int(time.time()) + 1)),
        secret=SECRET,
        issuer=ISSUER,
        audience=AUDIENCE,
    )


def test_missing_expiry_is_rejected_not_ignored() -> None:
    # ``exp`` defaults to 0 inside decode_token, which is in the past, so a
    # claim set without one must never be treated as eternally valid.
    token = _token({"sub": "device-42", "iss": ISSUER, "aud": AUDIENCE})

    with pytest.raises(TokenError):
        decode_token(token, secret=SECRET, issuer=ISSUER, audience=AUDIENCE)


@pytest.mark.parametrize(
    "malformed",
    [
        "",
        "not-a-token",
        "only.two",
        "a.b.c.d",
        "!!!.$$$.%^&",
    ],
)
def test_structural_malformations_raise_token_error(malformed: str) -> None:
    # Failing closed means a typed error, not an AttributeError/ValueError that
    # escapes the caller and turns a bad request into a 500.
    with pytest.raises(TokenError):
        decode_token(malformed, secret=SECRET, issuer=ISSUER, audience=AUDIENCE)


def test_non_object_claims_raise_token_error() -> None:
    # A payload that is valid base64url JSON but not an object: the claims
    # lookup must fail as a token error, not an AttributeError on ``.get``.
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64url(json.dumps(["not", "an", "object"]).encode())
    signature = _b64url(
        hmac.new(SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    )
    token = f"{header}.{payload}.{signature}"

    with pytest.raises(TokenError):
        decode_token(token, secret=SECRET, issuer=ISSUER, audience=AUDIENCE)


def test_password_hash_round_trip_and_rejection() -> None:
    encoded = hash_password("correct horse battery staple")

    assert encoded.startswith("scrypt$")
    assert verify_password("correct horse battery staple", encoded)
    assert not verify_password("wrong password", encoded)


def test_password_hashes_are_salted_so_equal_passwords_differ() -> None:
    first, second = hash_password("same-password"), hash_password("same-password")

    assert first != second
    assert verify_password("same-password", first)
    assert verify_password("same-password", second)


@pytest.mark.parametrize(
    "encoded",
    [
        "",
        "not-a-hash",
        "md5$1$1$1$c2FsdA==$ZGlnZXN0",  # wrong algorithm
        "scrypt$notanint$8$1$c2FsdA==$ZGlnZXN0",  # non-numeric cost
        "scrypt$16384$8$1$!!!$ZGlnZXN0",  # undecodable salt
    ],
)
def test_verify_password_fails_closed_on_unusable_hashes(encoded: str) -> None:
    # A corrupt row in the account store must read as "no match", never raise.
    assert verify_password("any-password", encoded) is False


def test_secret_digest_is_stable_and_input_sensitive() -> None:
    assert secret_digest("value") == secret_digest("value")
    assert secret_digest("value") != secret_digest("other value")
    assert len(secret_digest("value")) == 64
