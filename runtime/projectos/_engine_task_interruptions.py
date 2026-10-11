"""Settle cooperative pauses without consuming a task's failure budget."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from runtime.projectos.model import Task
from runtime.safety.approval.cancellation import current_cancellation_token


def interrupt_claimed_task(
    task: Task,
    claim_id: str,
    events: list[str],
    commit: Callable[..., bool],
    *,
    preserve_output: bool | None = None,
) -> None:
    token = current_cancellation_token()
    if not token.is_cancelled:
        return
    if preserve_output is None:
        preserve_output = bool((task.qa_verdict or {}).get("review_error"))
    task.status = "pending"
    task.qa_verdict = (
        {"approved": False, "review_error": True, "reason": "执行已停止，原产物待质量检查"}
        if preserve_output
        else None
    )
    if not preserve_output:
        task.output = None
    commit(task, claim_id, f"task_interrupted:{task.id}", events, interrupted=True)
    token.throw_if_cancelled()


def handle_decomposition_failure(
    engine: Any,
    project_id: str,
    project: Any,
    milestone: Any,
    claim_id: str,
    events: list[str],
    error: str,
) -> None:
    token = current_cancellation_token()
    if token.is_cancelled:
        # A cooperative pause owns only its claim, not the phase. Releasing
        # that generation leaves any newer claim and terminal state untouched.
        with engine.store._lock, engine.store._conn() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if engine.store._project_doc_for_scope(conn, project_id, None) is not None:
                conn.execute(
                    "DELETE FROM milestone_claims WHERE milestone_id=? AND claim_id=?",
                    (milestone.id, claim_id),
                )
        engine._audit(project_id, "project.decompose_interrupted", {"milestone_id": milestone.id})
        token.throw_if_cancelled()
    events.append(f"tasks_decompose_failed:{milestone.id}")
    saved, committed = engine.store.finalize_milestone_decomposition(
        project_id,
        milestone.id,
        [],
        claim_id,
        blocked=True,
    )
    if committed and project is not None:
        milestone.status = saved.status if saved is not None else "blocked"
        engine._block_project(project, milestone.id, events, reason="decompose_failed")
    elif not committed:
        events.append(f"milestone_stale_decompose_failure_ignored:{milestone.id}")
    engine._audit(
        project_id, "project.decompose_failed", {"milestone_id": milestone.id, "error": error}
    )
