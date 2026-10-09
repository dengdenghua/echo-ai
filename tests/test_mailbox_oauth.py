import base64
import hashlib
import time
import urllib.error
import urllib.parse
import urllib.request
from unittest.mock import MagicMock

import pytest

from runtime.platform import mailbox_oauth as oauth
from runtime.platform.connectors.credential_store import CredentialStore
from runtime.platform.mailbox import MailboxService, MailError


@pytest.fixture
def svc(tmp_path):
    return MailboxService("alice", CredentialStore(root=tmp_path))


@pytest.fixture
def google(monkeypatch):
    mock = MagicMock(
        side_effect=lambda url, **kwargs: (
            {"email": "alice@gmail.com", "email_verified": True}
            if "userinfo" in url
            else {
                "access_token": "access-secret",
                "refresh_token": "refresh-secret",
                "scope": oauth.MAIL_SCOPE,
                "expires_in": 3600,
            }
        )
    )
    monkeypatch.setattr(oauth, "google_json", mock)
    return mock


def configured(svc):
    oauth.configure(svc, "client.apps.googleusercontent.com", "client-secret")
    return oauth.client_config(svc)


def test_loopback_pkce_state_and_owner_binding(svc, google):
    configured(svc)
    started = oauth.start(svc)
    try:
        params = urllib.parse.parse_qs(urllib.parse.urlsplit(started["authorization_url"]).query)
        flow = oauth._flows[started["flow_id"]]
        expected = (
            base64.urlsafe_b64encode(hashlib.sha256(flow.verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        assert params["code_challenge"] == [expected]
        assert params["code_challenge_method"] == ["S256"]
        assert params["redirect_uri"][0].startswith("http://127.0.0.1:")
        with pytest.raises(MailError):
            oauth.flow_status(MailboxService("bob", svc.store), started["flow_id"])
        with pytest.raises(urllib.error.HTTPError) as failure:
            urllib.request.urlopen(flow.redirect_uri + "?state=wrong&code=code", timeout=5)
        assert failure.value.code == 400
        assert flow.status == "pending"
        google.assert_not_called()
        verifier = flow.verifier
        url = (
            flow.redirect_uri
            + "?"
            + urllib.parse.urlencode({"state": flow.state, "code": "valid-code"})
        )
        with urllib.request.urlopen(url, timeout=5) as response:
            assert response.status == 200
            assert response.headers["Cache-Control"] == "no-store"
        assert oauth.flow_status(svc, started["flow_id"])["status"] == "connected"
        assert google.call_args_list[0].kwargs["form"]["code_verifier"] == verifier
        assert svc.accounts() == [
            {
                "id": hashlib.sha256(b"alice@gmail.com").hexdigest()[:24],
                "email": "alice@gmail.com",
                "provider": "gmail",
                "auth_type": "oauth",
            }
        ]
        assert "refresh-secret" not in str(svc.accounts())
    finally:
        oauth.flow_status(svc, started["flow_id"], cancel=True)


def test_cancel_and_replay_cannot_exchange_tokens(svc, google):
    config = configured(svc)
    flow = oauth.Flow(
        svc.namespace,
        "state",
        "verifier",
        time.monotonic() + 60,
        redirect_uri="http://127.0.0.1:1/oauth2/callback",
    )
    oauth.finish(svc, flow, config, {"state": ["state"], "code": ["code"]})
    calls = google.call_count
    with pytest.raises(MailError):
        oauth.finish(svc, flow, config, {"state": ["state"], "code": ["replay"]})
    assert google.call_count == calls
    flow.status = "cancelled"
    with pytest.raises(MailError):
        oauth.finish(svc, flow, config, {"state": ["state"], "code": ["again"]})
    assert google.call_count == calls


def test_denied_or_missing_scope_does_not_save_account(svc, google):
    config = configured(svc)
    flow = oauth.Flow(svc.namespace, "state", "verifier", time.monotonic() + 60)
    with pytest.raises(MailError, match="取消"):
        oauth.finish(svc, flow, config, {"state": ["state"], "error": ["access_denied"]})
    assert flow.status == "error"
    google.assert_not_called()
    with pytest.raises(MailError, match="权限"):
        oauth.save_grant(
            svc, config, {"scope": "openid email", "access_token": "a", "refresh_token": "r"}
        )
    assert svc.accounts() == []


def test_refresh_is_persisted_without_leaking_tokens(svc, google):
    config = configured(svc)
    oauth.save_grant(
        svc,
        config,
        {
            "scope": oauth.MAIL_SCOPE,
            "access_token": "old",
            "refresh_token": "refresh-secret",
            "expires_in": -1,
        },
    )
    account = svc._get("account:" + svc.accounts()[0]["id"])
    assert oauth.access_token(svc, account) == "access-secret"
    calls = google.call_count
    assert oauth.access_token(svc, account) == "access-secret"
    assert google.call_count == calls
    assert google.call_args.kwargs["form"]["grant_type"] == "refresh_token"
    svc.disconnect(account["id"])
    with pytest.raises(MailError):
        oauth.access_token(svc, account)
    assert svc.accounts() == []


def test_oauth_used_for_imap_and_smtp_not_password(svc, google, monkeypatch):
    oauth.save_grant(
        svc,
        configured(svc),
        {
            "scope": oauth.MAIL_SCOPE,
            "access_token": "access-secret",
            "refresh_token": "refresh-secret",
        },
    )
    account = svc._get("account:" + svc.accounts()[0]["id"])
    imap = MagicMock()
    monkeypatch.setattr("runtime.platform.mailbox.imaplib.IMAP4_SSL", lambda *args, **kwargs: imap)
    with svc._imap(account):
        pass
    imap.login.assert_not_called()
    mechanism, callback = imap.authenticate.call_args.args
    assert mechanism == "XOAUTH2"
    assert b"auth=Bearer access-secret\x01" in callback(b"")
    assert callback(b"error") == b""
    smtp = MagicMock()
    svc._smtp_login(smtp, account)
    smtp.login.assert_not_called()
    mechanism, callback = smtp.auth.call_args.args
    assert mechanism == "XOAUTH2"
    assert "auth=Bearer access-secret\x01" in callback()
