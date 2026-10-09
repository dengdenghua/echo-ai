from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from typing import Any

from ._webhook_auth import (
    RemoteKeySet,
    bearer_token,
    host_allowed,
    keys_from_jwks,
    verify_rs256_jwt,
)
from .base import Channel, InboundMessage, OutboundMessage, _sanitize_url

try:
    import httpx  # type: ignore[import-untyped]

    HTTPX_AVAILABLE = True
except ImportError:  # pragma: no cover
    HTTPX_AVAILABLE = False
    httpx = None  # type: ignore[assignment]


logger = logging.getLogger(__name__)

DEFAULT_API_BASE = "https://login.microsoftonline.com"

# Bot Connector -> bot authentication (public Azure cloud).  Inbound activities
# carry ``Authorization: Bearer <JWT>`` signed with keys published here; the
# token audience is the bot's Microsoft App ID.
DEFAULT_OPENID_METADATA_URL = "https://login.botframework.com/v1/.well-known/openidconfiguration"
DEFAULT_TOKEN_ISSUERS: tuple[str, ...] = ("https://api.botframework.com",)

# Hosts a Bot Framework ``serviceUrl`` may point at.  Replies carry the bot's
# OAuth token, so any other host would receive (and could replay) it.  A
# leading dot means "any subdomain of".  ``trafficmanager.net`` is a shared
# Azure namespace, so only the exact Teams host is trusted there.
DEFAULT_SERVICE_URL_HOSTS: tuple[str, ...] = (
    "smba.trafficmanager.net",
    ".botframework.com",
    ".botframework.us",
    ".botframework.azure.us",
    ".teams.microsoft.com",
    ".teams.microsoft.us",
)


class TeamsError(RuntimeError):
    pass


class TeamsSignatureError(ValueError):
    pass


