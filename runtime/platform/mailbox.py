"""User-scoped Gmail mailboxes. Secrets and drafts use the encrypted credential store."""

from __future__ import annotations

import contextlib
import email.policy
import hashlib
import imaplib
import json
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import formatdate, make_msgid, parseaddr, parsedate_to_datetime
from html.parser import HTMLParser
from typing import Any
from uuid import uuid4

from runtime.platform.connectors.credential_store import CredentialStore


class MailError(ValueError):
    pass


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in {"script", "style"}:
            self.hidden += 1
        elif tag in {"p", "br", "div", "li"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"}:
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


def address(value: str) -> str:
    if "\r" in value or "\n" in value:
        raise MailError("邮箱地址不能包含换行。")
    result = parseaddr(value)[1]
    if not re.fullmatch(r"[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+", result):
        raise MailError("请填写有效的邮箱地址。")
    return result


def parse_message(raw: bytes, *, uid: str, account_id: str, flags: bytes = b"") -> dict[str, Any]:
    msg = BytesParser(policy=email.policy.default).parsebytes(raw)
    body = msg.get_body(preferencelist=("plain", "html"))
    text = ""
    if body is not None:
        try:
            text = str(body.get_content())
        except (LookupError, UnicodeError):
            text = (body.get_payload(decode=True) or b"").decode("utf-8", errors="replace")
        if body.get_content_type() == "text/html":
            parser = _Text()
            parser.feed(text)
            text = "".join(parser.parts)
    try:
        timestamp = parsedate_to_datetime(str(msg.get("Date", ""))).timestamp()
    except (ValueError, TypeError, OverflowError):
        timestamp = 0
    return {
        "id": uid,
        "account_id": account_id,
        "subject": str(msg.get("Subject", "")) or "（无主题）",
        "sender": str(msg.get("From", "")),
        "to": str(msg.get("To", "")),
        "reply_to": parseaddr(str(msg.get("Reply-To") or msg.get("From", "")))[1],
        "message_id": str(msg.get("Message-ID", "")),
        "date": timestamp,
        "read": b"\\Seen" in flags,
        "starred": b"\\Flagged" in flags,
        "body": text[:100000],
        "truncated": len(text) > 100000,
        "attachments": [
            str(part.get_filename()) for part in msg.iter_attachments() if part.get_filename()
        ],
    }


class MailboxService:
    def __init__(self, owner: str, store: CredentialStore | None = None) -> None:
        self.store = store or CredentialStore()
        self.namespace = "mailbox-" + hashlib.sha256(owner.encode()).hexdigest()

    def _get(self, key: str) -> dict[str, Any]:
        value = self.store.get_secret(self.namespace, key)
        if not value:
            raise MailError("账户或草稿不存在，请刷新后重试。")
        return json.loads(value)

    def _put(self, key: str, value: dict[str, Any]) -> None:
        self.store.set_secret(self.namespace, key, json.dumps(value, ensure_ascii=False))

    def accounts(self) -> list[dict[str, Any]]:
        return [
            {
                k: v
                for k, v in self._get(key).items()
                if k in {"id", "email", "provider", "auth_type"}
            }
            for key in self.store.list_secrets(self.namespace)
            if key.startswith("account:")
        ]

    @contextlib.contextmanager
    def _imap(self, account: dict[str, Any]):
        client = imaplib.IMAP4_SSL(
            "imap.gmail.com", 993, ssl_context=ssl.create_default_context(), timeout=20
        )
        try:
            if account.get("auth_type") == "oauth":
                from runtime.platform.mailbox_oauth import access_token

                token = access_token(self, account)
                payload = f"user={account['email']}\x01auth=Bearer {token}\x01\x01".encode()
                client.authenticate("XOAUTH2", lambda challenge: b"" if challenge else payload)
            else:
                client.login(account["email"], account["password"])
            yield client
        finally:
            with contextlib.suppress(imaplib.IMAP4.error, OSError):
                client.logout()

    def _smtp_login(self, smtp: Any, account: dict[str, Any]) -> None:
        if account.get("auth_type") == "oauth":
            from runtime.platform.mailbox_oauth import access_token

            token = access_token(self, account)
            payload = f"user={account['email']}\x01auth=Bearer {token}\x01\x01"
            smtp.ehlo()
            smtp.auth("XOAUTH2", lambda challenge=None: "" if challenge else payload)
        else:
            smtp.login(account["email"], account["password"])

    def connect(self, email_address: str, password: str) -> dict[str, Any]:
        email_address = address(email_address).lower()
        password = password.replace(" ", "")
        if not re.fullmatch(r"[a-zA-Z]{16}", password):
            raise MailError("请输入 Google 生成的 16 位应用专用密码，不是登录密码。")
        account_id = hashlib.sha256(email_address.encode()).hexdigest()[:24]
        account = {
            "id": account_id,
            "email": email_address,
            "provider": "gmail",
            "password": password,
        }
        with self._imap(account):
            pass
        with smtplib.SMTP_SSL(
            "smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=20
        ) as smtp:
            smtp.login(email_address, password)
        self._put("account:" + account_id, account)
        return {k: v for k, v in account.items() if k != "password"}

    def disconnect(self, account_id: str) -> None:
        self._get("account:" + account_id)
        with self.store.connector_lifecycle(self.namespace + ":oauth:" + account_id):
            self.store.delete_secret(self.namespace, "account:" + account_id)

    @staticmethod
    def _select(client: Any, folder: str, *, readonly: bool = True) -> str:
        mailbox = "INBOX"
        if folder == "sent":
            status, rows = client.list()
            if status != "OK":
                raise MailError("无法读取文件夹。")
            mailbox = ""
            for row in rows:
                if row and b"\\Sent" in row:
                    match = re.match(rb'\([^)]*\)\s+(?:"[^"]*"|NIL)\s+(.+)', row)
                    if match:
                        mailbox = match.group(1).decode("ascii")
                        break
            if not mailbox:
                raise MailError("Gmail 的已发送文件夹不可用。")
        elif folder != "inbox":
            raise MailError("不支持的文件夹。")
        status, _ = client.select(mailbox, readonly=readonly)
        if status != "OK":
            raise MailError("无法打开邮件文件夹。")
        _, values = client.response("UIDVALIDITY")
        if not values or not values[0]:
            raise MailError("邮件服务器没有返回文件夹版本，请重试。")
        return values[0].decode()

    def messages(self, account_id: str, folder: str, limit: int = 50) -> dict[str, Any]:
        account = self._get("account:" + account_id)
        with self._imap(account) as client:
            version = self._select(client, folder)
            status, data = client.uid("search", None, "ALL")
            if status != "OK":
                raise MailError("读取邮件列表失败。")
            ids = (data[0] or b"").split()
            if not ids:
                return {"messages": [], "total": 0}
            status, rows = client.uid(
                "fetch",
                b",".join(ids[-limit:]),
                "(UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO DATE)])",
            )
            if status != "OK":
                raise MailError("读取邮件列表失败。")
            messages = []
            for row in rows:
                if isinstance(row, tuple):
                    match = re.search(rb"UID (\d+)", row[0])
                    if match:
                        messages.append(
                            parse_message(
                                row[1],
                                uid=version + "-" + match.group(1).decode(),
                                account_id=account_id,
                                flags=row[0],
                            )
                        )
            return {
                "messages": sorted(messages, key=lambda item: item["date"], reverse=True),
                "total": len(ids),
            }

    def message(
        self, account_id: str, folder: str, message_id: str, *, flags: dict[str, bool] | None = None
    ) -> dict[str, Any]:
        if not re.fullmatch(r"\d+-\d+", message_id):
            raise MailError("无效的邮件编号。")
        version, uid = message_id.split("-")
        with self._imap(self._get("account:" + account_id)) as client:
            if self._select(client, folder, readonly=flags is None) != version:
                raise MailError("邮件文件夹已更新，请刷新列表。")
            if flags is not None:
                for name, enabled in flags.items():
                    flag = {"read": "\\Seen", "starred": "\\Flagged"}[name]
                    status, _ = client.uid(
                        "store", uid, "+FLAGS.SILENT" if enabled else "-FLAGS.SILENT", f"({flag})"
                    )
                    if status != "OK":
                        raise MailError("更新邮件状态失败。")
                return {"ok": True}
            status, sizes = client.uid("fetch", uid, "(RFC822.SIZE)")
            size = re.search(
                rb"RFC822.SIZE (\d+)", b" ".join(row for row in sizes if isinstance(row, bytes))
            )
            if status != "OK" or not size:
                raise MailError("邮件已不存在，请刷新列表。")
            if int(size.group(1)) > 10 * 1024 * 1024:
                raise MailError("这封邮件超过 10 MB，请在 Gmail 网页版查看。")
            status, rows = client.uid("fetch", uid, "(FLAGS BODY.PEEK[])")
            if status == "OK":
                for row in rows:
                    if isinstance(row, tuple):
                        return parse_message(
                            row[1], uid=message_id, account_id=account_id, flags=row[0]
                        )
            raise MailError("读取邮件失败，请刷新后重试。")

    def drafts(self) -> list[dict[str, Any]]:
        return [
            self._get(key)
            for key in self.store.list_secrets(self.namespace)
            if key.startswith("draft:")
        ]

    def save_draft(self, draft: dict[str, Any]) -> dict[str, Any]:
        draft = {**draft, "id": draft.get("id") or uuid4().hex}
        self._put("draft:" + draft["id"], draft)
        return draft

    def send(self, draft: dict[str, Any], request_id: str) -> dict[str, Any]:
        account = self._get("account:" + draft["account_id"])
        recipients = [address(item.strip()) for item in draft["to"].split(",") if item.strip()]
        if not recipients or len(recipients) > 20:
            raise MailError("请填写 1 至 20 个收件人，以逗号分隔。")
        if any(
            "\n" in str(draft.get(key, "")) or "\r" in str(draft.get(key, ""))
            for key in ("subject", "reply_message_id")
        ):
            raise MailError("邮件主题和引用编号不能包含换行。")
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = (
            account["email"],
            ", ".join(recipients),
            draft["subject"],
        )
        msg["Date"], msg["Message-ID"] = formatdate(localtime=True), make_msgid()
        if draft.get("reply_message_id"):
            msg["In-Reply-To"] = draft["reply_message_id"]
            msg["References"] = draft["reply_message_id"]
        msg.set_content(draft["body"])
        # Persist intent before SMTP DATA. Never blindly retry an ambiguous delivery.
        with self.store.connector_lifecycle(self.namespace):
            existing = self.store.get_secret(self.namespace, "send:" + request_id)
            if existing:
                result = json.loads(existing)
                if result["status"] == "sent":
                    return result
                if result["status"] != "failed":
                    raise MailError(
                        "上次发送结果尚未确认，请先到 Gmail 已发送中核对，避免重复发送。"
                    )
            with smtplib.SMTP_SSL(
                "smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=20
            ) as smtp:
                self._smtp_login(smtp, account)
                self._put("send:" + request_id, {"status": "pending"})
                try:
                    refused = smtp.send_message(msg)
                except (
                    smtplib.SMTPRecipientsRefused,
                    smtplib.SMTPSenderRefused,
                    smtplib.SMTPDataError,
                ):
                    # An explicit rejection means SMTP did not accept the
                    # message. Disconnects/timeouts remain pending because
                    # delivery could already have happened in those cases.
                    self._put("send:" + request_id, {"status": "failed"})
                    raise
                result = {
                    "status": "sent",
                    "message_id": str(msg["Message-ID"]),
                    "refused": list(refused),
                }
                self._put("send:" + request_id, result)
            if draft.get("id"):
                self.store.delete_secret(self.namespace, "draft:" + draft["id"])
            return result
