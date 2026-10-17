"""Low-level payload rewrite helpers for OpenAI-compatible gateways.

Extracted from ``openai_compat_providers.py``: thinking-field
normalization, sampling-parameter removal, strict tool-schema cleanup,
payload diffing, and the error-body matching used by the retry planner.
"""

from __future__ import annotations

import json
import re
from typing import Any

from ._providers_data import OpenAICompatProviderProfile, _profile_by_id

_STRICT_SCHEMA_DROPPED_KEYS = frozenset(
    {
        "$anchor",
        "$comment",
        "$id",
        "$schema",
        "default",
        "deprecated",
        "discriminator",
        "example",
        "examples",
        "externalDocs",
        "format",
        "nullable",
        "readOnly",
        "title",
        "writeOnly",
        "xml",
    }
)


def _normalize_thinking_fields(
    payload: dict[str, Any],
    profile: OpenAICompatProviderProfile,
) -> None:
    if "reasoning_effort" not in payload and "thinking" not in payload:
        return
    if profile.thinking_request_style == "openai":
        return
    if profile.thinking_request_style == "deepseek":
        _normalize_deepseek_thinking(payload)
        return
    if profile.thinking_request_style == "minimax_adaptive":
        payload.pop("reasoning_effort", None)
        payload["thinking"] = {"type": "adaptive"}
        return
    payload.pop("reasoning_effort", None)
    payload.pop("thinking", None)


_DEEPSEEK_EFFORT_VOCAB = frozenset({"off", "high", "max"})
"""DeepSeek's native reasoning_effort vocabulary (V4): off | high | max."""

_DEEPSEEK_EFFORT_FALLBACKS = {
    "minimal": "high",
    "low": "high",
    "medium": "high",
    "high": "high",
    "xhigh": "max",
    "max": "max",
}
"""OpenAI-style efforts map into the DeepSeek vocabulary; only high/max keep
thinking enabled, anything below high is promoted rather than dropped."""


def _normalize_deepseek_thinking(payload: dict[str, Any]) -> None:
    """DeepSeek-native thinking normalization (V4 wire contract).

    * ``reasoning_effort: off`` → ``thinking: {type: disabled}`` and the
      effort field is dropped (DeepSeek rejects ``off`` as an effort value).
    * ``reasoning_effort: high|max`` (or an OpenAI-style effort mapped into
      that vocabulary) → ``thinking: {type: enabled}`` with the effort kept.
    * ``thinking: {type: disabled}`` alone → stays disabled.
    * ``thinking: {type: enabled}`` alone → stays enabled without an effort.
    """

    thinking = payload.get("thinking")
    effort_raw = payload.get("reasoning_effort")
    effort = str(effort_raw or "").strip().lower() if effort_raw is not None else None

    if effort == "off":
        payload["thinking"] = {"type": "disabled"}
        payload.pop("reasoning_effort", None)
        return

    if effort in _DEEPSEEK_EFFORT_VOCAB:
        payload["thinking"] = {"type": "enabled"}
        payload["reasoning_effort"] = effort
        return

    if effort in _DEEPSEEK_EFFORT_FALLBACKS:
        payload["thinking"] = {"type": "enabled"}
        payload["reasoning_effort"] = _DEEPSEEK_EFFORT_FALLBACKS[effort]
        return

    if isinstance(thinking, dict) and thinking.get("type") in ("enabled", "disabled"):
        payload["thinking"] = {"type": thinking["type"]}
        # An effort outside the native vocabulary is invalid on the wire;
        # the explicit thinking flag wins and the effort is dropped.
        payload.pop("reasoning_effort", None)
        return

    # Unknown effort/thinking shape: drop both rather than risk a 400.
    payload.pop("reasoning_effort", None)
    payload.pop("thinking", None)


def _remove_sampling_parameters(payload: dict[str, Any]) -> None:
    for key in (
        "temperature",
        "top_p",
        "presence_penalty",
        "frequency_penalty",
        "logit_bias",
        "seed",
    ):
        payload.pop(key, None)


def _payload_has_sampling(payload: dict[str, Any]) -> bool:
    return any(
        key in payload
        for key in (
            "temperature",
            "top_p",
            "presence_penalty",
            "frequency_penalty",
            "logit_bias",
            "seed",
        )
    )


def _payload_fingerprint(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)


def _payload_delta(
    original: dict[str, Any],
    candidate: dict[str, Any],
) -> tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    original_keys = set(original)
    candidate_keys = set(candidate)
    removed = tuple(sorted(original_keys - candidate_keys))
    added = tuple(sorted(candidate_keys - original_keys))
    changed = tuple(
        sorted(
            key for key in original_keys & candidate_keys if original.get(key) != candidate.get(key)
        )
    )
    return removed, added, changed


def _coerce_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_string_tuple(value: Any) -> tuple[str, ...] | None:
    if value is None:
        return None
    if isinstance(value, str):
        items = [item.strip() for item in value.split(",")]
    elif isinstance(value, list):
        items = [str(item).strip() for item in value]
    else:
        return None
    return tuple(item for item in items if item)


def _has_explicit_compat_override(entry: dict[str, Any]) -> bool:
    if _profile_by_id(entry.get("compat_profile")) is not None:
        return True
    return any(
        entry.get(field_name) is not None
        for field_name in (
            "thinking_request_style",
            "drop_tool_choice",
            "strict_tool_schema",
            "retry_without_tool_choice",
            "retry_without_sampling",
            "retry_max_tokens_as_completion_tokens",
            "max_temperature",
            "unsupported_request_fields",
        )
    )


def _mentions_any(haystack: str, needles: tuple[str, ...]) -> bool:
    return any(needle in haystack for needle in needles)


def _mentioned_payload_fields(
    haystack: str,
    payload: dict[str, Any],
    field_names: tuple[str, ...],
) -> tuple[str, ...]:
    return tuple(
        field_name
        for field_name in field_names
        if field_name in payload and _mentions_field(haystack, field_name)
    )


def _mentions_field(haystack: str, field_name: str) -> bool:
    needle = re.escape(field_name)
    return re.search(rf"(^|[^a-z0-9_]){needle}([^a-z0-9_]|$)", haystack) is not None


def _mentions_tool_use_unsupported(haystack: str) -> bool:
    return _mentions_any(
        haystack,
        (
            "tools is not supported",
            "tools are not supported",
            "tool calls are not supported",
            "tool calling is not supported",
            "function calling is not supported",
            "function calls are not supported",
            "unsupported parameter: tools",
            "unsupported field: tools",
            "unknown field: tools",
            "unrecognized field: tools",
        ),
    )


def _strict_tools(value: Any) -> Any:
    if not isinstance(value, list):
        return value
    tools: list[Any] = []
    for tool in value:
        if not isinstance(tool, dict):
            tools.append(tool)
            continue
        copied = dict(tool)
        fn = copied.get("function")
        if isinstance(fn, dict):
            fn_copy = dict(fn)
            name = fn_copy.get("name", "")
            if "-" in name:
                continue
            params = fn_copy.get("parameters")
            if isinstance(params, dict):
                fn_copy["parameters"] = _normalize_strict_json_schema(params)
            copied["function"] = fn_copy
        tools.append(copied)
    return tools


def _normalize_strict_json_schema(schema: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in schema.items():
        if key == "additionalProperties" or key in _STRICT_SCHEMA_DROPPED_KEYS:
            continue
        if isinstance(value, dict):
            out[key] = _normalize_strict_json_schema(value)
        elif isinstance(value, list):
            out[key] = [
                _normalize_strict_json_schema(item) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            out[key] = value
    return out
