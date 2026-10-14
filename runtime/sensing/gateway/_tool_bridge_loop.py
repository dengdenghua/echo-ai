"""The native agentic tool loop (``stream_agentic_fallback``).

Extracted from ``tool_bridge.py`` (the Claude-native agentic loop). This
satellite owns the main ``stream_agentic_fallback`` generator — the bounded
``plan → tool_use → execute → tool_result`` loop that turns Echo skills
into Claude-native ``tool_use`` calls and streams ``(kind, delta, final)``
events back to the SSE consumer.

The parent ``tool_bridge`` module re-exports every name here so existing
importers and tests are unchanged.
"""

from __future__ import annotations

import contextvars  # noqa: F401 — live bindings used by native-loop phases
import json  # noqa: F401 — live bindings used by native-loop phases
import logging
import time  # noqa: F401 — live bindings used by native-loop phases
from collections.abc import Callable, Generator, Iterator
from concurrent.futures import (  # noqa: F401 — live bindings used by native-loop phases
    FIRST_COMPLETED,
    ThreadPoolExecutor,
    wait,
)
from typing import Any
from uuid import uuid4  # noqa: F401 — live bindings used by native-loop phases

from runtime.platform.models import (
    ArmId,  # noqa: F401 — live bindings used by native-loop phases
    Budget,  # noqa: F401 — live bindings used by native-loop phases
    BudgetLimits,  # noqa: F401 — live bindings used by native-loop phases
    CostEntry,  # noqa: F401 — live bindings used by native-loop phases
    InsufficientBudget,  # noqa: F401 — live bindings used by native-loop phases
    ParsedIntent,
    TaskId,  # noqa: F401 — live bindings used by native-loop phases
    now_utc,  # noqa: F401 — live bindings used by native-loop phases
)
from runtime.platform.models.llm import (
    model_supports_thinking,  # noqa: F401 — live bindings used by native-loop phases
)
from runtime.sensing.model_router.models import (
    Message,  # noqa: F401 — live bindings used by native-loop phases
    ModelRequest,  # noqa: F401 — live bindings used by native-loop phases
    ToolCall,
    thinking_budget_for_effort,  # noqa: F401 — live bindings used by native-loop phases
)

