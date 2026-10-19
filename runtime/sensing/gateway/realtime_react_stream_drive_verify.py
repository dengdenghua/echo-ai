"""Split out of :mod:`realtime_react_stream_drive_steps` so that module stays under the 1000-line
god-file ratchet. Everything here is re-exported by the original module, so
import sites do not move.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from typing import Any

from runtime.memory.threads.event_log import EventLog
from runtime.protocol import ItemMarker, ItemStatus, McpToolCallItem
from runtime.sensing.gateway._realtime_subagent_journal_items import (
    _emit_subagent_lifecycle_item,
    _emit_subagent_progress_item,
    _subagent_lifecycle_item_from_journal,
    _subagent_lifecycle_matches,
    _subagent_progress_item_from_journal,
    _subagent_tool_item_from_journal,
)
from runtime.sensing.gateway.realtime_gateway import EventEmitter

_SUBAGENT_PROGRESS_PREVIEW_CHARS = 2_400
_SUBAGENT_PROGRESS_EMIT_CHARS = 160
_SUBAGENT_PROGRESS_EMIT_INTERVAL_S = 0.25


def _start_subagent_lifecycle_bridge(
    runtime: Any,
    turn: Any,
    log: EventLog,
    emitter: EventEmitter,
    loop: asyncio.AbstractEventLoop,
    task_id: str,
) -> Callable[[], None] | None:
    """Subscribe the genome journal for this turn's sub-agent lifecycle.

    Returns the unsubscribe callable, or ``None`` when the stack's journal
    isn't a live ``StreamingJournal`` (the base ``Journal.subscribe`` is a
    documented no-op that still returns an unsubscribe — mirror
    ``stream_handler._has_live_subscribe``'s guard).
    """
    journal = getattr(getattr(runtime, "_stack", None), "journal", None)
    if journal is None:
        return None
    from runtime.memory.journal.journal import Journal as _JournalBase

    subscribe = getattr(type(journal), "subscribe", None)
    if subscribe is None or subscribe is _JournalBase.subscribe:
        return None
    task_id = str(task_id or "").strip()
    lane_identity: dict[str, dict[str, Any]] = {}
    started_tools: dict[str, McpToolCallItem] = {}
    progress_items: dict[str, McpToolCallItem] = {}
    progress_text: dict[str, str] = {}
    progress_pending_chars: dict[str, int] = {}
    progress_last_emit_at: dict[str, float] = {}
    progress_emitted_ids: set[str] = set()

    def _identity_for_event(event: Any) -> dict[str, Any]:
        """Resolve one child without using a shared role as its primary key."""
        role = str(getattr(event, "role_id", "") or "")
        event_agent_id = str(getattr(event, "agent_id", "") or "")
        event_codename = str(getattr(event, "codename", "") or "")
        base: dict[str, Any] = {}
        for alias in (event_codename, event_agent_id, role):
            if alias and alias in lane_identity:
                base = lane_identity[alias]
                break
        return {
            **base,
            "agent_id": event_agent_id or base.get("agent_id"),
            "codename": event_codename or base.get("codename"),
            "avatar": getattr(event, "avatar", "") or base.get("avatar"),
            "role": role or base.get("role"),
        }

    def _remember_identity(identity: dict[str, Any], role: str = "") -> None:
        # Codename and requested id are unique lane aliases. A resolved role
        # such as ``explorer`` is shared by siblings, so only use it as a
        # fallback for legacy events that carry no stronger identity.
        aliases = [
            str(identity.get("requested_agent_id") or ""),
            str(identity.get("agent_id") or ""),
            str(identity.get("codename") or ""),
        ]
        if not any(aliases) and role:
            aliases.append(role)
        for alias in aliases:
            if alias:
                lane_identity[alias] = identity

    def _on_journal_event(event: Any) -> None:
        if not _subagent_lifecycle_matches(event, task_id):
            return
        if getattr(event, "event_type", None) == "sub_text_delta":
            role = str(getattr(event, "role_id", "") or "")
            identity = _identity_for_event(event)
            delta = str(getattr(event, "delta", "") or "")
            if not delta:
                return
            lane_key = str(
                getattr(event, "session_id", "")
                or (identity or {}).get("codename")
                or (identity or {}).get("agent_id")
                or role
            )
            previous = progress_text.get(lane_key, "")
            combined = previous + delta
            # The finish marker carries the complete answer. Keep the live
            # progress item bounded so token streaming cannot grow one turn
            # without limit while preserving the newest visible context.
            if len(combined) > _SUBAGENT_PROGRESS_PREVIEW_CHARS:
                prefix = "…（较早输出已省略）\n"
                combined = prefix + combined[-(_SUBAGENT_PROGRESS_PREVIEW_CHARS - len(prefix)) :]
            progress_text[lane_key] = combined
            progress_item = _subagent_progress_item_from_journal(
                event,
                identity=identity,
                accumulated=combined,
            )
            if progress_item is None:
                return
            existing = progress_items.get(progress_item.id)
            if existing is not None:
                progress_item = progress_item.model_copy(update={"created_at": existing.created_at})
            progress_items[progress_item.id] = progress_item
            pending_chars = progress_pending_chars.get(lane_key, 0) + len(delta)
            now = time.monotonic()
            last_emit = progress_last_emit_at.get(lane_key, 0.0)
            should_emit = (
                progress_item.id not in progress_emitted_ids
                or pending_chars >= _SUBAGENT_PROGRESS_EMIT_CHARS
                or delta.endswith("\n")
                or (last_emit > 0 and now - last_emit >= _SUBAGENT_PROGRESS_EMIT_INTERVAL_S)
            )
            if not should_emit:
                progress_pending_chars[lane_key] = pending_chars
                return
            progress_pending_chars[lane_key] = 0
            progress_last_emit_at[lane_key] = now
            started = progress_item.id not in progress_emitted_ids
            progress_emitted_ids.add(progress_item.id)
            try:
                asyncio.run_coroutine_threadsafe(
                    _emit_subagent_progress_item(
                        turn,
                        log,
                        emitter,
                        progress_item,
                        started=started,
                    ),
                    loop,
                )
            except (RuntimeError, ValueError):
                return
            return
        item = _subagent_lifecycle_item_from_journal(event)
        if item is not None and item.tool == ItemMarker.SUBAGENT_SPAWNED.value:
            identity = dict(item.arguments)
            role = str(identity.get("role") or getattr(event, "role_id", "") or "")
            _remember_identity(identity, role)
        if item is None:
            role = str(getattr(event, "role_id", "") or "")
            identity = _identity_for_event(event)
            probe = _subagent_tool_item_from_journal(
                event,
                identity=identity,
            )
            started_item = started_tools.get(probe.id) if probe is not None else None
            item = _subagent_tool_item_from_journal(
                event,
                identity=identity,
                started_item=started_item,
            )
        if item is None:
            return
        terminal = item.status in {
            ItemStatus.COMPLETED,
            ItemStatus.FAILED,
        }
        if not terminal:
            started_tools[item.id] = item
        else:
            started_tools.pop(item.id, None)

        terminal_progress: list[McpToolCallItem] = []
        if item.tool == ItemMarker.SUBAGENT_FINISHED.value:
            result = item.result if isinstance(item.result, dict) else {}
            target_agent_id = str(result.get("agent_id") or "")
            target_codename = str(result.get("codename") or "")
            target_role = str(result.get("role") or "")
            # McpToolProgress has its own compact wire vocabulary.  Passing
            # ItemStatus values ("completed"/"failed") here serialized an
            # invalid progress object and left some clients showing a stale
            # spinner after the child had finished.
            progress_status = "done" if item.status == ItemStatus.COMPLETED else "error"
            for progress_id, progress_item in list(progress_items.items()):
                args = progress_item.arguments
                progress_agent_id = str(args.get("agent_id") or "")
                progress_codename = str(args.get("subagent_codename") or "")
                progress_role = str(args.get("sub_agent_role") or "")
                same_agent = bool(
                    (target_agent_id and progress_agent_id == target_agent_id)
                    or (target_codename and progress_codename == target_codename)
                    or (
                        not target_agent_id
                        and not target_codename
                        and target_role
                        and progress_role == target_role
                    )
                )
                if not same_agent:
                    continue
                progress = progress_item.progress
                completed_progress = progress_item.model_copy(
                    update={
                        "status": item.status,
                        "progress": (
                            progress.model_copy(update={"status": progress_status})
                            if progress is not None
                            else None
                        ),
                    }
                )
                progress_items[progress_id] = completed_progress
                terminal_progress.append(completed_progress)

        async def _emit_item_sequence() -> None:
            # Finish a child's public text lane before its lifecycle marker so
            # a completed card never keeps a stale spinner while sibling
            # agents are still running.
            for progress_item in terminal_progress:
                await _emit_subagent_lifecycle_item(
                    turn,
                    log,
                    emitter,
                    progress_item,
                    terminal=True,
                )
            await _emit_subagent_lifecycle_item(
                turn,
                log,
                emitter,
                item,
                terminal=terminal,
            )

        try:
            asyncio.run_coroutine_threadsafe(
                _emit_item_sequence(),
                loop,
            )
        except (RuntimeError, ValueError):
            # Loop already closed / task cancelled — drop the frame rather
            # than leak it into a torn-down turn.
            return

    try:
        return journal.subscribe(_on_journal_event)
    except Exception:  # noqa: BLE001 — telemetry bridge never breaks the turn
        return None
