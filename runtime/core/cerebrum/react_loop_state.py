"""Shared per-turn state for the ReAct main-loop phases.

``_LoopState`` stores everything in eight nested group dataclasses
(``wiring``, ``model_call``, ``mode``, ``guard_tools``, ``convo``,
``iteration``, ``emit``, ``parse``) so each phase owns a clearly
bounded slice.  The constructor still accepts the historical flat
keyword arguments and routes them via ``_FIELD_TO_GROUP`` (derived from
the group dataclasses themselves, so routing cannot drift); attribute
access is group-qualified everywhere — ``state.iteration.tools_active``
— which ``__slots__`` enforces by rejecting stray attributes.

Reference-typed fields (``steps``, ``executed_beak_steps``,
``messages``, ``working_set``, ``final_answer_segments``) are shared
with the main loop and mutated in place; scalar fields are synced
local→state before a phase call and state→local after it, so the loop
body stays the single source of truth between phase extractions.

Depends only on react_types / platform-level types; must never import
react_loop.
"""

from __future__ import annotations

import dataclasses
import enum
from dataclasses import dataclass, field
from typing import Any

from runtime.core.cerebrum.react_types import ReActStep


class _LoopControl(enum.Enum):
    """Control signal returned by extracted phase generators."""

    CONTINUE = "continue"  # proceed to the next phase / iteration
    NEXT_ITERATION = "next_iteration"  # skip remaining phases; next loop iteration
    BREAK = "break"  # exit the iteration loop; state carries terminated_reason/final_answer
    RETURN_NONE = "return_none"  # abort the turn; persist/unregister already done


@dataclass
class _WiringState:
    """Turn-level wiring, assembled once and read-only inside phases."""

    stack: Any = None
    goal: str = ""
    executor: Any = None
    react_task_id: Any = None
    pause_controller: Any = None
    effective_wp: Any = None
    format_violation_bail_at: int = 2
    final_guard_grounded_source_paths: Any = None
    guard_impasse_state: dict = field(default_factory=dict)
    # Tool observations from EARLIER turns of this thread (``Observation:``
    # user messages in the assembled history). Research guards merge this into
    # their evidence stream so cross-turn facts aren't flagged as fabricated.
    prior_grounding_text: str = ""
    intent: Any = None
    agent: Any = None
    thread_id: str = ""
    approval_provider: Any = None
    output_chunk_sink: Any = None
    router: Any = None
    metadata: dict = field(default_factory=dict)
    is_goal_mode: bool = False
    observed_read_sequence: bool = False
    ordered_result_handoffs: bool = False
    realtime_public_orientation: bool = False
    realtime_public_narrative: bool = False


@dataclass
class _ModelCallState:
    """6b model-call wiring, assembled once and read-only downstream."""

    temperature: float = 0.0
    max_tokens_per_iter: int = 0
    wants_thinking: bool = False
    reasoning_effort: Any = None
    native_evidence_update_tool_specs: list = field(default_factory=list)
    native_public_update_tool_specs: list = field(default_factory=list)
    budget_auto_pause_enabled: bool = False
    budget_pause_threshold: float = 0.0
    agent_id_for_pause: str = ""
    throughput_started_at: float = 0.0
    throughput_interval_s: float = 0.5


@dataclass
class _ModeState:
    """Turn flags (read-only in the per-iteration phases)."""

    is_code_mode: bool = False
    browser_operation_mode: bool = False
    todo_protocol_required: bool = False
    todo_protocol_visible: bool = False
    file_inspection_tools_visible: bool = False
    read_only_turn: bool = False
    no_tool_turn: bool = False


@dataclass
class _GuardToolsState:
    """dsh repeat-tool-reminder state (advisory, never vetoes)."""

    repeat_guard: Any = None
    guard_notices: list = field(default_factory=list)


@dataclass
class _ConvoState:
    """Shared references mutated in place, never re-synced."""

    steps: list = field(default_factory=list)
    executed_beak_steps: list = field(default_factory=list)
    messages: list = field(default_factory=list)
    working_set: dict = field(default_factory=dict)
    final_answer_segments: list = field(default_factory=list)


