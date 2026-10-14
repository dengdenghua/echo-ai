"""Project completed realtime agent output into the linked cowork room.

Split out of ``_realtime_turn_lifecycle_helpers`` (which re-exports
``_persist_cowork_agent_messages``) to keep that module under the god-file
line budget. Each projected message is attributed to the member that produced
it: group fan-out stamps ``AgentMessageItem.agent_id`` per bubble, and the
sender kind is read off the durable roster rather than self-reported.
"""

from __future__ import annotations

import contextlib
import logging
import re
from typing import Any

from runtime.protocol import AgentMessageItem, ErrorItem, ItemStatus, Turn

_logger = logging.getLogger(__name__)


def _cowork_group_state(runtime: Any, thread_id: str) -> Any:
    """Best-effort roster snapshot; ``None`` leaves every sender unattributed."""

    store = getattr(runtime, "_cowork_group_store", None)
    if store is None:
        store = getattr(getattr(runtime, "_app_state", None), "cowork_group_store", None)
    with contextlib.suppress(Exception):
        return store.state(thread_id) if store is not None else None
    return None


def _persist_cowork_agent_messages(
    runtime: Any,
    *,
    thread_id: str,
    turns: list[Turn],
    intent: Any,
) -> int:
    """Project completed realtime agent prose into the linked room timeline.

    Human prompts already enter ``collaboration_messages`` through the turn
    input bridge. Without the symmetric agent side, a group refresh could show
    the question but lose the answer because the answer lived only in the
    thread event log. Item ids become stable source ids, making repeated
    snapshots (and reconnect recovery) idempotent.
    """

    from runtime.memory.cowork.group import ai_sender_identity
    from runtime.sensing.gateway._realtime_turn_lifecycle_helpers import _collaboration_store

    context = getattr(intent, "user_context", None)
    if not isinstance(context, dict) or not context.get("cowork_persistent_group"):
        return 0
    room_id = str(context.get("cowork_room_id") or "").strip()
    store = _collaboration_store(runtime)
    append_message = getattr(store, "append_message", None)
    if not room_id or not callable(append_message):
        return 0

    thread_agent_id = str(context.get("agent") or context.get("agent_name") or "assistant").strip()
    group_state = _cowork_group_state(runtime, thread_id)
    projected = 0
    for turn in turns:
        for item in getattr(turn, "items", ()):
            if not isinstance(item, (AgentMessageItem, ErrorItem)):
                continue
            text = str(
                item.text if isinstance(item, AgentMessageItem) else item.message or ""
            ).strip()
            # Streaming snapshots may run before the final item snapshot. Do
            # not persist a partial answer; the terminal snapshot will retry.
            if not text or item.status == ItemStatus.IN_PROGRESS:
                continue
            # Group fan-out stamps each bubble with its member; everything else
            # (single responder, host summary, errors) speaks as the thread agent.
            agent_id = str(getattr(item, "agent_id", None) or thread_agent_id).strip()
            safe_agent_id = re.sub(r"[^A-Za-z0-9._:@-]+", "-", agent_id).strip("-") or "assistant"
            sender_kind, sender_driver = ai_sender_identity(group_state, agent_id)
            source_message_id = (
                f"thread:{'agent' if isinstance(item, AgentMessageItem) else 'error'}:{item.id}"
            )
            display_name = str(
                getattr(item, "agent_display_name", None) or agent_id or "Assistant"
            ).strip()
            message_type = "message" if isinstance(item, AgentMessageItem) else "system_card"
            metadata: dict[str, Any] = {
                "source_message_id": source_message_id,
                "message_type": message_type,
                "sender_type": "agent",
                "sender_kind": sender_kind,
                "sender_driver": sender_driver,
                "agent_id": safe_agent_id,
                "turn_id": turn.id,
                "item_id": item.id,
                "message_kind": (
                    item.message_kind if isinstance(item, AgentMessageItem) else "error"
                ),
            }
            if isinstance(item, AgentMessageItem) and item.reply_to:
                metadata["reply_to"] = item.reply_to
            if isinstance(item, ErrorItem):
                metadata["system_card"] = {
                    "type": "error",
                    "title": "执行失败",
                    "summary": text,
                    "status": "failed",
                }
            try:
                append_message(
                    thread_id,
                    room_id=room_id,
                    text=text,
                    participant_id=f"agent:{safe_agent_id}",
                    display_name=display_name,
                    metadata=metadata,
                )
                projected += 1
            except ValueError:
                # A prior snapshot already wrote this source id. The
                # collaboration store validates that any conflicting rewrite
                # is rejected; either way the room already has the answer.
                continue
            except Exception as exc:  # noqa: BLE001 — projection is a read-model bridge
                _logger.warning(
                    "cowork agent-message projection failed for %s/%s: %s",
                    thread_id,
                    item.id,
                    exc,
                )
    return projected
