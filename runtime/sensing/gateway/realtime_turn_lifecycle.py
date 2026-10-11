"""Realtime turn validation, dispatch, resume handling, and finalization."""

from __future__ import annotations

import asyncio
import contextlib
import json  # noqa: F401 - live dependency of extracted lifecycle phases
import logging
import time  # noqa: F401 - live dependency of extracted lifecycle phases
from typing import TYPE_CHECKING, Any

from runtime.execution.agents.group_fanout import (
    is_group_presence_query,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
)
from runtime.execution.codex_backend import BackpressureError
from runtime.execution.tool_engine.session_reference_uri import (
    SUPPORTED_SESSION_REFERENCE_SCHEMES,  # noqa: F401 - live dependency of extracted lifecycle phases
)
from runtime.platform.models.primitives import now_utc
from runtime.protocol import (
    AgentMessageItem,  # noqa: F401 - live dependency of extracted lifecycle phases
    ErrorItem,
    ItemStatus,
    ServerMethod,
    Turn,
    TurnParams,
    TurnStatus,
    VerificationItem,  # noqa: F401 - live dependency of extracted lifecycle phases
)
from runtime.safety.approval.approval_gate import (
    ApprovalProvider,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
)
from runtime.sensing.gateway._realtime_cerebrum_project_os import (
    _is_project_os_command,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
)
from runtime.sensing.gateway._realtime_turn_lifecycle_helpers import (
    _background_task_is_verification,  # noqa: F401 - live dependency of extracted lifecycle phases
    _inject_cowork_turn_plan,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
    _persist_cowork_user_message,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
    _resolve_cowork_responder_agent,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
    _start_cowork_orchestration_run,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
    _turn_has_cowork_coordination_evidence,  # noqa: F401 - live dependency of extracted lifecycle phases
    _turn_has_cowork_delivery_evidence,  # noqa: F401 - live dependency of extracted lifecycle phases
    _turn_has_observable_output,
)
from runtime.sensing.gateway._realtime_turn_lifecycle_resume import (
    _consume_confirmed_resume_intent,
    _consume_paused_task_resume_intent,
    _record_pending_resume_intent,
    _resume_checkpoint_metadata,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
)

# Re-exported helper names reachable from the old module-level surface.
__all__ = [
    "_consume_confirmed_resume_intent",
    "_consume_paused_task_resume_intent",
    "_record_pending_resume_intent",
]
from runtime.execution.agents.preparation import RolePreparationError
from runtime.execution.engines import (  # noqa: F401 - live dependency of extracted lifecycle phases
    EngineSelectionError,
    ExecutionPhase,
)
from runtime.sensing.gateway._realtime_react_stream_helpers import (
    _should_use_direct_text_path,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
)
from runtime.sensing.gateway._realtime_turn_dispatch import (
    _apply_composer_markers,
    _repair_coordinated_delivery,
    _route_simple_turn_model,
)
from runtime.sensing.gateway._realtime_turn_reporting import (
    _close_turn,
    _finish_startup_interrupt,
    _item_outlives_turn,  # noqa: F401 - live dependency of extracted lifecycle phases
    _notify_terminal,
    _refill_subagent_wake_budget,  # noqa: F401 - live dependency of extracted lifecycle phases
    _resolve_session_reference_mentions,
    _schedule_pending_subagent_reports,
    _schedule_subagent_wake_budget_refill,
    _surface_pending_subagent_reports,  # noqa: F401 - live dependency of extracted lifecycle phases
)
from runtime.sensing.gateway._realtime_turn_start_phases import (
    _anchor_user_message,
    _announce_turn_started,
    _apply_cowork_turn_context,
    _attach_resume_context,
    _await_pending_subagent_reports,
    _drain_late_steering,
    _emit_turn_hints,
    _register_turn,
    _resolve_turn_provider_and_agent,
    _route_turn_input,
    _select_turn_route,
)
from runtime.sensing.gateway._realtime_turn_verification import _verify_turn_code_changes
from runtime.sensing.gateway.realtime_approval import (
    GatewayApprovalProvider,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
)
from runtime.sensing.gateway.realtime_execution import (
    TurnExecutionRequest,
    bind_turn_execution,
    select_turn_execution,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
)
from runtime.sensing.gateway.realtime_gateway import EventEmitter
from runtime.sensing.gateway.realtime_thread_history import (
    _conversation_messages_for_react,
)
from runtime.sensing.gateway.realtime_turn_input import (
    _build_intent,
    _extract_codex_composer_mode,  # noqa: F401 - live dependency of extracted lifecycle phases
    _input_attachments,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
    _input_metadata,  # noqa: F401 - live dependency of extracted lifecycle phases
    _join_text,  # noqa: F401 - live dependency of extracted lifecycle phases
    _resume_confirmation_text,
    _should_default_planning_mode,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
    _should_default_topology,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
    _turn_mode,
    external_model_owner,  # noqa: F401 - live dependency of extracted lifecycle phases
)
from runtime.sensing.gateway.realtime_turn_outcome import (
    _code_change_paths,  # noqa: F401 - live dependency of extracted lifecycle phases
    _file_change_item_ids,  # noqa: F401 - live dependency of extracted lifecycle phases
    _turn_has_failed_code_verification,  # noqa: F401 - live dependency of extracted lifecycle phases
    _turn_has_unverified_code_changes,  # noqa: F401 - live dependency of extracted lifecycle phases
    _turn_verification_environment_blocked,  # noqa: F401 - live dependency of extracted lifecycle phases
    _verification_plan_for_code_paths,  # noqa: F401 - live dependency of extracted lifecycle phases
    _verification_plan_stdout_tail,  # noqa: F401 - live dependency of extracted lifecycle phases
)

