"""Settle cooperative pauses without consuming a task's failure budget."""

from __future__ import annotations

from collections.abc import Callable

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
