"""Google desktop OAuth: PKCE, loopback callback, encrypted refresh tokens.

The callback listener only binds loopback. Mailbox API callers still authenticate
through the gateway; the unguessable state binds the Google redirect to its owner.
"""

from __future__ import annotations

import base64
import contextvars
import hashlib
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

from runtime.platform.mailbox import MailboxService, MailError, address

MAIL_SCOPE = "https://mail.google.com/"
TOKEN_URL = "https://oauth2.googleapis.com/token"
_flows: dict[str, Flow] = {}
_lock = threading.Lock()


def google_json(url: str, *, form: dict[str, str] | None = None, token: str = "") -> dict[str, Any]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = urllib.parse.urlencode(form).encode() if form is not None else None
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, data=data, headers=headers), timeout=20
        ) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        # Never expose provider responses (which may contain authorization data).
        if exc.code in (400, 401, 403):
            raise MailError(
                "Google 授权无效或已撤销，请重新连接；也请检查客户端配置和测试用户设置。"
            ) from None
        raise MailError("Google 服务暂时不可用，请稍后重试。") from None
    except (OSError, ValueError):
        raise MailError("无法连接 Google 授权服务，请检查网络后重试。") from None


def client_config(svc: MailboxService) -> dict[str, str]:
    saved = svc.store.get_secret(svc.namespace, "google-client")
    if saved:
        return json.loads(saved)
    return {
        "client_id": os.environ.get("ECHO_GMAIL_GOOGLE_CLIENT_ID", ""),
        "client_secret": os.environ.get("ECHO_GMAIL_GOOGLE_CLIENT_SECRET", ""),
    }


def configure(svc: MailboxService, client_id: str, client_secret: str) -> None:
    client_id, client_secret = client_id.strip(), client_secret.strip()
    if not client_id.endswith(".apps.googleusercontent.com") or not client_secret:
        raise MailError("请导入 Google Cloud 的“桌面应用”OAuth 客户端 JSON 文件。")
    svc._put("google-client", {"client_id": client_id, "client_secret": client_secret})


def save_grant(svc: MailboxService, config: dict[str, str], tokens: dict[str, Any]) -> None:
    if MAIL_SCOPE not in str(tokens.get("scope", "")).split():
        raise MailError("未授予 Gmail 邮箱访问权限，请重新连接并勾选邮箱权限。")
    if not tokens.get("access_token") or not tokens.get("refresh_token"):
        raise MailError("Google 未返回持续访问凭据，请重新连接并完成授权。")
    profile = google_json(
        "https://openidconnect.googleapis.com/v1/userinfo", token=tokens["access_token"]
    )
    if profile.get("email_verified") is not True:
        raise MailError("Google 未返回已验证的邮箱地址。")
    email = address(str(profile.get("email", ""))).lower()
    account_id = hashlib.sha256(email.encode()).hexdigest()[:24]
    if len(svc.accounts()) >= 10 and not any(item["id"] == account_id for item in svc.accounts()):
        raise MailError("最多连接 10 个邮箱，请先移除不用的账户。")
    svc._put(
        "account:" + account_id,
        {
            "id": account_id,
            "email": email,
            "provider": "gmail",
            "auth_type": "oauth",
            "access_token": tokens["access_token"],
            "refresh_token": tokens["refresh_token"],
            "expires_at": time.time() + int(tokens.get("expires_in", 3600)),
            "client_id": config["client_id"],
            "client_secret": config["client_secret"],
        },
    )


def access_token(svc: MailboxService, account: dict[str, Any]) -> str:
    with svc.store.connector_lifecycle(svc.namespace + ":oauth:" + account["id"]):
        # Re-read inside the lock: refresh and account removal must not race.
        current = svc._get("account:" + account["id"])
        if current.get("auth_type") != "oauth":
            raise MailError("账户连接方式已改变，请刷新后重试。")
        if current.get("access_token") and current.get("expires_at", 0) > time.time() + 60:
            return current["access_token"]
        tokens = google_json(
            TOKEN_URL,
            form={
                "client_id": current["client_id"],
                "client_secret": current["client_secret"],
                "refresh_token": current["refresh_token"],
                "grant_type": "refresh_token",
            },
        )
        if not tokens.get("access_token"):
            raise MailError("Google 授权已失效，请重新连接邮箱。")
        current.update(
            access_token=tokens["access_token"],
            expires_at=time.time() + int(tokens.get("expires_in", 3600)),
        )
        if tokens.get("refresh_token"):
            current["refresh_token"] = tokens["refresh_token"]
        svc._put("account:" + account["id"], current)
        return current["access_token"]


@dataclass
class Flow:
    owner: str
    state: str
    verifier: str
    deadline: float
    status: str = "pending"
    error: str = ""
    redirect_uri: str = ""
    server: HTTPServer | None = None


