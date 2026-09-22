"""Stable, opaque row identifiers for operator-configured model routes.

The browser must be able to distinguish all three dimensions of a picker row:
the custom endpoint entry, its concrete upstream model, and its context profile.
None of those dimensions can safely be inferred from the legacy ``model`` or
``entry_id`` fields because both may be shared by several rows.

``selection_id`` is therefore a versioned digest of those non-secret routing
coordinates.  It is deterministic across restarts, contains no credentials or
base URL, and is resolved only against the current custom-model catalog.

The module also owns the reverse lookup (``entry_matches_model`` /
``find_custom_model_entry``) that maps a bare model id back to its entry.  It
lives here, below the flag modules that consume it, so the sensing adapter and
the layer-neutral platform flags cannot drift apart on how an entry is
matched.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

SELECTION_ID_PREFIX = "echo-custom-model:v1:"
DEFAULT_CONTEXT_PROFILE = "default"
LONG_CONTEXT_PROFILE = "1m"


@dataclass(frozen=True)
class CustomModelSelection:
    selection_id: str
    entry_id: str
    model: str
    context_profile: str
    entry: dict[str, Any]


def custom_model_selection_id(
    entry_id: str,
    model: str,
    context_profile: str = DEFAULT_CONTEXT_PROFILE,
) -> str:
    """Return the stable opaque id for one advertised custom-model row."""

    coordinates = json.dumps(
        ["echo.custom-model-selection.v1", entry_id, model, context_profile],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    digest = hashlib.sha256(coordinates).hexdigest()[:24]
    return f"{SELECTION_ID_PREFIX}{digest}"


def custom_model_upstreams(entry: dict[str, Any], entry_id: str) -> list[str]:
    """Resolve modern and legacy upstream fields without changing their order."""

    raw_models = entry.get("models")
    if isinstance(raw_models, list) and raw_models:
        upstreams = [str(item).strip() for item in raw_models if str(item or "").strip()]
        if upstreams:
            return upstreams

    legacy: list[str] = []
    primary = entry.get("model")
    if isinstance(primary, str) and primary.strip():
        legacy.append(primary.strip())
    performance = entry.get("model_performance")
    if isinstance(performance, str) and performance.strip() and performance.strip() not in legacy:
        legacy.append(performance.strip())
    return legacy or [entry_id]


def custom_model_1m_enabled(entry: dict[str, Any], upstreams: list[str]) -> bool:
    explicit = entry.get("enable_1m_context")
    if isinstance(explicit, bool):
        return explicit
    probe = " ".join(upstreams).lower()
    return any(marker in probe for marker in ("glm-5.2", "deepseek-v4-flash", "deepseek-v4-pro"))


def selections_for_entry(
    entry_id: str,
    entry: dict[str, Any],
) -> Iterator[CustomModelSelection]:
    """Yield every selectable variant/profile coordinate for one endpoint."""

    resolved_entry_id = str(entry.get("id") or entry_id).strip()
    if not resolved_entry_id:
        return
    upstreams = custom_model_upstreams(entry, resolved_entry_id)
    profiles = [DEFAULT_CONTEXT_PROFILE]
    if custom_model_1m_enabled(entry, upstreams):
        profiles.append(LONG_CONTEXT_PROFILE)
    for model in upstreams:
        for profile in profiles:
            yield CustomModelSelection(
                selection_id=custom_model_selection_id(
                    resolved_entry_id,
                    model,
                    profile,
                ),
                entry_id=resolved_entry_id,
                model=model,
                context_profile=profile,
                entry=entry,
            )


def iter_custom_model_selections(
    custom_models: dict[str, Any],
) -> Iterator[CustomModelSelection]:
    for raw_entry_id, entry in custom_models.items():
        if not isinstance(entry, dict):
            continue
        yield from selections_for_entry(str(raw_entry_id), entry)


def resolve_custom_model_selection(
    custom_models: dict[str, Any],
    selection_id: str,
) -> CustomModelSelection | None:
    """Resolve an advertised id; arbitrary or stale digests fail closed."""

    candidate = str(selection_id or "").strip()
    if not candidate.startswith(SELECTION_ID_PREFIX):
        return None
    for selection in iter_custom_model_selections(custom_models):
        if selection.selection_id == candidate:
            return selection
    return None


def entry_matches_model(entry: Any, model: str) -> bool:
    """Whether one operator entry advertises ``model``.

    Accepts the opaque picker ids minted above as well as the legacy
    ``id``/``name``/``model``/``display_name`` fields and the ``models``
    list, because the router and the gateway both address entries by
    whichever coordinate their caller had at hand.
    """

    if not isinstance(entry, dict):
        return False
    target = (model or "").strip()
    if not target:
        return False
    entry_id = str(entry.get("id") or "").strip()
    if entry_id and any(
        selection.selection_id == target for selection in selections_for_entry(entry_id, entry)
    ):
        return True
    target = target.removesuffix("::1m")
    candidates = {
        str(value).strip()
        for value in (
            entry.get("id"),
            entry.get("name"),
            entry.get("model"),
            entry.get("display_name"),
        )
        if isinstance(value, str) and value.strip()
    }
    raw_models = entry.get("models")
    if isinstance(raw_models, list):
        candidates.update(
            str(value).strip() for value in raw_models if isinstance(value, str) and value.strip()
        )
    return target in candidates


def normalize_base_url(value: Any) -> str | None:
    """Canonical form of a declared/called base URL for identity comparison."""

    if not isinstance(value, str):
        return None
    candidate = value.strip().rstrip("/")
    return candidate.lower() or None


def find_custom_model_entry(
    custom_models: dict[str, Any],
    model: str,
    base_url: str | None = None,
) -> dict[str, Any] | None:
    """Reverse-look-up the operator entry that declares ``model``.

    ``base_url`` disambiguates the match. A relay fronts many vendors behind
    one URL, so several entries advertise the same upstream model id and a
    catalog-order match applied one vendor's compatibility quirks to another
    vendor's model. With a hint an entry must either declare that same base
    URL or declare none at all (credential-backed / declarative-only entries
    such as an OpenAI API-key row); an entry that pins the model to a
    *different* endpoint vetoes the unanchored match rather than leaking
    across endpoints.

    Without a hint the historical first-match-wins order is preserved, so
    callers that only know a model id keep behaving exactly as before.
    """

    hint = normalize_base_url(base_url)
    declarative: dict[str, Any] | None = None
    conflicted = False
    for entry in custom_models.values():
        if not entry_matches_model(entry, model):
            continue
        if hint is None:
            return entry
        declared = normalize_base_url(entry.get("base_url"))
        if declared == hint:
            # Exact endpoint identity outranks every weaker signal.
            return entry
        if declared is None:
            if declarative is None:
                declarative = entry
        else:
            conflicted = True
    if hint is not None and conflicted:
        return None
    return declarative


__all__ = [
    "CustomModelSelection",
    "DEFAULT_CONTEXT_PROFILE",
    "LONG_CONTEXT_PROFILE",
    "SELECTION_ID_PREFIX",
    "custom_model_1m_enabled",
    "custom_model_selection_id",
    "custom_model_upstreams",
    "entry_matches_model",
    "find_custom_model_entry",
    "iter_custom_model_selections",
    "normalize_base_url",
    "resolve_custom_model_selection",
    "selections_for_entry",
]
