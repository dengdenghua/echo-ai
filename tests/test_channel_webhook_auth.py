"""Inbound webhook authentication for channels without native signatures.

BlueBubbles / Home Assistant / Open WebUI accept an optional operator shared
secret (fail closed once configured); Google Chat verifies the Google-signed
bearer JWT when ``verification_audience`` is configured.  Also covers the
constant-time secret comparison helper and the inbound router passing query
parameters to adapters that opt in.
"""

from __future__ import annotations

import base64
import json
import time

import pytest

from runtime.adapters.channels import (
    BlueBubblesChannel,
    GoogleChatChannel,
    HomeAssistantChannel,
    OpenWebUIChannel,
)
from runtime.adapters.channels._webhook_auth import (
    WebhookAuthError,
    check_webhook_secret,
    host_allowed,
    secrets_match,
)
from runtime.adapters.channels.google_chat import GoogleChatSignatureError

# ── helpers ────────────────────────────────────────────────────────────


def _bluebubbles(secret: str = "") -> tuple[BlueBubblesChannel, bytes]:
    ch = BlueBubblesChannel(server_url="http://bb.local:3000", api_key="ak", webhook_secret=secret)
    body = json.dumps(
        {
            "data": {
                "message": {
                    "guid": "m1",
                    "text": "hi",
                    "isFromMe": False,
                    "chats": [{"guid": "c1"}],
                    "sender": "s1",
                }
            }
        }
    ).encode()
    return ch, body


def _homeassistant(secret: str = "") -> tuple[HomeAssistantChannel, bytes]:
    ch = HomeAssistantChannel(
        ha_url="http://ha.local", long_lived_token="llt", webhook_secret=secret
    )
    return ch, json.dumps({"message": "door opened", "user_id": "u1"}).encode()


def _open_webui(secret: str = "") -> tuple[OpenWebUIChannel, bytes]:
    ch = OpenWebUIChannel(base_url="http://owui.local", api_key="ak", webhook_secret=secret)
    return ch, json.dumps({"messages": [{"role": "user", "content": "hi"}]}).encode()


_FACTORIES = [_bluebubbles, _homeassistant, _open_webui]


# ── shared-secret channels ─────────────────────────────────────────────


@pytest.mark.parametrize("factory", _FACTORIES)
def test_unconfigured_secret_keeps_legacy_behavior(factory) -> None:
    ch, body = factory()
    ch.handle_webhook(body=body, headers={})  # no exception: unchanged when unset


@pytest.mark.parametrize("factory", _FACTORIES)
def test_configured_secret_rejects_missing_or_wrong(factory) -> None:
    ch, body = factory("s3cret-value")
    with pytest.raises(ValueError, match="signature"):
        ch.handle_webhook(body=body, headers={})
    with pytest.raises(ValueError, match="signature"):
        ch.handle_webhook(body=body, headers={"x-echo-webhook-secret": "nope"})
    with pytest.raises(ValueError, match="signature"):
        ch.handle_webhook(body=body, headers={}, query={"webhook_secret": "nope"})


@pytest.mark.parametrize("factory", _FACTORIES)
@pytest.mark.parametrize(
    "headers, query",
    [
        ({"x-echo-webhook-secret": "s3cret-value"}, None),
        ({"X-Echo-Webhook-Secret": "s3cret-value"}, None),
        ({"authorization": "Bearer s3cret-value"}, None),
        ({}, {"webhook_secret": "s3cret-value"}),
    ],
)
def test_configured_secret_accepts_header_bearer_or_query(factory, headers, query) -> None:
    ch, body = factory("s3cret-value")
    ch.handle_webhook(body=body, headers=headers, query=query)


def test_secrets_match_is_strict() -> None:
    assert secrets_match("abc", "abc")
    assert secrets_match("令牌", "令牌")  # non-ASCII must not raise TypeError
    assert not secrets_match("abc", "abd")
    assert not secrets_match("", "")
    assert not secrets_match(None, "abc")
    assert not secrets_match(123, "123")
    assert not secrets_match("abc", "")


def test_check_webhook_secret_noop_when_unset() -> None:
    check_webhook_secret("", headers={}, query=None)
    with pytest.raises(WebhookAuthError):
        check_webhook_secret("x", headers={}, query=None)


