"""Dry-run request-contract summary for OpenAI-compatible gateways.

Extracted from ``openai_compat_providers.py``: the representative probe
payload and the capability matrix / risk scoring built from a
normalized payload and its planned fallback retries.
"""

from __future__ import annotations

from typing import Any

from ._providers_data import OpenAICompatRetryPayload


def sample_openai_compat_contract_payload(model: str) -> dict[str, Any]:
    """Representative dry-run request covering common compat edge-fields."""
    return {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "temperature": 0.7,
        "top_p": 0.9,
        "presence_penalty": 0.0,
        "frequency_penalty": 0.0,
        "max_tokens": 8,
        "stream": True,
        "stream_options": {"include_usage": True},
        "response_format": {"type": "json_object"},
        "reasoning_effort": "high",
        "thinking": {"type": "enabled"},
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "diagnostic_ping",
                    "description": "No-op compatibility probe.",
                    "parameters": {
                        "$schema": "https://json-schema.org/draft/2020-12/schema",
                        "title": "Diagnostic ping input",
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "default": "README.md",
                                "examples": ["README.md"],
                                "format": "uri-reference",
                                "additionalProperties": False,
                            },
                        },
                        "additionalProperties": True,
                    },
                },
            },
        ],
        "tool_choice": "auto",
        "parallel_tool_calls": True,
    }


def _request_contract_summary(
    *,
    normalized: dict[str, Any],
    removed_fields: tuple[str, ...],
    changed_fields: tuple[str, ...],
    retry_plan: list[OpenAICompatRetryPayload],
    compat_score: int,
) -> dict[str, Any]:
    retry_removed: set[str] = set()
    retry_changed: set[str] = set()
    retry_reasons: list[str] = []
    for retry in retry_plan:
        retry_reasons.append(str(retry.reason or ""))
        retry_removed.update(str(v) for v in retry.removed_fields or ())
        retry_changed.update(str(v) for v in retry.changed_fields or ())

    removed = set(removed_fields)
    changed = set(changed_fields)
    matrix = [
        _compat_capability_row(
            "chat_completion",
            "pass" if {"model", "messages"}.issubset(normalized) else "warn",
            [
                "model preserved" if "model" in normalized else "model missing",
                ("messages preserved" if "messages" in normalized else "messages missing"),
            ],
            ["dry_run_request_shape_only"],
        ),
        _compat_capability_row(
            "streaming",
            "warn" if "stream_options" in retry_removed else "unverified",
            [
                (
                    "stream flag preserved"
                    if normalized.get("stream") is True
                    else "stream flag not preserved"
                ),
                (
                    "stream_options preserved"
                    if "stream_options" in normalized
                    else "stream_options absent"
                ),
            ],
            [
                "dry_run_does_not_open_stream",
                *(
                    ["strict fallback may drop stream_options"]
                    if "stream_options" in retry_removed
                    else []
                ),
            ],
        ),
        _compat_capability_row(
            "tool_calling",
            "warn" if {"tools", "tool_choice"} & (removed | retry_removed) else "pass",
            [
                "tools preserved" if "tools" in normalized else "tools removed",
                ("tool_choice preserved" if "tool_choice" in normalized else "tool_choice absent"),
            ],
            [
                *(["parallel_tool_calls removed"] if "parallel_tool_calls" in removed else []),
                *(["tool schema normalized"] if "tools" in changed else []),
                *(["fallback may drop tool_choice"] if "tool_choice" in retry_removed else []),
                *(["fallback may drop tools"] if "tools" in retry_removed else []),
            ],
        ),
        _compat_capability_row(
            "structured_output",
            "warn" if "response_format" in retry_removed else "unverified",
            [
                (
                    "response_format preserved"
                    if "response_format" in normalized
                    else "response_format absent"
                ),
            ],
            [
                "dry_run_does_not_validate_response_schema",
                *(
                    ["strict fallback may drop response_format"]
                    if "response_format" in retry_removed
                    else []
                ),
            ],
        ),
        _compat_capability_row(
            "reasoning_request",
            "warn"
            if {"reasoning_effort", "thinking"}
            & (removed | changed | retry_removed | retry_changed)
            else "pass",
            [
                (
                    "reasoning_effort preserved"
                    if "reasoning_effort" in normalized
                    else "reasoning_effort absent"
                ),
                "thinking preserved" if "thinking" in normalized else "thinking absent",
            ],
            [
                *(
                    ["reasoning request normalized"]
                    if {"reasoning_effort", "thinking"} & (removed | changed)
                    else []
                ),
                *(
                    ["fallback may drop reasoning fields"]
                    if {"reasoning_effort", "thinking"} & retry_removed
                    else []
                ),
            ],
        ),
        _compat_capability_row(
            "usage_accounting",
            "warn" if "stream_options" in retry_removed else "unverified",
            [
                (
                    "stream usage requested"
                    if normalized.get("stream_options", {}).get("include_usage") is True
                    else "stream usage not requested"
                ),
            ],
            [
                "response_usage_shape_not_called_in_dry_run",
                *(
                    ["strict fallback may drop stream usage"]
                    if "stream_options" in retry_removed
                    else []
                ),
            ],
        ),
        _compat_capability_row(
            "fallback_retries",
            "pass" if retry_plan else "unverified",
            [
                f"{len(retry_plan)} retry variants planned",
                *retry_reasons[:4],
            ],
            ["dry_run_representative_400"],
        ),
    ]

    risk_reasons: list[str] = []
    risk_points = 0

    def add_risk(reason: str, points: int = 1) -> None:
        nonlocal risk_points
        if reason not in risk_reasons:
            risk_reasons.append(reason)
        risk_points += points

    if compat_score < 80:
        add_risk(f"compat_score:{compat_score}", 2 if compat_score < 70 else 1)
    if {"reasoning_effort", "thinking"} & (removed | changed):
        add_risk("reasoning_request_normalized", 1)
    if {"temperature", "top_p", "presence_penalty", "frequency_penalty"} & removed:
        add_risk("sampling_parameters_removed", 1)
    if "parallel_tool_calls" in removed:
        add_risk("parallel_tool_calls_removed", 1)
    if "tool_choice" in removed:
        add_risk("tool_calling_control_removed", 2)
    if "tools" in changed:
        add_risk("tool_schema_normalized", 1)
    if {"tool_choice", "tools"} & retry_removed:
        add_risk("tool_calling_fallback_degrades_control", 1)
    if {"response_format", "stream_options"} & retry_removed:
        add_risk("strict_provider_may_drop_optional_features", 0)
    if {"model", "messages"} & removed:
        add_risk("core_request_field_removed", 3)
    if "tools" in removed:
        add_risk("tool_calling_removed", 2)

    if risk_points >= 5:
        risk_level = "high"
    elif risk_points >= 2:
        risk_level = "medium"
    else:
        risk_level = "low"

    return {
        "risk_level": risk_level,
        "risk_reasons": risk_reasons,
        "capability_matrix": matrix,
    }


def _compat_capability_row(
    capability: str,
    status: str,
    evidence: list[str],
    notes: list[str],
) -> dict[str, Any]:
    return {
        "capability": capability,
        "status": status,
        "evidence": [item for item in evidence if item],
        "notes": [item for item in notes if item],
    }