def flow_status(svc: MailboxService, flow_id: str, *, cancel: bool = False) -> dict[str, str]:
    with _lock:
        flow = _flows.get(flow_id)
        if flow is None or flow.owner != svc.namespace:
            raise MailError("授权会话不存在，请重新开始。")
        if flow.status == "pending" and (cancel or time.monotonic() > flow.deadline):
            flow.status = "cancelled" if cancel else "expired"
        return {"status": flow.status, "error": flow.error}


def finish(
    svc: MailboxService, flow: Flow, config: dict[str, str], query: dict[str, list[str]]
) -> None:
    # Atomically claim a flow. Replayed callbacks cannot exchange another code.
    with _lock:
        if flow.status != "pending" or time.monotonic() > flow.deadline:
            raise MailError("授权会话已结束，请回到 Echo 重新连接。")
        states = query.get("state", [])
        if len(states) != 1 or not secrets.compare_digest(states[0], flow.state):
            raise MailError("授权回调校验失败。")
        flow.status = "exchanging"
    try:
        if query.get("error"):
            raise MailError("你取消了授权，或 Google 不允许此账户连接。")
        codes = query.get("code", [])
        if len(codes) != 1 or not codes[0]:
            raise MailError("Google 没有返回授权码。")
        tokens = google_json(
            TOKEN_URL,
            form={
                "client_id": config["client_id"],
                "client_secret": config["client_secret"],
                "code": codes[0],
                "code_verifier": flow.verifier,
                "grant_type": "authorization_code",
                "redirect_uri": flow.redirect_uri,
            },
        )
        save_grant(svc, config, tokens)
        flow.status = "connected"
    except MailError as exc:
        flow.status, flow.error = "error", str(exc)
        raise
    except Exception:
        flow.status, flow.error = "error", "授权保存失败，请回到 Echo 重试。"
        raise MailError(flow.error) from None


def start(svc: MailboxService) -> dict[str, str]:
    config = client_config(svc)
    if not config.get("client_id") or not config.get("client_secret"):
        raise MailError("请先配置 Google OAuth 桌面客户端。")
    with _lock:
        for key, item in list(_flows.items()):
            if item.deadline + 300 < time.monotonic():
                del _flows[key]
        if any(
            item.owner == svc.namespace
            and item.status in {"pending", "exchanging"}
            and item.deadline > time.monotonic()
            for item in _flows.values()
        ):
            raise MailError("已有授权窗口在等待，请先完成或取消上一次授权。")
        if len(_flows) >= 100:
            raise MailError("授权服务繁忙，请稍后重试。")
        flow_id = secrets.token_urlsafe(32)
        flow = Flow(
            svc.namespace,
            secrets.token_urlsafe(32),
            secrets.token_urlsafe(48),
            time.monotonic() + 300,
        )
        _flows[flow_id] = flow

    class Callback(BaseHTTPRequestHandler):
        def log_message(self, *args: Any) -> None:
            pass  # Authorization codes must never enter access logs.

        def do_GET(self) -> None:
            parsed = urllib.parse.urlsplit(self.path)
            if parsed.path != "/oauth2/callback":
                self.send_error(404)
                return
            try:
                finish(svc, flow, config, urllib.parse.parse_qs(parsed.query))
                code, message = 200, "Gmail 已连接。可以关闭此窗口，回到 Echo 邮箱。"
            except MailError:
                code, message = 400, "授权未完成。请回到 Echo 查看状态或重新连接。"
            self.send_response(code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header(
                "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
            )
            self.end_headers()
            self.wfile.write(
                f"<!doctype html><meta charset=utf-8><title>Echo 邮箱</title><h2>{message}</h2>".encode()
            )

    try:
        server = HTTPServer(("127.0.0.1", 0), Callback)
    except OSError:
        with _lock:
            _flows.pop(flow_id, None)
        raise MailError("无法启动本地授权回调，请检查本机端口权限。") from None
    server.timeout = 0.5
    flow.server = server
    flow.redirect_uri = f"http://127.0.0.1:{server.server_port}/oauth2/callback"
    context = contextvars.copy_context()

    def listen() -> None:
        try:
            while flow.status == "pending" and time.monotonic() < flow.deadline:
                server.handle_request()
        finally:
            server.server_close()
            if flow.status == "pending":
                flow.status = "expired"
            flow.verifier = ""
            flow.state = ""

    threading.Thread(target=lambda: context.run(listen), daemon=True, name="gmail-oauth").start()
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(flow.verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(
        {
            "client_id": config["client_id"],
            "redirect_uri": flow.redirect_uri,
            "response_type": "code",
            "scope": f"openid email {MAIL_SCOPE}",
            "state": flow.state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "access_type": "offline",
            "prompt": "consent select_account",
        }
    )
    return {"flow_id": flow_id, "authorization_url": url}
