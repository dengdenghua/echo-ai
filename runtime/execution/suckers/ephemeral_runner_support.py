"""Budget, signature, report, and registry helpers for the ephemeral runner.

Extracted from ``ephemeral_runner`` to keep that module under the god-file
threshold. The runner re-imports these helpers, so its behaviour and import
surface are unchanged.
"""

from __future__ import annotations

import logging
from typing import Any

_log = logging.getLogger("runtime.execution.ephemeral_runner")

# Margin below the parent/bridge timeout so the loop can hand back partial
# findings before the bridge force-kills the whole sub-agent call.
_LOOP_DEADLINE_MARGIN_S = 10.0

# Maximum delegation depth. 0 = planner (root), 1 = ephemeral sub-agent,
# 2 = ephemeral sub-agent's sub-agent. Prevents infinite recursion while
# allowing hierarchical orchestration (give dimension → sub-agent self-organizes).
MAX_DELEGATION_DEPTH: int = 2

_LENGTH_LIMIT_FINISH_REASONS = {
    "length",
    "max_tokens",
    "max_output_tokens",
    "output_limit",
    "token_limit",
}


def _loop_budget_seconds(call: Any) -> float:
    """Wall-clock budget (seconds from now) for the tool loop.

    Mirrors the parent/bridge ``timeout_s`` so a sub-agent is bounded by time
    rather than an arbitrary round count. Falls back to 900s when the bridge
    did not stamp a timeout.
    """
    raw = (call.context or {}).get("timeout_s")
    try:
        budget = float(raw) if raw is not None else 0.0
    except (TypeError, ValueError):
        budget = 0.0
    if budget <= 0:
        budget = 900.0
    return max(60.0, budget - _LOOP_DEADLINE_MARGIN_S)


# Tools that legitimately re-invoke the same signature while a long-running
# background job is still working. Polling a stable task_id is real progress
# for long tasks, so these rounds are exempt from the convergence guard and
# must never be truncated as a "loop".
POLLING_TOOL_NAMES = frozenset(
    {
        "read_background_output",
        "read_shell_output",
        "background_exec",
        "kill_background_exec",
    }
)


def _tool_call_signature(tool_call: Any) -> tuple[str, str]:
    """Stable identity for one tool call, used for repeat-loop detection."""
    name = getattr(tool_call, "name", "") or ""
    raw = getattr(tool_call, "input", None) or {}
    try:
        import json as _json

        return (str(name), _json.dumps(raw, sort_keys=True, ensure_ascii=False))
    except (TypeError, ValueError):  # non-serializable args -> fall back to repr
        return (str(name), repr(raw))


def _tool_path_args(tool_input: Any) -> dict[str, Any]:
    """Emit only the write-target path so the bridge's file-touch tracking can
    list it on the finish card without shipping the whole tool input (file
    content) onto the parent timeline. Best-effort, never raises."""
    if not isinstance(tool_input, dict):
        return {}
    path = tool_input.get("path")
    return {"path": path} if isinstance(path, str) and path else {}


# ── Child→parent report tool (dsh ``tool-subagent-report``) ──────────────
# Installed into every continuable in-process child's tool surface (i.e. when
# ``call.context["subagent_session_id"]`` is present): the child can deliver
# self-contained findings to its direct parent MID-round, not only via the
# transcript the bridge pulls afterwards. Roots, one-shot children, remote
# providers, and agentless executions never see the registration (dsh scope).

REPORT_TOOL_GUIDANCE = (
    "Finish by delivering your result with the report tool: call it exactly once "
    "with a self-contained final answer. A successful report ends this child "
    "run immediately, so complete all research and verification before calling it. "
    "The agent that started you shares your "
    "workspace but does not automatically receive your transcript, tool "
    'output, or reasoning, so a closing remark such as "done" leaves it '
    "nothing it can use. Do not use report for progress updates and do not "
    "call any more tools after it."
)


