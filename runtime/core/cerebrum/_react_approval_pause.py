"""Approval outcomes that pause a ReAct turn instead of failing it.

Split out of ``_react_execution_phase6d``: telling an approval nobody could
answer (no UI, timeout, lost connection, an unavailable automatic reviewer in
an unattended run) apart from an explicit decline, and turning the former
into a checkpointed ``approval_required`` pause.

It also owns the turn's automatic reviewer: one ``AutoReviewApprovalProvider``
per turn, so its denial accounting spans every ReAct iteration. When that
reviewer stops for the turn (repeated denials, spent review budget) a person
has to decide, so every run that can pause does — interactive or background.
"""

from __future__ import annotations

from typing import Any

from runtime.core.cerebrum.react_loop_state import _LoopState
from runtime.safety.approval.guardian_review import is_auto_review_turn_stop

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

_APPROVAL_PAUSED_PREVIEW = "审批界面暂不可用，任务已保存并暂停，等待用户授权后继续。"
_ESCALATION_PAUSED_PREVIEW = "沙箱放宽审批暂不可用，任务已保存并暂停，等待授权后继续。"
_APPROVAL_DENIED_OBSERVATION = "(工具审批未通过) 此操作未获批准，请换一种更安全的方式或询问用户。"
# A refused network call must not be read as "try another route": fetching the
# same target through another tool is exactly the bypass the refusal closes.
_NETWORK_DENIED_OBSERVATION = (
    "(工具审批未通过) 用户拒绝了这次网络访问。本轮不要再用这个或其他工具"
    "（网页抓取、浏览、平台读取等）访问同一目标；请告诉用户因此无法完成的部分。"
)
_ESCALATION_DENIED_OBSERVATION = (
    "(工具被沙箱拦截，用户拒绝放宽沙箱重跑；请换一种不需要该权限/网络的方式，或询问用户。)"
)
# Only reached when the run cannot pause: the agent must stop, not route around.
_REVIEW_STOPPED_OBSERVATION = (
    "(自动审查本轮已停止) 自动审查在本轮多次拒绝了操作，本轮剩余需要审批的操作都不会再执行。"
    "不要再尝试同类操作，也不要换一种方式绕过；请停止并告诉用户需要由他来决定如何继续。"
)


def _latest_human_intent(messages: Any) -> str:
    """Most recent human message text — the only trusted authorization
    evidence for the guardian review (codex policy_template Evidence
    Handling: user messages are trusted content; tool outputs are not)."""
    try:
        for message in reversed(list(messages or [])):
            if getattr(message, "type", None) == "human":
                content = getattr(message, "content", None)
                if isinstance(content, str) and content.strip():
                    return content.strip()[:1000]
                if isinstance(content, list):
                    parts = [
                        part.get("text", "")
                        for part in content
                        if isinstance(part, dict) and part.get("type") == "text"
                    ]
                    text = " ".join(parts).strip()
                    if text:
                        return text[:1000]
    except Exception:  # noqa: BLE001 — intent extraction is best-effort
        pass
    return ""


def _turn_auto_review_provider(state: _LoopState) -> Any:
    """The turn's automatic reviewer, or ``None`` outside auto-review mode.

    Built on first use and cached on the turn wiring: the same-action breaker,
    the turn-wide denial breaker and the review budget only trip when every
    iteration of the turn asks the same provider. The latest user request is
    refreshed each iteration (a mid-turn follow-up can change it).
    """
    from runtime.safety.approval.permission_modes import is_auto_review_mode

    wiring = state.wiring
    if not is_auto_review_mode(
        wiring.intent.user_context.get("permission_mode") or wiring.metadata.get("permission_mode")
    ):
        return None
    user_intent = _latest_human_intent(state.convo.messages)
    provider = wiring.auto_review_provider
    if provider is not None:
        provider.update_user_intent(user_intent)
        return provider
    from runtime.safety.approval.guardian_review import (
        AutoReviewApprovalProvider,
        approval_router_for_stack,
    )

    reviewer_router = approval_router_for_stack(wiring.stack)
    provider = wiring.auto_review_provider = AutoReviewApprovalProvider(
        reviewer_router,
        user_intent=user_intent,
        default_model=state.iteration.effective_model if reviewer_router is wiring.router else None,
    )
    return provider


