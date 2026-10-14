from __future__ import annotations

import base64
import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from ._webhook_auth import (
    RemoteKeySet,
    bearer_token,
    check_webhook_secret,
    keys_from_jwks,
    keys_from_x509_map,
    verify_rs256_jwt,
)
from .base import Channel, InboundMessage, OutboundMessage, _sanitize_url

try:
    import httpx  # type: ignore[import-untyped]

    HTTPX_AVAILABLE = True
except ImportError:  # pragma: no cover
    HTTPX_AVAILABLE = False
    httpx = None  # type: ignore[assignment]

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding, rsa

    CRYPTO_AVAILABLE = True
except ImportError:  # pragma: no cover
    CRYPTO_AVAILABLE = False


logger = logging.getLogger(__name__)

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_CHAT_SCOPE = "https://www.googleapis.com/auth/chat.bot"

# Inbound request verification (Google Chat app "Authentication Audience").
# Project-number audience: JWT issued by the Chat service account, keys
# published as X.509 certs.  HTTP-endpoint-URL audience: Google OIDC ID token
# whose ``email`` is the Chat service account.
GOOGLE_CHAT_ISSUER = "chat@system.gserviceaccount.com"
GOOGLE_CHAT_CERTS_URL = (
    "https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com"
)
GOOGLE_OIDC_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
GOOGLE_OIDC_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"


class GoogleChatError(RuntimeError):
    pass


class GoogleChatSignatureError(ValueError):
    pass


