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
    AutoDenyProvider,
    approval_action_for_tool,
)
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
    messages = state.convo.messages
    i = iteration - 1
    _input_preview = input_preview
    _guardian_reviewer = guardian_reviewer
    _auto_review_provider = auto_review_provider
    _approval_timeout_s = approval_timeout_s
    _tool_started_at = time.monotonic()
    _auto_approve = intent.user_context.get("auto_approve", False) or intent.flags.get(
        "auto_approve", False
    )

    try:
        from runtime.platform.process.session import current_session as _cs_ap

        _sess_ap = _cs_ap()
        _risk_policy_raw = (
            (getattr(_sess_ap, "metadata", {}) or {}).get("approval_risk_policy")
            if _sess_ap is not None
            else None
        )
    except (AttributeError, TypeError):
        _risk_policy_raw = None
    _approval_risk, _approval_action, _approval_policy = approval_action_for_tool(
        resolved_name,
        str(_input_preview)[:500] if _input_preview else "",
        policy=_risk_policy_raw,
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
    _permission_context = {
        **state.wiring.metadata,
        **intent.user_context,
    }
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
    _approval_deny_reason: str | None = None
    if _guardian_reviewer is not None:
        from runtime.safety.approval.guardian_review import (
            decide_with_guardian,
        )

        _guardian_user_intent = _latest_human_intent(messages)
        _guardian_action, _guardian_note = decide_with_guardian(
            rule_engine_action=_approval_action,
            rule_engine_risk=_approval_risk.level,
            rule_engine_categories=_approval_risk.categories,
            reviewer=_guardian_reviewer,
            thread_id=thread_id,
            tool_name=resolved_name,
            args_preview=(str(_input_preview)[:500] if _input_preview else ""),
            user_intent=_guardian_user_intent,
        )
        if _guardian_action == "deny":
            _approval_action = "deny"
            _approval_deny_reason = _guardian_note
    if _approval_action == "deny" and not _auto_approve and not _scoped_artifact_write:
        yield {
            "type": "tool_end",
            "tool_name": resolved_name,
            "tool_call_id": call_id,
            "iteration": i + 1,
            "status": "rejected",
            "output_preview": (
                _approval_deny_reason
                or f"Denied by approval risk policy "
                f"(risk={_approval_risk.level}: {_approval_risk.reason})"
            ),
            "duration_ms": int((time.monotonic() - _tool_started_at) * 1000),
            "risk": _approval_risk.to_dict(),
            "approval_action": _approval_action,
            "approval_policy": _approval_policy.to_dict(),
        }
        observation = (
            "(工具被风险策略拒绝) 此操作被 approval risk policy 拒绝，请换一种方式或询问用户。"
        )
        return ActionReview(False, _auto_approve, observation, _LoopControl.NEXT_ITERATION)
    if _approval_action in {"ask", "confirm"} and not _auto_approve and not _scoped_artifact_write:
        _provider = _auto_review_provider or approval_provider or AutoDenyProvider()
        _approval_detail = (
            f"{resolved_name} wants to execute "
            f"(risk={_approval_risk.level}: {_approval_risk.reason})"
        )
        if _auto_review_provider is None:
            yield {
                "type": "tool_approval_request",
                "tool_name": resolved_name,
                "tool_call_id": call_id,
                "args_preview": (str(_input_preview)[:500] if _input_preview else ""),
                "detail": _approval_detail,
                "risk": _approval_risk.to_dict(),
                "approval_action": _approval_action,
                "approval_policy": _approval_policy.to_dict(),
            }
        _decision = _provider.request(
            ApprovalRequest(
                thread_id=thread_id,
                tool_name=resolved_name,
                tool_call_id=call_id,
                args_preview=str(_input_preview)[:500] if _input_preview else "",
                detail=_approval_detail,
            ),
            timeout=_approval_timeout_s,
        )
        if not _decision.approved:
            if _paused_preview := _pause_for_unavailable_approval(
                state,
                _decision,
                iteration=i,
                tool_name=resolved_name,
                detail=_approval_detail,
            ):
                yield {
                    "type": "tool_end",
                    "tool_name": resolved_name,
                    "tool_call_id": call_id,
                    "iteration": i + 1,
                    "status": "waiting_approval",
                    "output_preview": _paused_preview,
                    "duration_ms": int((time.monotonic() - _tool_started_at) * 1000),
                }
                return ActionReview(
                    False, _auto_approve, _paused_preview, _LoopControl.CONTINUE, stop_batch=True
                )
            yield {
                "type": "tool_end",
                "tool_name": resolved_name,
                "tool_call_id": call_id,
                "iteration": i + 1,
                "status": "rejected",
                "output_preview": _decision.reason or "User denied tool execution",
                "duration_ms": int((time.monotonic() - _tool_started_at) * 1000),
            }
            observation = _approval_denied_observation(_decision)
            return ActionReview(
                False,
                _auto_approve,
                observation,
                _LoopControl.NEXT_ITERATION,
                stop_batch=is_auto_review_turn_stop(_decision.reason),
            )
    return ActionReview(True, _auto_approve, approval_policy=_approval_policy.to_dict())
