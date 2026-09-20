"""Thread-scoped context window breakdown for the composer ring.

Hemolymph still budgets four buckets (system / suckers / memory / history).
The chat ring needs Claude's finer split of the *current conversation*:
messages, MCP tools, system tools, skills, system prompt, and memory.

This classifier walks the thread's stored messages. Token counts use the
same chars/4 estimate as the frontend so the ring total stays comparable
to the existing message estimate when provider usage is absent.
"""

from __future__ import annotations

from typing import Any

_KEYS = (
    "messages",
    "mcp_tools",
    "system_tools",
    "skills",
    "system_prompt",
    "memory",
)


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, len(text) // 4)


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


def _classify_tool_name(name: str) -> str:
    probe = (name or "").lower()
    if "mcp" in probe:
        return "mcp_tools"
    if "skill" in probe or probe.startswith("use_capability") or probe.startswith("query_skill"):
        return "skills"
    if "memory" in probe or "remember" in probe:
        return "memory"
    return "system_tools"


def breakdown_messages(messages: list[Any] | None) -> dict[str, Any]:
    """Return Claude-style segment totals for one thread's messages."""
    tokens = {key: 0 for key in _KEYS}
    items = {key: 0 for key in _KEYS}
    for raw in messages or []:
        if not isinstance(raw, dict):
            continue
        kind = str(raw.get("type") or raw.get("role") or "").lower()
        content = _text_of(raw.get("content"))
        if kind in {"system", "developer"}:
            if content:
                tokens["system_prompt"] += estimate_tokens(content)
                items["system_prompt"] += 1
            continue
        if kind in {"human", "user"}:
            if content:
                tokens["messages"] += estimate_tokens(content)
                items["messages"] += 1
            continue
        if kind in {"tool", "function"}:
            bucket = _classify_tool_name(str(raw.get("name") or raw.get("tool_call_id") or ""))
            if content:
                tokens[bucket] += estimate_tokens(content)
                items[bucket] += 1
            continue
        # AI / assistant: prose is messages; each tool call is its own bucket.
        if content:
            tokens["messages"] += estimate_tokens(content)
            items["messages"] += 1
        calls = raw.get("tool_calls")
        if isinstance(calls, list):
            for call in calls:
                if not isinstance(call, dict):
                    continue
                name = str(call.get("name") or "")
                args = _text_of(call.get("args") or call.get("arguments") or "")
                bucket = _classify_tool_name(name)
                tokens[bucket] += estimate_tokens(name + "\n" + args)
                items[bucket] += 1
    segments = [
        {"key": key, "tokens": tokens[key], "items": items[key]}
        for key in _KEYS
        if tokens[key] > 0 or items[key] > 0
    ]
    return {
        "segments": segments,
        "total_tokens": sum(tokens.values()),
    }


def breakdown_for_thread(thread_id: str, messages: list[Any] | None) -> dict[str, Any]:
    """Segments for one thread, preferring the last measured request.

    A measured request is used wholesale rather than blended with the
    estimate: a number matching neither measurement nor estimate would be
    worse than either. ``source`` tells the caller which one it got, so the
    ring can say so instead of presenting a guess as a reading.
    """
    from .context_snapshot import MEASURED_KEYS, get_request_context

    snapshot = get_request_context(thread_id)
    if snapshot is not None:
        tokens = snapshot["tokens"]
        return {
            "thread_id": thread_id,
            "segments": [
                {"key": key, "tokens": int(tokens.get(key, 0))}
                for key in MEASURED_KEYS
                if int(tokens.get(key, 0)) > 0
            ],
            "total_tokens": sum(int(tokens.get(key, 0)) for key in MEASURED_KEYS),
            "source": "request",
            "measured_at": snapshot["measured_at"],
        }

    estimate = breakdown_messages(messages)
    return {
        "thread_id": thread_id,
        "segments": [
            {"key": segment["key"], "tokens": segment["tokens"]} for segment in estimate["segments"]
        ],
        "total_tokens": estimate["total_tokens"],
        "source": "estimate",
        "measured_at": None,
    }


def handle_thread_context_breakdown(
    request: Any,
    thread_id: str,
    auth_fn: Any,
    tenant_fn: Any,
    require_store_fn: Any,
    require_thread_id_fn: Any,
    get_thread_fn: Any,
) -> dict[str, Any]:
    from fastapi import HTTPException

    actor_id = auth_fn(request)
    tenant_id = tenant_fn(request)
    require_store_fn()
    thread_id = require_thread_id_fn(thread_id)
    thread = get_thread_fn(thread_id, actor_id, tenant_id)
    if thread is None:
        raise HTTPException(404, f"thread not found: {thread_id}")
    values = thread.get("values") if isinstance(thread.get("values"), dict) else {}
    messages = values.get("messages") if isinstance(values, dict) else None
    return breakdown_for_thread(thread_id, messages if isinstance(messages, list) else [])