class GoogleChatChannel(Channel):
    channel_id: str = "google_chat"

    def __init__(
        self,
        *,
        service_account_key: dict[str, Any] | str,
        channel_id: str = "google_chat",
        api_base_url: str = "https://chat.googleapis.com",
        http_client: Any = None,
        verification_audience: str = "",
        webhook_secret: str = "",
        keys_provider: Any = None,
    ) -> None:
        """``verification_audience`` is the Chat app's authentication audience
        (the Cloud project number, or the HTTP endpoint URL); when set every
        inbound request must carry a valid Google-signed bearer JWT.
        ``webhook_secret`` is an optional extra shared secret.  ``keys_provider``
        (tests) returns the raw certs/JWKS document instead of fetching it."""
        if not service_account_key:
            raise ValueError("service_account_key is required")
        if isinstance(service_account_key, str):
            path = Path(service_account_key)
            if not path.exists():
                raise ValueError(
                    f"service_account_key file not found: {service_account_key!r}",
                )
            try:
                with open(path, encoding="utf-8") as f:
                    self._sa_key = json.load(f)
            except (json.JSONDecodeError, OSError) as e:
                raise ValueError(
                    f"failed to load service_account_key: {e}",
                ) from e
        elif isinstance(service_account_key, dict):
            self._sa_key = service_account_key
        else:
            raise TypeError(
                "service_account_key must be a dict or path to JSON file",
            )

        self.channel_id = channel_id
        self.api_base_url = api_base_url.rstrip("/")
        self._http = http_client
        self.send_log: list[OutboundMessage] = []
        self._token: str = ""
        self._token_expires: float = 0.0
        self._verification_audience = str(verification_audience or "").strip()
        self._webhook_secret = webhook_secret or ""
        self._keys_provider = keys_provider
        self._inbound_keys = RemoteKeySet(self._fetch_inbound_keys)
        if not self._verification_audience and not self._webhook_secret:
            logger.warning(
                "google_chat.inbound.unauthenticated: set verification_audience "
                "(project number or endpoint URL) to verify Google-signed requests",
                extra={"channel": channel_id},
            )

    # ── inbound authentication ────────────────────────────────────────

    def _uses_oidc_audience(self) -> bool:
        return self._verification_audience.lower().startswith("https://")

    def _fetch_inbound_keys(self) -> dict[str, tuple[Any, dict[str, Any]]]:
        oidc = self._uses_oidc_audience()
        if self._keys_provider is not None:
            doc = self._keys_provider()
        else:
            url = GOOGLE_OIDC_JWKS_URL if oidc else GOOGLE_CHAT_CERTS_URL
            if self._http is not None and hasattr(self._http, "get"):
                resp = self._http.get(url)
            else:
                resp = httpx.get(url, timeout=10.0)
            if getattr(resp, "status_code", 200) >= 400:
                raise GoogleChatError(f"GET {url} failed: HTTP {resp.status_code}")
            doc = resp.json()
        if not isinstance(doc, dict):
            raise GoogleChatError("signing key document not an object")
        return keys_from_jwks(doc) if "keys" in doc else keys_from_x509_map(doc)

    def _verify_inbound(self, headers: dict[str, str], query: dict[str, str] | None) -> None:
        check_webhook_secret(
            self._webhook_secret,
            headers=headers,
            query=query,
            error_cls=GoogleChatSignatureError,
        )
        if not self._verification_audience:
            return
        token = bearer_token(headers)
        if not token:
            raise GoogleChatSignatureError("missing Google Chat bearer token (signature required)")
        oidc = self._uses_oidc_audience()
        claims, _jwk = verify_rs256_jwt(
            token,
            resolve_key=self._inbound_keys.get,
            issuers=GOOGLE_OIDC_ISSUERS if oidc else (GOOGLE_CHAT_ISSUER,),
            audiences=(self._verification_audience,),
            leeway_seconds=300.0,
            error_cls=GoogleChatSignatureError,
        )
        if oidc and (
            claims.get("email") != GOOGLE_CHAT_ISSUER or claims.get("email_verified") is not True
        ):
            raise GoogleChatSignatureError(
                "token not issued to the Chat service account (signature)"
            )

    def _ensure_token(self) -> str:
        now = time.time()
        if self._token and now < self._token_expires - 60:
            return self._token

        if not CRYPTO_AVAILABLE:
            raise RuntimeError(
                "`cryptography` package required for GoogleChatChannel "
                "token signing · `pip install cryptography`",
            )

        client_email = self._sa_key.get("client_email", "")
        private_key_pem = self._sa_key.get("private_key", "")
        token_uri = self._sa_key.get("token_uri", GOOGLE_TOKEN_URL)

        if not client_email or not private_key_pem:
            raise GoogleChatError(
                "service_account_key missing client_email or private_key",
            )

        now_int = int(now)
        jwt_header = {"alg": "RS256", "typ": "JWT"}
        jwt_payload = {
            "iss": client_email,
            "scope": GOOGLE_CHAT_SCOPE,
            "aud": token_uri,
            "iat": now_int,
            "exp": now_int + 3600,
        }

        header_b64 = base64.urlsafe_b64encode(
            json.dumps(jwt_header, separators=(",", ":")).encode(),
        ).rstrip(b"=")
        payload_b64 = base64.urlsafe_b64encode(
            json.dumps(jwt_payload, separators=(",", ":")).encode(),
        ).rstrip(b"=")
        sign_input = header_b64 + b"." + payload_b64

        try:
            private_key = serialization.load_pem_private_key(
                private_key_pem.encode(),
                password=None,
            )
            # Google service-account keys are RSA (the JWT header is RS256);
            # narrow the load_pem_private_key union so the PKCS1v15 sign is
            # type-checked against RSAPrivateKey rather than every key type.
            assert isinstance(private_key, rsa.RSAPrivateKey)
            signature = private_key.sign(
                sign_input,
                padding.PKCS1v15(),
                hashes.SHA256(),
            )
        except Exception as e:
            raise GoogleChatError(f"JWT signing failed: {e}") from e

        sig_b64 = base64.urlsafe_b64encode(signature).rstrip(b"=")
        jwt_token = (sign_input + b"." + sig_b64).decode("ascii")

        body = {
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": jwt_token,
        }
        req_headers = {"Content-Type": "application/x-www-form-urlencoded"}

        if self._http is not None:
            resp = self._http.post(token_uri, data=body, headers=req_headers)
        else:
            if not hasattr(self, "_bare_client") or self._bare_client is None:
                self._bare_client = httpx.Client(timeout=15.0)
            resp = self._bare_client.post(token_uri, data=body, headers=req_headers)

        status = getattr(resp, "status_code", 200)
        if status >= 400:
            raise GoogleChatError(
                f"token HTTP {status}: {getattr(resp, 'text', '')[:200]}",
            )
        try:
            data = resp.json()
        except Exception as e:
            raise GoogleChatError(f"token json parse: {e}") from e
        if not isinstance(data, dict):
            raise GoogleChatError("token response not an object")
        access_token = data.get("access_token", "")
        expires_in = data.get("expires_in", 0)
        if not access_token:
            raise GoogleChatError("token response missing access_token")
        self._token = access_token
        self._token_expires = now + float(expires_in)
        return self._token

    def start(self) -> None:
        pass

    def stop(self) -> None:
        if hasattr(self, "_bare_client") and self._bare_client is not None:
            self._bare_client.close()
            self._bare_client = None

    def send(self, msg: OutboundMessage) -> None:
        self.send_log.append(msg)

        # Constitution gate · LINT-11 requires this before any network call.
        verdict = self.safe_send(msg)
        if verdict.action == "block":
            logger.warning(
                "channel.send.blocked",
                extra={"channel": self.channel_id, "reason": verdict.reason},
            )
            return
        # Use sanitized text if the gate rewrote PII · otherwise original.
        content = verdict.sanitized if verdict.action == "rewrite" else msg.content

        space_name, _ = self._split_thread_id(msg.thread_id)
        parent = space_name or msg.thread_id
        url = f"{self.api_base_url}/v1/{parent}/messages"
        body: dict[str, Any] = {"text": content}
        token = self._ensure_token()
        self._post_json(url, body=body, authorization=f"Bearer {token}")

    def health_check(self) -> bool:
        try:
            token = self._ensure_token()
            return bool(token)
        except Exception:
            return False

    def _post_json(
        self,
        url: str,
        *,
        body: dict[str, Any],
        authorization: str,
    ) -> dict[str, Any]:
        headers = {
            "Content-Type": "application/json",
            "Authorization": authorization,
        }
        if self._http is not None:
            client = self._http
        else:
            if not hasattr(self, "_bare_client") or self._bare_client is None:
                self._bare_client = httpx.Client(timeout=15.0)
            client = self._bare_client
        for attempt in range(4):
            try:
                resp = client.post(url, json=body, headers=headers)
            except Exception as e:
                raise GoogleChatError(
                    f"network: {type(e).__name__}: {e}",
                ) from e
            if resp.status_code < 500 and resp.status_code != 429:
                logger.info(
                    "channel.send", extra={"channel": self.channel_id, "status": resp.status_code}
                )
                break
            if attempt == 3:
                logger.error(
                    "channel.send.failed",
                    extra={"channel": self.channel_id, "status": resp.status_code},
                )
                break
            logger.warning(
                "channel.send.retry",
                extra={"channel": self.channel_id, "status": resp.status_code, "attempt": attempt},
            )
            time.sleep(2**attempt)
        status = getattr(resp, "status_code", 200)
        if status >= 400:
            raise GoogleChatError(
                f"POST {_sanitize_url(url)} failed: HTTP {status}",
            )
        try:
            data = resp.json()
        except Exception as e:
            raise GoogleChatError(f"json parse: {e}") from e
        if not isinstance(data, dict):
            raise GoogleChatError("response not an object")
        return data

    def handle_webhook(
        self,
        *,
        body: bytes,
        headers: dict[str, str],
        query: dict[str, str] | None = None,
    ) -> InboundMessage | dict[str, Any] | None:
        self._verify_inbound(headers, query)
        try:
            payload = json.loads(body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise ValueError(f"bad json body: {e}") from e
        if not isinstance(payload, dict):
            raise ValueError("payload not an object")

        event = payload.get("event") or {}
        if not isinstance(event, dict):
            return None
        if event.get("type") != "MESSAGE":
            return None

        message = event.get("message") or {}
        if not isinstance(message, dict):
            return None

        text = message.get("text", "")
        if not isinstance(text, str) or not text.strip():
            return None

        sender = event.get("sender") or {}
        sender_name = str(sender.get("name", "")) if isinstance(sender, dict) else ""
        sender_display = str(sender.get("displayName", "")) if isinstance(sender, dict) else ""

        space = event.get("space") or {}
        space_name = str(space.get("name", "")) if isinstance(space, dict) else ""

        message_name = str(message.get("name", "")) if isinstance(message, dict) else ""

        event_time = event.get("eventTime", "")

        thread_id = f"{space_name}:{message_name}" if space_name and message_name else space_name
        if not thread_id:
            return None

        return InboundMessage(
            channel_id=self.channel_id,
            thread_id=thread_id,
            sender_id=sender_name,
            content=text.strip(),
            metadata={
                "platform": "google_chat",
                "google_chat_space": space_name,
                "google_chat_message": message_name,
                "google_chat_sender_display": sender_display,
                "google_chat_event_time": event_time,
            },
            received_at=_parse_google_chat_ts(event_time),
        )

    @staticmethod
    def _split_thread_id(thread_id: str) -> tuple[str, str]:
        if ":" in thread_id:
            space, _, msg_name = thread_id.partition(":")
            return space, msg_name
        return thread_id, ""


def _parse_google_chat_ts(raw: Any) -> datetime | None:
    if not isinstance(raw, str):
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
