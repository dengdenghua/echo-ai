"""Capture terminal trace reviews as pending experience candidates."""

from __future__ import annotations

import logging
from typing import Any

from runtime.protocol import Turn
from runtime.safety.auth.scope import TenantScope
from runtime.safety.evolution.service import get_evolution_service

_logger = logging.getLogger(__name__)


def record_finished_trace(
    runtime: Any,
    turn: Turn,
    *,
    status: str,
    reason: str,
    agent_id: str | None,
    engine: str,
    scope: TenantScope | None,
) -> None:
    """Persist the terminal fact before deriving any learning from it."""
    runtime._trace_store.record_task_run_finished(
        # The transport attempt identifies the trace, even for resumed tasks.
        task_id=turn.id,
        thread_id=turn.thread_id,
        turn_id=turn.id,
        agent_id=agent_id,
        status=status,
        reason=reason,
        scope=scope,
        metadata={
            "item_count": len(turn.items),
            "error": turn.error,
            "engine": engine,
            "outcome_reason": turn.outcome_reason,
            "completion_decision": turn.completion_decision,
        },
    )
    try:
        queue_finished_turn_review(runtime, turn, status=status, scope=scope)
    except Exception as exc:  # noqa: BLE001 — learning failure must not change the turn outcome
        _logger.warning("automatic turn review skipped for %s: %s", turn.id, exc)


def queue_finished_turn_review(*args: Any, **kwargs: Any) -> dict[str, Any] | None:
    """Transport compatibility adapter; learning belongs to self-evolution."""
    return get_evolution_service().queue_finished_turn_review(*args, **kwargs)
