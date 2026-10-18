"""Capture terminal trace reviews as pending experience candidates."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from runtime.memory.learning.review_queue import ReviewQueue
from runtime.platform import feature_flags
from runtime.protocol import Turn
from runtime.safety.auth.scope import TenantScope, tenant_scoped_path

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


def queue_finished_turn_review(
    runtime: Any, turn: Turn, *, status: str, scope: TenantScope | None
) -> dict[str, Any] | None:
    """Reuse evidence-derived reviews; never invent or automatically activate lessons.

    Pauses, cancellation and empty conversational turns are not failure lessons.
    Candidates remain in the existing review/promotion workflow. No model call
    or direct change to experience memory, skills, prompts or policy occurs.
    """
    if status not in {"completed", "failed"} or not feature_flags.is_on("memory.auto_review"):
        return None
    params = turn.params
    tenant = str(getattr(params, "tenant_id", None) or "").strip()
    owner = str(getattr(params, "owner_actor_id", None) or "").strip()
    if bool(tenant) != bool(owner):
        return None
    if tenant and (scope is None or (scope.tenant_id, scope.actor_id) != (tenant, owner)):
        return None
    review = runtime._trace_store.task_run_review(turn.id, scope=scope)
    if not isinstance(review, dict) or review.get("status") != status:
        return None
    if str(review.get("task_id") or "") != turn.id:
        return None
    if not (review.get("learning_candidates") or review.get("backlog_candidates")):
        return None
    # Match the runtime's existing learning-data root, including custom logs
    # roots in embedders/tests. Scope the queue exactly as the review API does.
    base = Path(runtime._proposal_ledger_path).with_name("review_queue.json")
    return ReviewQueue(tenant_scoped_path(base, scope)).add_from_task_run_review(
        review, scope=scope, once_per_task=True
    )
