"""Programmatic subagent bridge.

This module intentionally lives outside ``runtime.execution.suckers`` because
subagents are not skills. A caller invokes a subagent runner, which creates an
isolated agent turn and returns a compact result to the caller.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable, Iterable
from typing import Any

from ._bridge_call import _SubagentCall
from ._bridge_context import _compose_continuation_prompt as _compose_continuation_prompt
from ._bridge_context import _inherit_parent_work_context, _open_subagent_session
from ._bridge_identity import (
    _CODENAME_POOL,  # noqa: F401 — re-exported for test access via bridge._CODENAME_POOL
    _resolve_cheap_subagent_model,
    _resolve_display_identity,
)
from ._bridge_identity import _avatar_for_role as _avatar_for_role
from ._bridge_identity import _codename_for_role as _codename_for_role
from ._bridge_trace import (
    _ensure_context_trace_fields,
    _subagent_trace_context,
)
from .artifact_handoff import ArtifactHandoff, ArtifactHandoffError
from .registry import SubagentRegistry
from .schema_output import schema_instruction

_log = logging.getLogger("runtime.execution.subagents")

SubAgentRunner = Callable[..., str]

_RUNNER: SubAgentRunner | None = None
_REGISTRY: SubagentRegistry | None = None


# Each child holds one global slot for its lifetime, so the same cap bounds
# both width and recursive depth. The deployment can override the generous
# fail-closed default through ECHO_MAX_ACTIVE_SUBAGENTS.
def _default_max_active_subagents() -> int:
    raw = os.environ.get("ECHO_MAX_ACTIVE_SUBAGENTS", "").strip()
    if raw:
        try:
            v = int(raw)
            if v > 0:
                return v
        except ValueError:  # expected · malformed env value falls through to the default
            pass
    return 64


MAX_ACTIVE_SUBAGENTS: int = _default_max_active_subagents()
_ACTIVE_SUBAGENTS: int = 0
_ACTIVE_SUBAGENTS_BY_ROOT: dict[str, int] = {}
_ACTIVE_SUBAGENTS_LOCK = threading.Lock()


def _positive_env(name: str, default: int, *, ceiling: int) -> int:
    raw = os.environ.get(name, "").strip()
    if raw:
        try:
            return max(1, min(int(raw), ceiling))
        except (
            ValueError
        ):  # intentional: Use the bounded default for an invalid environment setting.
            pass
    return default


MAX_SUBAGENT_DEPTH = _positive_env("ECHO_MAX_SUBAGENT_DEPTH", 3, ceiling=16)
MAX_ACTIVE_SUBAGENTS_PER_ROOT = _positive_env("ECHO_MAX_ACTIVE_SUBAGENTS_PER_ROOT", 16, ceiling=256)


def _acquire_subagent_slot(root_id: str = "unscoped") -> bool:
    """Reserve a concurrency slot. Returns False when the global cap is
    already reached (caller must refuse to spawn)."""
    global _ACTIVE_SUBAGENTS
    with _ACTIVE_SUBAGENTS_LOCK:
        root_active = _ACTIVE_SUBAGENTS_BY_ROOT.get(root_id, 0)
        if (
            _ACTIVE_SUBAGENTS >= MAX_ACTIVE_SUBAGENTS
            or root_active >= MAX_ACTIVE_SUBAGENTS_PER_ROOT
        ):
            return False
        _ACTIVE_SUBAGENTS += 1
        _ACTIVE_SUBAGENTS_BY_ROOT[root_id] = root_active + 1
        return True


def _release_subagent_slot(root_id: str = "unscoped") -> None:
    global _ACTIVE_SUBAGENTS
    with _ACTIVE_SUBAGENTS_LOCK:
        if _ACTIVE_SUBAGENTS > 0:
            _ACTIVE_SUBAGENTS -= 1
        root_active = _ACTIVE_SUBAGENTS_BY_ROOT.get(root_id, 0)
        if root_active <= 1:
            _ACTIVE_SUBAGENTS_BY_ROOT.pop(root_id, None)
        else:
            _ACTIVE_SUBAGENTS_BY_ROOT[root_id] = root_active - 1
        if _ACTIVE_SUBAGENTS == 0:
            _ACTIVE_SUBAGENTS_BY_ROOT.clear()


def active_subagent_count() -> int:
    """Current number of concurrently-executing subagents (test/introspection)."""
    with _ACTIVE_SUBAGENTS_LOCK:
        return _ACTIVE_SUBAGENTS


def set_sub_agent_runner(runner: SubAgentRunner | None) -> None:
    """Inject the runner used for persistent subagent dispatch."""
    global _RUNNER
    _RUNNER = runner


def get_sub_agent_runner() -> SubAgentRunner | None:
    return _RUNNER


def set_subagent_registry(registry: SubagentRegistry | None) -> None:
    """Install the Claude-style subagent definition registry."""
    global _REGISTRY
    _REGISTRY = registry


def get_subagent_registry() -> SubagentRegistry | None:
    return _REGISTRY


def call_subagent(
    agent_id: str = "",
    prompt: str = "",
    *,
    role: str = "",
    task: str = "",
    name: str = "",
    message: str = "",
    query: str = "",
    context: dict[str, Any] | None = None,
    timeout_s: int = 300,
    timeout_seconds: float | None = None,
    event_emitter: Callable[[dict], None] | None = None,
    session: Any = None,
    use_cheap_model: bool = False,
    extra_denied_paths: list[str] | None = None,
    workspace_path: str = "",
    isolate: bool = False,
    output_schema: dict[str, Any] | None = None,
    input_files: list[str] | None = None,
    output_files: list[str] | None = None,
    schema_max_retries: int = 1,
    requires_capabilities: Iterable[str] | None = None,
    continue_session_id: str | None = None,
    runner: SubAgentRunner | None = None,
    **_kw: Any,
) -> dict[str, Any]:
    """Invoke a subagent and return a structured result.

    Alias parameters are accepted for backward compatibility with older model
    outputs and router code. They are not intended to make this a skill.

    Parameters
    ----------
    timeout_seconds :
        Wall-clock deadline in seconds. When set and exceeded, the subagent
        run is cancelled (best-effort) and a structured timeout result is
        returned instead of hanging. ``None`` (default) means no limit.
    event_emitter :
        Optional callable that receives plain JSON-serializable dicts for
        live progress events. Called with ``sub_tool_start`` before each
        tool invocation and ``sub_tool_end`` after. Exceptions from the
        emitter are swallowed so they never crash the runner.
    use_cheap_model :
        When true and the caller didn't pin an explicit ``model_name`` in
        ``context``, the cheap default resolved by
        :func:`_resolve_cheap_subagent_model` is injected so the subagent
        runs on a lower-cost tier. Used by the swarm dispatcher to route
        research-style roles cheaply.
    output_schema :
        Optional JSON Schema. When set, the subagent is asked to return a
        single JSON value matching the schema; the reply is extracted and
        validated, and on a successful match the parsed object is attached to
        the result as ``parsed`` with ``schema_ok=True``. On a validation
        failure the subagent is re-asked up to ``schema_max_retries`` times
        with the validation error; if it still fails, ``schema_ok`` is False
        and ``schema_error`` carries the reason (the raw ``output`` is always
        preserved). Default ``None`` leaves the free-text contract unchanged.
    schema_max_retries :
        How many extra attempts to grant when ``output_schema`` is set and the
        first reply doesn't validate. Ignored when ``output_schema`` is None.
    requires_capabilities :
        Capabilities the chosen subagent must declare. Checked BEFORE any
        runner work starts; a missing capability fails loud with the declared
        set instead of being accepted-then-ignored (dsh fail-loud rule).
        Registry-backed definitions only — ephemeral roles are not checked.
    continue_session_id :
        Durable subagent session to continue (dsh ``continuable``). When set,
        the prior transcript is injected into the prompt and the new turn is
        appended to the same session; an unknown session fails loud BEFORE any
        runner work. When omitted, a fresh session is created (best-effort)
        and its id is attached to the result as ``session_id`` so the caller
        can continue this subagent later.
    runner :
        Explicit caller-owned persistent runner. When omitted, the historical
        process-global runner installed by :func:`set_sub_agent_runner` remains
        the compatibility fallback. Application routers should pass their own
        runner so multiple app instances cannot overwrite one another.
    """
    agent_id = agent_id or role or name
    prompt = prompt or task or message or query
    # Pipelines and other composite tools must obey the same group roster as
    # direct delegation. Tool arguments cannot grant global candidate access.
    from runtime.execution.tool_engine.coordination_guard import current_group_coordination
    from runtime.memory.cowork.delivery import current_delivery

    if current_delivery() is not None:
        raise PermissionError("自动交付阶段仅验收已有成员结果，不得重新派发任务")
    coordination = current_group_coordination()
    if coordination is not None:
        coordination.check_member(coordination.current()["thread_id"], agent_id)
    if not agent_id:
        return {
            "agent_id": agent_id,
            "output": "",
            "success": False,
            "error": "agent_id is required",
        }
    if not prompt:
        return {
            "agent_id": agent_id,
            "output": "",
            "success": False,
            "error": "prompt is required",
        }
    if not isinstance(isolate, bool):
        return {
            "agent_id": agent_id,
            "output": "",
            "success": False,
            "error": "isolate must be a boolean",
            "retry_allowed": False,
        }

    # Public lane identity is the id requested by the delegating call. It is
    # intentionally distinct from ``agent_id`` below, which can be a generic
    # builtin selected by fallback routing. Without this distinction two
    # custom lanes that both resolve to ``explorer`` overwrite each other in
    # realtime and replay observability.
    _requested_agent_id = (
        str((context or {}).get("requested_agent_id") or agent_id).strip() or agent_id
    )
    _session_meta = getattr(session, "metadata", None) if session is not None else None
    _parent_tool_use_id = str(
        (context or {}).get("parent_tool_use_id")
        or (
            (_session_meta or {}).get("_active_parent_tool_use_id")
            if isinstance(_session_meta, dict)
            else ""
        )
        or ""
    ).strip()

    required = tuple(requires_capabilities or ())
    if required and _REGISTRY is not None and _REGISTRY.has(agent_id):
        definition = _REGISTRY.get(agent_id)
        missing = [cap for cap in required if cap not in definition.capabilities]
        if missing:
            declared = ", ".join(definition.capabilities) or "none"
            return {
                "agent_id": agent_id,
                "output": "",
                "success": False,
                "error": (
                    f"subagent {agent_id!r} lacks required capability(ies): "
                    f"{', '.join(missing)} · declared: {declared}"
                ),
                "capability_error": "missing_required_capability",
            }

    # Capture the ambient parent Session before entering the timeout worker.
    # ContextVars do not propagate into ThreadPoolExecutor threads, but the
    # child needs the same turn_id for blackboard exchange, trace attribution,
    # workspace scope, and approval context.
    if session is None:
        try:
            from runtime.platform.process.session import current_session

            session = current_session()
        except (ImportError, AttributeError):
            session = None
    if not _parent_tool_use_id and session is not None:
        _resolved_session_meta = getattr(session, "metadata", None)
        if isinstance(_resolved_session_meta, dict):
            _parent_tool_use_id = str(
                _resolved_session_meta.get("_active_parent_tool_use_id") or ""
            ).strip()

    context = _inherit_parent_work_context(context, session)
    _governance_meta = getattr(session, "metadata", None) if session is not None else None
    if not isinstance(_governance_meta, dict):
        _governance_meta = {}
    try:
        _parent_depth = max(0, int(_governance_meta.get("_subagent_depth") or 0))
    except (TypeError, ValueError):
        _parent_depth = 0
    _child_depth = _parent_depth + 1
    _subagent_root_id = (
        str(
            _governance_meta.get("_subagent_root_id")
            or getattr(session, "turn_id", None)
            or getattr(session, "thread_id", None)
            or "unscoped"
        ).strip()
        or "unscoped"
    )
    if _child_depth > MAX_SUBAGENT_DEPTH:
        return {
            "status": "rejected",
            "error": (
                f"subagent nesting depth cap reached ({MAX_SUBAGENT_DEPTH}); "
                f"refused to spawn '{agent_id}' at depth {_child_depth}"
            ),
            "governance_error": "depth_exhausted",
            "agent_id": agent_id,
            "output": "",
            "success": False,
            "subagent_depth": _child_depth,
            "subagent_root_id": _subagent_root_id,
        }

    handoff: ArtifactHandoff | None = None
    isolated_workspace: Any = None
    if isolate:
        schema_max_retries = 0
        if timeout_seconds is None:
            timeout_seconds = float(timeout_s)
    elif input_files is not None or output_files is not None:
        try:
            handoff = ArtifactHandoff.prepare(session, input_files, output_files)
        except (ArtifactHandoffError, OSError, ValueError) as exc:
            return {
                "agent_id": agent_id,
                "output": "",
                "success": False,
                "status": "artifact_contract_rejected",
                "error": str(exc),
                "retry_allowed": False,
            }
        prompt += handoff.instruction()
        # A schema or transient retry could re-enter after file effects.
        # Reconciliation and a new explicit dispatch are required instead.
        schema_max_retries = 0

    # Capture the parent turn's react stack (ambient ContextVar set around
    # the main conversation's ``stream_react_loop``) so the runner can drive
    # this sub-agent through the SAME react loop instead of the bespoke
    # mini-loop. Ambient only — never persisted into session metadata.
    if (context or {}).get("react_stack") is None:
        try:
            from runtime.execution.subagents._ambient import current_react_stack

            _ambient_stack = current_react_stack()
        except (ImportError, AttributeError):
            _ambient_stack = None
        if _ambient_stack is not None:
            context = {**(context or {}), "react_stack": _ambient_stack}
            # Real-time sub-agents dispatched inside the parent react loop are
            # driven through the MAIN react loop by default (the react-drive
            # path is now validated; sequential + parallel children reuse the
            # same machinery and the runner falls back to the mini-loop if the
            # react path yields no result). Explicit callers may opt out by
            # passing ``react_loop_subagent=False``.
            if (context or {}).get("react_loop_subagent") is None:
                context = {**context, "react_loop_subagent": True}
            # Real-time sub-agents also get their OWN thread identity by
            # default (independent thread_id), so each child is a real,
            # addressable thread — journal/trace attribute to the child and
            # parallel children no longer collide on the parent's busy flag.
            # Blackboard continuity is preserved via ``blackboard_root_turn_id``
            # (the parent's turn), independent of the child thread id. Callers
            # may opt out with ``flip_subagent_thread=False``.
            if (context or {}).get("flip_subagent_thread") is None:
                context = {**context, "flip_subagent_thread": True}

    # When a schema is requested, steer the model toward schema-valid JSON up
    # front. Enforcement still happens post-hoc (see ``_do_call_with_schema``)
    # so this works on any model, not just ones with native structured output.
    if output_schema:
        prompt = prompt + schema_instruction(output_schema)

    _trace_context = _subagent_trace_context(context, session)
    context = _ensure_context_trace_fields(context, _trace_context)

    # Trusted callers (e.g. the worktree loop) confine this sub-agent's file
    # writes to ONE directory by passing ``workspace_path`` (or
    # context["workspace_path"]). It is carried as ``_locked_write_root`` on the
    # sub-agent's Session; the ephemeral chokepoint injects it as the
    # sandbox_dir for write skills (ephemeral runs bypass the executor's own
    # sandbox-arg injector). NOT a model-facing argument.
    _locked_root = str(
        workspace_path
        or (context.get("workspace_path") if isinstance(context, dict) else "")
        or "",
    ).strip()

    # ── Sub-agent identity for visibility (codename + avatar) ──
    # Computed once per call so the spawn / finish events agree on
    # the same display name. Frontend receives these on the
    # ``subagent_spawned`` event and renders a tile in the Workbench
    # panel.
    _role_label = (role or agent_id or "agent").strip().lower()
    (
        _codename,
        _avatar,
        _role_display_name,
        _role_description,
        _market_avatar_url,
        _identity_source,
    ) = _resolve_display_identity(_role_label, _requested_agent_id)
    _spawn_started_at = time.time()

    # ── Thread-scoped memory key ──
    # Resolves the thread_id that the per-role memory uses for context
    # continuity. Priority: explicit context > session attribute. Empty
    # thread_id means stateless (no history record/replay) — matches the
    # previous behaviour for callers that don't supply a thread.
    _memory_thread_id = ""
    if isinstance(context, dict):
        _ctx_thread = context.get("thread_id") or context.get("caller_thread_id")
        if isinstance(_ctx_thread, str) and _ctx_thread.strip():
            _memory_thread_id = _ctx_thread.strip()
    if not _memory_thread_id and session is not None:
        _sess_thread = getattr(session, "thread_id", None)
        if isinstance(_sess_thread, str) and _sess_thread.strip():
            _memory_thread_id = _sess_thread.strip()
    # Stamp it back into context so _compose_system_prompt sees it
    # (it reads from context first, then falls back to session).
    if _memory_thread_id:
        if context is None:
            context = {}
        context.setdefault("thread_id", _memory_thread_id)

    # Preserve the caller's current turn separately from the provider prompt.
    # A continuation may add a read-only history projection for the runner,
    # but memory/session persistence must never recursively store that expansion.
    _session_turn_prompt = prompt

    # Durable session continuation (dsh continuable subagents). Unknown
    # session ids fail loud before any runner work; the transcript of a
    # known session is injected so the child continues instead of
    # re-researching from scratch.
    _active_session, prompt, _session_error = _open_subagent_session(
        agent_id=agent_id,
        prompt=prompt,
        context=context,
        continue_session_id=continue_session_id,
        _memory_thread_id=_memory_thread_id,
        _session_turn_prompt=_session_turn_prompt,
    )
    if _session_error is not None:
        return _session_error

    # ── Prompt-injection taint inheritance ──
    # call_subagent's body runs in the spawning parent's thread, but the
    # actual sub-agent runs behind an inner ThreadPoolExecutor (``run``) whose
    # worker starts with a FRESH taint contextvar. Capture the parent's taint
    # HERE and stamp it into the context that flows to the runner, so an
    # injection-tainted parent cannot launder a risky action through a
    # delegated sub-agent. Honored at the sub-agent's react-loop start.
    try:
        from runtime.safety.validation.prompt_injection import (
            current_injection_taint,
        )

        _taint = current_injection_taint()
        if _taint and _taint != "none":
            if context is None:
                context = {}
            context.setdefault("_inherited_injection_taint", _taint)
    except Exception:  # noqa: BLE001 - taint propagation is best-effort
        pass

    call = _SubagentCall(
        agent_id=agent_id,
        prompt=prompt,
        role=role,
        context=context,
        timeout_s=timeout_s,
        timeout_seconds=timeout_seconds,
        event_emitter=event_emitter,
        session=session,
        use_cheap_model=use_cheap_model,
        extra_denied_paths=extra_denied_paths,
        isolate=isolate,
        output_schema=output_schema,
        input_files=input_files,
        output_files=output_files,
        schema_max_retries=schema_max_retries,
        runner=runner,
        handoff=handoff,
        isolated_workspace=isolated_workspace,
        _requested_agent_id=_requested_agent_id,
        _parent_tool_use_id=_parent_tool_use_id,
        _child_depth=_child_depth,
        _subagent_root_id=_subagent_root_id,
        _trace_context=_trace_context,
        _locked_root=_locked_root,
        _role_label=_role_label,
        _codename=_codename,
        _avatar=_avatar,
        _role_display_name=_role_display_name,
        _role_description=_role_description,
        _market_avatar_url=_market_avatar_url,
        _identity_source=_identity_source,
        _spawn_started_at=_spawn_started_at,
        _memory_thread_id=_memory_thread_id,
        _session_turn_prompt=_session_turn_prompt,
        _active_session=_active_session,
    )
    return call.run()


def _dispatch(
    *,
    agent_id: str,
    prompt: str,
    context: dict[str, Any] | None,
    timeout_s: int,
    session: Any,
    event_emitter: Callable[[dict], None] | None,
    use_cheap_model: bool = False,
    runner: SubAgentRunner | None = None,
) -> dict[str, Any]:
    """Inner dispatch — runs in the caller's thread or a worker thread."""
    _log.info(
        "subagent dispatch · agent_id=%s prompt_len=%d timeout=%ds",
        agent_id,
        len(prompt),
        timeout_s,
    )
    from runtime.execution.subagents.market_bridge import runnable_market_roles
    from runtime.execution.suckers.ephemeral_agents import (
        EphemeralRoleDef,
        get_ephemeral_role_runner,
        is_ephemeral_role,
        run_ephemeral_definition,
        run_ephemeral_role,
    )

    selected_runner = runner if runner is not None else _RUNNER
    market_role = runnable_market_roles(selected_runner).get(agent_id)
    if (context or {}).get("_require_installed_market_role") and market_role is None:
        return {
            "agent_id": agent_id,
            "output": "",
            "success": False,
            "error": "HUB role is no longer installed or runnable; no substitute was spawned.",
        }
    registry = _REGISTRY
    if market_role is None and registry is not None and registry.has(agent_id):
        definition = registry.get(agent_id)
        merged_context: dict[str, Any] = {
            **(context or {}),
            "subagent_source_path": definition.source_path,
            "subagent_scope": definition.scope,
        }
        if definition.model:
            merged_context.setdefault("model_name", definition.model)
        if (
            use_cheap_model
            and "model_name" not in merged_context
            and getattr(get_ephemeral_role_runner(), "execution_backend", "native") == "native"
        ):
            cheap = _resolve_cheap_subagent_model()
            if cheap:
                merged_context["model_name"] = cheap
        if event_emitter is not None:
            merged_context["event_emitter"] = event_emitter
        if definition.backend:
            partner_result = _dispatch_partner(definition, prompt, timeout_s)
            if partner_result is not None:
                return partner_result
            # The partner exists but has no stable headless invocation yet —
            # fall back to the in-process loop (dsh provider vocabulary: an
            # unsupported provider degrades to the default transport).
        return run_ephemeral_definition(
            EphemeralRoleDef(
                id=definition.name,
                display_name=definition.name,
                description=definition.description,
                system_prompt=definition.system_prompt,
                share_context=True,
                share_memory=True,
                tool_allowlist=definition.tools,
            ),
            prompt,
            session=session,
            context=merged_context,
            timeout_s=timeout_s,
        )

    if market_role is None and is_ephemeral_role(agent_id):
        merged_eph: dict[str, Any] = dict(context or {})
        if (
            use_cheap_model
            and "model_name" not in merged_eph
            and getattr(get_ephemeral_role_runner(), "execution_backend", "native") == "native"
        ):
            cheap = _resolve_cheap_subagent_model()
            if cheap:
                merged_eph["model_name"] = cheap
        if event_emitter is not None:
            merged_eph["event_emitter"] = event_emitter
        return run_ephemeral_role(
            agent_id,
            prompt,
            session=session,
            context=merged_eph,
            timeout_s=timeout_s,
        )

    selected_runner = runner if runner is not None else _RUNNER
    if selected_runner is None:
        return {
            "agent_id": agent_id,
            "output": "",
            "success": False,
            "error": (
                "sub-agent runner not configured; call set_sub_agent_runner(fn) during bootstrap"
            ),
        }

    merged_ctx: dict[str, Any] = dict(context or {})
    if market_role is not None:
        # Execute the full loaded role, never a prompt-only temporary copy or
        # a same-named .claude definition with a different tool policy.
        merged_ctx["subagent_scope"] = "market"
        merged_ctx["subagent_source_path"] = market_role.soul_path
    merged_ctx["timeout_s"] = timeout_s
    resolve_backend = getattr(selected_runner, "execution_backend_for", None)
    try:
        selected_backend = resolve_backend(agent_id) if callable(resolve_backend) else "native"
    except ValueError as exc:
        return {"agent_id": agent_id, "output": "", "success": False, "error": str(exc)}
    # The host's cheap-model pool belongs to native execution. External
    # members select models through their own provider/account catalog.
    if use_cheap_model and "model_name" not in merged_ctx and selected_backend == "native":
        cheap = _resolve_cheap_subagent_model()
        if cheap:
            merged_ctx["model_name"] = cheap
    if event_emitter is not None:
        merged_ctx["event_emitter"] = event_emitter
    if session is not None:
        caller_thread = getattr(session, "thread_id", None)
        if caller_thread:
            merged_ctx.setdefault("caller_thread_id", caller_thread)
        # Propagate actor identity so the subagent's journal events,
        # rate-limit buckets, and memory ACL checks all run as the
        # caller. Without this, subagents execute as ``actor=None``
        # and escape the per-user enforcement applied to the parent
        # turn.
        caller_actor = getattr(session, "actor", None) or getattr(session, "actor_id", None)
        if caller_actor:
            merged_ctx.setdefault("actor", caller_actor)
        # Pass the full session through for downstream runners that
        # want to re-scope (e.g. to use session_scope for nested
        # journal events). Opt-in via a dedicated key so we don't
        # accidentally shadow user-supplied ``session`` in context.
        merged_ctx.setdefault("caller_session", session)

    try:
        output = selected_runner(prompt, subagent_name=agent_id, context=merged_ctx)
    except Exception as exc:  # noqa: BLE001
        _log.warning(
            "subagent %s runner raised %s: %s",
            agent_id,
            type(exc).__name__,
            exc,
        )
        return {
            "agent_id": agent_id,
            "output": "",
            "success": False,
            "error": f"{type(exc).__name__}: {exc}",
        }

    return {
        "agent_id": agent_id,
        "output": str(output) if output is not None else "",
        "success": True,
        "error": None,
        **(
            {
                "identity_source": "agent-market",
                "market_agent_id": agent_id,
                "display_name": market_role.display_name,
                "avatar_url": market_role.avatar_url,
                "avatar": market_role.icon,
                "role_source_path": market_role.soul_path,
            }
            if market_role
            else {}
        ),
    }


def _dispatch_partner(
    definition: Any,
    prompt: str,
    timeout_s: int,
) -> dict[str, Any] | None:
    """Reject persisted definitions that still name the retired CLI backend.

    External model access is installed through model-provider plugins.  We fail
    explicitly instead of probing the host or silently falling back to another
    model, so old configuration cannot resurrect local CLI execution.
    """
    del prompt, timeout_s
    return {
        "agent_id": definition.name,
        "output": "",
        "success": False,
        "error": (
            f"legacy CLI backend {definition.backend!r} has been removed; "
            "install and configure a model-provider plugin instead"
        ),
        "backend": definition.backend,
        "failure_kind": "legacy_cli_backend_removed",
    }
