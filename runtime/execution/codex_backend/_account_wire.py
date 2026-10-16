"""App Server wire-shape normalizers for the Codex account control plane."""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from .types import Notification, ProtocolError, RemoteError

if TYPE_CHECKING:
    from .account import _ControlRuntime


def _is_unusable_account_error(exc: BaseException) -> bool:
    """Whether App Server rejected the stored account credential outright.

    Codex App Server resolves workspace routing while answering
    ``account/read``.  A credential the provider has revoked makes that
    discovery fail with an opaque internal error (``-32603 workspace routing
    discovery failed``) instead of a clean "no account" response.
    """

    return (
        isinstance(exc, RemoteError)
        and exc.code == -32603
        and "workspace routing discovery failed" in exc.message.casefold()
    )


def _normalize_login_response(response: Mapping[str, Any]) -> dict[str, object]:
    login_type = response.get("type")
    if login_type == "apiKey":
        return {"type": "apiKey", "login_id": None}
    if login_type == "chatgpt":
        return {
            "type": "chatgpt",
            "login_id": response.get("loginId"),
            "auth_url": response.get("authUrl"),
        }
    if login_type == "chatgptDeviceCode":
        return {
            "type": "chatgptDeviceCode",
            "login_id": response.get("loginId"),
            "verification_url": response.get("verificationUrl"),
            "user_code": response.get("userCode"),
        }
    raise ProtocolError("account/login/start returned an unsupported login type")


def _normalize_model_entry(raw: Mapping[str, Any]) -> dict[str, object]:
    model_id = raw.get("id")
    display_name = raw.get("displayName")
    if not isinstance(model_id, str) or not model_id:
        raise ProtocolError("model/list item id must be a non-empty string")
    if not isinstance(display_name, str) or not display_name:
        display_name = model_id
    efforts: list[str] = []
    raw_efforts = raw.get("supportedReasoningEfforts")
    if isinstance(raw_efforts, list):
        for item in raw_efforts:
            if isinstance(item, Mapping) and isinstance(item.get("reasoningEffort"), str):
                efforts.append(str(item["reasoningEffort"]))
    modalities = raw.get("inputModalities")
    if not isinstance(modalities, list):
        modalities = ["text", "image"]
    return {
        "id": model_id,
        "display_name": display_name,
        "description": raw.get("description") if isinstance(raw.get("description"), str) else "",
        "reasoning_efforts": efforts,
        "default_reasoning_effort": (
            raw.get("defaultReasoningEffort")
            if isinstance(raw.get("defaultReasoningEffort"), str)
            else None
        ),
        "hidden": bool(raw.get("hidden")),
        "is_default": bool(raw.get("isDefault")),
        "input_modalities": [str(item) for item in modalities if isinstance(item, str)],
    }


def _normalize_rate_window(raw: Any) -> dict[str, object] | None:
    if raw is None:
        return None
    if not isinstance(raw, Mapping):
        raise ProtocolError("account/rateLimits/read window must be an object or null")
    used = raw.get("usedPercent")
    duration = raw.get("windowDurationMins")
    reset = raw.get("resetsAt")
    if isinstance(used, bool) or not isinstance(used, (int, float)):
        raise ProtocolError("account/rateLimits/read usedPercent must be numeric")
    if isinstance(duration, bool) or not isinstance(duration, int) or duration < 0:
        raise ProtocolError("account/rateLimits/read windowDurationMins must be non-negative")
    if isinstance(reset, bool) or not isinstance(reset, int) or reset < 0:
        raise ProtocolError("account/rateLimits/read resetsAt must be non-negative")
    used_percent = min(100.0, max(0.0, float(used)))
    return {
        "used_percent": used_percent,
        "remaining_percent": 100.0 - used_percent,
        "window_duration_mins": duration,
        "resets_at": reset,
    }


def _normalize_app_entry(raw: Mapping[str, Any]) -> dict[str, object]:
    app_id = raw.get("id")
    name = raw.get("name")
    if not isinstance(app_id, str) or not app_id.strip() or len(app_id) > 256:
        raise ProtocolError("app/list item id must be a bounded string")
    if any(char in app_id for char in "\x00\r\n"):
        raise ProtocolError("app/list item id contains unsafe characters")
    return {
        "id": app_id.strip(),
        "name": name if isinstance(name, str) and name.strip() else app_id.strip(),
        "description": raw.get("description") if isinstance(raw.get("description"), str) else "",
        "logo_url": raw.get("logoUrl") if isinstance(raw.get("logoUrl"), str) else None,
        "install_url": raw.get("installUrl") if isinstance(raw.get("installUrl"), str) else None,
        "is_accessible": raw.get("isAccessible") is True,
        "is_enabled": raw.get("isEnabled") is True,
    }


