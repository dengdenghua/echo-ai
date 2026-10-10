"""Approval outcomes that pause a ReAct turn instead of failing it.

Split out of ``_react_execution_phase6d``: telling an approval nobody could
answer (no UI, timeout, lost connection, an unavailable automatic reviewer in
an unattended run) apart from an explicit decline, and turning the former
into a checkpointed ``approval_required`` pause.
"""

from __future__ import annotations

from typing import Any

from runtime.core.cerebrum.react_loop_state import _LoopState

_UNAVAILABLE_APPROVAL_REASONS = (
    "timeout",
    "connection_lost",
    "error:",
    "no interactive approval ui",
)
# AutoReviewApprovalProvider's "reviewer could not decide" outcome. Interactive
# turns keep the Codex contract (a distinct denial the agent can route around);
# unattended background runs opt in via ``pause_on_unavailable_review`` so an
# approval nobody could answer becomes a resumable pause instead.
_UNAVAILABLE_REVIEW_REASONS = ("automatic review was unavailable",)


def _approval_could_not_reach_user(
    decision: Any,
    *,
    include_unavailable_review: bool = False,
) -> bool:
    """Separate an unavailable reviewer from an explicit human decline."""

    if bool(getattr(decision, "approved", False)):
        return False
    reason = str(getattr(decision, "reason", "") or "").strip().lower()
    markers = _UNAVAILABLE_APPROVAL_REASONS + (
        _UNAVAILABLE_REVIEW_REASONS if include_unavailable_review else ()
    )
    return any(reason == marker or reason.startswith(marker) for marker in markers)


def _pause_for_unavailable_approval(
    state: _LoopState,
    decision: Any,
    *,
    iteration: int,
    tool_name: str,
    detail: str,
) -> bool:
    """Pause (checkpointed) when ``decision`` is an approval nobody could give.

    An explicit decline returns ``False`` and stays a denial. An unavailable
    automatic reviewer only pauses runs whose intent opted in with
    ``pause_on_unavailable_review`` (unattended background loops).
    """

    user_context = getattr(getattr(state.wiring, "intent", None), "user_context", None)
    review_pauses = bool((user_context or {}).get("pause_on_unavailable_review"))
    if not _approval_could_not_reach_user(decision, include_unavailable_review=review_pauses):
        return False
    pause_controller = state.wiring.pause_controller
    task_id = str(state.wiring.react_task_id or "").strip()
    if pause_controller is None or not task_id:
        return False
    pause_controller.request_pause(
        task_id=task_id,
        reason="approval_required",
        requested_by="system",
        note=f"{tool_name}: {detail}",
        thread_id=state.wiring.thread_id,
        agent_id=state.model_call.agent_id_for_pause,
    )
    # Reserve a boundary for the normal pause guard, including when the
    # blocked call happened on what would otherwise be the final iteration.
    state.iteration.iteration_limit = max(state.iteration.iteration_limit, iteration + 2)
    return True
