"""Derive pending experience candidates from scoped terminal evidence."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from runtime.platform import feature_flags
from runtime.protocol import Turn
from runtime.safety.auth.scope import TenantScope, tenant_scoped_path

from .review_queue import ReviewQueue


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