@dataclass
class _IterationState:
    """Per-iteration synced scalars (synced in before each phase call)."""

    tools_active: bool = False
    planning_mode: bool = False
    enable_tools: bool = True
    effective_model: str = ""
    current_phase: str = ""
    evidence_convergence_active: Any = None
    native_mode: bool = False
    model_failovers: int = 0
    model_timeout_recoveries: int = 0
    consecutive_format_violations: int = 0
    # Consecutive rounds that produced neither a tool call nor a final answer.
    # Drives ``ModelRequest.require_tool_use`` so a prose-only round is
    # answered by constraining the next decode rather than by another
    # prompt-level reminder the model is free to ignore.
    zero_action_rounds: int = 0
    throughput_chars: int = 0
    final_stream_started: bool = False
    force_convergence_next: bool = False
    # Sticky once repeated trusted verifier environment gaps require a
    # terminal, tools-disabled synthesis. Unlike the one-shot recovery flag,
    # this survives guard repair retries so tools cannot reappear.
    terminal_convergence_active: bool = False
    streamed_final_chars: int = 0
    progress_summary: str = ""
    public_progress_summary: str = ""
    consecutive_same_failed_actions: int = 0
    last_failed_action_fingerprint: str = ""
    # Safety net for "silent no-op" tools — the call returns ok=True but
    # produces no real effect (e.g. todo_write with a wrong key, search
    # with an empty query).  Without this the model can loop on the same
    # wrong shape indefinitely because the existing failed-action guard
    # only counts ok=False results.
    consecutive_same_noop_actions: int = 0
    last_noop_action_fingerprint: str = ""
    green_verification_convergence_active: bool = False
    green_convergence_todo_used: bool = False
    result_handoff_ready: bool = False
    last_public_update_key: str = ""
    saw_successful_code_write: bool = False
    clean_verification_rounds_after_write: int = 0
    quiet_evidence_steps: list = field(default_factory=list)
    throughput_last_emit: float = 0.0
    consecutive_llm_errors: int = 0
    # The main loop reads ``iteration_limit`` dynamically, allowing a
    # productive long-running turn to receive a bounded in-place extension
    # instead of being interrupted solely because it reached the initial
    # recipe limit. ``iteration_base_limit`` keeps each grant fixed-size so
    # repeated extensions do not grow exponentially.
    iteration_base_limit: int = 0
    iteration_limit: int = 0
    iteration_extensions_used: int = 0
    # Count of consecutive "blank" iterations where the model emitted no
    # tool call, no observation, no meaningful thought and no final answer
    # (e.g. degraded reasoning producing only whitespace). Used by the
    # model-spin guard to stop burning iterations early.
    consecutive_spin_iterations: int = 0
    # Capability-enhancing spin escalation: before pausing a spinning turn,
    # first force a context-compression pass, then attempt a model switch.
    # ``0`` = not yet escalated · ``1`` = compression forced · ``2`` = model
    # switch requested · ``3`` = exhausted, fall back to pause.
    spin_escalation_stage: int = 0
    # Set by the spin guard (phase 6g) when it decides the next escalation is
    # a model switch. The main loop consumes it after the cancel/pause guard
    # (before the next LLM call) and calls the model-failover closure.
    spin_model_switch_requested: bool = False


@dataclass
class _EmitState:
    """Terminal accumulators (synced in/out)."""

    final_answer: str | None = None
    terminated_reason: str = "max_iter"
    final_answer_emitted: bool = False
    final_delta_emitted_this_iteration: bool = False


@dataclass
class _ParseState:
    """6b/6c outputs consumed by later phases (synced out only)."""

    resp: Any = None
    raw_text: str = ""
    request_has_tool_evidence: bool = False
    iteration_soft_timed_out: bool = False
    maybe_emit_throughput: Any = None
    step: ReActStep | None = None
    maybe_final: str | None = None
    text: str = ""
    length_limited: bool = False
    length_limit_should_continue: bool = False


# Group attr name → group dataclass, used by the guard tests to verify
# every group member is routed and no orphan remains.
_LOOP_STATE_GROUPS = {
    "wiring": _WiringState,
    "model_call": _ModelCallState,
    "mode": _ModeState,
    "guard_tools": _GuardToolsState,
    "convo": _ConvoState,
    "iteration": _IterationState,
    "emit": _EmitState,
    "parse": _ParseState,
}

# flat field name → owning group attr name, derived from the group
# dataclasses themselves so the constructor's flat-kwargs routing and
# the guard tests cannot drift from the group definitions.
_FIELD_TO_GROUP = {
    f.name: group_attr
    for group_attr, group_cls in _LOOP_STATE_GROUPS.items()
    for f in dataclasses.fields(group_cls)
}


class _LoopState:
    """Per-turn state shared between stream_react_loop and the phases.

    Storage is the eight nested groups below; the constructor accepts
    the historical flat keyword arguments and routes each to its group.
    ``__slots__`` pins the attribute set to the groups, so a typo'd
    ``state.<attr> = …`` raises instead of silently creating an
    unrelated instance attribute.
    """

    __slots__ = (
        "wiring",
        "model_call",
        "mode",
        "guard_tools",
        "convo",
        "iteration",
        "emit",
        "parse",
    )

    wiring: _WiringState
    model_call: _ModelCallState
    mode: _ModeState
    guard_tools: _GuardToolsState
    convo: _ConvoState
    iteration: _IterationState
    emit: _EmitState
    parse: _ParseState

    def __init__(self, **kwargs: Any) -> None:
        self.wiring = _WiringState()
        self.model_call = _ModelCallState()
        self.mode = _ModeState()
        self.guard_tools = _GuardToolsState()
        self.convo = _ConvoState()
        self.iteration = _IterationState()
        self.emit = _EmitState()
        self.parse = _ParseState()
        for name in kwargs:
            if name not in _FIELD_TO_GROUP:
                raise TypeError(f"_LoopState() got an unexpected keyword argument {name!r}")
        for name, value in kwargs.items():
            setattr(getattr(self, _FIELD_TO_GROUP[name]), name, value)
