"""6c reads its 6b inputs off state instead of taking them as kwargs.

The ``parse`` group is documented as "synced out only": 6b assigns its share in
a ``finally`` so every exit path leaves state authoritative, which is what lets
6c pull those values directly instead of routing them through a
state → local → kwarg → local round trip in the main loop.

That only holds while both sides agree on the field set. If someone adds a 6b
output to the group and forgets the ``finally``, or has 6c read a parse field
6b never writes, 6c silently observes the previous iteration's value — a class
of bug that produces a plausible-looking answer rather than a crash. These are
structural latches in the ``test_max_tools_matches_the_broker`` style: cheap,
source-level, and loud the moment the two sides drift.
"""

from __future__ import annotations

import ast
import dataclasses
import inspect
from pathlib import Path

from runtime.core.cerebrum import react_model_stream, react_phase_6c
from runtime.core.cerebrum.react_loop_state import _ParseState


def _function_def(module: object, name: str) -> ast.FunctionDef:
    source = Path(inspect.getfile(module)).read_text(encoding="utf-8")
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{name} not found in {module!r}")


def _parse_field_names() -> frozenset[str]:
    return frozenset(f.name for f in dataclasses.fields(_ParseState))


def _state_attrs_written_in_finally(func: ast.FunctionDef) -> frozenset[str]:
    """``state.<attr> = ...`` assignments inside any ``finally`` of ``func``."""
    written: set[str] = set()
    for node in ast.walk(func):
        if not isinstance(node, ast.Try):
            continue
        for stmt in node.finalbody:
            for inner in ast.walk(stmt):
                if not isinstance(inner, ast.Assign):
                    continue
                for target in inner.targets:
                    if (
                        isinstance(target, ast.Attribute)
                        and isinstance(target.value, ast.Name)
                        and target.value.id == "state"
                    ):
                        written.add(target.attr)
    return frozenset(written)


def _state_attrs_read(func: ast.FunctionDef) -> frozenset[str]:
    """``... = state.<attr>`` reads anywhere in ``func``."""
    read: set[str] = set()
    for node in ast.walk(func):
        if (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == "state"
            and isinstance(node.ctx, ast.Load)
        ):
            read.add(node.attr)
    return frozenset(read)


# The parse fields 6b produces and 6c consumes. The rest of the group
# (``step``, ``maybe_final``, ``text``, ``length_limited``,
# ``length_limit_should_continue``, ``maybe_emit_throughput``) are 6c's own
# outputs for 6d–6g, which 6b has no reason to write — 6c initializes them
# through state at entry, so reading one back is not a handoff.
_HANDED_OFF_PARSE_FIELDS = frozenset(
    {
        "resp",
        "raw_text",
        "request_has_tool_evidence",
        "iteration_soft_timed_out",
    }
)


def test_6b_writes_every_parse_field_6c_takes_as_a_handoff() -> None:
    parse_fields = _parse_field_names()
    assert _HANDED_OFF_PARSE_FIELDS <= parse_fields, (
        "this latch drifted from the parse group definition: "
        f"{sorted(_HANDED_OFF_PARSE_FIELDS - parse_fields)}"
    )
    written_by_6b = _state_attrs_written_in_finally(
        _function_def(react_model_stream, "_phase_6b_model_stream")
    )
    read_by_6c = _state_attrs_read(_function_def(react_phase_6c, "_phase_6c_parse_and_guard"))

    handed_off = read_by_6c & _HANDED_OFF_PARSE_FIELDS
    assert handed_off == _HANDED_OFF_PARSE_FIELDS, (
        "6c stopped reading handoff field(s) off state — did a kwarg creep back? "
        f"{sorted(_HANDED_OFF_PARSE_FIELDS - handed_off)}"
    )
    missing = handed_off - written_by_6b
    assert not missing, (
        "6c reads handoff field(s) off state that 6b never writes in its finally, "
        f"so a stale previous-iteration value leaks through: {sorted(missing)}"
    )


def test_6b_parse_writes_stay_in_a_finally() -> None:
    """A write outside ``finally`` would be skipped on 6b's early exits."""

    func = _function_def(react_model_stream, "_phase_6b_model_stream")
    in_finally = _state_attrs_written_in_finally(func)
    handed_off = _HANDED_OFF_PARSE_FIELDS
    assert handed_off <= in_finally, (
        "6b must assign every handed-off parse field inside a finally so an "
        "early return still leaves state authoritative: "
        f"{sorted(handed_off - in_finally)} are not written in a finally"
    )


def test_6c_does_not_take_its_parse_inputs_as_keywords() -> None:
    """Pins the round trip out of the main loop rather than just deleting it."""

    signature = inspect.signature(react_phase_6c._phase_6c_parse_and_guard)
    for name in ("resp", "raw_text", "request_has_tool_evidence", "iteration_soft_timed_out"):
        assert name not in signature.parameters, (
            f"{name} came back as a 6c keyword; it is already authoritative on "
            "state.parse, so the main loop should not copy it out and back in"
        )
