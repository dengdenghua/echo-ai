"""Record encoding and thread-value helpers shared by the thread store modules."""

from __future__ import annotations

import copy
import re
from datetime import UTC, datetime
from typing import Any

_PATH_SEGMENT_RE = re.compile(r'[<>:"/\\|?*\x00-\x1F]')


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(tzinfo=None).isoformat() + "Z"


def _deepcopy(value: Any) -> Any:
    return copy.deepcopy(value)


_STATE_FROM_THREAD_KEY = "state_from_thread"


def _encoded_state_record(state: dict[str, Any]) -> dict[str, Any]:
    """Drop values duplicated verbatim by the record's ``thread`` payload."""

    return {key: value for key, value in state.items() if key not in {"values", "metadata"}}


def _decoded_state_record(
    record: dict[str, Any],
    thread: dict[str, Any],
) -> dict[str, Any] | None:
    raw_state = record.get("state")
    if not isinstance(raw_state, dict):
        return None
    if record.get(_STATE_FROM_THREAD_KEY) is not True:
        return raw_state
    state = dict(raw_state)
    # Thread snapshots are replaced rather than mutated in-place. Sharing the
    # immutable value objects here avoids recreating a second full conversation
    # in memory; all public getters return defensive deep copies.
    state["values"] = thread.get("values", {})
    state["metadata"] = thread.get("metadata", {})
    return state


_PROJECT_BINDING_METADATA_KEYS = frozenset(
    {"project_id", "project_home", "project_binding_generation"}
)
_PROJECT_BINDING_VALUE_KEYS = frozenset({"project_id", "project_home"})


def _without_project_binding_fields(
    payload: dict[str, Any] | None,
    keys: frozenset[str],
) -> dict[str, Any]:
    return {key: _deepcopy(value) for key, value in (payload or {}).items() if key not in keys}


def _sidebar_title_source(value: dict[str, Any]) -> str | None:
    """Extract a compact first-user-message title source without its history."""

    values = value.get("values")
    messages = values.get("messages") if isinstance(values, dict) else None
    if not isinstance(messages, list):
        return None
    for message in messages:
        if not isinstance(message, dict) or message.get("type") != "human":
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content[:4096]
        if isinstance(content, list):
            parts: list[str] = []
            for part in content:
                if isinstance(part, str):
                    parts.append(part)
                elif (
                    isinstance(part, dict)
                    and part.get("type") == "text"
                    and isinstance(part.get("text"), str)
                ):
                    parts.append(part["text"])
            title = " ".join(part for part in parts if part)
            return title[:4096] if title else None
        return None
    return None


def _project_fields(
    value: dict[str, Any],
    fields: tuple[str, ...] | list[str],
) -> dict[str, Any]:
    """Copy only requested top-level or dotted fields from a thread row."""

    projected: dict[str, Any] = {}
    for field in fields:
        if not isinstance(field, str):
            continue
        if field == "values.sidebar_title_source":
            raw_values = value.get("values")
            existing_title = (
                raw_values.get("sidebar_title_source") if isinstance(raw_values, dict) else None
            )
            title_source = (
                existing_title if isinstance(existing_title, str) else _sidebar_title_source(value)
            )
            if title_source is not None:
                projected.setdefault("values", {})["sidebar_title_source"] = title_source
            continue
        parts = tuple(part for part in field.split(".") if part)
        if not parts:
            continue
        source: Any = value
        target = projected
        for index, part in enumerate(parts):
            if not isinstance(source, dict) or part not in source:
                break
            if index == len(parts) - 1:
                target[part] = _deepcopy(source[part])
                break
            source = source[part]
            existing = target.get(part)
            if not isinstance(existing, dict):
                existing = {}
                target[part] = existing
            target = existing
    return projected


def _default_values(values: dict[str, Any] | None = None) -> dict[str, Any]:
    merged = {
        "title": "New chat",
        "messages": [],
        "artifacts": [],
    }
    if values:
        merged.update(_deepcopy(values))
    return merged


def _safe_path_segment(value: str, fallback: str) -> str:
    clean = _PATH_SEGMENT_RE.sub("_", value.strip())
    clean = re.sub(r"\s+", "-", clean).strip(" .")
    return clean or fallback
