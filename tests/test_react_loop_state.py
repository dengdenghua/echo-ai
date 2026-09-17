"""Guards for _LoopState's grouped storage contract.

These tests pin the Wave D end-state: ``_LoopState`` stores everything
in eight nested group dataclasses, the constructor accepts the original
flat keywords and routes them via ``_FIELD_TO_GROUP`` (itself derived
from the group dataclasses, so routing cannot drift), and defaults match
the pre-refactor snapshot.  Mirrors the
``test_max_tools_matches_the_broker`` pattern: a small structural latch
that fails loudly the moment the two sides drift.
"""

from __future__ import annotations

import dataclasses
import re
from pathlib import Path
from typing import Any

import pytest

from runtime.core.cerebrum.react_loop_state import (
    _FIELD_TO_GROUP,
    _LOOP_STATE_GROUPS,
    _LoopState,
)


def _all_group_members() -> dict[str, str]:
    """flat_name → group attr name, built from the group dataclasses."""
    members: dict[str, str] = {}
    for group_attr, group_cls in _LOOP_STATE_GROUPS.items():
        for f in dataclasses.fields(group_cls):
            assert f.name not in members, f"duplicate member {f.name!r}"
            members[f.name] = group_attr
    return members


def test_field_routing_covers_all_group_members() -> None:
    members = _all_group_members()
    assert members == _FIELD_TO_GROUP, (
        "constructor routing drifted from group members: "
        f"missing={sorted(set(members) - set(_FIELD_TO_GROUP))} "
        f"extra={sorted(set(_FIELD_TO_GROUP) - set(members))}"
    )


def test_constructor_routes_every_field_to_its_group() -> None:
    for name, group_attr in _FIELD_TO_GROUP.items():
        sentinel = object()
        state = _LoopState(**{name: sentinel})
        assert getattr(getattr(state, group_attr), name) is sentinel, (
            f"{name}: constructor kwarg did not land in {group_attr}"
        )


def test_default_values_match_pre_wave_a_snapshot() -> None:
    expected: dict[str, Any] = {
        # wiring
        "stack": None,
        "goal": "",
        "executor": None,
        "react_task_id": None,
        "pause_controller": None,
        "effective_wp": None,
        "format_violation_bail_at": 2,
        "final_guard_grounded_source_paths": None,
        "guard_impasse_state": {},
        "prior_grounding_text": "",
        "intent": None,
        "agent": None,
        "thread_id": "",
        "approval_provider": None,
        "output_chunk_sink": None,
        "router": None,
        "metadata": {},
        "is_goal_mode": False,
        "observed_read_sequence": False,
        "ordered_result_handoffs": False,
        "realtime_public_orientation": False,
        "realtime_public_narrative": False,
        # model_call
        "temperature": 0.0,
        "max_tokens_per_iter": 0,
        "wants_thinking": False,
        "reasoning_effort": None,
        "native_evidence_update_tool_specs": [],
        "native_public_update_tool_specs": [],
        "budget_auto_pause_enabled": False,
        "budget_pause_threshold": 0.0,
        "agent_id_for_pause": "",
        "throughput_started_at": 0.0,
        "throughput_interval_s": 0.5,
        # mode
        "is_code_mode": False,
        "browser_operation_mode": False,
        "todo_protocol_required": False,
        "todo_protocol_visible": False,
        "file_inspection_tools_visible": False,
        "read_only_turn": False,
        "no_tool_turn": False,
        # guard_tools
        "repeat_guard": None,
        "guard_notices": [],
        # convo
        "steps": [],
        "executed_beak_steps": [],
        "messages": [],
        "working_set": {},
        "final_answer_segments": [],
        # iteration
        "tools_active": False,
        "planning_mode": False,
        "enable_tools": True,
        "effective_model": "",
        "current_phase": "",
        "evidence_convergence_active": None,
        "native_mode": False,
        "model_failovers": 0,
        "model_timeout_recoveries": 0,
        "consecutive_format_violations": 0,
        "zero_action_rounds": 0,
        "throughput_chars": 0,
        "final_stream_started": False,
        "force_convergence_next": False,
        "terminal_convergence_active": False,
        "streamed_final_chars": 0,
        "progress_summary": "",
        "public_progress_summary": "",
        "consecutive_same_failed_actions": 0,
        "last_failed_action_fingerprint": "",
        "consecutive_same_noop_actions": 0,
        "last_noop_action_fingerprint": "",
        "green_verification_convergence_active": False,
        "green_convergence_todo_used": False,
        "result_handoff_ready": False,
        "last_public_update_key": "",
        "saw_successful_code_write": False,
        "clean_verification_rounds_after_write": 0,
        "quiet_evidence_steps": [],
        "throughput_last_emit": 0.0,
        "consecutive_llm_errors": 0,
        "iteration_base_limit": 0,
        "iteration_limit": 0,
        "iteration_extensions_used": 0,
        "consecutive_spin_iterations": 0,
        "spin_escalation_stage": 0,
        "spin_model_switch_requested": False,
        # emit
        "final_answer": None,
        "terminated_reason": "max_iter",
        "final_answer_emitted": False,
        "final_delta_emitted_this_iteration": False,
        # parse
        "resp": None,
        "raw_text": "",
        "request_has_tool_evidence": False,
        "iteration_soft_timed_out": False,
        "maybe_emit_throughput": None,
        "step": None,
        "maybe_final": None,
        "text": "",
        "length_limited": False,
        "length_limit_should_continue": False,
    }
    assert set(expected) == set(_FIELD_TO_GROUP), (
        f"snapshot drifted from routed fields: "
        f"missing={sorted(set(_FIELD_TO_GROUP) - set(expected))} "
        f"extra={sorted(set(expected) - set(_FIELD_TO_GROUP))}"
    )
    state = _LoopState()
    for name, value in expected.items():
        group_attr = _FIELD_TO_GROUP[name]
        actual = getattr(getattr(state, group_attr), name)
        assert actual == value and type(actual) is type(value), (
            f"{name}: default {actual!r} ({type(actual).__name__}) "
            f"!= expected {value!r} ({type(value).__name__})"
        )


