from __future__ import annotations

import logging as logging
import re as re
import time as time
from collections.abc import (
    Callable as Callable,
)
from collections.abc import (
    Generator as Generator,
)
from typing import (
    TYPE_CHECKING as TYPE_CHECKING,
)
from typing import (
    Any as Any,
)

from runtime.core.cerebrum._react_loop_reexports import *  # noqa: F403
from runtime.core.cerebrum.pause_control import (
    turn_wall_time_cap_s as turn_wall_time_cap_s,
)
from runtime.core.cerebrum.react_action_outcomes import (
    _action_batch_fingerprint as _action_batch_fingerprint,
)
from runtime.core.cerebrum.react_action_outcomes import (
    _deduplicate_actions as _deduplicate_actions,
)
from runtime.core.cerebrum.react_action_outcomes import (
    _observation_is_noop as _observation_is_noop,
)
from runtime.core.cerebrum.react_action_outcomes import (
    _per_action_outcomes as _per_action_outcomes,
)
from runtime.core.cerebrum.react_action_outcomes import (
    _retry_safe_affinity as _retry_safe_affinity,
)
from runtime.core.cerebrum.react_action_outcomes import (
    _tool_call_succeeded as _tool_call_succeeded,
)
from runtime.core.cerebrum.react_checkpointing import (
    _auto_checkpoint_and_evaluate_step as _auto_checkpoint_and_evaluate_step,
)
from runtime.core.cerebrum.react_convergence import (
    EvidenceConvergence as EvidenceConvergence,
)
from runtime.core.cerebrum.react_execution import (
    _build_research_progress_summary as _build_research_progress_summary,
)
from runtime.core.cerebrum.react_execution import (
    _phase_6d_dispatch_and_observe as _phase_6d_dispatch_and_observe,
)
from runtime.core.cerebrum.react_execution import (
    _phase_6g_housekeeping as _phase_6g_housekeeping,
)
from runtime.core.cerebrum.react_final_answer_guards import (
    _phase_6e_guards_and_step_emit as _phase_6e_guards_and_step_emit,
)
from runtime.core.cerebrum.react_in_flight_nudges import (
    _apply_in_flight_nudges as _apply_in_flight_nudges,
)
from runtime.core.cerebrum.react_in_flight_nudges import (
    _should_terminal_environment_convergence as _should_terminal_environment_convergence,
)
from runtime.core.cerebrum.react_loop_controls import (
    _cancel_pause_guard as _cancel_pause_guard,
)
from runtime.core.cerebrum.react_loop_controls import (
    get_react_variant_stats as get_react_variant_stats,
)
from runtime.core.cerebrum.react_loop_impl import (  # noqa: F401,F403  façade re-export
    _logger as _logger,
)
from runtime.core.cerebrum.react_loop_impl import (
    _mark_subagent_owner_thread as _mark_subagent_owner_thread,
)
from runtime.core.cerebrum.react_loop_impl import (
    _stream_react_loop_impl as _stream_react_loop_impl,
)
from runtime.core.cerebrum.react_loop_state import (
    _LoopControl as _LoopControl,
)
from runtime.core.cerebrum.react_loop_state import (
    _LoopState as _LoopState,
)
from runtime.core.cerebrum.react_model_deadlines import (
    _model_iteration_timeout_s as _model_iteration_timeout_s,
)
from runtime.core.cerebrum.react_model_stream import (
    _phase_6b_model_stream as _phase_6b_model_stream,
)
from runtime.core.cerebrum.react_parallel_dispatch import (
    _WRITE_TOOLS as _WRITE_TOOLS,
)
from runtime.core.cerebrum.react_parallel_dispatch import (
    _dispatch_parallel_actions as _dispatch_parallel_actions,
)
from runtime.core.cerebrum.react_phase_6c import (
    _phase_6c_parse_and_guard as _phase_6c_parse_and_guard,
)
from runtime.core.cerebrum.react_prompt_assembly import (
    _assemble_prompt_and_messages as _assemble_prompt_and_messages,
)
from runtime.core.cerebrum.react_prompt_assembly import (
    _emit_turn_start_events as _emit_turn_start_events,
)
from runtime.core.cerebrum.react_prompt_assembly import (
    _resolve_turn_bootstrap as _resolve_turn_bootstrap,
)
from runtime.core.cerebrum.react_public_updates import (
    _stream_public_evidence_narrative as _stream_public_evidence_narrative,
)
from runtime.core.cerebrum.react_quiet_evidence import (
    _quiet_evidence_checkpoint_due as _quiet_evidence_checkpoint_due,
)
from runtime.core.cerebrum.react_quiet_evidence import (
    _result_checkpoint_is_meaningful as _result_checkpoint_is_meaningful,
)
from runtime.core.cerebrum.react_quiet_evidence import (
    _should_accumulate_quiet_evidence as _should_accumulate_quiet_evidence,
)
from runtime.core.cerebrum.react_resume import (
    _resume_or_register_turn as _resume_or_register_turn,
)
from runtime.core.cerebrum.react_terminal import (
    _finalize_react_turn as _finalize_react_turn,
)
from runtime.core.cerebrum.react_types import (
    ReActResult as ReActResult,
)
from runtime.core.cerebrum.react_types import (
    ReActStep as ReActStep,
)
from runtime.platform.config.builder import (
    StackProtocol as StackProtocol,
)
from runtime.platform.config.schema import (
    BUDGET_DEFAULT_MAX_TOKENS as BUDGET_DEFAULT_MAX_TOKENS,
)
from runtime.platform.config.schema import (
    BUDGET_DEFAULT_MAX_USD as BUDGET_DEFAULT_MAX_USD,
)
from runtime.platform.models import (
    ParsedIntent as ParsedIntent,
)
from runtime.platform.models import (
    Step as Step,
)
from runtime.platform.models import (
    TaskId as TaskId,
)
from runtime.platform.models.rescue_policy import (
    next_custom_model_fallback as next_custom_model_fallback,
)
from runtime.safety.approval.approval_gate import (
    ApprovalProvider as ApprovalProvider,
)
from runtime.safety.guards.repeat_tool_reminder import (
    build_repeat_tool_reminder as build_repeat_tool_reminder,
)

