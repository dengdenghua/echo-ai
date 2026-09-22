"""Operator-declared capability flags from ``custom_models.json``.

The OpenAI-compatible router consults these to decide, per model id,
whether to send ``tools``, sampling knobs, or thinking parameters.
Kept apart from the router so the flag semantics stay reusable and the
router module stays under the god-file threshold.
"""

from __future__ import annotations

import json
from typing import Any

from runtime.platform.models.custom_model_selection import (
    LONG_CONTEXT_PROFILE,
    entry_matches_model,
    find_custom_model_entry,
    resolve_custom_model_selection,
)


def read_custom_models() -> dict[str, Any] | None:
    try:
        from runtime.platform.process.paths import app_paths

        path = app_paths().custom_models_path
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError, ImportError, TypeError):
        return None


def custom_model_entry_for(model: str, base_url: str | None = None) -> dict[str, Any] | None:
    """Resolve the operator entry behind ``model``.

    ``base_url`` is the endpoint the caller is actually about to hit. Passing
    it keeps a relay from lending one vendor's entry flags to a same-named
    model served by another vendor; omitting it preserves the historical
    model-only lookup for callers that have no endpoint context.
    """

    data = read_custom_models()
    if not isinstance(data, dict):
        return None
    selection = resolve_custom_model_selection(data, model)
    if selection is not None:
        return selection.entry
    return find_custom_model_entry(data, model, base_url)


def model_supports_tool_use(model: str) -> bool:
    """Return False when ``custom_models.json`` (or per-model env
    overrides) marks this model id as not supporting native
    function calling.

    Default is True — most OpenAI-compatible endpoints honor
    ``tools``. We only flip to False when the operator has
    explicitly declared incompatibility, so we don't accidentally
    disable working providers.
    """
    entry = custom_model_entry_for(model)
    return not (isinstance(entry, dict) and entry.get("supports_tool_use") is False)


def model_omits_sampling_parameters(model: str) -> bool:
    """Return True for strict OpenAI-compatible coding endpoints.

    Some coding-model gateways reject sampling knobs entirely (or
    require their undocumented defaults). Operators can declare
    ``omit_sampling_parameters=true`` in ``custom_models.json`` so
    Echo sends only model/messages/max_tokens/tool fields.
    """
    entry = custom_model_entry_for(model)
    return bool(entry.get("omit_sampling_parameters")) if isinstance(entry, dict) else False


def custom_model_supports_thinking(model: str) -> bool:
    entry = custom_model_entry_for(model)
    return bool(entry.get("supports_thinking")) if isinstance(entry, dict) else False


def model_context_window(model: str) -> int | None:
    """Return the operator-declared input window for a custom model."""
    data = read_custom_models()
    selection = resolve_custom_model_selection(data, model) if isinstance(data, dict) else None
    entry = selection.entry if selection is not None else custom_model_entry_for(model)
    if not isinstance(entry, dict):
        return None
    if (
        selection is not None and selection.context_profile == LONG_CONTEXT_PROFILE
    ) or model.strip().endswith("::1m"):
        return 1_000_000
    raw_context_window = entry.get("context_window")
    if raw_context_window is None:
        return None
    try:
        value = int(raw_context_window)
    except (TypeError, ValueError):
        return None
    return value if 8_192 <= value <= 2_000_000 else 256_000


__all__ = [
    "custom_model_entry_for",
    "custom_model_supports_thinking",
    "entry_matches_model",
    "model_context_window",
    "model_omits_sampling_parameters",
    "model_supports_tool_use",
    "read_custom_models",
]
