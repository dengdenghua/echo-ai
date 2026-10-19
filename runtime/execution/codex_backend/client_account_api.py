"""Account/login API functions for :class:`CodexAppServerClient`.

Extracted from ``client`` to keep the client class under the god-file
threshold. The client keeps thin delegating methods, so the public surface
(``client.account_read(...)``, ...) is unchanged.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol, cast

from ._transport import validate_identifier
from .client_support import _require_object_result
from .types import ConfigurationError, JsonObject, JsonValue, ProtocolError


class _AccountRequestHost(Protocol):
    """The slice of the client that the account API functions rely on."""

    def request(
        self,
        method: str,
        params: Mapping[str, Any] | None = None,
        *,
        timeout_s: float | None = None,
    ) -> Any: ...


async def account_read(
    client: _AccountRequestHost,
    *,
    refresh_token: bool = False,
    timeout_s: float | None = None,
) -> JsonObject:
    """Read App Server's current account without exposing stored tokens."""

    result = await client.request(
        "account/read",
        {"refreshToken": bool(refresh_token)},
        timeout_s=timeout_s,
    )
    return _require_object_result(cast(JsonValue, result), "account/read")


async def login_api_key(
    client: _AccountRequestHost,
    api_key: str,
    *,
    timeout_s: float | None = None,
) -> JsonObject:
    """Hand an OpenAI API key directly to App Server's credential store."""

    if not isinstance(api_key, str) or not api_key.strip() or "\x00" in api_key:
        raise ConfigurationError("api_key must be a non-empty, NUL-free string")
    result = await client.request(
        "account/login/start",
        {"type": "apiKey", "apiKey": api_key.strip()},
        timeout_s=timeout_s,
    )
    return _require_object_result(cast(JsonValue, result), "account/login/start")


async def login_chatgpt(
    client: _AccountRequestHost,
    *,
    device_code: bool = False,
    timeout_s: float | None = None,
) -> JsonObject:
    """Start a managed ChatGPT browser or device-code login flow."""

    params: JsonObject
    if device_code:
        params = {"type": "chatgptDeviceCode"}
    else:
        params = {
            "type": "chatgpt",
            "useHostedLoginSuccessPage": True,
            "appBrand": "chatgpt",
        }
    result = await client.request("account/login/start", params, timeout_s=timeout_s)
    response = _require_object_result(cast(JsonValue, result), "account/login/start")
    expected_type = "chatgptDeviceCode" if device_code else "chatgpt"
    if response.get("type") != expected_type:
        raise ProtocolError("account/login/start returned an unexpected login type")
    required = ("loginId", "verificationUrl", "userCode") if device_code else ("loginId", "authUrl")
    if any(not isinstance(response.get(name), str) or not response.get(name) for name in required):
        raise ProtocolError("account/login/start returned an incomplete login response")
    return response


async def cancel_login(
    client: _AccountRequestHost,
    login_id: str,
    *,
    timeout_s: float | None = None,
) -> JsonObject:
    """Cancel one managed ChatGPT login generation."""

    validate_identifier(login_id, "login_id")
    result = await client.request(
        "account/login/cancel",
        {"loginId": login_id},
        timeout_s=timeout_s,
    )
    return _require_object_result(cast(JsonValue, result), "account/login/cancel")


async def logout_account(
    client: _AccountRequestHost, *, timeout_s: float | None = None
) -> JsonObject:
    """Remove App Server's stored account for this isolated Codex home."""

    result = await client.request("account/logout", {}, timeout_s=timeout_s)
    return _require_object_result(cast(JsonValue, result), "account/logout")


async def read_account_rate_limits(
    client: _AccountRequestHost,
    *,
    timeout_s: float | None = None,
) -> JsonObject:
    """Read ChatGPT quota windows without exposing account credentials."""

    result = await client.request(
        "account/rateLimits/read",
        {},
        timeout_s=timeout_s,
    )
    return _require_object_result(cast(JsonValue, result), "account/rateLimits/read")


async def read_account_usage(
    client: _AccountRequestHost,
    *,
    timeout_s: float | None = None,
) -> JsonObject:
    """Read account-level ChatGPT token activity summaries."""

    result = await client.request(
        "account/usage/read",
        {},
        timeout_s=timeout_s,
    )
    return _require_object_result(cast(JsonValue, result), "account/usage/read")