if TYPE_CHECKING:
    from runtime.execution.agents.base import Agent


def stream_react_loop(
    stack: StackProtocol,
    intent: ParsedIntent,
    agent: Agent | None,
    *,
    model: str | None = None,
    max_iterations: int = 30,
    temperature: float = 0.3,
    enable_tools: bool = True,
    resume_task_id: TaskId | None = None,
    thread_id: str = "",
    max_tokens_budget: int = BUDGET_DEFAULT_MAX_TOKENS,
    max_usd_budget: float = BUDGET_DEFAULT_MAX_USD,
    approval_provider: ApprovalProvider | None = None,
    output_chunk_sink: Callable[[str, str, str], None] | None = None,
    step_evaluator: Callable[[dict[str, Any]], Any] | None = None,
    planning_mode: bool = False,
    reasoning_effort: str | None = None,
    steering_drain: Callable[[], list[str]] | None = None,
    on_auto_parallel_batch: Callable[[str], None] | None = None,
) -> Generator[dict[str, Any], None, ReActResult | None]:
    """Drive one parent ReAct turn (see ``_stream_react_loop_impl``).

    Thin lifecycle wrapper: marks the turn's thread busy in the subagent
    report lane while the turn runs (dsh ``agent.status``) and always clears
    it on exit — normal completion, failure, or early generator close.
    """
    _mark_subagent_owner_thread(thread_id, busy=True)
    try:
        return (
            yield from _stream_react_loop_impl(
                stack,
                intent,
                agent,
                model=model,
                max_iterations=max_iterations,
                temperature=temperature,
                enable_tools=enable_tools,
                resume_task_id=resume_task_id,
                thread_id=thread_id,
                max_tokens_budget=max_tokens_budget,
                max_usd_budget=max_usd_budget,
                approval_provider=approval_provider,
                output_chunk_sink=output_chunk_sink,
                step_evaluator=step_evaluator,
                planning_mode=planning_mode,
                reasoning_effort=reasoning_effort,
                steering_drain=steering_drain,
                on_auto_parallel_batch=on_auto_parallel_batch,
            )
        )
    finally:
        _mark_subagent_owner_thread(thread_id, busy=False)


def run_react_loop(
    stack: StackProtocol,
    intent: ParsedIntent,
    agent: Agent | None,
    *,
    model: str | None = None,
    max_iterations: int = 30,
    temperature: float = 0.3,
    enable_tools: bool = True,
    resume_task_id: TaskId | None = None,
    thread_id: str | None = None,
    max_tokens_budget: int = BUDGET_DEFAULT_MAX_TOKENS,
    max_usd_budget: float = BUDGET_DEFAULT_MAX_USD,
    approval_provider: ApprovalProvider | None = None,
    step_evaluator: Callable[[dict[str, Any]], Any] | None = None,
) -> ReActResult | None:
    gen = stream_react_loop(
        stack,
        intent,
        agent,
        model=model,
        max_iterations=max_iterations,
        temperature=temperature,
        enable_tools=enable_tools,
        resume_task_id=resume_task_id,
        thread_id=thread_id or "",
        max_tokens_budget=max_tokens_budget,
        max_usd_budget=max_usd_budget,
        approval_provider=approval_provider,
        step_evaluator=step_evaluator,
    )
    try:
        while True:
            next(gen)
    except StopIteration as stop:
        return stop.value  # type: ignore[no-any-return]
