import smtplib
from email.message import EmailMessage
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.platform.connectors.credential_store import CredentialStore
from runtime.platform.mailbox import MailboxService, MailError, parse_message
from runtime.sensing.gateway.mailbox_router import create_mailbox_router


@pytest.fixture
def store(tmp_path):
    return CredentialStore(root=tmp_path)


def account(svc, name="person@gmail.com"):
    item = {"id": "gmail", "email": name, "password": "abcdefghijklmnop", "provider": "gmail"}
    svc._put("account:gmail", item)
    return item


def test_accounts_and_drafts_are_encrypted_and_owner_isolated(store, tmp_path):
    alice, bob = MailboxService("alice", store), MailboxService("bob", store)
    account(alice)
    alice.save_draft({"body": "private draft text"})
    assert alice.accounts() == [{"id": "gmail", "email": "person@gmail.com", "provider": "gmail"}]
    assert bob.accounts() == []
    assert bob.drafts() == []
    with pytest.raises(MailError):
        bob.message("gmail", "inbox", "1-1")
    stored = (tmp_path / "credentials.v1.json").read_text()
    assert "abcdefghijklmnop" not in stored
    assert "private draft text" not in stored
    alice.disconnect("gmail")
    assert alice.accounts() == []


def test_html_mail_becomes_inert_text_and_attachment_names():
    msg = EmailMessage()
    msg["Subject"] = "会议安排"
    msg["From"] = "Person <person@example.com>"
    msg.set_content(
        '<p>周五开会</p><script>steal()</script><img src="https://tracker.test/pixel">',
        subtype="html",
    )
    msg.add_attachment(b"report", maintype="application", subtype="pdf", filename="report.pdf")
    result = parse_message(msg.as_bytes(), uid="1-2", account_id="gmail")
    assert "周五开会" in result["body"]
    assert "steal" not in result["body"]
    assert "tracker" not in result["body"]
    assert result["attachments"] == ["report.pdf"]


def test_mailbox_uid_validity_prevents_stale_message_reads(store, monkeypatch):
    svc = MailboxService("alice", store)
    account(svc)
    imap = MagicMock()
    imap.select.return_value = ("OK", [b"1"])
    imap.response.return_value = ("UIDVALIDITY", [b"2"])
    monkeypatch.setattr("runtime.platform.mailbox.imaplib.IMAP4_SSL", lambda *a, **kw: imap)
    with pytest.raises(MailError, match="已更新"):
        svc.message("gmail", "inbox", "1-123")
    imap.uid.assert_not_called()


def test_list_fetches_headers_without_marking_read(store, monkeypatch):
    svc = MailboxService("alice", store)
    account(svc)
    imap = MagicMock()
    imap.select.return_value = ("OK", [b"1"])
    imap.response.return_value = ("UIDVALIDITY", [b"2"])
    imap.uid.side_effect = [
        ("OK", [b"123"]),
        ("OK", [(b"1 (UID 123 FLAGS (\\Seen))", b"Subject: Hello\r\n\r\n")]),
    ]
    monkeypatch.setattr("runtime.platform.mailbox.imaplib.IMAP4_SSL", lambda *a, **kw: imap)
    result = svc.messages("gmail", "inbox")
    assert result["messages"][0]["id"] == "2-123"
    assert result["messages"][0]["read"]
    assert "BODY.PEEK" in imap.uid.call_args.args[-1]
    imap.select.assert_called_once_with("INBOX", readonly=True)


def test_send_is_idempotent_and_replies_have_thread_headers(store, monkeypatch):
    svc = MailboxService("alice", store)
    account(svc)
    smtp = MagicMock()
    smtp.__enter__.return_value = smtp
    smtp.send_message.return_value = {}
    monkeypatch.setattr("runtime.platform.mailbox.smtplib.SMTP_SSL", lambda *a, **kw: smtp)
    draft = svc.save_draft(
        {
            "account_id": "gmail",
            "to": "recipient@example.com",
            "subject": "Re: Meeting",
            "body": "Confirmed",
            "reply_message_id": "<original@example.com>",
        }
    )
    first = svc.send(draft, "request123")
    assert svc.send(draft, "request123") == first
    smtp.send_message.assert_called_once()
    assert smtp.send_message.call_args.args[0]["In-Reply-To"] == "<original@example.com>"
    assert svc.drafts() == []