def _is_review_stop(decision: Any) -> bool:
    return not bool(getattr(decision, "approved", False)) and is_auto_review_turn_stop(
        getattr(decision, "reason", "")
    )


def _approval_could_not_reach_user(
    decision: Any,
    *,
    include_unavailable_review: bool = False,
) -> bool:
    """Separate an unavailable reviewer from an explicit human decline.

    Automatic review's turn-level stop always counts as unanswered: the
    reviewer has handed the decision back to a person.
    """

    if bool(getattr(decision, "approved", False)):
        return False
    if _is_review_stop(decision):
        return True
    reason = str(getattr(decision, "reason", "") or "").strip().lower()
    markers = _UNAVAILABLE_APPROVAL_REASONS + (
        _UNAVAILABLE_REVIEW_REASONS if include_unavailable_review else ()
    )
    return any(reason == marker or reason.startswith(marker) for marker in markers)


def _approval_denied_observation(
    decision: Any, *, sandbox_escalation: bool = False, network: bool = False
) -> str:
    """What the model reads after an approval that did not pause the run."""
    if _is_review_stop(decision):
        return _REVIEW_STOPPED_OBSERVATION
    if sandbox_escalation:
        return _ESCALATION_DENIED_OBSERVATION
    if network:
        return _NETWORK_DENIED_OBSERVATION
    return _APPROVAL_DENIED_OBSERVATION


def _review_stop_note(state: _LoopState, decision: Any, tool_name: str) -> str:
    stop = getattr(state.wiring.auto_review_provider, "turn_stop", None)
    if stop is None:
        return f"{tool_name}: {getattr(decision, 'reason', '')}"
    if stop.cause == "review_budget":
        return (
            f"自动审查本轮已审查 {stop.reviews} 次，达到上限（{tool_name} 未执行），"
            "需要你决定是否继续。"
        )
    return f"自动审查本轮已拒绝 {stop.denials} 次（{tool_name} 未执行），需要你决定是否继续。"


def _pause_for_unavailable_approval(
    state: _LoopState,
    decision: Any,
    *,
    iteration: int,
    tool_name: str,
    detail: str,
    sandbox_escalation: bool = False,
) -> str:
    """Pause (checkpointed) when ``decision`` is an approval nobody could give.

    Returns the tool row's text for the pause, or ``""`` when the run keeps
    going. An explicit decline stays a denial. An unavailable automatic
    reviewer only pauses runs whose intent opted in with
    ``pause_on_unavailable_review`` (unattended background loops); automatic
    review's turn-level stop pauses every run (Claude Code's auto mode also
    falls back to asking). Without a pause controller nothing pauses and the
    caller reports the denial.
    """

    user_context = getattr(getattr(state.wiring, "intent", None), "user_context", None)
    review_pauses = bool((user_context or {}).get("pause_on_unavailable_review"))
    if not _approval_could_not_reach_user(decision, include_unavailable_review=review_pauses):
        return ""
    pause_controller = state.wiring.pause_controller
    task_id = str(state.wiring.react_task_id or "").strip()
    if pause_controller is None or not task_id:
        return ""
    review_stopped = _is_review_stop(decision)
    note = (
        _review_stop_note(state, decision, tool_name)
        if review_stopped
        else f"{tool_name}: {detail}"
    )
    pause_controller.request_pause(
        task_id=task_id,
        reason="approval_required",
        requested_by="system",
        note=note,
        thread_id=state.wiring.thread_id,
        agent_id=state.model_call.agent_id_for_pause,
    )
    # Reserve a boundary for the normal pause guard, including when the
    # blocked call happened on what would otherwise be the final iteration.
    state.iteration.iteration_limit = max(state.iteration.iteration_limit, iteration + 2)
    if review_stopped:
        return f"任务已保存并暂停：{note}"
    return _ESCALATION_PAUSED_PREVIEW if sandbox_escalation else _APPROVAL_PAUSED_PREVIEW