def _normalize_rate_bucket(raw: Any) -> dict[str, object]:
    if not isinstance(raw, Mapping):
        raise ProtocolError("account/rateLimits/read bucket must be an object")
    limit_id = raw.get("limitId")
    if not isinstance(limit_id, str) or not limit_id.strip() or len(limit_id) > 256:
        raise ProtocolError("account/rateLimits/read limitId must be a bounded string")
    limit_name = raw.get("limitName")
    plan_type = raw.get("planType")
    reached = raw.get("rateLimitReachedType")
    return {
        "limit_id": limit_id.strip(),
        "limit_name": limit_name if isinstance(limit_name, str) else None,
        "primary": _normalize_rate_window(raw.get("primary")),
        "secondary": _normalize_rate_window(raw.get("secondary")),
        "plan_type": plan_type if isinstance(plan_type, str) else None,
        "rate_limit_reached_type": reached if isinstance(reached, str) else None,
    }


def _normalize_rate_limits(response: Mapping[str, Any]) -> dict[str, object]:
    buckets: list[dict[str, object]] = []
    raw_by_id = response.get("rateLimitsByLimitId")
    if isinstance(raw_by_id, Mapping):
        for raw in raw_by_id.values():
            buckets.append(_normalize_rate_bucket(raw))
    elif response.get("rateLimits") is not None:
        buckets.append(_normalize_rate_bucket(response.get("rateLimits")))
    reset_credits = response.get("rateLimitResetCredits")
    available_count: int | None = None
    if isinstance(reset_credits, Mapping):
        raw_count = reset_credits.get("availableCount")
        if isinstance(raw_count, int) and not isinstance(raw_count, bool) and raw_count >= 0:
            available_count = raw_count
    return {"buckets": buckets, "reset_credits_available": available_count}


def _optional_non_negative_int(value: Any, field: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ProtocolError(f"account/usage/read {field} must be non-negative or null")
    return value


def _normalize_usage(response: Mapping[str, Any]) -> dict[str, object]:
    raw_summary = response.get("summary")
    if not isinstance(raw_summary, Mapping):
        raise ProtocolError("account/usage/read summary must be an object")
    summary = {
        "lifetime_tokens": _optional_non_negative_int(
            raw_summary.get("lifetimeTokens"), "lifetimeTokens"
        ),
        "peak_daily_tokens": _optional_non_negative_int(
            raw_summary.get("peakDailyTokens"), "peakDailyTokens"
        ),
        "longest_running_turn_sec": _optional_non_negative_int(
            raw_summary.get("longestRunningTurnSec"), "longestRunningTurnSec"
        ),
        "current_streak_days": _optional_non_negative_int(
            raw_summary.get("currentStreakDays"), "currentStreakDays"
        ),
        "longest_streak_days": _optional_non_negative_int(
            raw_summary.get("longestStreakDays"), "longestStreakDays"
        ),
    }
    buckets: list[dict[str, object]] = []
    raw_buckets = response.get("dailyUsageBuckets")
    if raw_buckets is not None:
        if not isinstance(raw_buckets, list):
            raise ProtocolError("account/usage/read dailyUsageBuckets must be an array or null")
        for raw in raw_buckets[:3660]:
            if not isinstance(raw, Mapping):
                raise ProtocolError("account/usage/read daily bucket must be an object")
            date = raw.get("startDate")
            if not isinstance(date, str) or not date or len(date) > 32:
                raise ProtocolError("account/usage/read startDate must be a bounded string")
            buckets.append(
                {
                    "start_date": date,
                    "tokens": _optional_non_negative_int(raw.get("tokens"), "tokens"),
                }
            )
    return {"summary": summary, "daily_usage_buckets": buckets}


def _apply_account_notification(runtime: _ControlRuntime, notification: Notification) -> None:
    if notification.method != "account/login/completed":
        return
    login_id = notification.params.get("loginId")
    if runtime.active_login_id is not None and login_id != runtime.active_login_id:
        return
    success = notification.params.get("success") is True
    runtime.login_error = None if success else "Codex login did not complete"
    runtime.active_login_id = None
    runtime.active_login_type = None
    runtime.login_started_at = None