def test_constructor_accepts_flat_kwargs_and_rejects_unknown() -> None:
    state = _LoopState(goal="g", tools_active=True, final_answer="done")
    assert state.wiring.goal == "g"
    assert state.iteration.tools_active is True
    assert state.emit.final_answer == "done"
    with pytest.raises(TypeError, match="unexpected keyword argument"):
        _LoopState(never_existed=1)  # type: ignore[call-arg]


def test_reference_fields_stay_shared_in_place() -> None:
    steps: list[Any] = []
    state = _LoopState(steps=steps)
    state.convo.steps.append("s1")
    assert steps == ["s1"], "steps lost in-place sharing"
    state.convo.messages.append("m1")
    assert state.convo.messages == ["m1"]


# Runtime files migrated to group-level access across Waves C/D. Flat
# ``state.<field>`` access is gone from _LoopState entirely, so a flat
# write here would silently create an unrelated instance attribute.
# Extend this list when a new phase module is extracted.
_REACT_STATE_FILES = (
    Path("runtime/core/cerebrum/react_loop.py"),
    Path("runtime/core/cerebrum/react_model_stream.py"),
    Path("runtime/core/cerebrum/react_phase_6c.py"),
    Path("runtime/core/cerebrum/react_final_answer_guards.py"),
    Path("runtime/core/cerebrum/_react_execution_phase6d.py"),
    Path("runtime/core/cerebrum/_react_execution_phase6g.py"),
)


def test_runtime_files_use_group_access_not_flat_fields() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    allowed = set(_LOOP_STATE_GROUPS)
    for rel in _REACT_STATE_FILES:
        text = (repo_root / rel).read_text(encoding="utf-8")
        # Lookbehind: skip ``task.state.x``-style attribute paths on other
        # objects; only a bare ``state.`` prefix is a _LoopState reference.
        used = set(re.findall(r"(?<![A-Za-z0-9_.])state\.([A-Za-z_]\w*)", text))
        flat = used - allowed
        assert not flat, f"{rel}: flat _LoopState access leaked back: {sorted(flat)}"