from ._tool_bridge_exec import (  # noqa: F401 — live bindings used by native-loop phases
    _execute_tool_call,
    _recover_named_xml_tool_calls,
)
from ._tool_bridge_loop_batch import (
    _execute_parallel_batch,
    _execute_serial_batch,
    _observe_parallel_batch,
    _prepare_tool_batch,
)
from ._tool_bridge_loop_completion import _finish_round_budget
from ._tool_bridge_loop_context import _NativeLoopContext, _NativeLoopDirective
from ._tool_bridge_loop_decisions import (
    _announce_native_action,
    _announce_tool_requests,
    _finish_native_synthesis,
    _guard_native_calls,
    _guard_terminal_evidence,
)
from ._tool_bridge_loop_prompt import (
    _apply_code_convergence_nudges,  # noqa: F401 — live bindings used by native-loop phases
    _base_conversation_messages,  # noqa: F401 — live bindings used by native-loop phases
    _build_native_session,  # noqa: F401 — live bindings used by native-loop phases
    _insert_capability_assertions,  # noqa: F401 — live bindings used by native-loop phases
    _insert_profile_and_memory_sections,  # noqa: F401 — live bindings used by native-loop phases
    _insert_task_contract_sections,  # noqa: F401 — live bindings used by native-loop phases
    _insert_turn_contract_sections,  # noqa: F401 — live bindings used by native-loop phases
    _resolve_native_tool_specs,  # noqa: F401 — live bindings used by native-loop phases
)
from ._tool_bridge_loop_results import (
    _announce_tool_results,
    _apply_round_convergence,
    _commit_tool_results,
)
from ._tool_bridge_loop_setup import _initialize_steering, _initialize_tracking, _prepare_prompt
from ._tool_bridge_loop_stream import (
    _guard_model_budget,
    _prepare_model_round,
    _recover_model_round,
    _reserve_model_round,
    _stream_model_round,
)
from ._tool_bridge_native import (
    _NATIVE_STREAM_DEADLINE,  # noqa: F401 — live bindings used by native-loop phases
    _NATIVE_STREAM_REDIRECTED,  # noqa: F401 — live bindings used by native-loop phases
    _deduplicate_native_tool_calls,  # noqa: F401 — live bindings used by native-loop phases
    _iter_native_model_stream_with_deadline,  # noqa: F401 — live bindings used by native-loop phases
    _native_call_failure_is_definitive,  # noqa: F401 — live bindings used by native-loop phases
    _native_definitive_failure_target,  # noqa: F401 — live bindings used by native-loop phases
    _native_failure_is_definitive,  # noqa: F401 — live bindings used by native-loop phases
    _native_model_recovery_timeout_s,  # noqa: F401 — live bindings used by native-loop phases
    _native_post_tool_timeout_s,  # noqa: F401 — live bindings used by native-loop phases
    _native_tool_batch_fingerprint,  # noqa: F401 — live bindings used by native-loop phases
    _native_tool_call_fingerprint,  # noqa: F401 — live bindings used by native-loop phases
)
from ._tool_bridge_policy import (
    _CODE_MUTATION_TOOLS,
    _CODE_TERMINAL_VERIFIER_TOOLS,  # noqa: F401 — live bindings used by native-loop phases
    _CODE_VERIFICATION_TOOLS,
    _SERIAL_BARRIER_TOOLS,  # noqa: F401 — live bindings used by native-loop phases
    PARALLEL_TOOL_USE_DEFAULT,  # noqa: F401 — live bindings used by native-loop phases
    PARALLEL_TOOL_USE_MAX_WORKERS,  # noqa: F401 — live bindings used by native-loop phases
    REFLECTION_INTERVAL,  # noqa: F401 — live bindings used by native-loop phases
    _is_shell_mutation,
    _is_shell_terminal_verifier,  # noqa: F401 — live bindings used by native-loop phases
    _is_shell_verification,
    _reflection_checkpoint_message,  # noqa: F401 — live bindings used by native-loop phases
    _tool_uses_session_scope,  # noqa: F401 — live bindings used by native-loop phases
)
from ._tool_bridge_protocol import (
    _NATIVE_ROUND_TEXT_PREFIX_RE,  # noqa: F401 — live bindings used by native-loop phases
    _NATIVE_TEXT_STREAM_SUPPRESS_MARKERS,  # noqa: F401 — live bindings used by native-loop phases
    _NATIVE_TEXT_STREAM_TAIL_MARGIN,  # noqa: F401 — live bindings used by native-loop phases
    _generate_native_action_checkpoint,  # noqa: F401 — live bindings used by native-loop phases
    _generate_native_evidence_checkpoint,  # noqa: F401 — live bindings used by native-loop phases
    _model_response_actual_cost,  # noqa: F401 — live bindings used by native-loop phases
    _native_calls_with_public_checkpoint,  # noqa: F401 — live bindings used by native-loop phases
    _native_public_checkpoint,  # noqa: F401 — live bindings used by native-loop phases
    _native_result_checkpoint,  # noqa: F401 — live bindings used by native-loop phases
    _ordered_read_handoffs_requested,  # noqa: F401 — live bindings used by native-loop phases
    _public_narrative_silence_s,  # noqa: F401 — live bindings used by native-loop phases
)
from ._tool_bridge_scoring import (
    _persist_native_trajectory_safe,  # noqa: F401 — live bindings used by native-loop phases
    _record_score_safe,  # noqa: F401 — live bindings used by native-loop phases
)
from ._tool_bridge_session import (
    _browser_action_evidence,  # noqa: F401 — live bindings used by native-loop phases
)

_logger = logging.getLogger("echo.agentic")


def _rescue_policy_names() -> tuple[Any, Any]:
    """Lazily resolve rescue-policy helpers through the parent module.

    Tests monkeypatch ``tool_bridge._next_custom_model_fallback`` /
    ``tool_bridge._is_provider_unavailable_error`` at module level, so the
    loop must read them live from the parent namespace (not a locally-bound
    alias) for those patches to take effect. Returns ``(is_unavailable, fallback)``.
    """
    from runtime.sensing.gateway import tool_bridge as _tb

    return _tb._is_provider_unavailable_error, _tb._next_custom_model_fallback