class TeamsChannel(Channel):
    channel_id: str = "teams"

    def __init__(
        self,
        *,
        app_id: str,
        app_password: str,
        channel_id: str = "teams",
        api_base_url: str = DEFAULT_API_BASE,
        http_client: Any = None,
        openid_metadata_url: str = DEFAULT_OPENID_METADATA_URL,
        token_issuers: tuple[str, ...] | list[str] = DEFAULT_TOKEN_ISSUERS,
        allowed_service_url_hosts: tuple[str, ...] | list[str] | None = None,
        jwks_provider: Any = None,
        clock_skew_seconds: float = 300.0,
    ) -> None:
        """``jwks_provider`` (tests/air-gapped installs) returns a JWKS dict
        instead of fetching ``openid_metadata_url``."""
        if not app_id:
            raise ValueError("app_id required")
        if not app_password:
            raise ValueError("app_password required")
        if not HTTPX_AVAILABLE:
            raise RuntimeError(
                "`httpx` package required for TeamsChannel · "
                "`pip install httpx` (or extras '.[teams]')",
            )

        self._app_id = app_id
        self._app_password = app_password
        self.channel_id = channel_id
        self.api_base_url = api_base_url.rstrip("/")
        self._http = http_client
        self.send_log: list[OutboundMessage] = []
        self._token: str = ""
        self._token_expires: float = 0.0
        self._service_url: str = ""
        self._openid_metadata_url = openid_metadata_url
        self._token_issuers = tuple(token_issuers)
        self._allowed_service_url_hosts = tuple(
            allowed_service_url_hosts if allowed_service_url_hosts else DEFAULT_SERVICE_URL_HOSTS
        )
        self._jwks_provider = jwks_provider
        self._clock_skew_seconds = float(clock_skew_seconds)
        self._keys = RemoteKeySet(self._fetch_signing_keys)

    # ── inbound authentication ────────────────────────────────────────

    def _get_json(self, url: str) -> Any:
        if self._http is not None and hasattr(self._http, "get"):
            resp = self._http.get(url)
        else:
            resp = httpx.get(url, timeout=10.0)
        status = getattr(resp, "status_code", 200)
        if status >= 400:
            raise TeamsError(f"GET {_sanitize_url(url)} failed: HTTP {status}")
        return resp.json()

    def _fetch_signing_keys(self) -> dict[str, tuple[Any, dict[str, Any]]]:
        if self._jwks_provider is not None:
            jwks = self._jwks_provider()
        else:
            metadata = self._get_json(self._openid_metadata_url)
            jwks_uri = metadata.get("jwks_uri") if isinstance(metadata, dict) else None
            if not isinstance(jwks_uri, str) or not jwks_uri.lower().startswith("https://"):
                raise TeamsError("openid metadata missing https jwks_uri")
            jwks = self._get_json(jwks_uri)
        if not isinstance(jwks, dict):
            raise TeamsError("jwks response not an object")
        return keys_from_jwks(jwks)

    def service_url_allowed(self, service_url: str) -> bool:
        return host_allowed(service_url, self._allowed_service_url_hosts)

    def _verify_inbound(self, payload: dict[str, Any], headers: dict[str, str]) -> None:
        """Verify the Bot Connector JWT (signature, issuer, audience=app_id,
        expiry, channel endorsement and serviceUrl claim)."""
        token = bearer_token(headers)
        if not token:
            raise TeamsSignatureError("missing Bot Framework bearer token (signature required)")
        claims, jwk = verify_rs256_jwt(
            token,
            resolve_key=self._keys.get,
            issuers=self._token_issuers,
            audiences=(self._app_id,),
            leeway_seconds=self._clock_skew_seconds,
            error_cls=TeamsSignatureError,
        )
        channel = payload.get("channelId")
        endorsements = jwk.get("endorsements")
        if (
            isinstance(endorsements, list)
            and isinstance(channel, str)
            and channel
            and channel not in endorsements
        ):
            raise TeamsSignatureError("signing key not endorsed for this channel (signature)")
        claim_url = claims.get("serviceurl") or claims.get("serviceUrl")
        activity_url = payload.get("serviceUrl")
        if (
            isinstance(claim_url, str)
            and claim_url
            and activity_url
            and (
                not isinstance(activity_url, str)
                or claim_url.rstrip("/").lower() != activity_url.rstrip("/").lower()
            )
        ):
            raise TeamsSignatureError("serviceUrl does not match token claim (signature)")

    def _ensure_token(self) -> str:
        now = time.time()
        if self._token and now < self._token_expires - 60:
            return self._token
        url = f"{self.api_base_url}/botframework.com/oauth2/v2.0/token"
        body = {
            "grant_type": "client_credentials",
            "client_id": self._app_id,
            "client_secret": self._app_password,
            "scope": "https://api.botframework.com/.default",
        }
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        if self._http is not None:
            resp = self._http.post(url, data=body, headers=headers)
        else:
            if not hasattr(self, "_bare_client") or self._bare_client is None:
                self._bare_client = httpx.Client(timeout=15.0)
            resp = self._bare_client.post(url, data=body, headers=headers)
        status = getattr(resp, "status_code", 200)
        if status >= 400:
            raise TeamsError(
                f"token HTTP {status}: {getattr(resp, 'text', '')[:200]}",
            )
        try:
            data = resp.json()
        except Exception as e:  # noqa: BLE001
            raise TeamsError(f"token json parse: {e}") from e
        if not isinstance(data, dict):
            raise TeamsError("token response not an object")
        access_token = data.get("access_token", "")
        expires_in = data.get("expires_in", 0)
        if not access_token:
            raise TeamsError("token response missing access_token")
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

        service_url = msg.metadata.get("teams_service_url") or self._service_url
        if not service_url:
            raise TeamsError("missing service_url for send")
        # Defense in depth: the bot token below must only ever go to Bot
        # Framework hosts, whatever put this URL into the metadata.
        if not self.service_url_allowed(service_url):
            raise TeamsError(
                f"refusing to send to untrusted serviceUrl {_sanitize_url(service_url)}"
            )
        conversation_id = msg.metadata.get("teams_conversation_id")
        if not conversation_id:
            raise TeamsError("missing teams_conversation_id for send")
        reply_to_id = msg.metadata.get("teams_activity_id", "")
        service_url = service_url.rstrip("/")
        url = f"{service_url}/v3/conversations/{conversation_id}/activities/{reply_to_id}"
        body: dict[str, Any] = {"type": "message", "text": content}
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
            except Exception as e:  # noqa: BLE001
                raise TeamsError(
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
            raise TeamsError(
                f"POST {_sanitize_url(url)} failed: HTTP {status}",
            )
        try:
            data = resp.json()
        except Exception as e:  # noqa: BLE001
            raise TeamsError(f"json parse: {e}") from e
        if not isinstance(data, dict):
            raise TeamsError("response not an object")
        return data

    def handle_webhook(
        self,
        *,
        body: bytes,
        headers: dict[str, str],
    ) -> InboundMessage | dict[str, Any] | None:
        try:
            payload = json.loads(body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise ValueError(f"bad json body: {e}") from e
        if not isinstance(payload, dict):
            raise ValueError("payload not an object")

        # Authenticate every activity (including pings) before trusting any field.
        self._verify_inbound(payload, headers)

        activity_type = payload.get("type", "")
        if activity_type == "ping":
            return {"type": "ping"}

        if activity_type != "message":
            return None

        service_url = payload.get("serviceUrl", "")
        if not isinstance(service_url, str) or not service_url:
            return None
        if not self.service_url_allowed(service_url):
            logger.warning(
                "teams.inbound.untrusted_service_url",
                extra={"channel": self.channel_id, "service_url": _sanitize_url(service_url)},
            )
            raise TeamsSignatureError("serviceUrl host not allowed (signature)")

        self._service_url = service_url

        text = payload.get("text", "")
        if not isinstance(text, str) or not text.strip():
            return None

        from_obj = payload.get("from") or {}
        sender_id = str(from_obj.get("id", "")) if isinstance(from_obj, dict) else ""

        conversation_obj = payload.get("conversation") or {}
        conversation_id = (
            str(conversation_obj.get("id", "")) if isinstance(conversation_obj, dict) else ""
        )

        activity_id = str(payload.get("id", ""))
        timestamp = payload.get("timestamp", "")

        if not conversation_id:
            return None

        thread_id = f"{conversation_id}:{activity_id}" if activity_id else conversation_id

        return InboundMessage(
            channel_id=self.channel_id,
            thread_id=thread_id,
            sender_id=sender_id,
            content=text.strip(),
            metadata={
                "platform": "teams",
                "teams_service_url": service_url,
                "teams_conversation_id": conversation_id,
                "teams_activity_id": activity_id,
            },
            received_at=_parse_teams_ts(timestamp),
        )


def _parse_teams_ts(raw: Any) -> datetime | None:
    if not isinstance(raw, str):
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
