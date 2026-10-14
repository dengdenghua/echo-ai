"""Realtime turn validation, dispatch, resume handling, and finalization."""

from __future__ import annotations

import asyncio
import contextlib  # noqa: F401 - live phase dependency or preserved facade
import json  # noqa: F401 - live dependency of extracted lifecycle phases
import logging
import time  # noqa: F401 - live dependency of extracted lifecycle phases
from typing import TYPE_CHECKING, Any

from runtime.execution.agents.group_fanout import (
    is_group_presence_query,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
)
from runtime.execution.codex_backend import (
    BackpressureError,  # noqa: F401 - live phase dependency or preserved facade
)
from runtime.execution.tool_engine.session_reference_uri import (
    SUPPORTED_SESSION_REFERENCE_SCHEMES,  # noqa: F401 - live dependency of extracted lifecycle phases
)
from runtime.platform.models.primitives import (
    now_utc,  # noqa: F401 - live phase dependency or preserved facade
)
from runtime.protocol import (
    AgentMessageItem,  # noqa: F401 - live dependency of extracted lifecycle phases
    ErrorItem,  # noqa: F401 - live phase dependency or preserved facade
    ItemStatus,  # noqa: F401 - live phase dependency or preserved facade
    ServerMethod,  # noqa: F401 - live phase dependency or preserved facade
    Turn,
    TurnParams,  # noqa: F401 - live phase dependency or preserved facade
    TurnStatus,  # noqa: F401 - live phase dependency or preserved facade
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
    _turn_has_observable_output,  # noqa: F401 - live phase dependency or preserved facade
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
from runtime.execution.agents.preparation import (
    RolePreparationError,  # noqa: F401 - live phase dependency or preserved facade
)
from runtime.execution.engines import (  # noqa: F401 - live dependency of extracted lifecycle phases
    EngineSelectionError,
    ExecutionPhase,
)
from runtime.sensing.gateway._realtime_react_stream_helpers import (
    _should_use_direct_text_path,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
)
from runtime.sensing.gateway._realtime_turn_dispatch import (
    _apply_composer_markers,  # noqa: F401 - live phase dependency or preserved facade
    _dispatch_turn,
    _finish_turn_delivery,
    _repair_coordinated_delivery,  # noqa: F401 - live phase dependency or preserved facade
    _route_simple_turn_model,  # noqa: F401 - live phase dependency or preserved facade
)
from runtime.sensing.gateway._realtime_turn_prepare import (
    _accept_turn_prompt,
    _compose_turn_intent,
    _initialize_turn_context,
    _prepare_turn_agent,
    _register_turn_context,
)
from runtime.sensing.gateway._realtime_turn_reporting import (
    _close_turn,  # noqa: F401 - live phase dependency or preserved facade
    _finish_startup_interrupt,  # noqa: F401 - live phase dependency or preserved facade
    _finish_turn_execution,
    _handle_turn_cancellation,
    _handle_turn_failure,
    _item_outlives_turn,  # noqa: F401 - live dependency of extracted lifecycle phases
    _notify_terminal,  # noqa: F401 - live phase dependency or preserved facade
    _refill_subagent_wake_budget,  # noqa: F401 - live dependency of extracted lifecycle phases
    _resolve_session_reference_mentions,  # noqa: F401 - live phase dependency or preserved facade
    _schedule_pending_subagent_reports,  # noqa: F401 - live phase dependency or preserved facade
    _schedule_subagent_wake_budget_refill,  # noqa: F401 - live phase dependency or preserved facade
    _surface_pending_subagent_reports,  # noqa: F401 - live dependency of extracted lifecycle phases
    _unregister_turn,
)
from runtime.sensing.gateway._realtime_turn_start_phases import (
    _anchor_user_message,  # noqa: F401 - live phase dependency or preserved facade
    _announce_turn_started,  # noqa: F401 - live phase dependency or preserved facade
    _apply_cowork_turn_context,  # noqa: F401 - live phase dependency or preserved facade
    _attach_resume_context,  # noqa: F401 - live phase dependency or preserved facade
    _await_pending_subagent_reports,  # noqa: F401 - live phase dependency or preserved facade
    _drain_late_steering,  # noqa: F401 - live phase dependency or preserved facade
    _emit_turn_hints,  # noqa: F401 - live phase dependency or preserved facade
    _register_turn,  # noqa: F401 - live phase dependency or preserved facade
    _resolve_turn_provider_and_agent,  # noqa: F401 - live phase dependency or preserved facade
    _route_turn_input,  # noqa: F401 - live phase dependency or preserved facade
    _select_turn_route,  # noqa: F401 - live phase dependency or preserved facade
)
from runtime.sensing.gateway._realtime_turn_verification import (
    _verify_turn_code_changes,  # noqa: F401 - live phase dependency or preserved facade
)
from runtime.sensing.gateway.realtime_approval import (
    GatewayApprovalProvider,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
)
from runtime.sensing.gateway.realtime_execution import (
    TurnExecutionRequest,  # noqa: F401 - live phase dependency or preserved facade
    bind_turn_execution,  # noqa: F401 - live phase dependency or preserved facade
    select_turn_execution,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
)
from runtime.sensing.gateway.realtime_gateway import EventEmitter
from runtime.sensing.gateway.realtime_thread_history import (
    _conversation_messages_for_react,  # noqa: F401 - live phase dependency or preserved facade
)
from runtime.sensing.gateway.realtime_turn_input import (
    _build_intent,  # noqa: F401 - live phase dependency or preserved facade
    _extract_codex_composer_mode,  # noqa: F401 - live dependency of extracted lifecycle phases
    _input_attachments,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
    _input_metadata,  # noqa: F401 - live dependency of extracted lifecycle phases
    _join_text,  # noqa: F401 - live dependency of extracted lifecycle phases
    _resume_confirmation_text,  # noqa: F401 - live phase dependency or preserved facade
    _should_default_planning_mode,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
    _should_default_topology,  # noqa: F401 - re-export; used by _realtime_turn_start_phases
    _turn_mode,  # noqa: F401 - live phase dependency or preserved facade
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

    ctx = _initialize_turn_context(runtime, params, emitter)
    await _register_turn_context(ctx)
    try:
        if await _accept_turn_prompt(ctx):
            return ctx.turn
        _compose_turn_intent(ctx)
        if await _prepare_turn_agent(ctx):
            return ctx.turn
        ctx.turn_driver = "react"
        if await _dispatch_turn(ctx):
            return ctx.turn
        await _finish_turn_delivery(ctx)
        return await _finish_turn_execution(ctx)
    except asyncio.CancelledError:
        await _handle_turn_cancellation(ctx)
        raise
    except Exception as exc:
        await _handle_turn_failure(ctx, exc)
        raise
    finally:
        _unregister_turn(ctx)