def _native_plan_reconciliation_milestones(
    calls: list[ToolCall],
    result_blocks: list[dict[str, Any]],
) -> list[str]:
    """Return successful write/verification milestones after the last todo."""
    last_todo_index = max(
        (index for index, call in enumerate(calls) if call.name == "todo_write"),
        default=-1,
    )
    milestones: list[str] = []
    for index, (call, block) in enumerate(zip(calls, result_blocks, strict=True)):
        if index <= last_todo_index or block.get("is_error"):
            continue
        if (
            call.name in _CODE_MUTATION_TOOLS or _is_shell_mutation(call)
        ) and "workspace/document write" not in milestones:
            milestones.append("workspace/document write")
        if (
            call.name in _CODE_VERIFICATION_TOOLS or _is_shell_verification(call)
        ) and "green verification" not in milestones:
            milestones.append("green verification")
    return milestones


def _native_tool_failure_type(output: str) -> str:
    """Classify bridge/preflight failures without trusting provider text."""

    normalized = output.strip().casefold()
    markers = (
        ("(executor unavailable", "executor_unavailable"),
        ("(invalid tool call:", "invalid_tool_call"),
        ("(skill not found:", "skill_not_found"),
        ("(skill disabled:", "skill_disabled"),
        ("(registry error:", "registry_error"),
        ("(cancelled", "cancelled"),
    )
    return next(
        (failure_type for marker, failure_type in markers if normalized.startswith(marker)),
        "native_tool_error",
    )


def stream_agentic_fallback(
    stack: Any,
    intent: ParsedIntent,
    agent: Any,
    *,
    model: str | None = None,
    sub_event_queue: Any = None,
    steering_drain: Callable[[], list[str]] | None = None,
) -> Iterator[tuple[str, Any, Any]]:
    """Run the native tool loop with a fail-closed terminal finalizer.

    ``yield from`` deliberately lives in this small wrapper.  Closing an SSE
    consumer injects ``GeneratorExit`` at the current yield point, while an
    unexpected checkpoint/model exception escapes the implementation.  The
    implementation registers its idempotent trajectory finalizer as soon as
    the per-turn task exists, letting this wrapper settle either path without
    indenting the entire (large) generator body under a fragile ``try`` block.
    """

    native_finalizer: Callable[..., bool] | None = None
    fallback_disposition = "failed"

    def _register_native_finalizer(finalizer: Callable[..., bool]) -> None:
        nonlocal native_finalizer
        native_finalizer = finalizer

    try:
        yield from _stream_agentic_fallback_impl(
            stack,
            intent,
            agent,
            model=model,
            sub_event_queue=sub_event_queue,
            steering_drain=steering_drain,
            _register_native_finalizer=_register_native_finalizer,
        )
    except GeneratorExit:
        fallback_disposition = "cancelled"
        raise
    finally:
        # Normal terminal paths finalize before their last public event.  This
        # call is therefore a no-op there, but closes the audit gap for client
        # disconnects, generator.close(), and exceptions in checkpoint code.
        if native_finalizer is not None:
            native_finalizer(success=False, disposition=fallback_disposition)