def _report_tool_spec() -> Any:
    """The ``report`` tool definition (dsh ``tool-subagent-report``)."""
    from runtime.platform.models.llm import ToolSpec

    return ToolSpec(
        name="report",
        description=(
            "Deliver your final result to the agent that started you and end "
            "this child run. Call this exactly once, only after all research "
            "and verification are complete, with a self-contained answer. "
            "That agent shares your workspace but does not "
            "automatically receive your transcript, tool output, or "
            "reasoning. Only your direct parent receives the report. A "
            "successful call is terminal; a failed call may still have "
            "arrived, so never blindly repeat it."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "output": {
                    "type": "string",
                    "description": (
                        "Actionable content for your parent; summarize "
                        "conclusions and reference relevant shared paths."
                    ),
                }
            },
            "required": ["output"],
            "additionalProperties": False,
        },
    )


def _handle_report_tool(
    tc: Any,
    session_id: str,
    *,
    delivery: str = "wakeup",
) -> tuple[str, bool]:
    """Deliver one ``report`` tool call to the child's report lane.

    Best-effort + at-least-once like dsh: a storage failure returns an error
    result to the child (which must not blindly repeat — the report may still
    have arrived), but never crashes the child round.
    """
    args = getattr(tc, "input", None) or {}
    content = args.get("output") if isinstance(args, dict) else None
    if not isinstance(content, str) or not content.strip():
        return (
            '(report failed) parameter "output" must be a non-empty string '
            "with the content to deliver.",
            True,
        )
    try:
        from runtime.execution.subagents.sessions import (
            get_subagent_session_store,
        )

        store = get_subagent_session_store()
        if store is None:
            return "(report failed) subagent session store unavailable.", True
        session = store.append_report(
            session_id,
            content=content,
            delivery="wakeup" if delivery != "quiet" else "quiet",
        )
        if session is None:
            return f"(report failed) no subagent session {session_id!r}.", True
    except ValueError as exc:
        return f"(report failed) {exc}", True
    except Exception as exc:  # noqa: BLE001 — never crash the child round
        _log.warning(
            "report tool failed for session %s: %s: %s",
            session_id,
            type(exc).__name__,
            exc,
        )
        return f"(report failed) {type(exc).__name__}: {exc}", True
    message_id = f"report-{len(session.reports) - 1}"
    effective = session.reports[-1].delivery if session.reports else "quiet"
    if effective == "quiet":
        note = (
            "Delivered to the parent's report lane, but queued quietly: "
            "the parent was not woken (the consecutive-wake budget is spent). "
            "Do not keep reporting — the parent will read this on its next turn."
        )
    elif effective == "queued":
        note = (
            "Delivered to the parent's report lane, queued into its running "
            "turn: the parent is busy and was not woken. Do not keep reporting "
            "— the parent will read this when it next continues this session "
            "or starts a turn."
        )
    else:
        note = "The parent has been woken to read this."
    return (
        f"Report delivered (messageId={message_id}). {note} This child run is now complete.",
        False,
    )


def _is_length_limited_finish(reason: str | None) -> bool:
    normalized = (reason or "").strip().lower()
    return normalized in _LENGTH_LIMIT_FINISH_REASONS


_CONTINUE_AFTER_LENGTH_LIMIT = (
    "Your previous response was cut off by the output length limit. "
    "Continue exactly where it stopped, do not repeat earlier text, "
    "and finish every missing requirement."
)

# Extra rounds granted ONLY to finish a reply the provider cut mid-sentence.
#
# The continue-after-truncation path is gated on ``round_i + 1 < max_rounds``, so
# a role with a finite cap that gets length-limited on its LAST allowed round has
# nowhere to continue and returns a mid-sentence answer with a "[response
# truncated]" marker. That is the worst possible outcome: the work was done, and
# only the write-out is broken.
#
# These rounds are not general exploration budget. They are only reachable when
# the model is provably mid-write-out (length-limited finish reason with no tool
# calls), the wall-clock deadline still holds, and the allowance has not been
# spent — so they cannot be used to keep exploring past the cap.
EPHEMERAL_WRITEOUT_GRACE_ROUNDS: int = 3

