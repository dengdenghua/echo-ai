"""Sub-agent observability helpers: event emission and trace-context derivation.

Extracted from ``bridge.py`` as part of a structural refactor. These are
pure helpers with no dependency on bridge module-level state, so they are
safe to import eagerly.
"""

from __future__ import annotations

import contextlib
from collections.abc import Callable
from typing import Any


def _safe_emit(emitter: Callable[[dict], None] | None, event: dict) -> None:
    """Fire-and-forget event emission. Exceptions are swallowed."""
    if emitter is None:
        return
    with contextlib.suppress(Exception):
        emitter(event)


def _safe_journal_emit(event: dict) -> None:
    """Mirror a lifecycle event into the genome journal so the
    realtime gateway / observability subscribers see it without
    relying on the in-memory ``event_emitter`` being plumbed.

    Best-effort; never raises. The runtime journal helper is
    imported lazily so unit tests that don't bootstrap the journal
    stack stay green.
    """
    if not isinstance(event, dict):
        return
    kind = event.get("type")
    if kind not in {"subagent_spawned", "subagent_finished"}:
        return
    try:
        from runtime.execution.suckers.ephemeral_runner import (
            _emit_subagent_lifecycle_event,
        )
    except ImportError:
        return
    with contextlib.suppress(Exception):
        # ``bridge.call_subagent`` publishes the typed event-bus lifecycle
        # explicitly, with the caller session's stable thread lineage.  This
        # helper therefore owns journal persistence only; publishing here as
        # well would duplicate every spawn/finish whenever a journal exists.
        _emit_subagent_lifecycle_event(kind, event, publish_bus=False)


def _clean_trace_value(value: Any, *, limit: int = 256) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    return text[:limit]


def _trace_context_value(
    context: dict[str, Any] | None,
    metadata: dict[str, Any],
    *keys: str,
) -> str:
    if isinstance(context, dict):
        for key in keys:
            value = _clean_trace_value(context.get(key))
            if value:
                return value
    for key in keys:
        value = _clean_trace_value(metadata.get(key))
        if value:
            return value
    return ""


def _subagent_trace_context(
    context: dict[str, Any] | None,
    session: Any,
) -> dict[str, str]:
    """Derive stable parent trace anchors for subagent observability."""
    metadata = getattr(session, "metadata", None)
    if not isinstance(metadata, dict):
        metadata = {}

    thread_id = (
        _trace_context_value(
            context,
            metadata,
            "thread_id",
            "caller_thread_id",
            "conversation_id",
        )
        or _clean_trace_value(getattr(session, "thread_id", None))
        or _clean_trace_value(getattr(session, "conversation_id", None))
    )
    turn_id = _trace_context_value(
        context, metadata, "turn_id", "caller_turn_id"
    ) or _clean_trace_value(getattr(session, "turn_id", None))
    trace = {
        "thread_id": thread_id,
        "turn_id": turn_id,
        "parent_task_id": _trace_context_value(
            context,
            metadata,
            "parent_task_id",
            "parent_run_id",
            "parent_trace_id",
        ),
        "task_id": _trace_context_value(context, metadata, "task_id"),
        "run_id": _trace_context_value(context, metadata, "run_id", "task_run_id"),
        "trace_id": _trace_context_value(context, metadata, "trace_id"),
        "source": _trace_context_value(context, metadata, "source"),
        "parent_agent_id": (
            _trace_context_value(context, metadata, "parent_agent_id", "caller_agent_id")
            or _clean_trace_value(getattr(session, "agent_id", None))
        ),
    }
    return {key: value for key, value in trace.items() if value}


def _ensure_context_trace_fields(
    context: dict[str, Any] | None,
    trace: dict[str, str],
) -> dict[str, Any] | None:
    if not trace:
        return context
    if context is None:
        context = {}
    for key, value in trace.items():
        context.setdefault(key, value)
    return context


def _attach_trace_fields(payload: dict[str, Any], trace: dict[str, str]) -> dict[str, Any]:
    if not trace:
        return payload
    payload.setdefault("trace", dict(trace))
    for key, value in trace.items():
        payload.setdefault(key, value)
    return payload


def _publish_bus_lifecycle(kind: str, event: dict, session: Any) -> None:
    """Mirror sub-agent spawn/finish lifecycle onto the typed event bus.

    The bus is what the Workbench subscribes to for an independent,
    full-fidelity stream. Publishing here (in addition to the journal +
    ``event_emitter``) means EVERY dispatch — including custom runners that
    never touch the ephemeral runner's emit helpers — surfaces lifecycle on
    the bus, keyed to the caller's thread lineage root.
    """
    import contextlib

    with contextlib.suppress(Exception):
        from runtime.execution.subagents.event_bus import publish_subagent_event

        meta = getattr(session, "metadata", None) or {}
        if not isinstance(meta, dict):
            meta = {}
        thread_id = meta.get("thread_id") or getattr(session, "thread_id", None) or ""
        root = meta.get("root_thread_id") or thread_id or ""
        role = event.get("role") or event.get("agent_id") or ""
        if kind == "subagent_spawned":
            publish_subagent_event(
                "sub_started",
                {
                    "role": role,
                    "agent_id": event.get("requested_agent_id") or event.get("agent_id") or "",
                    "resolved_agent_id": event.get("agent_id") or "",
                    "codename": event.get("codename") or "",
                    "avatar": event.get("avatar") or "",
                    "prompt_preview": (event.get("prompt_preview") or "")[:200],
                    "started_at": event.get("started_at"),
                    "parent_tool_use_id": event.get("parent_tool_use_id") or "",
                },
                thread_id=thread_id,
                root_thread_id=root,
            )
        else:
            ok = bool(event.get("ok"))
            bus_type = "sub_concluded" if ok and not event.get("error") else "sub_failed"
            publish_subagent_event(
                bus_type,
                {
                    "role": role,
                    "agent_id": event.get("requested_agent_id") or event.get("agent_id") or "",
                    "resolved_agent_id": event.get("agent_id") or "",
                    "codename": event.get("codename") or "",
                    "avatar": event.get("avatar") or "",
                    "ok": ok,
                    "error": event.get("error") or "",
                    "duration_s": event.get("duration_s"),
                    "iteration_count": event.get("iteration_count"),
                    "files_touched": event.get("files_touched") or 0,
                    "status": event.get("status") or "",
                    "output": event.get("output") or "",
                    "parent_tool_use_id": event.get("parent_tool_use_id") or "",
                },
                thread_id=thread_id,
                root_thread_id=root,
            )