def _run_native_round(
    ctx: _NativeLoopContext,
) -> Generator[tuple[str, Any, Any], None, _NativeLoopDirective]:
    directive = _prepare_model_round(ctx)
    if directive is not _NativeLoopDirective.PROCEED:
        return directive
    directive = yield from _reserve_model_round(ctx)
    if directive is not _NativeLoopDirective.PROCEED:
        return directive
    directive = yield from _stream_model_round(ctx)
    if directive is not _NativeLoopDirective.PROCEED:
        return directive
    directive = yield from _guard_model_budget(ctx)
    if directive is not _NativeLoopDirective.PROCEED:
        return directive
    directive = yield from _recover_model_round(ctx)
    if directive is not _NativeLoopDirective.PROCEED:
        return directive
    directive = _guard_native_calls(ctx)
    if directive is not _NativeLoopDirective.PROCEED:
        return directive
    directive = yield from _announce_native_action(ctx)
    if directive is not _NativeLoopDirective.PROCEED:
        return directive
    directive = yield from _announce_tool_requests(ctx)
    if directive is not _NativeLoopDirective.PROCEED:
        return directive
    if not ctx.round_tool_calls:
        directive = _guard_terminal_evidence(ctx)
        if directive is not _NativeLoopDirective.PROCEED:
            return directive
        return (yield from _finish_native_synthesis(ctx))
    directive = _prepare_tool_batch(ctx)
    if directive is not _NativeLoopDirective.PROCEED:
        return directive
    if ctx._parallel_enabled:
        directive = yield from _execute_parallel_batch(ctx)
        if directive is not _NativeLoopDirective.PROCEED:
            return directive
        directive = yield from _observe_parallel_batch(ctx)
        if directive is not _NativeLoopDirective.PROCEED:
            return directive
    else:
        directive = yield from _execute_serial_batch(ctx)
        if directive is not _NativeLoopDirective.PROCEED:
            return directive
    directive = _commit_tool_results(ctx)
    if directive is not _NativeLoopDirective.PROCEED:
        return directive
    directive = yield from _announce_tool_results(ctx)
    if directive is not _NativeLoopDirective.PROCEED:
        return directive
    directive = yield from _apply_round_convergence(ctx)
    if directive is not _NativeLoopDirective.PROCEED:
        return directive
    return _NativeLoopDirective.PROCEED


def _stream_agentic_fallback_impl(
    stack: Any,
    intent: ParsedIntent,
    agent: Any,
    *,
    model: str | None = None,
    sub_event_queue: Any = None,
    steering_drain: Callable[[], list[str]] | None = None,
    _register_native_finalizer: Callable[[Callable[..., bool]], None] | None = None,
) -> Iterator[tuple[str, Any, Any]]:
    """Agentic streaming · same ``(kind, delta, final)`` shape as
    ``_stream_direct_llm_fallback`` so the SSE loop can consume
    both paths identically.

    Extra event kinds vs the direct fallback:

    * ``("tool-call-delta", {index, id, name, argumentsDelta}, None)``
      — one raw fragment of a tool call while it is still assembling
      (dsh ``tool-call-delta`` lane). Purely a live preview; the
      completed call arrives as ``tool_start`` and nothing executes
      on the delta lane.
    * ``("tool_start", {id, name, input, iteration}, None)``
    * ``("tool_end",   {id, name, output, is_error, iteration}, None)``

    The tool_start/tool_end pair gets turned into SSE ``custom``
    frames by the router, feeding the existing
    ``LiveToolTimeline`` component in the UI.

    Sub-agent events
    ----------------

    When ``sub_event_queue`` is provided (same ``queue.Queue`` the
    SSE pump is draining), it's stashed on ``Session.metadata`` so
    the ephemeral sub-agent runner can push
    ``("sub_tool_start"/"sub_tool_end", payload, None)`` tuples into
    it when IT executes tools. The SSE pump's drain loop serializes
    parent + sub-agent events into one ordered stream with
    ``parent_tool_use_id`` fields linking children to the
    ``call_agent_parallel`` / ``call_agent`` row they run under.

    The ``_active_parent_tool_use_id`` session-metadata key is
    flipped on/off around each parent ``_execute_tool_call`` so
    sub-agents spawned inside a handler can read the id of the
    parent tool_use they're running under · see
    ``ephemeral_runner._emit_sub_tool_event``.
    """
    ctx = _prepare_prompt(
        stack,
        intent,
        agent,
        model=model,
        sub_event_queue=sub_event_queue,
        steering_drain=steering_drain,
        _register_native_finalizer=_register_native_finalizer,
    )
    if ctx is None:
        return
    _initialize_tracking(ctx)
    _initialize_steering(ctx)
    for ctx.round_i in range(ctx.max_tool_rounds):  # noqa: B020 — updates a field; does not rebind ctx
        directive = yield from _run_native_round(ctx)
        if directive is _NativeLoopDirective.TERMINAL:
            return
        if directive is _NativeLoopDirective.EXHAUSTED:
            break
    yield from _finish_round_budget(ctx)