if TYPE_CHECKING:
    from runtime.sensing.gateway.realtime_cerebrum import CerebrumRuntime

_logger = logging.getLogger(__name__)

# Bounded window (seconds) the turn verifier waits for an in-flight
# background verification task (background_exec) before closing the turn.
# The model may hand verification to a background task and return while it
# is still running; failing with "verification required" then would blame
# the model for work that is genuinely still finishing.
_BACKGROUND_VERIFY_WAIT_S = 180.0

# A parked-report disk scan should usually finish from the OS cache in a few
# milliseconds.  Give it a small foreground budget so reports are available to
# the first model round when cheap, then let the strongly tracked worker finish
# in the background instead of turning a cold/contended store into 12–42 s of
# model-start latency.
_PENDING_REPORT_STARTUP_BUDGET_S = 1.0

# A Stop can arrive immediately after the client sees ``turn/started``.  The
# pending-report scan is intentionally allowed a one-second warm-start window,
# but that foreground budget must never become a one-second cancellation
# floor.  Poll the gateway's durable interrupt registry while the report task
# runs so the lifecycle can close before any model/tool driver is constructed.
_STARTUP_INTERRUPT_POLL_S = 0.05

# Bounded number of agent-driven verification rounds the turn verifier runs
# when code changed with no recorded verification evidence and the
# auto-verifier could not produce any (sandbox didn't allow it, or no
# allowlisted command fit). Each round asks the agent to run the recommended
# commands itself and fix; one round is enough to close the loop without
# burning budget on a model that keeps failing.
_AGENT_VERIFY_ROUND_LIMIT = 1

# Item markers that are one half of a deliberate pair: the spawn tile is
# never completed, its sibling ``__subagent_finished__`` carries the outcome.
# Sweeping these would emit a completion the frontend reads as a second,
# phantom result for the same lane.
_UNPAIRED_ITEM_MARKERS = frozenset({"__subagent_spawned__"})