@pytest.mark.parametrize(
    "url, ok",
    [
        ("https://smba.trafficmanager.net/amer/", True),
        ("https://europe.webchat.botframework.com/", True),
        ("https://botframework.com/", False),  # bare apex not in the default list
        ("https://evil.trafficmanager.net/", False),
        ("https://smba.trafficmanager.net:8443/", False),
        ("http://smba.trafficmanager.net/", False),
        ("https://a@smba.trafficmanager.net/", False),
        ("https://xbotframework.com/", False),
        ("not a url", False),
    ],
)
def test_host_allowed(url: str, ok: bool) -> None:
    from runtime.adapters.channels.teams import DEFAULT_SERVICE_URL_HOSTS

    assert host_allowed(url, DEFAULT_SERVICE_URL_HOSTS) is ok


# ── Google Chat JWT ────────────────────────────────────────────────────


def _google_signer():
    import datetime as dt

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding, rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "chat")])
    now = dt.datetime.now(dt.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(1)
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    certs = {"g1": cert.public_bytes(serialization.Encoding.PEM).decode()}

    def _b64(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

    def token(**claims):
        body = {
            "iss": "chat@system.gserviceaccount.com",
            "aud": "1234567890",
            "exp": int(time.time()) + 600,
        }
        body.update(claims)
        header = _b64(json.dumps({"alg": "RS256", "kid": "g1"}).encode())
        payload = _b64(json.dumps(body).encode())
        sig = key.sign(f"{header}.{payload}".encode(), padding.PKCS1v15(), hashes.SHA256())
        return f"{header}.{payload}.{_b64(sig)}"

    return (lambda: certs), token


_GCHAT_EVENT = json.dumps(
    {
        "event": {
            "type": "MESSAGE",
            "message": {"text": "hi", "name": "spaces/s/messages/m"},
            "sender": {"name": "users/1"},
            "space": {"name": "spaces/s"},
        }
    }
).encode()
_SA_KEY = {"client_email": "t@t.iam.gserviceaccount.com", "private_key": "dummy"}


def test_google_chat_without_audience_is_unchanged() -> None:
    ch = GoogleChatChannel(service_account_key=_SA_KEY)
    assert ch.handle_webhook(body=_GCHAT_EVENT, headers={}) is not None


def test_google_chat_verifies_project_number_jwt() -> None:
    certs, token = _google_signer()
    _other_certs, forged = _google_signer()
    ch = GoogleChatChannel(
        service_account_key=_SA_KEY, verification_audience="1234567890", keys_provider=certs
    )
    ok = ch.handle_webhook(body=_GCHAT_EVENT, headers={"authorization": f"Bearer {token()}"})
    assert ok is not None
    for headers in (
        {},
        {"authorization": f"Bearer {forged()}"},
        {"authorization": f"Bearer {token(aud='999')}"},
        {"authorization": f"Bearer {token(iss='someone@else.com')}"},
        {"authorization": f"Bearer {token(exp=1)}"},
    ):
        with pytest.raises(GoogleChatSignatureError):
            ch.handle_webhook(body=_GCHAT_EVENT, headers=headers)


# ── router wiring ──────────────────────────────────────────────────────


def test_inbound_router_passes_query_secret_to_opt_in_adapters() -> None:
    from types import SimpleNamespace

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from runtime.sensing.gateway.channels_router import (
        LocalChannelManager,
        create_channels_router,
    )

    class _Manager(LocalChannelManager):
        def process_inbound(self, _msg):
            return SimpleNamespace(metadata={"duplicate": True, "conversation_id": "c"})

    manager = _Manager()
    ch, body = _homeassistant("s3cret-value")
    manager.register(ch)
    app = FastAPI()
    app.include_router(create_channels_router(manager=manager, require_auth=False, state_path=""))
    client = TestClient(app)

    denied = client.post("/api/channels/homeassistant/inbound", content=body)
    assert denied.status_code == 401
    allowed = client.post(
        "/api/channels/homeassistant/inbound?webhook_secret=s3cret-value", content=body
    )
    assert allowed.status_code == 200
    assert allowed.json()["duplicate"] is True