@pytest.mark.parametrize("failure", [smtplib.SMTPServerDisconnected("uncertain"), TimeoutError()])
def test_ambiguous_delivery_cannot_send_twice(store, monkeypatch, failure):
    svc = MailboxService("alice", store)
    account(svc)
    smtp = MagicMock()
    smtp.__enter__.return_value = smtp
    smtp.send_message.side_effect = failure
    monkeypatch.setattr("runtime.platform.mailbox.smtplib.SMTP_SSL", lambda *a, **kw: smtp)
    draft = {
        "account_id": "gmail",
        "to": "recipient@example.com",
        "subject": "Hello",
        "body": "Body",
    }
    with pytest.raises(type(failure)):
        svc.send(draft, "request123")
    with pytest.raises(MailError, match="避免重复"):
        svc.send(draft, "request123")
    smtp.send_message.assert_called_once()


@pytest.mark.parametrize(
    "failure",
    [
        smtplib.SMTPRecipientsRefused({"bad@example.com": (550, b"No such user")}),
        smtplib.SMTPSenderRefused(550, b"Sender rejected", "person@gmail.com"),
        smtplib.SMTPDataError(554, b"Message rejected"),
    ],
)
def test_explicit_rejection_allows_corrected_draft_retry(store, monkeypatch, failure):
    svc = MailboxService("alice", store)
    account(svc)
    smtp = MagicMock()
    smtp.__enter__.return_value = smtp
    smtp.send_message.side_effect = [failure, {}]
    monkeypatch.setattr("runtime.platform.mailbox.smtplib.SMTP_SSL", lambda *a, **kw: smtp)
    draft = svc.save_draft(
        {
            "account_id": "gmail",
            "to": "bad@example.com",
            "subject": "Hello",
            "body": "Body",
        }
    )
    with pytest.raises(type(failure)):
        svc.send(draft, draft["id"])
    assert svc.drafts() == [draft]
    assert svc._get("send:" + draft["id"])["status"] == "failed"
    draft["to"] = "corrected@example.com"
    result = svc.send(draft, draft["id"])
    assert result["status"] == "sent"
    assert smtp.send_message.call_count == 2
    assert str(smtp.send_message.call_args.args[0]["To"]) == "corrected@example.com"
    assert svc.send(draft, draft["id"]) == result
    assert smtp.send_message.call_count == 2
    assert svc.drafts() == []


def test_header_injection_rejected_before_smtp(store):
    svc = MailboxService("alice", store)
    account(svc)
    with pytest.raises(MailError, match="换行"):
        svc.send(
            {
                "account_id": "gmail",
                "to": "recipient@example.com",
                "subject": "hello\r\nBcc: other@example.com",
                "body": "Body",
            },
            "request123",
        )


def test_api_reports_definitive_rejection_and_accepts_corrected_retry(store, monkeypatch):
    svc = MailboxService("alice", store)
    account(svc)
    monkeypatch.setattr("runtime.sensing.gateway.mailbox_router.MailboxService", lambda owner: svc)
    smtp = MagicMock()
    smtp.__enter__.return_value = smtp
    smtp.send_message.side_effect = [
        smtplib.SMTPRecipientsRefused({"bad@example.com": (550, b"No such user")}),
        {},
    ]
    monkeypatch.setattr("runtime.platform.mailbox.smtplib.SMTP_SSL", lambda *a, **kw: smtp)
    app = FastAPI()
    app.include_router(create_mailbox_router())
    payload = {
        "account_id": "gmail",
        "to": "bad@example.com",
        "body": "Hello",
        "request_id": "same-draft-request-id",
    }
    with TestClient(app) as client:
        rejected = client.post("/api/mailbox/send", json=payload)
        assert rejected.status_code == 502
        assert "未发送" in rejected.json()["detail"]
        payload["to"] = "corrected@example.com"
        sent = client.post("/api/mailbox/send", json=payload)
        assert sent.status_code == 200
        assert sent.json()["status"] == "sent"
    assert smtp.send_message.call_count == 2


def test_api_requires_authentication():
    app = FastAPI()
    app.include_router(create_mailbox_router(require_auth=True))
    with TestClient(app) as client:
        assert client.get("/api/mailbox/accounts").status_code == 401


def test_assistant_has_no_tools_and_never_sends(store, monkeypatch):
    svc = MailboxService("alice", store)
    monkeypatch.setattr("runtime.sensing.gateway.mailbox_router.MailboxService", lambda owner: svc)
    router = MagicMock()
    router.call.return_value = SimpleNamespace(text="A suggested reply")
    app = FastAPI()
    app.include_router(
        create_mailbox_router(stack=SimpleNamespace(planner=SimpleNamespace(router=router)))
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/mailbox/assist",
            json={
                "action": "draft",
                "account_id": "gmail",
                "instruction": "Write a polite follow-up",
            },
        )
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
    request = router.call.call_args.args[0]
    assert not request.tools
    assert "不可信" in request.messages[0].content
    assert "Write a polite follow-up" in request.messages[1].content
    assert not any(key.startswith("send:") for key in store.list_secrets(svc.namespace))