async def _start_turn(
    runtime: CerebrumRuntime,
    params: dict[str, Any],
    emitter: EventEmitter,
) -> Turn:
    """Start and drive one realtime turn through its terminal state."""
    # ── PHASE 1 · validation + slash/topology/model routing ────────
    validated = TurnParams.model_validate(params)
    thread_id = runtime._require_thread_id(validated.thread_id)
    # dsh ``agent/inbox/claimed``: a HUMAN-initiated turn refills every
    # subagent wake budget owned by this thread.  The actual store call is
    # deliberately deferred until after ``turn_started`` + the user anchor:
    # it shares the durable-session lock with cold disk discovery and must not
    # hold the visible Send acknowledgement hostage.  An auto-woken parent
    # still never refills the budget.
    _auto_wake, text, validated = _apply_composer_markers(validated=validated)
    text, validated, requested_model_before_routing = _route_turn_input(
        text=text, validated=validated, _logger=_logger
    )

    # Smart model routing — auto-route trivial / simple turns to
    # the cheap tier. Complex / research / topology / code-mode
    # turns stay on the user's primary. Explicit ``model`` pins
    # bypass this entirely.
    validated = _route_simple_turn_model(text=text, validated=validated)

    # ── PHASE 2 · thread setup + turn registration ─────────────────
    # Sweep any background command watchers left running from a
    # previous turn on this thread. They're allowed to outlive
    # their own turn (long shells finishing after the LLM said
    # done) but mustn't bleed into the brand-new conversation
    # the user just started.
    (
        log,
        turn,
        apply_delivery_context,
        delivery,
        turn_created_at,
        intent,
        emitter_registered_at,
        active_turn_registered_at,
    ) = await _register_turn(
        runtime=runtime, thread_id=thread_id, emitter=emitter, validated=validated
    )
    try:
        turn_started_visible_at, prompt_decision = await _announce_turn_started(
            log=log,
            thread_id=thread_id,
            turn=turn,
            runtime=runtime,
            emitter=emitter,
            emitter_registered_at=emitter_registered_at,
            turn_created_at=turn_created_at,
            active_turn_registered_at=active_turn_registered_at,
            text=text,
            validated=validated,
            _logger=_logger,
        )
        if prompt_decision.cancelled:
            err = ErrorItem(message=prompt_decision.reason or "prompt rejected")
            turn.items.append(err)
            await runtime._emit_item_started(turn, log, emitter, err)
            err.status = ItemStatus.FAILED
            await runtime._emit_item_completed(turn, log, emitter, err)
            turn.status = TurnStatus.FAILED
            _close_turn(log, thread_id, turn)
            # ``intent`` isn't built yet on the prompt-rejected path;
            # the snapshot helper accepts None so the legacy thread
            # store still records the failed turn for the sidebar.
            runtime._record_failed_turn_proposal(
                turn,
                intent=None,
                failure_source="prompt_rejected",
            )
            runtime._snapshot_to_thread_store(thread_id, log, None)
            return turn
        if prompt_decision.modified_prompt is not None:
            text = prompt_decision.modified_prompt
        if not text:
            err = ErrorItem(message="empty input")
            turn.items.append(err)
            await runtime._emit_item_started(turn, log, emitter, err)
            await runtime._emit_item_completed(turn, log, emitter, err)
            turn.status = TurnStatus.FAILED
            _close_turn(log, thread_id, turn)
            runtime._record_failed_turn_proposal(
                turn,
                intent=None,
                failure_source="empty_input",
            )
            return turn

        # ── PHASE 3.5 · Echo session-reference mention resolution ──
        # Resolve @session: / @subagent: / canonical echo-session: mentions
        # (plus historical dsh-session: references)
        # into a read-only referenced-sessions frame. The frame is injected
        # into the model's user context (never the sidebar text); any
        # failure degrades to the raw prompt.
        (
            text,
            session_reference_frame,
            user_item,
            user_message_visible_at,
        ) = await _anchor_user_message(
            text=text,
            thread_id=thread_id,
            validated=validated,
            delivery=delivery,
            turn=turn,
            runtime=runtime,
            log=log,
            emitter=emitter,
            turn_started_visible_at=turn_started_visible_at,
            turn_created_at=turn_created_at,
            _resolve_session_reference_mentions=_resolve_session_reference_mentions,
            _logger=_logger,
        )

        # ``turn/interrupt`` may race the prompt hooks or user-item emission.
        # Keep the user's message as the durable conversation anchor, but do
        # not start report discovery, model routing, or any tool-capable driver
        # after the Stop has already been acknowledged.
        if _finish_startup_interrupt(
            runtime,
            turn,
            log,
            emitter,
            intent=None,
        ):
            return turn

        # dsh inject-at-next-wake: claim every parked report owned by this
        # thread only after the user's Send is durably visible.  The worker
        # hop also keeps a cold all-session scan from blocking the realtime
        # event loop.  Warm scans still inject before history replay; a scan
        # that exceeds the budget keeps running and reaches the live steering
        # queue at the next safe model/tool boundary.  If the turn has already
        # ended, injection returns false and the worker deliberately does not
        # ack, leaving the durable report for the next turn.
        await _await_pending_subagent_reports(
            _auto_wake=_auto_wake,
            runtime=runtime,
            thread_id=thread_id,
            turn=turn,
            emitter=emitter,
            user_message_visible_at=user_message_visible_at,
            turn_started_visible_at=turn_started_visible_at,
            _schedule_subagent_wake_budget_refill=_schedule_subagent_wake_budget_refill,
            _schedule_pending_subagent_reports=_schedule_pending_subagent_reports,
            _PENDING_REPORT_STARTUP_BUDGET_S=_PENDING_REPORT_STARTUP_BUDGET_S,
            _STARTUP_INTERRUPT_POLL_S=_STARTUP_INTERRUPT_POLL_S,
            _logger=_logger,
        )
        if _finish_startup_interrupt(
            runtime,
            turn,
            log,
            emitter,
            intent=None,
        ):
            return turn

        # ── PHASE 4 · intent build + resume check ──────────────────
        conversation_messages: list[dict[str, Any]] = []
        with contextlib.suppress(Exception):
            conversation_messages = _conversation_messages_for_react(log.replay())

        intent = _build_intent(
            text,
            validated,
            workspaces=runtime._workspaces,
            thread_store=runtime._thread_store,
            allow_client_auto_approve=runtime._allow_client_auto_approve,
            allow_local_workspace_access=runtime._allow_local_workspace_access,
            conversation_messages=conversation_messages,
        )
        resolved_execution_workspace = intent.user_context.get("cwd")
        turn.execution_workspace_path = (
            resolved_execution_workspace.strip()
            if isinstance(resolved_execution_workspace, str)
            and resolved_execution_workspace.strip()
            else None
        )
        # Make a newly-created thread queryable as soon as its authenticated
        # user anchor and execution context exist. Previously the derived HTTP
        # thread store was written only at terminal completion, so workbench
        # and sidebar queries saw several seconds of transient 404s while the
        # live turn was already streaming successfully.
        runtime._snapshot_to_thread_store(thread_id, log, intent)
        if session_reference_frame is not None:
            intent = intent.model_copy(
                update={
                    "user_context": {
                        **intent.user_context,
                        "session_reference_context": session_reference_frame,
                    }
                }
            )
        explicit_project_command, _planned_pattern_execution = await _apply_cowork_turn_context(
            runtime=runtime,
            thread_id=thread_id,
            text=text,
            intent=intent,
            delivery=delivery,
            apply_delivery_context=apply_delivery_context,
            user_item=user_item,
            emitter=emitter,
        )
        if (
            (intent.user_context or {}).get("cowork_waiting_for_mention")
            and not explicit_project_command
            and _planned_pattern_execution
            not in {
                "fanout",
                "presence",
                "orchestrated",
            }
        ):
            # A durable chat room accepts ordinary human conversation without
            # manufacturing an assistant response.  Close this as a successful
            # user-only turn before approval/model routing. Explicit natural
            # group work requests and presence checks are selected by the
            # server-owned team pattern and therefore continue to dispatch.
            runtime._set_turn_steering_accepting(turn, False)
            turn.status = TurnStatus.COMPLETED
            turn.outcome_reason = "cowork_waiting_for_mention"
            log.turn_updated(
                thread_id,
                turn.id,
                objective_id=turn.objective_id,
                task_id=turn.task_id,
                outcome_reason=turn.outcome_reason,
            )
            _close_turn(log, thread_id, turn)
            runtime._snapshot_to_thread_store(thread_id, log, intent)
            return turn
        resume_intent = await _attach_resume_context(
            runtime=runtime, thread_id=thread_id, text=text, intent=intent
        )
        if isinstance(resume_intent, dict) and resume_intent.get("requires_confirmation") is True:
            await runtime._record_pending_resume_intent(thread_id, resume_intent)
            await runtime._emit_agent_message(
                turn,
                log,
                emitter,
                _resume_confirmation_text(resume_intent),
            )
            turn.status = TurnStatus.COMPLETED
            _close_turn(log, thread_id, turn)
            await runtime._maybe_compact(thread_id, log, emitter)
            runtime._snapshot_to_thread_store(thread_id, log, intent)
            return turn

        provider, agent = _resolve_turn_provider_and_agent(
            runtime=runtime,
            thread_id=thread_id,
            turn=turn,
            intent=intent,
            text=text,
            emitter=emitter,
            validated=validated,
        )
        # Agent resolution and resume plumbing can yield to async stores. A
        # Stop accepted during that window still belongs to startup and must
        # close before dispatch selects any model/tool-capable driver.
        if _finish_startup_interrupt(
            runtime,
            turn,
            log,
            emitter,
            intent=intent,
        ):
            return turn
        turn_driver = "react"

        try:
            topology_id = getattr(validated, "topology_id", None)
            _cowork_context = intent.user_context or {}
            _team_pattern = _cowork_context.get("team_pattern")
            _team_pattern_execution = (
                str(_team_pattern.get("execution") or "").strip()
                if isinstance(_team_pattern, dict)
                else ""
            )
            # The declarative team pattern is authoritative. A focused reply
            # must not inherit a stale cluster topology, an orchestrated task
            # must not be forced back into the legacy bubble fan-out by
            # serve_mesh/cowork_is_multi compatibility flags, and neither may be
            # re-routed to the mesh by a client-supplied topology.
            if _team_pattern_execution in {"focused", "orchestrated"}:
                # ``orchestrated`` is decided by the server together with the
                # coordinator contract and any recoverable run snapshot. A
                # client-supplied ``topology_id`` (the legacy 集群 field) would
                # otherwise win route precedence and dispatch ``swarm_mesh``
                # instead, while the deliverable-completeness gate below still
                # audits this turn as coordinated execution.
                if topology_id:
                    _logger.info(
                        "ignoring topology_id %r under server-owned team pattern %r",
                        topology_id,
                        _team_pattern_execution,
                    )
                    validated = validated.model_copy(update={"topology_id": None})
                topology_id = None
            # Mode-level guard: single-agent modes MUST NOT route
            # through ``_drive_team_topology`` even if a leftover
            # ``topology_id`` slipped through (e.g. settings
            # persisted from a prior swarm turn, an old front-end
            # build, or ``auto-dispatch`` on a stale runtime). The
            # explicit user-facing mode is the source of truth:
            #   chat / react / deep  → single-agent ReAct
            #   swarm                → swarm topology
            # Anything that lands in the first bucket here gets
            # its topology cleared so the swarm path stays
            # unreachable from the Agent / Inspiration modes.
            _mode_str = (_turn_mode(validated) or "").lower()
            if topology_id and _mode_str in {"chat", "react", "deep"}:
                _logger.info(
                    "ignoring topology_id %r in single-agent mode %r",
                    topology_id,
                    _mode_str,
                )
                topology_id = None
                validated = validated.model_copy(
                    update={"topology_id": None},
                )

            # 能力包 / Meta-Skill soft hand-off: if the user's text
            # strongly matches one of the curated workflow packs,
            # surface a hint so the user can switch to the catalog
            # page. ReAct still runs — the hint is informational,
            # not a redirect, until the graph runtime is wired
            # through the realtime gateway.
            await _emit_turn_hints(
                text=text,
                emitter=emitter,
                thread_id=thread_id,
                turn=turn,
                explicit_project_command=explicit_project_command,
                _logger=_logger,
            )

            reflection, route = await _select_turn_route(
                _cowork_context=_cowork_context,
                _team_pattern_execution=_team_pattern_execution,
                text=text,
                explicit_project_command=explicit_project_command,
                topology_id=topology_id,
                agent=agent,
                validated=validated,
                runtime=runtime,
                conversation_messages=conversation_messages,
                thread_id=thread_id,
                turn=turn,
                intent=intent,
            )
            if route.engine in {"opencode", "codex"}:
                validated = validated.model_copy(update={"model": requested_model_before_routing})
                turn.params = validated
                external_context = {
                    **(intent.user_context or {}),
                    "model_name": requested_model_before_routing,
                }
                # Preserve the host's existing no-tool classification for
                # OpenCode.  Without this handoff, greetings and explicit
                # discussion-only turns still built and connected the full
                # per-turn MCP bridge before asking the model for text.
                if route.engine == "opencode":
                    external_context["direct_conversation_reply"] = reflection
                intent = intent.model_copy(update={"user_context": external_context})
            # The explicit model still governs every member of an orchestrated
            # topology. Engine selection does not change model ownership.
            if route.driver == "swarm_mesh":
                team_model = str(validated.model or "").strip()
                if team_model and team_model.lower() not in {"auto", "default"}:
                    intent = intent.model_copy(
                        update={
                            "user_context": {
                                **(intent.user_context or {}),
                                "model_name": team_model,
                            }
                        }
                    )
            turn_driver = route.driver
            execution = bind_turn_execution(
                runtime,
                turn,
                log,
                emitter,
                provider,
                agent,
                route,
                topology_id=topology_id,
            )
            await execution.execute(TurnExecutionRequest(intent, text, validated.model))
        except Exception as exc:
            if isinstance(exc, (EngineSelectionError, RolePreparationError)):
                _logger.info(
                    "CerebrumRuntime: preparation requires attention: %s", type(exc).__name__
                )
            else:
                _logger.exception("CerebrumRuntime: turn driver crashed: %s", turn_driver)
            if isinstance(exc, RolePreparationError):
                selection_error = True
                turn.error = {**exc.info, "message": str(exc)}
                turn_driver = "role_preparation"
            elif isinstance(exc, EngineSelectionError):
                selection_error = True
                turn.error = {
                    "code": "execution_unavailable",
                    "engine": exc.engine.value,
                    "reason": exc.reason,
                    "message": str(exc),
                    "disposition": "blocked_on_user",
                }
                turn_driver = "engine_selection"
            else:
                selection_error = False
                turn.execution_engine = (
                    turn.execution.engine
                    if turn.execution is not None
                    else {
                        "codex_app_server": "codex",
                        "opencode_server": "opencode",
                    }.get(turn_driver, "echo")
                )
            context = intent.user_context if isinstance(intent.user_context, dict) else {}
            event_backpressure = isinstance(exc, BackpressureError)
            public_error_message = (
                "Codex event delivery was temporarily overloaded. Completed steps were "
                "preserved; retry to continue."
                if event_backpressure
                else str(exc) or exc.__class__.__name__
            )
            err = ErrorItem(
                message=public_error_message,
                error_info={
                    "code": (
                        "execution_unavailable"
                        if selection_error
                        else "codex_event_backpressure"
                        if event_backpressure
                        else "turn_driver_exception"
                    ),
                    "driver": turn_driver,
                    "exception_type": exc.__class__.__name__,
                    "failure_kind": "backpressure" if event_backpressure else "",
                    "cowork_mode": context.get("cowork_mode"),
                    "topology_id": topology_id or "",
                    **(
                        {
                            "engine": exc.engine.value,
                            "reason": exc.reason,
                            "disposition": "blocked_on_user",
                        }
                        if isinstance(exc, EngineSelectionError)
                        else {}
                    ),
                    **(exc.info if isinstance(exc, RolePreparationError) else {}),
                },
            )
            turn.items.append(err)
            await runtime._emit_item_started(turn, log, emitter, err)
            await runtime._emit_item_completed(turn, log, emitter, err)
            turn.status = TurnStatus.FAILED
            _close_turn(log, thread_id, turn)
            if not selection_error:
                runtime._record_failed_turn_proposal(
                    turn,
                    intent=intent,
                    failure_source=f"{turn_driver}_exception",
                )
            runtime._snapshot_to_thread_store(thread_id, log, intent)
            return turn

        # Native tool turns consume steering between model rounds. Other
        # drivers (reflection, topology, Project OS) may finish one atomic
        # pass without such a boundary; hand any message that arrived during
        # that pass to the normal agent loop before finalizing the same turn.
        turn_driver = await _drain_late_steering(
            turn=turn,
            runtime=runtime,
            intent=intent,
            execution=execution,
            validated=validated,
            turn_driver=turn_driver,
        )

        # A coordinated deliverable is not complete merely because the TL
        # wrote a confident answer. Require server-observed delegation. Give
        # the coordinator one bounded repair round so an omitted tool call can
        # be corrected without making the user repeat the request.
        turn_driver = await _repair_coordinated_delivery(
            runtime=runtime,
            turn=turn,
            log=log,
            emitter=emitter,
            thread_id=thread_id,
            intent=intent,
            validated=validated,
            execution=execution,
            text=text,
            explicit_project_command=explicit_project_command,
            _team_pattern_execution=_team_pattern_execution,
            turn_driver=turn_driver,
        )

        # ── PHASE 6 · status finalization + snapshot ───────────────
        if turn.status in {
            TurnStatus.PAUSED,
            TurnStatus.CANCELLED,
            TurnStatus.INTERRUPTED,
        }:
            # Preserve the concrete terminal/waiting outcome.  In particular,
            # a resumable checkpoint must never be flattened back to completed
            # or to a generic transport interruption.
            _close_turn(log, thread_id, turn)
            runtime._snapshot_to_thread_store(thread_id, log, intent)
            return turn
        if turn.status == TurnStatus.FAILED:
            _close_turn(log, thread_id, turn)
            # A "blocked_on_user" disposition is a genuine hand-off, not a
            # failure — do not feed it to the failure-sampling evolution
            # ledger as a turn_failure sample.
            _turn_error = turn.error if isinstance(turn.error, dict) else None
            if not (_turn_error and _turn_error.get("disposition") == "blocked_on_user"):
                runtime._record_failed_turn_proposal(
                    turn,
                    intent=intent,
                    failure_source="react_failed",
                )
            runtime._snapshot_to_thread_store(thread_id, log, intent)
            return turn

        terminal = await _verify_turn_code_changes(
            runtime=runtime,
            turn=turn,
            log=log,
            emitter=emitter,
            thread_id=thread_id,
            intent=intent,
            validated=validated,
            execution=execution,
            params=params,
            turn_driver=turn_driver,
        )
        if terminal is not None:
            return terminal

        if not _turn_has_observable_output(turn):
            err = ErrorItem(
                message=(
                    "模型执行结束但没有返回任何可见输出。请重试，或切换到其他可用模型后再试。"
                ),
                error_info={
                    "code": "empty_model_output",
                    "model": validated.model,
                },
            )
            turn.items.append(err)
            await runtime._emit_item_started(turn, log, emitter, err)
            await runtime._emit_item_completed(turn, log, emitter, err)
            turn.status = TurnStatus.FAILED
            _close_turn(log, thread_id, turn)
            runtime._record_failed_turn_proposal(
                turn,
                intent=intent,
                failure_source="empty_model_output",
            )
            runtime._snapshot_to_thread_store(thread_id, log, intent)
            return turn

        background_tasks = runtime._thread_background_tasks.get(thread_id, [])
        if any(not task.done() for task in background_tasks):
            turn.outcome_reason = "completed_with_background"
            log.turn_updated(
                thread_id,
                turn.id,
                objective_id=turn.objective_id,
                task_id=turn.task_id,
                outcome_reason=turn.outcome_reason,
            )
        turn.status = TurnStatus.COMPLETED
        _close_turn(log, thread_id, turn)
        runtime._record_successful_turn_example(turn, intent=intent)
        await runtime._maybe_compact(thread_id, log, emitter)
        runtime._snapshot_to_thread_store(thread_id, log, intent)
        return turn
    except asyncio.CancelledError:
        # Connection teardown cancels the turn task mid-flight
        # (gateway ``_serve`` finally). CancelledError bypasses both
        # the driver ``except Exception`` above and the gateway's
        # error wrapping, so without this handler the journal keeps an
        # IN_PROGRESS turn that only the next thread/resume can reap
        # and the client never sees a terminal event. Finalize
        # best-effort, then always re-raise — cancellation must
        # propagate.
        if turn.status == TurnStatus.IN_PROGRESS:
            turn.status = TurnStatus.INTERRUPTED
            with contextlib.suppress(Exception):
                _close_turn(log, thread_id, turn)
        if turn.completed_at is None:
            turn.completed_at = now_utc()
        # Record the concrete interrupt reason so the frontend can
        # tell the user *why* the turn stopped, not just *that* it did.
        if not turn.interrupt_reason:
            reason = "连接断开或后端重启"
            with contextlib.suppress(Exception):
                emitter_reason = emitter.get_interrupt_reason(turn.id)
                if emitter_reason:
                    reason = emitter_reason
            turn.interrupt_reason = reason
        # The connection is usually already dead here; send failures
        # must not mask the cancellation. Notify the current connection.
        with contextlib.suppress(Exception):
            await _notify_terminal(
                emitter,
                ServerMethod.TURN_INTERRUPTED,
                {
                    "threadId": thread_id,
                    "turnId": turn.id,
                    "reason": turn.interrupt_reason,
                },
            )
        with contextlib.suppress(Exception):
            await _notify_terminal(
                emitter,
                ServerMethod.TURN_COMPLETED,
                {
                    "threadId": thread_id,
                    "turn": turn.model_dump(by_alias=True, mode="json"),
                },
            )
        raise
    except Exception as exc:
        # Failures between turn/started and the driver try (intent
        # build, policy wrap, agent resolve) — or in finalization —
        # escape to the gateway, which only sends a turnId-less error
        # notification: the client would keep this turn inProgress for
        # the rest of the session. Emit the terminal snapshot first,
        # then re-raise so the gateway error path runs unchanged.
        if turn.status == TurnStatus.IN_PROGRESS:
            turn.status = TurnStatus.FAILED
            with contextlib.suppress(Exception):
                _close_turn(
                    log,
                    thread_id,
                    turn,
                    error={"message": str(exc) or exc.__class__.__name__},
                )
            # Mirror the driver-crash handler's bypass records: the
            # evolution store learns the failure and the failed turn
            # stays visible in the sidebar's legacy thread store.
            with contextlib.suppress(Exception):
                runtime._record_failed_turn_proposal(
                    turn,
                    intent=intent,
                    failure_source="turn_lifecycle_exception",
                )
        if turn.completed_at is None:
            turn.completed_at = now_utc()
        with contextlib.suppress(Exception):
            runtime._snapshot_to_thread_store(thread_id, log, intent)
        with contextlib.suppress(Exception):
            await _notify_terminal(
                emitter,
                ServerMethod.TURN_COMPLETED,
                {
                    "threadId": thread_id,
                    "turn": turn.model_dump(by_alias=True, mode="json"),
                },
            )
        raise
    finally:
        # Journal replay stamps completedAt from the turn_completed
        # event ts (event_log.py); mirror that on the live snapshot the
        # gateway serializes right after this returns, or clients see
        # completedAt=null until the next resume.
        if turn.status != TurnStatus.IN_PROGRESS and turn.completed_at is None:
            turn.completed_at = now_utc()
        runtime._record_task_run_finished(turn)
        runtime._active_turn_ids.discard(turn.id)
        runtime._unregister_active_turn(turn.id)
        emitter.unregister_turn(turn.id)
