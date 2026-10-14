"""Per-thread record of what the last real request actually carried.

The composer ring used to split an *estimate* of the stored conversation. The
numbers a reader wants are the ones the model was handed, and the only code
that sees the finished payload is the ReAct loop that assembles it — so that
is where the sizes are measured, and this module is the hand-off back to the
ring's endpoint.

The map is bounded and lives in this process: it is a display cache, not a
source of truth. A miss (fresh server, thread never run here) is answered by
the message-based estimate instead, and ``source`` tells the caller which one
it got.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any

# Buckets the request itself can be measured into.
MEASURED_KEYS = (
    "messages",
    "mcp_tools",
    "system_tools",
    "skills",
    "system_prompt",
    "memory",
)

# Beyond this many threads the oldest snapshot is dropped. The ring only ever
# reads the thread it is displaying, so the map is a short-lived cache.
_MAX_THREADS = 200

# The assembly writes the skill catalogue and the memory blocks into the
# system prompt as prose. These are the headings it actually uses, so their
# spans are measured from the real text instead of guessed from the
# conversation. Two headers exist because the ReAct loop and the planner
# each build their own catalogue.
_SKILLS_MARKERS = ("AVAILABLE SKILLS", "可用工具 (skill):")
_MEMORY_MARKERS = ("RELEVANT LONG-TERM MEMORY:", "USER PROFILE MEMORY:")
_SECTION_MARKERS = _SKILLS_MARKERS + _MEMORY_MARKERS

_LOCK = threading.Lock()
_SNAPSHOTS: dict[str, dict[str, Any]] = {}


def estimate_tokens(text: str) -> int:
    """Same chars/4 estimate the frontend uses, so the two stay comparable."""
    if not text:
        return 0
    return max(1, len(text) // 4)


def _field(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _text_of(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(
                    str(item.get("text") or item.get("thinking") or item.get("content") or "")
                )
        return "\n".join(part for part in parts if part)
    if isinstance(value, dict):
        return str(value.get("text") or value.get("content") or "")
    return str(value)


def classify_tool_name(name: str) -> str:
    """Bucket a tool name the way the ring labels it."""
    probe = (name or "").lower()
    if "mcp" in probe:
        return "mcp_tools"
    if "skill" in probe or probe.startswith("use_capability") or probe.startswith("query_skill"):
        return "skills"
    if "memory" in probe or "remember" in probe:
        return "memory"
    return "system_tools"


def _starts_with_any(text: str, markers: tuple[str, ...]) -> bool:
    return any(text.startswith(marker) for marker in markers)


def split_system_sections(text: str) -> dict[str, str]:
    """Slice a system prompt into the labelled spans it already contains.

    The assembly appends each section as its own paragraph and joins them
    with blank lines, so a section is identified by the heading its own
    paragraph opens with. Anchoring on the paragraph — rather than letting a
    heading swallow everything up to the next one — keeps the guidance that
    follows the tool catalogue out of the skills bucket. Text that merely
    mentions a heading is not reclassified, and a prompt with no headings
    reports every token as ``system_prompt``: nothing is invented either way.
    """
    buckets: dict[str, list[str]] = {"system_prompt": [], "skills": [], "memory": []}
    if not text:
        return {key: "" for key in buckets}

    for paragraph in text.split("\n\n"):
        stripped = paragraph.lstrip()
        if _starts_with_any(stripped, _SKILLS_MARKERS):
            buckets["skills"].append(paragraph)
        elif _starts_with_any(stripped, _MEMORY_MARKERS):
            buckets["memory"].append(paragraph)
        else:
            buckets["system_prompt"].append(paragraph)
    return {key: "\n\n".join(chunks) for key, chunks in buckets.items()}


def measure_request(messages: Any, tools: Any) -> dict[str, int]:
    """Token totals for one assembled request, per ring bucket."""
    tokens = {key: 0 for key in MEASURED_KEYS}
    for message in messages or []:
        text = _text_of(_field(message, "content"))
        role = str(_field(message, "role", "") or "").lower()
        if role in {"system", "developer"}:
            for bucket, span in split_system_sections(text).items():
                tokens[bucket] += estimate_tokens(span)
            continue
        if role in {"tool", "function"}:
            name = str(_field(message, "name", "") or "")
            tokens[classify_tool_name(name)] += estimate_tokens(text)
            continue
        # User / assistant prose is conversation. Tool calls carried on an
        # assistant turn are charged to the bucket their tool belongs to.
        tokens["messages"] += estimate_tokens(text)
        for call in _field(message, "tool_calls", None) or []:
            name = str(_field(call, "name", "") or "")
            args = _field(call, "args", None)
            if args is None:
                args = _field(call, "arguments", None)
            payload = f"{name}\n{_text_of(args)}" if args is not None else name
            tokens[classify_tool_name(name)] += estimate_tokens(payload)

    for tool in tools or []:
        name = str(_field(tool, "name", "") or "")
        schema = _field(tool, "input_schema", None)
        description = str(_field(tool, "description", "") or "")
        try:
            schema_text = json.dumps(schema, default=str) if schema else ""
        except (TypeError, ValueError):
            schema_text = str(schema)
        blob = "\n".join(part for part in (name, description, schema_text) if part)
        tokens[classify_tool_name(name)] += estimate_tokens(blob)
    return tokens


def record_request_context(thread_id: str, messages: Any, tools: Any) -> dict[str, Any] | None:
    """Measure one assembled request and remember it for ``thread_id``.

    Called from the ReAct loop, so it must never raise: a display cache that
    can break a turn is worse than a ring that falls back to its estimate.
    """
    if not thread_id:
        return None
    try:
        tokens = measure_request(messages, tools)
    except Exception:  # pragma: no cover - defensive: never break a turn
        return None
    snapshot = {"tokens": tokens, "measured_at": time.time()}
    with _LOCK:
        _SNAPSHOTS[thread_id] = snapshot
        if len(_SNAPSHOTS) > _MAX_THREADS:
            oldest = min(_SNAPSHOTS, key=lambda key: _SNAPSHOTS[key]["measured_at"])
            _SNAPSHOTS.pop(oldest, None)
    return snapshot


def get_request_context(thread_id: str) -> dict[str, Any] | None:
    """Return the last measured composition for ``thread_id``, if any."""
    if not thread_id:
        return None
    with _LOCK:
        snapshot = _SNAPSHOTS.get(thread_id)
        if snapshot is None:
            return None
        return {"tokens": dict(snapshot["tokens"]), "measured_at": snapshot["measured_at"]}


def clear_request_context(thread_id: str | None = None) -> None:
    """Drop one thread's snapshot, or every one of them (tests, deletion)."""
    with _LOCK:
        if thread_id is None:
            _SNAPSHOTS.clear()
        else:
            _SNAPSHOTS.pop(thread_id, None)
