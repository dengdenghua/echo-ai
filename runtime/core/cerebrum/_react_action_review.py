"""One approval gate shared by single actions and multi-action batches."""

from __future__ import annotations

import time
from collections.abc import Generator
from dataclasses import dataclass
from typing import Any

from runtime.core.cerebrum._react_approval_pause import (
    _approval_denied_observation,
    _latest_human_intent,
    _pause_for_unavailable_approval,
)
from runtime.core.cerebrum._react_execution_results import _is_scoped_artifact_write
from runtime.core.cerebrum.react_loop_state import _LoopControl, _LoopState
from runtime.safety.approval.approval_gate import (
    ApprovalRequest,
    ApprovalRiskAction,
    AutoDenyProvider,
    NetworkDenialMemory,
    approval_action_for_tool,
    is_network_risk,
)
from runtime.safety.approval.exec_consent import is_human_provider, needs_unconfined_consent
from runtime.safety.approval.guardian_review import is_auto_review_turn_stop
from runtime.safety.validation.prompt_injection import injection_taint_gates


@dataclass(frozen=True)
class ActionReview:
    allowed: bool
    auto_approve: bool
    observation: str = ""
    control: _LoopControl | None = None
    approval_policy: dict[str, Any] | None = None
    stop_batch: bool = False
    # A person approved this call knowing it runs without a hard sandbox.
    unconfined_consent: bool = False


def turn_network_denials(state: _LoopState) -> NetworkDenialMemory:
    """The turn's memory of refused network access, created on first use."""
    denials = state.wiring.network_denials
    if denials is None:
        denials = state.wiring.network_denials = NetworkDenialMemory()
    return denials


def _session_risk_policy() -> Any:
    """The active session's ``approval_risk_policy`` override, if any."""
    try:
        from runtime.platform.process.session import current_session as _cs_ap

        _sess_ap = _cs_ap()
        return (
            (getattr(_sess_ap, "metadata", {}) or {}).get("approval_risk_policy")
            if _sess_ap is not None
            else None
        )
    except (AttributeError, TypeError):
        return None


def _tool_end_event(
    tool_name: str,
    call_id: str,
    iteration: int,
    status: str,
    output_preview: Any,
    started_at: float,
    **extra: Any,
) -> dict[str, Any]:
    """A ``tool_end`` event for a call the review stopped before dispatch."""
    return {
        "type": "tool_end",
        "tool_name": tool_name,
        "tool_call_id": call_id,
        "iteration": iteration,
        "status": status,
        "output_preview": output_preview,
        "duration_ms": int((time.monotonic() - started_at) * 1000),
        **extra,
    }


def _guardian_verdict(
    state: _LoopState,
    guardian_reviewer: Any,
    *,
    action: ApprovalRiskAction,
    risk: Any,
    tool_name: str,
    input_preview: Any,
) -> tuple[ApprovalRiskAction, str | None]:
    """The rule engine's action after the opt-in guardian review.

    Returns ``(action, deny_reason)``: a guardian deny tightens the action to
    ``deny`` with the guardian's note; an allow or a failure keeps the rule
    engine's action and no reason.
    """
    if guardian_reviewer is None:
        return action, None
    from runtime.safety.approval.guardian_review import decide_with_guardian

    guardian_user_intent = _latest_human_intent(state.convo.messages)
    guardian_action, guardian_note = decide_with_guardian(
        rule_engine_action=action,
        rule_engine_risk=risk.level,
        rule_engine_categories=risk.categories,
        reviewer=guardian_reviewer,
        thread_id=state.wiring.thread_id,
        tool_name=tool_name,
        args_preview=(str(input_preview)[:500] if input_preview else ""),
        user_intent=guardian_user_intent,
    )
    if guardian_action == "deny":
        return "deny", guardian_note
    return action, None


