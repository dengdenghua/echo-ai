"""Final-answer guard plumbing for the ReAct loop.

Extracted from ``react_loop.py`` (Wave 1 of the split documented in
``docs/design/react-loop-split-plan.md``    _ENVIRONMENTAL_FAILURE_MARKERS as _ENVIRONMENTAL_FAILURE_MARKERS,
    _VERIFIER_CAPABILITY_MARKERS as _VERIFIER_CAPABILITY_MARKERS,
). Everything here decides whether a
candidate final answer may stream to the user, records rejected steps, and
produces the terminal wording when the loop deadlocks against a guard.
"""

from __future__ import annotations

from runtime.core.cerebrum.react_final_answer_guards_checks import (  # noqa: F401  re-export: import sites stay stable
    _CODE_FENCE_RE as _CODE_FENCE_RE,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _EXECUTION_DEGRADED_THRESHOLD as _EXECUTION_DEGRADED_THRESHOLD,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _INLINE_TOOL_CALL_NAMES as _INLINE_TOOL_CALL_NAMES,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _INLINE_TOOL_CALL_RE as _INLINE_TOOL_CALL_RE,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _REACT_ACTION_CALL_RE as _REACT_ACTION_CALL_RE,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _REACT_THOUGHT_LINE_RE as _REACT_THOUGHT_LINE_RE,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _STANDALONE_INLINE_TOOL_CALL_RE as _STANDALONE_INLINE_TOOL_CALL_RE,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _clean_protocol_leak as _clean_protocol_leak,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _environmental_failure_count as _environmental_failure_count,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _evaluate_final_answer_guards as _evaluate_final_answer_guards,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _final_answer_needs_pre_emit_guard as _final_answer_needs_pre_emit_guard,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _guard_impasse_actionable_hint as _guard_impasse_actionable_hint,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _guard_impasse_final_answer as _guard_impasse_final_answer,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _guard_reason_for_user as _guard_reason_for_user,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _guard_rejection_outcome as _guard_rejection_outcome,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _guard_repair_feedback as _guard_repair_feedback,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _guard_soft_landing_answer as _guard_soft_landing_answer,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _logger as _logger,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _looks_like_observation_echo as _looks_like_observation_echo,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _note_guard_impasse as _note_guard_impasse,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _phase_6e_guards_and_step_emit as _phase_6e_guards_and_step_emit,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _record_rejected_step as _record_rejected_step,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _research_final_answer_guards_active as _research_final_answer_guards_active,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _step_environmental_failure_count as _step_environmental_failure_count,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _step_has_pending_tool_action as _step_has_pending_tool_action,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _step_is_environmental_failure as _step_is_environmental_failure,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _strip_code_fences as _strip_code_fences,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _strip_inline_tool_calls as _strip_inline_tool_calls,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _targets_verifier_capability as _targets_verifier_capability,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _text_has_pending_tool_action as _text_has_pending_tool_action,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _trajectory_execution_degraded as _trajectory_execution_degraded,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _trajectory_has_executed_action as _trajectory_has_executed_action,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _trajectory_has_successful_tool_evidence as _trajectory_has_successful_tool_evidence,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _trusted_execution_failure as _trusted_execution_failure,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _try_clean_downgrade as _try_clean_downgrade,
)
from runtime.core.cerebrum.react_final_answer_guards_checks import (
    _unfinished_implementation_recovery_needed as _unfinished_implementation_recovery_needed,
)

# Imported from the defining module directly: react_guards' re-export of
# ``_step_is_failed_execution`` exists only in an uncommitted refactor, so at
# the committed tip ``from react_guards import _step_is_failed_execution``
# raised ImportError and broke 24 test modules at collection.
from runtime.core.cerebrum.react_types import ReActStep

# A ReAct Action block written as prose: ``Action:\n    name({...})`` or
# ``Action: name({...})``. Anchored on the tool-call shape (name + JSON
# parens) so a legitimate mention like "the Action field" is not flagged.
# A ``Thought:`` line at the start of a line. Used only as a corroboration
# signal alongside an Action block above, never on its own.


def guard_stall_kind(steps: list[ReActStep]) -> str:
    """Classify *why* a guard keeps rejecting: ``action_deficit`` vs ``evidence``.

    The two demand opposite responses and the loop previously conflated them:

    * ``evidence`` — the model is running tools but cannot obtain what the
      guard wants. Text feedback is useful here; it names the missing piece.
    * ``action_deficit`` — the model executed nothing at all. Text feedback is
      provably useless: in trn_c2fbddce247b4164 the same guard rejected three
      rephrasings of "I'll inspect X next" while zero tools ran. What breaks
      that loop is the decode-level ``require_tool_use`` forcing, so this case
      should be given fewer rephrasing attempts before terminating honestly.
    """
    return "evidence" if _trajectory_has_executed_action(steps) else "action_deficit"


# Markers that distinguish an ENVIRONMENTAL tool failure (sandbox/network
# denial the model cannot fix by retrying the same tool) from a logic error
# it could. Matched case-insensitively against the observation text.


# How many environmental failures mark the environment itself as degraded.
# One EPERM can be transient (or the model probing whether a tool runs);
# two or more mean execution is genuinely blocked, so run-based evidence
# guards must stop vetoing the turn.


# Tool names the model may write into answer prose as an inline JSON call
# (``todo_write({"items": [...]})``) instead of emitting a structured tool
# call. When that leaks into the final answer, strip the whole call block so
# the user never sees raw tool protocol in the transcript.