_TRUNCATION_ENDINGS = (
    ".",
    "!",
    "?",
    "。",
    "！",
    "？",
    ")",
    "]",
    "】",
    "」",
    "”",
    "'",
    '"',
    "`",
    "…",
)


def _looks_truncated_text(
    text: str,
    *,
    output_tokens: int,
    max_tokens: int,
) -> bool:
    """Best-effort fallback when a provider omits a truncation finish_reason."""
    stripped = text.rstrip()
    if not stripped:
        return False
    if (
        max_tokens > 0
        and output_tokens > 0
        and (
            output_tokens >= max(1, int(max_tokens * 0.9))
            and len(stripped) >= max(1200, int(max_tokens * 0.75))
        )
    ):
        return True
    if max_tokens > 0 and len(stripped) >= max(2000, int(max_tokens * 1.5)):
        return not stripped.endswith(_TRUNCATION_ENDINGS)
    return bool(len(stripped) >= 1200 and not stripped.endswith(_TRUNCATION_ENDINGS))


def _select_call_model(default_model: str, context: Any) -> str:
    """Pick the model for ONE ephemeral sub-agent run.

    The dispatch bridge stamps ``context["model_name"]`` for BOTH explicit
    per-dispatch overrides (caller passed ``context={"model_name": ...}``) AND
    ``use_cheap_model`` routing (bridge injects the resolved cheap model). The
    runner must honor it; the factory-captured ``default_model`` (the
    planner/stack default) is only the fallback when no override is present.

    This is the lever that actually changes the backend: ``ModelDispatchRouter``
    resolves the provider/host from ``request.model``, so returning the override
    here is what makes the sub-agent reach the requested model's host instead of
    silently running on the planner default (the bug this fixes — the override
    was carried all the way into ``call.context`` but never consulted).
    """
    if isinstance(context, dict):
        override = context.get("model_name")
        if isinstance(override, str) and override.strip():
            return override.strip()
    return default_model


def _clone_registry_with_delegation(
    registry: Any,
    call: Any,
    depth: int,
) -> Any:
    """Clone the registry and conditionally register delegation skills.

    When a sub-agent is allowed to spawn its own sub-agents (hierarchical
    orchestration), this creates a shallow registry clone and registers
    `call_agent_parallel` with depth and budget constraints inherited from
    the parent.

    Parameters
    ----------
    registry :
        The parent's SkillRegistry.
    call :
        The EphemeralCall with context carrying budget and depth.
    depth :
        Current delegation depth (0=planner, 1=ephemeral, 2=ephemeral's child).

    Returns
    -------
    A new SkillRegistry with delegation skills registered.
    """
    from copy import copy

    # Shallow clone: tools dict is new, but tool objects are shared refs
    cloned = copy(registry)
    cloned._by_name = dict(registry._by_name)  # noqa: SLF001

    # Depth limit is enforced HERE as defense in depth, not only at the
    # caller: the clone function must be safe standalone (a node at depth N
    # may only spawn at N+1 while N+1 < MAX). The caller's pre-gate already
    # skips this call past the limit, so this is behavior-neutral for the
    # normal path — it only hardens direct/standalone use.
    if depth >= MAX_DELEGATION_DEPTH:
        return cloned

    # Register delegation skills with inherited constraints
    ctx = getattr(call, "context", None) or {}
    subdelegation_budget = ctx.get("subdelegation_budget", 0)

    if subdelegation_budget > 0:
        # Import delegation skills registration function
        try:
            from runtime.execution.suckers.delegation_skills import (
                register_call_agent_parallel,
            )

            # Register with next depth level
            register_call_agent_parallel(
                cloned,
                max_spawns=min(5, ctx.get("max_subdelegation_spawns", 3)),
                depth=depth + 1,
            )
        except (ImportError, AttributeError) as exc:
            import logging

            _log = logging.getLogger(__name__)
            _log.warning(
                "Failed to register delegation skills for depth=%d: %s",
                depth,
                exc,
            )

    return cloned