def review_tool_action(
    state: _LoopState,
    *,
    resolved_name: str,
    input_preview: Any,
    call_id: str,
    iteration: int,
    guardian_reviewer: Any = None,
    auto_review_provider: Any = None,
    approval_timeout_s: float = 600.0,
) -> Generator[dict[str, Any], None, ActionReview]:
    """Review immediately before dispatch, after earlier untrusted output taints the turn."""
    from runtime.core.cerebrum._react_execution_phase6d import (
        _workspace_sandbox_handles_ordinary_action,
    )

    intent = state.wiring.intent
    thread_id = state.wiring.thread_id
    approval_provider = state.wiring.approval_provider
    i = iteration - 1
    _input_preview = input_preview
    _guardian_reviewer = guardian_reviewer
    _auto_review_provider = auto_review_provider
    _approval_timeout_s = approval_timeout_s
    _tool_started_at = time.monotonic()
    _auto_approve = intent.user_context.get("auto_approve", False) or intent.flags.get(
        "auto_approve", False
    )

    _risk_policy_raw = _session_risk_policy()
    _permission_context = {
        **state.wiring.metadata,
        **intent.user_context,
    }
    _approval_risk, _approval_action, _approval_policy = approval_action_for_tool(
        resolved_name,
        str(_input_preview)[:500] if _input_preview else "",
        policy=_risk_policy_raw,
        permission_mode=_permission_context.get("permission_mode"),
    )
    _scoped_artifact_write = _is_scoped_artifact_write(
        resolved_name,
        _input_preview,
    )
    # Injection taint gate (hard): if untrusted content
    # carrying injection markers entered this turn, a
    # risky tool can no longer auto-run — force it through
    # human approval, overriding auto_approve and the
    # scoped-write / accept-edits fast paths. This is the
    # escalation from the in-context warning to an actual
    # stop: a poisoned page can't drive an exec_shell /
    # write / send behind the user's back. Gate at medium+
    # so EXFILTRATION (egress tools = medium — the classic
    # injection payload) is caught, not just destructive
    # high-risk tools; only pure low-risk reads still
    # auto-run after taint.
    if injection_taint_gates() and _approval_risk.level in {
        "medium",
        "high",
        "critical",
    }:
        _auto_approve = False
        _scoped_artifact_write = False
        if _approval_action not in {"ask", "confirm", "deny"}:
            _approval_action = "ask"
        _approval_risk = _approval_risk.with_injection_taint()
    _network_denials = turn_network_denials(state)
    _refused = (
        None
        if _auto_approve or _scoped_artifact_write
        else _network_denials.refusal(resolved_name, _approval_risk, _input_preview)
    )
    if _refused is not None:
        yield _tool_end_event(
            resolved_name,
            call_id,
            i + 1,
            "rejected",
            _refused,
            _tool_started_at,
            risk=_approval_risk.to_dict(),
            approval_action="deny",
            approval_policy=_approval_policy.to_dict(),
        )
        observation = f"(工具审批未通过) {_refused}。请告诉用户因此无法完成的部分。"
        return ActionReview(False, _auto_approve, observation, _LoopControl.NEXT_ITERATION)
    if _approval_action in {
        "ask",
        "confirm",
    } and _workspace_sandbox_handles_ordinary_action(
        resolved_name,
        _approval_risk,
        _permission_context,
    ):
        _approval_action = "allow"
    # Guardian independent review (opt-in, after the taint
    # gate so tainted actions still route to the human): a
    # guardian deny tightens ask/confirm/allow to deny; an
    # allow or a failure keeps the rule engine's action.
    _approval_action, _approval_deny_reason = _guardian_verdict(
        state,
        _guardian_reviewer,
        action=_approval_action,
        risk=_approval_risk,
        tool_name=resolved_name,
        input_preview=_input_preview,
    )
    if _approval_action == "deny" and not _auto_approve and not _scoped_artifact_write:
        if _approval_deny_reason is not None:
            # The guardian refused this exact call; keep it refused for the turn.
            _network_denials.note_denial(resolved_name, _approval_risk, _input_preview)
        yield _tool_end_event(
            resolved_name,
            call_id,
            i + 1,
            "rejected",
            (
                _approval_deny_reason
                or f"Denied by approval risk policy "
                f"(risk={_approval_risk.level}: {_approval_risk.reason})"
            ),
            _tool_started_at,
            risk=_approval_risk.to_dict(),
            approval_action=_approval_action,
            approval_policy=_approval_policy.to_dict(),
        )
        observation = (
            "(工具被风险策略拒绝) 此操作被 approval risk policy 拒绝，请换一种方式或询问用户。"
        )
        return ActionReview(False, _auto_approve, observation, _LoopControl.NEXT_ITERATION)
    _consent = False
    if _approval_action in {"ask", "confirm"} and not _auto_approve and not _scoped_artifact_write:
        _provider = _auto_review_provider or approval_provider or AutoDenyProvider()
        _request = ApprovalRequest(
            thread_id=thread_id,
            tool_name=resolved_name,
            tool_call_id=call_id,
            args_preview=str(_input_preview)[:500] if _input_preview else "",
            detail=(
                f"{resolved_name} wants to execute "
                f"(risk={_approval_risk.level}: {_approval_risk.reason})"
            ),
            unconfined=needs_unconfined_consent(_approval_risk.categories),
        )
        if _auto_review_provider is None:
            yield {
                "type": "tool_approval_request",
                "tool_name": resolved_name,
                "tool_call_id": call_id,
                "args_preview": _request.args_preview,
                "detail": _request.detail,
                "risk": _approval_risk.to_dict(),
                "approval_action": _approval_action,
                "approval_policy": _approval_policy.to_dict(),
                "unconfined": _request.unconfined,
            }
        _decision = _provider.request(_request, timeout=_approval_timeout_s)
        if not _decision.approved:
            if _paused_preview := _pause_for_unavailable_approval(
                state,
                _decision,
                iteration=i,
                tool_name=resolved_name,
                detail=_request.detail,
            ):
                yield _tool_end_event(
                    resolved_name,
                    call_id,
                    i + 1,
                    "waiting_approval",
                    _paused_preview,
                    _tool_started_at,
                )
                return ActionReview(
                    False, _auto_approve, _paused_preview, _LoopControl.CONTINUE, stop_batch=True
                )
            _network_denials.note_denial(resolved_name, _approval_risk, _input_preview)
            yield _tool_end_event(
                resolved_name,
                call_id,
                i + 1,
                "rejected",
                _decision.reason or "User denied tool execution",
                _tool_started_at,
            )
            observation = _approval_denied_observation(
                _decision, network=is_network_risk(_approval_risk)
            )
            return ActionReview(
                False,
                _auto_approve,
                observation,
                _LoopControl.NEXT_ITERATION,
                stop_batch=is_auto_review_turn_stop(_decision.reason),
            )
        _consent = _request.unconfined and is_human_provider(_provider)
    return ActionReview(
        True, _auto_approve, approval_policy=_approval_policy.to_dict(), unconfined_consent=_consent
    )
