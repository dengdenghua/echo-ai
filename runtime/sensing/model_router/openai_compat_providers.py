"""Provider profiles for OpenAI-compatible chat-completion gateways.

The OpenAI-compatible label hides a few practical differences across
domestic model providers: some reject OpenAI-only thinking fields, some
prefer stricter sampling payloads, and several expose reasoning text
through provider-specific response keys.  This module keeps those rules
data-driven so ``OpenAIModelRouter`` can stay a normal chat-completions
transport instead of accumulating provider-specific branches.

The immutable provider catalog (dataclasses, the ``_PROFILES`` registry,
and pure data-only accessors) lives in ``_providers_data`` and the
response-parsing helpers (reasoning/usage extraction, tool-call argument
decoding) live in ``_response_parsers``.  Both are re-exported here so
existing import sites continue to work unchanged.  The low-level payload
rewrite helpers live in ``_payload_rules`` and the dry-run contract
summary in ``_request_contract``.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from ._payload_rules import (
    _coerce_float,
    _coerce_string_tuple,
    _has_explicit_compat_override,
    _mentioned_payload_fields,
    _mentions_any,
    _mentions_tool_use_unsupported,
    _normalize_thinking_fields,
    _payload_delta,
    _payload_fingerprint,
    _payload_has_sampling,
    _remove_sampling_parameters,
    _strict_tools,
)
from ._providers_data import (
    GENERIC_OPENAI_PROFILE,
    REQUIRED_DOMESTIC_PROFILE_IDS,
    OpenAICompatProfileProbe,
    OpenAICompatProviderProfile,
    OpenAICompatRetryPayload,
    _compatibility_score,
    _profile_by_id,
    _sample_base_url_from_profile_markers,
    _sample_model_from_profile_markers,
    describe_openai_compat_profile,
    effective_supported_efforts,
    known_openai_compat_profiles,
    openai_compat_profile_ids,
    resolve_openai_compat_profile,
)
from ._request_contract import (
    _request_contract_summary,
    sample_openai_compat_contract_payload,
)
from ._response_parsers import (
    InlineReasoningSplitter,
    extract_openai_compat_reasoning,
    extract_openai_compat_usage,
    parse_tool_call_arguments,
    split_inline_reasoning,
)

_OPTIONAL_REQUEST_FIELD_FALLBACKS = (
    "parallel_tool_calls",
    "response_format",
    "stream_options",
    "logprobs",
    "top_logprobs",
)

_TOOL_REQUEST_FIELDS = ("tools", "tool_choice", "parallel_tool_calls")


def sample_openai_compat_profile_probe(
    profile: OpenAICompatProviderProfile,
) -> OpenAICompatProfileProbe:
    smoke = _smoke_provider_by_id().get(profile.id)
    base_url = (
        smoke.base_url if smoke is not None else _sample_base_url_from_profile_markers(profile)
    )
    model = (
        smoke.default_model if smoke is not None else _sample_model_from_profile_markers(profile)
    )
    return OpenAICompatProfileProbe(
        profile_id=profile.id,
        base_url=base_url,
        model=model,
        smoke_provider_configured=smoke is not None,
        base_url_resolves_to=resolve_openai_compat_profile(base_url).id,
        model_resolves_to=resolve_openai_compat_profile("", model).id,
    )


def audit_openai_compat_profile_catalog(
    required_profile_ids: tuple[str, ...] = REQUIRED_DOMESTIC_PROFILE_IDS,
) -> dict[str, Any]:
    profiles = list(known_openai_compat_profiles())
    profile_ids = [profile.id for profile in profiles]
    smoke_provider_ids = list(_smoke_provider_by_id())
    probes = [sample_openai_compat_profile_probe(profile) for profile in profiles]
    resolver_mismatches = [
        {
            "profile_id": probe.profile_id,
            "base_url": probe.base_url,
            "model": probe.model,
            "base_url_resolves_to": probe.base_url_resolves_to,
            "model_resolves_to": probe.model_resolves_to,
        }
        for probe in probes
        if probe.base_url_resolves_to != probe.profile_id
    ]
    model_alias_mismatches = [
        {
            "profile_id": probe.profile_id,
            "base_url": probe.base_url,
            "model": probe.model,
            "model_resolves_to": probe.model_resolves_to,
            "reason": "model_id_looks_like_upstream_model_on_aggregator",
        }
        for probe in probes
        if probe.model_resolves_to != probe.profile_id
    ]
    missing_required = [
        profile_id for profile_id in required_profile_ids if profile_id not in profile_ids
    ]
    missing_smoke = [
        profile_id for profile_id in profile_ids if profile_id not in smoke_provider_ids
    ]
    orphan_smoke = [
        provider_id for provider_id in smoke_provider_ids if provider_id not in profile_ids
    ]
    smoke_mismatches = [
        {
            "profile_id": probe.profile_id,
            "base_url": probe.base_url,
            "model": probe.model,
            "base_url_resolves_to": probe.base_url_resolves_to,
            "model_resolves_to": probe.model_resolves_to,
        }
        for probe in probes
        if probe.smoke_provider_configured and probe.base_url_resolves_to != probe.profile_id
    ]
    contract_probes = [
        probe_openai_compat_request_contract(
            _profile_by_id(probe.profile_id) or GENERIC_OPENAI_PROFILE,
            probe.model,
        )
        for probe in probes
    ]
    contract_mismatches = [
        {
            "profile_id": probe["profile_id"],
            "model": probe["model"],
            "risk_level": probe["risk_level"],
            "reason": "core_request_contract_changed",
        }
        for probe in contract_probes
        if not probe["contract_ready"]
    ]
    catalog_ready = (
        not missing_required
        and not missing_smoke
        and not orphan_smoke
        and not resolver_mismatches
        and not contract_mismatches
    )
    return {
        "schema": "echo.openai_compat_profile_audit.v1",
        "catalog_ready": catalog_ready,
        "profile_count": len(profile_ids),
        "profile_ids": profile_ids,
        "required_profile_ids": list(required_profile_ids),
        "missing_required_profile_ids": missing_required,
        "smoke_provider_ids": smoke_provider_ids,
        "missing_smoke_provider_ids": missing_smoke,
        "orphan_smoke_provider_ids": orphan_smoke,
        "resolver_mismatches": resolver_mismatches,
        "model_alias_mismatches": model_alias_mismatches,
        "smoke_resolver_mismatches": smoke_mismatches,
        "request_contract_mismatches": contract_mismatches,
        "request_contract_probes": contract_probes,
        "sample_probes": [
            {
                "profile_id": probe.profile_id,
                "base_url": probe.base_url,
                "model": probe.model,
                "smoke_provider_configured": probe.smoke_provider_configured,
                "base_url_resolves_to": probe.base_url_resolves_to,
                "model_resolves_to": probe.model_resolves_to,
            }
            for probe in probes
        ],
    }


def probe_openai_compat_request_contract(
    profile: OpenAICompatProviderProfile,
    model: str,
) -> dict[str, Any]:
    """Dry-run request contract probe for a provider/profile pair.

    This never calls the provider. It normalizes a representative request,
    plans retries for a representative strict-validation error, and reports
    which capabilities are preserved, normalized, or likely degraded.
    """
    original = sample_openai_compat_contract_payload(model)
    normalized = normalize_openai_compat_payload(original, profile=profile)
    removed, added, changed = _payload_delta(original, normalized)
    retry_plan = plan_openai_compat_retries(
        normalized,
        status_code=400,
        body=(
            "unsupported reasoning_effort thinking tool_choice "
            "temperature top_p max_completion_tokens stream_options "
            "response_format additionalProperties extra inputs are not "
            "permitted unsupported parameter"
        ),
        profile=profile,
    )
    summary = _request_contract_summary(
        normalized=normalized,
        removed_fields=removed,
        changed_fields=changed,
        retry_plan=retry_plan,
        compat_score=_compatibility_score(profile),
    )
    core_fields_ready = {"model", "messages"}.issubset(normalized)
    return {
        "schema": "echo.openai_compat_request_contract_probe.v1",
        "profile_id": profile.id,
        "model": model,
        "dry_run": True,
        "contract_ready": bool(core_fields_ready),
        "risk_level": summary["risk_level"],
        "risk_reasons": summary["risk_reasons"],
        "capability_matrix": summary["capability_matrix"],
        "original_fields": sorted(original),
        "normalized_fields": sorted(normalized),
        "removed_fields": list(removed),
        "added_fields": list(added),
        "changed_fields": list(changed),
        "normalized_payload": normalized,
        "fallback_retries": [
            {
                "reason": item.reason,
                "removed_fields": list(item.removed_fields),
                "added_fields": list(item.added_fields),
                "changed_fields": list(item.changed_fields),
                "payload_fields": sorted(item.payload),
            }
            for item in retry_plan
        ],
    }


def apply_custom_openai_compat_profile(
    entry: dict[str, Any] | None,
    *,
    base_profile: OpenAICompatProviderProfile,
) -> OpenAICompatProviderProfile:
    if not isinstance(entry, dict):
        return base_profile

    profile = _profile_by_id(entry.get("compat_profile")) or base_profile
    updates: dict[str, Any] = {}

    thinking_style = entry.get("thinking_request_style")
    if thinking_style in ("openai", "none", "minimax_adaptive", "deepseek"):
        updates["thinking_request_style"] = thinking_style

    for field_name in (
        "drop_tool_choice",
        "strict_tool_schema",
        "retry_without_tool_choice",
        "retry_without_sampling",
        "retry_max_tokens_as_completion_tokens",
    ):
        value = entry.get(field_name)
        if value is not None:
            updates[field_name] = bool(value)

    omit_sampling = entry.get("omit_sampling_parameters")
    if omit_sampling is not None and (
        omit_sampling is True or _has_explicit_compat_override(entry)
    ):
        updates["omit_sampling_parameters"] = bool(omit_sampling)

    max_temperature = _coerce_float(entry.get("max_temperature"))
    if max_temperature is not None:
        updates["max_temperature"] = max_temperature

    unsupported_fields = _coerce_string_tuple(entry.get("unsupported_request_fields"))
    if unsupported_fields is not None:
        updates["unsupported_request_fields"] = unsupported_fields

    if not updates:
        return profile
    return replace(profile, **updates)


def normalize_openai_compat_payload(
    payload: dict[str, Any],
    *,
    profile: OpenAICompatProviderProfile,
) -> dict[str, Any]:
    normalized = dict(payload)

    for field_name in profile.unsupported_request_fields:
        normalized.pop(field_name, None)

    _normalize_thinking_fields(normalized, profile)

    if profile.omit_sampling_parameters:
        _remove_sampling_parameters(normalized)
    elif profile.max_temperature is not None and "temperature" in normalized:
        value = normalized.get("temperature")
        if isinstance(value, int | float) and value > profile.max_temperature:
            normalized["temperature"] = profile.max_temperature

    if profile.drop_tool_choice:
        normalized.pop("tool_choice", None)

    if profile.strict_tool_schema and "tools" in normalized:
        normalized["tools"] = _strict_tools(normalized.get("tools"))

    return normalized


def retry_payloads_after_openai_compat_error(
    payload: dict[str, Any],
    *,
    status_code: int,
    body: str = "",
    profile: OpenAICompatProviderProfile = GENERIC_OPENAI_PROFILE,
) -> list[dict[str, Any]]:
    return [
        item.payload
        for item in plan_openai_compat_retries(
            payload,
            status_code=status_code,
            body=body,
            profile=profile,
        )
    ]


def plan_openai_compat_retries(
    payload: dict[str, Any],
    *,
    status_code: int,
    body: str = "",
    profile: OpenAICompatProviderProfile = GENERIC_OPENAI_PROFILE,
) -> list[OpenAICompatRetryPayload]:
    if status_code not in (400, 422):
        return []

    variants: list[OpenAICompatRetryPayload] = []
    seen: set[str] = {_payload_fingerprint(payload)}
    cascade = dict(payload)
    cascade_reasons: list[str] = []

    def add(reason: str, candidate: dict[str, Any]) -> None:
        fp = _payload_fingerprint(candidate)
        if fp in seen:
            return
        seen.add(fp)
        removed, added, changed = _payload_delta(payload, candidate)
        variants.append(
            OpenAICompatRetryPayload(
                payload=candidate,
                reason=reason,
                removed_fields=removed,
                added_fields=added,
                changed_fields=changed,
            )
        )

    lower = (body or "").lower()
    strict_validation = _mentions_any(
        lower,
        (
            "unsupported parameter",
            "unsupported field",
            "unsupported request",
            "unrecognized field",
            "unknown field",
            "unknown parameter",
            "extra inputs are not permitted",
            "extra_forbidden",
            "invalid parameter",
        ),
    )

    if "reasoning_effort" in payload or "thinking" in payload:
        candidate = dict(payload)
        candidate.pop("reasoning_effort", None)
        candidate.pop("thinking", None)
        add("drop_thinking_fields", candidate)
        cascade.pop("reasoning_effort", None)
        cascade.pop("thinking", None)
        cascade_reasons.append("drop_thinking_fields")

    optional_fields = _mentioned_payload_fields(
        lower,
        payload,
        _OPTIONAL_REQUEST_FIELD_FALLBACKS,
    )
    if strict_validation and not optional_fields:
        optional_fields = tuple(
            field_name for field_name in _OPTIONAL_REQUEST_FIELD_FALLBACKS if field_name in payload
        )
    if optional_fields:
        candidate = dict(payload)
        for field_name in optional_fields:
            candidate.pop(field_name, None)
            cascade.pop(field_name, None)
        add(f"drop_unsupported_fields:{','.join(optional_fields)}", candidate)
        cascade_reasons.append("drop_unsupported_fields")

    if profile.retry_without_tool_choice and "tool_choice" in payload:
        candidate = dict(payload)
        candidate.pop("tool_choice", None)
        add("drop_tool_choice", candidate)
        cascade.pop("tool_choice", None)
        cascade_reasons.append("drop_tool_choice")

    if (
        profile.retry_without_sampling
        and _payload_has_sampling(payload)
        and (
            _mentions_any(
                lower, ("temperature", "top_p", "sampling", "presence_penalty", "frequency_penalty")
            )
            or strict_validation
            or profile.omit_sampling_parameters
        )
    ):
        candidate = dict(payload)
        _remove_sampling_parameters(candidate)
        add("drop_sampling_parameters", candidate)
        _remove_sampling_parameters(cascade)
        cascade_reasons.append("drop_sampling_parameters")

    if (
        profile.retry_max_tokens_as_completion_tokens
        and "max_tokens" in payload
        and "max_completion_tokens" not in payload
        and _mentions_any(lower, ("max_completion_tokens", "max_tokens", "max token"))
    ):
        candidate = dict(payload)
        candidate["max_completion_tokens"] = candidate.pop("max_tokens")
        add("rename_max_tokens", candidate)
        if "max_tokens" in cascade and "max_completion_tokens" not in cascade:
            cascade["max_completion_tokens"] = cascade.pop("max_tokens")
        cascade_reasons.append("rename_max_tokens")

    if (
        profile.retry_max_tokens_as_completion_tokens
        and "max_completion_tokens" in payload
        and "max_tokens" not in payload
        and _mentions_any(lower, ("max_completion_tokens", "max_tokens", "max token"))
    ):
        candidate = dict(payload)
        candidate["max_tokens"] = candidate.pop("max_completion_tokens")
        add("rename_max_completion_tokens", candidate)
        if "max_completion_tokens" in cascade and "max_tokens" not in cascade:
            cascade["max_tokens"] = cascade.pop("max_completion_tokens")
        cascade_reasons.append("rename_max_completion_tokens")

    if "tools" in payload and _mentions_any(
        lower,
        ("additionalproperties", "additional properties", "tool schema", "parameters"),
    ):
        candidate = dict(payload)
        candidate["tools"] = _strict_tools(candidate.get("tools"))
        add("strict_tool_schema", candidate)
        cascade["tools"] = _strict_tools(cascade.get("tools"))
        cascade_reasons.append("strict_tool_schema")

    if "tools" in payload and _mentions_tool_use_unsupported(lower):
        candidate = dict(payload)
        for field_name in _TOOL_REQUEST_FIELDS:
            candidate.pop(field_name, None)
            cascade.pop(field_name, None)
        add("drop_tools", candidate)
        cascade_reasons.append("drop_tools")

    if len(cascade_reasons) > 1:
        add("combined_compatibility_fallback", cascade)

    return variants


def _smoke_provider_by_id() -> dict[str, Any]:
    try:
        from runtime.sensing.model_router.openai_compat_smoke_matrix import (
            openai_compat_smoke_providers,
        )
    except Exception:  # pragma: no cover - optional module import guard
        return {}
    return {provider.id: provider for provider in openai_compat_smoke_providers()}


__all__ = [
    "GENERIC_OPENAI_PROFILE",
    "OpenAICompatProviderProfile",
    "OpenAICompatProfileProbe",
    "OpenAICompatRetryPayload",
    "REQUIRED_DOMESTIC_PROFILE_IDS",
    "InlineReasoningSplitter",
    "apply_custom_openai_compat_profile",
    "audit_openai_compat_profile_catalog",
    "describe_openai_compat_profile",
    "effective_supported_efforts",
    "extract_openai_compat_reasoning",
    "extract_openai_compat_usage",
    "known_openai_compat_profiles",
    "normalize_openai_compat_payload",
    "openai_compat_profile_ids",
    "parse_tool_call_arguments",
    "plan_openai_compat_retries",
    "resolve_openai_compat_profile",
    "retry_payloads_after_openai_compat_error",
    "sample_openai_compat_profile_probe",
    "split_inline_reasoning",
]
