"""Split out of :mod:`react_final_answer_guards` so that module stays under the 1000-line
god-file ratchet. Everything here is re-exported by the original module, so
import sites do not move.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Generator

from runtime.core.cerebrum.react_auto_inspect import _try_auto_project_inspection_salvage
from runtime.core.cerebrum.react_convergence import evidence_answer_conflicts_with_goal
from runtime.core.cerebrum.react_final_answer_guards_soft import (  # noqa: F401  re-export: import sites stay stable
    _CODE_FENCE_RE as _CODE_FENCE_RE,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _ENVIRONMENTAL_FAILURE_MARKERS as _ENVIRONMENTAL_FAILURE_MARKERS,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _EXECUTION_DEGRADED_THRESHOLD as _EXECUTION_DEGRADED_THRESHOLD,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _INLINE_TOOL_CALL_NAMES as _INLINE_TOOL_CALL_NAMES,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _INLINE_TOOL_CALL_RE as _INLINE_TOOL_CALL_RE,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _REACT_ACTION_CALL_RE as _REACT_ACTION_CALL_RE,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _REACT_THOUGHT_LINE_RE as _REACT_THOUGHT_LINE_RE,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _STANDALONE_INLINE_TOOL_CALL_RE as _STANDALONE_INLINE_TOOL_CALL_RE,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _VERIFIER_CAPABILITY_MARKERS as _VERIFIER_CAPABILITY_MARKERS,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _clean_protocol_leak as _clean_protocol_leak,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _environmental_failure_count as _environmental_failure_count,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _evaluate_final_answer_guards as _evaluate_final_answer_guards,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _final_answer_needs_pre_emit_guard as _final_answer_needs_pre_emit_guard,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _guard_impasse_actionable_hint as _guard_impasse_actionable_hint,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _guard_impasse_final_answer as _guard_impasse_final_answer,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _guard_reason_for_user as _guard_reason_for_user,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _guard_rejection_outcome as _guard_rejection_outcome,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _guard_repair_feedback as _guard_repair_feedback,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _guard_soft_landing_answer as _guard_soft_landing_answer,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _looks_like_observation_echo as _looks_like_observation_echo,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _note_guard_impasse as _note_guard_impasse,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _record_rejected_step as _record_rejected_step,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _research_final_answer_guards_active as _research_final_answer_guards_active,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _step_environmental_failure_count as _step_environmental_failure_count,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _step_has_pending_tool_action as _step_has_pending_tool_action,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _step_is_environmental_failure as _step_is_environmental_failure,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _strip_code_fences as _strip_code_fences,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _strip_inline_tool_calls as _strip_inline_tool_calls,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _targets_verifier_capability as _targets_verifier_capability,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _text_has_pending_tool_action as _text_has_pending_tool_action,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _trajectory_execution_degraded as _trajectory_execution_degraded,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _trajectory_has_executed_action as _trajectory_has_executed_action,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _trajectory_has_successful_tool_evidence as _trajectory_has_successful_tool_evidence,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _trusted_execution_failure as _trusted_execution_failure,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _try_clean_downgrade as _try_clean_downgrade,
)
from runtime.core.cerebrum.react_final_answer_guards_soft import (
    _unfinished_implementation_recovery_needed as _unfinished_implementation_recovery_needed,
)
from runtime.core.cerebrum.react_loop_controls import (
    _emit_assistant_chunk,
)
from runtime.core.cerebrum.react_loop_state import _LoopControl, _LoopState
from runtime.core.cerebrum.react_types import ReActStep

_logger = logging.getLogger(__name__)


def _phase_6e_guards_and_step_emit(
    state: _LoopState,
    *,
    i: int,
    append_pending_live_steering: Callable[[], int],
    build_research_progress_summary: Callable[[list[ReActStep]], str],
) -> Generator[dict, None, _LoopControl]:
    """PHASE 6e guard state machine + step completion emit.

    Moved verbatim from ``react_loop.py`` (PHASE 6e, second half): the
    evidence-answer conflict repair, the live-steering finalization
    deferral, final-answer guard evaluation with the three-strike
    impasse breaker, the deferred ``text_delta`` emit, and the
    ``react_step_complete`` event. Returns ``BREAK`` when a guard hits
    the impasse limit (``state`` then carries ``final_answer`` /
    ``terminated_reason``); ``CONTINUE`` otherwise.
    ``_append_pending_live_steering`` is a react_loop closure and
    ``_build_research_progress_summary`` lives in react_execution (which
    imports this module), so both are injected.
    """
    # Injected callables under their original names.
    _append_pending_live_steering = append_pending_live_steering
    _build_research_progress_summary = build_research_progress_summary
    # Reference-typed aliases — mutations propagate to the main loop.
    intent = state.wiring.intent
    steps = state.convo.steps
    final_answer_segments = state.convo.final_answer_segments
    step = state.parse.step
    assert step is not None, "phase 6e requires a parsed ReAct step"
    react_task_id = state.wiring.react_task_id
    _working_set = state.convo.working_set
    _guard_impasse_state = state.wiring.guard_impasse_state
    _final_guard_grounded_source_paths = state.wiring.final_guard_grounded_source_paths
    # Scalar mailbox — reads pull from state; every write point writes through immediately.
    maybe_final = state.parse.maybe_final
    _evidence_convergence_active = state.iteration.evidence_convergence_active
    _final_stream_started = state.iteration.final_stream_started
    _final_delta_emitted_this_iteration = state.emit.final_delta_emitted_this_iteration
    _todo_protocol_required = state.mode.todo_protocol_required
    _todo_protocol_visible = state.mode.todo_protocol_visible
    _is_code_mode = state.mode.is_code_mode
    _browser_operation_mode = state.mode.browser_operation_mode
    _file_inspection_tools_visible = state.mode.file_inspection_tools_visible
    tools_active = state.iteration.tools_active
    _streamed_final_chars = state.iteration.streamed_final_chars
    _current_phase = state.iteration.current_phase
    _progress_summary = state.iteration.progress_summary
    _public_progress_summary = state.iteration.public_progress_summary
    _research_guard_active = _research_final_answer_guards_active(
        is_code_mode=_is_code_mode,
        goal=intent.normalized_goal,
        steps=steps + [step],
        tools_active=tools_active,
    )
    _length_fragment_pending = state.parse.length_limited and not (
        bool(getattr(state.parse.resp, "tool_calls", None))
        or bool(step.observation and step.observation != "N/A")
    )
    if (
        maybe_final
        and _evidence_convergence_active is not None
        and evidence_answer_conflicts_with_goal(
            goal=intent.normalized_goal,
            answer=maybe_final,
        )
    ):
        # Bounded evidence exists, so an idle/greeting answer claiming
        # there was no task is objectively contradictory. Keep it out of
        # the answer stream and retry with the original request attached.
        step.observation = (
            (((step.observation or "") + "\n\n") if step.observation else "")
            + "[evidence-answer-conflict]\n"
            + "The proposed answer falsely denied the active user request or the "
            + "completed evidence. Discard it and answer the original request "
            + "directly from the bounded evidence already supplied."
        )
        maybe_final = state.parse.maybe_final = None
        if _research_guard_active:
            final_answer_segments.clear()
        state.iteration.force_convergence_next = True

    # Close the race where a follow-up arrives while the model is composing
    # what would otherwise be the terminal answer. Keep that answer as
    # conversation history, then give the latest user message the next
    # model round instead of finalizing over it.
    if maybe_final and _append_pending_live_steering():
        maybe_final = state.parse.maybe_final = None
        if _research_guard_active:
            final_answer_segments.clear()
        _logger.info(
            "react_loop deferred finalization for a priority user follow-up",
        )

    # A length-limited research response is only a fragment. PHASE 6g
    # stores it in ``final_answer_segments`` and the next iteration
    # continues; guard and publish only after the complete candidate is
    # available so cross-segment links/facts are checked atomically.
    if maybe_final and not (_research_guard_active and _length_fragment_pending):
        _guard_candidate = (
            "".join(final_answer_segments + [maybe_final])
            if _research_guard_active and final_answer_segments
            else maybe_final
        )
        _deferred_final_emit = not _final_stream_started and (
            _evidence_convergence_active is not None
            or _final_answer_needs_pre_emit_guard(
                _guard_candidate,
                is_code_mode=_is_code_mode,
                browser_operation_mode=_browser_operation_mode,
                research_guard_active=_research_guard_active,
            )
        )
        _guard_hit = _evaluate_final_answer_guards(
            steps=steps,
            step=step,
            final_answer=_guard_candidate,
            is_code_mode=_is_code_mode,
            todo_protocol_required=_todo_protocol_required,
            todo_protocol_visible=_todo_protocol_visible,
            file_inspection_tools_visible=_file_inspection_tools_visible,
            tools_active=tools_active,
            goal=intent.normalized_goal,
            browser_operation_mode=_browser_operation_mode,
            grounded_source_paths=_final_guard_grounded_source_paths,
            prior_grounding_text=state.wiring.prior_grounding_text,
        )
        if _guard_hit is not None:
            if _research_guard_active:
                final_answer_segments.clear()
            # Solution-A: a guard rejection that is purely a leaked ReAct
            # protocol block is downgraded to a one-shot cleaned delivery
            # rather than retried in a loop. The model usually already did
            # the work (tools ran); only the answer markup was dirty.
            _downgrade = _try_clean_downgrade(_guard_candidate)
            if _downgrade is not None:
                state.emit.final_answer = _downgrade
                state.emit.terminated_reason = "final_answer_with_warning"
                steps.append(step)
                return _LoopControl.BREAK
            _guard_label, _guard_message = _guard_hit
            _auto_inspect_step = _try_auto_project_inspection_salvage(
                _guard_label,
                _guard_candidate,
                steps,
                iteration=i + 1,
                tools_active=tools_active,
            )
            if _auto_inspect_step is not None:
                step.thought = _auto_inspect_step.thought
                step.public_update = _auto_inspect_step.public_update
                step.action = _auto_inspect_step.action
                step.actions = _auto_inspect_step.actions
                _final_stream_started = False
                state.parse.maybe_final = None
                return _LoopControl.CONTINUE
            _guard_outcome = _guard_rejection_outcome(_guard_impasse_state, _guard_label, steps)
            if _guard_outcome == "hard_stop":
                # Same guard, repeated rejections, zero new action-bearing
                # steps in between: pushing back again only burns the
                # remaining budget and ends in the auto-pause path's
                # misleading "paused" report. Terminate with the truth.
                _logger.warning(
                    "react_loop guard impasse · %s rejected the final answer "
                    "3x with no intervening tool execution — terminating "
                    "explicitly instead of burning the iteration budget",
                    _guard_label,
                )
                state.emit.final_answer = _guard_impasse_final_answer(
                    _guard_label, _guard_message, steps
                )
                state.emit.terminated_reason = "guard_impasse"
                steps.append(step)
                return _LoopControl.BREAK
            state.parse.maybe_final = None
            # A completion guard may discover a semantic defect even
            # after two superficially green verifier rounds. Re-open the
            # tool path so the model can perform the demanded repair;
            # otherwise the convergence gate would suppress every fix
            # and turn a useful guard into an impasse. The todo protocol
            # is different: terminal evidence is still valid and the
            # convergence state already allows exactly one checklist
            # update. Clearing it here caused green agents to resume an
            # unbounded test/lint cycle after that update.
            if _guard_label != "todo-protocol guard" and not (
                _guard_label == "final-answer completeness guard"
                and _trajectory_has_successful_tool_evidence(steps)
            ):
                state.iteration.green_verification_convergence_active = False
                state.iteration.green_convergence_todo_used = False
                state.iteration.clean_verification_rounds_after_write = 0
                state.iteration.force_convergence_next = False
            step.observation = (
                (((step.observation or "") + "\n\n") if step.observation else "")
                + f"[{_guard_label}]\n"
                + _guard_repair_feedback(
                    _guard_label,
                    _guard_message,
                    steps,
                    candidate_was_published=(
                        _final_stream_started or _final_delta_emitted_this_iteration
                    ),
                )
            )
        elif _deferred_final_emit:
            _delta = (
                _guard_candidate
                if _research_guard_active
                else (
                    _guard_candidate[_streamed_final_chars:]
                    if _streamed_final_chars
                    else _guard_candidate
                )
            )
            _emit_assistant_chunk(
                state.wiring.stack,
                iteration=i + 1,
                delta=_delta,
                task_id=react_task_id,
            )
            yield {
                "type": "text_delta",
                "delta": _delta,
                "iteration": i + 1,
            }
            state.emit.final_delta_emitted_this_iteration = True

    _public_progress_summary = state.iteration.public_progress_summary = (
        _progress_summary if _is_code_mode else _build_research_progress_summary(steps + [step])
    )

    yield {
        "type": "react_step_complete",
        "iteration": step.iteration,
        "thought": step.thought,
        "public_update": step.public_update,
        "action": step.action,
        "observation": step.observation,
        "task_id": str(react_task_id),
        "current_phase": _current_phase if _is_code_mode else None,
        "working_set": list(_working_set.values()) if _is_code_mode else None,
        "progress_summary": _public_progress_summary,
    }
    return _LoopControl.CONTINUE
