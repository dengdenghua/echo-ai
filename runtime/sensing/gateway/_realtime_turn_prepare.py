"""Validate, anchor and prepare a realtime turn without starting its driver."""

from __future__ import annotations

from typing import Any

from runtime.sensing.gateway._realtime_turn_context import _TurnContext


def _initialize_turn_context(runtime: Any, params: dict[str, Any], emitter: Any) -> _TurnContext:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    validated = lifecycle.TurnParams.model_validate(params)
    thread_id = runtime._require_thread_id(validated.thread_id)
    # dsh ``agent/inbox/claimed``: a HUMAN-initiated turn refills every
    # subagent wake budget owned by this thread.  The actual store call is
    # deliberately deferred until after ``turn_started`` + the user anchor:
    # it shares the durable-session lock with cold disk discovery and must not
    # hold the visible Send acknowledgement hostage.  An auto-woken parent
    # still never refills the budget.
    _auto_wake, text, validated = lifecycle._apply_composer_markers(validated=validated)
    text, validated, requested_model_before_routing = lifecycle._route_turn_input(
        text=text, validated=validated, _logger=lifecycle._logger
    )

    # Smart model routing — auto-route trivial / simple turns to
    # the cheap tier. Complex / research / topology / code-mode
    # turns stay on the user's primary. Explicit ``model`` pins
    # bypass this entirely.
    validated = lifecycle._route_simple_turn_model(text=text, validated=validated)

    return _TurnContext(
        runtime=runtime,
        params=params,
        emitter=emitter,
        validated=validated,
        thread_id=thread_id,
        text=text,
        _auto_wake=_auto_wake,
        requested_model_before_routing=requested_model_before_routing,
    )


async def _register_turn_context(ctx: _TurnContext) -> None:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    (
        ctx.log,
        ctx.turn,
        ctx.apply_delivery_context,
        ctx.delivery,
        ctx.turn_created_at,
        ctx.intent,
        ctx.emitter_registered_at,
        ctx.active_turn_registered_at,
    ) = await lifecycle._register_turn(
        runtime=ctx.runtime, thread_id=ctx.thread_id, emitter=ctx.emitter, validated=ctx.validated
    )


async def _accept_turn_prompt(ctx: _TurnContext) -> bool:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    ctx.turn_started_visible_at, prompt_decision = await lifecycle._announce_turn_started(
        log=ctx.log,
        thread_id=ctx.thread_id,
        turn=ctx.turn,
        runtime=ctx.runtime,
        emitter=ctx.emitter,
        emitter_registered_at=ctx.emitter_registered_at,
        turn_created_at=ctx.turn_created_at,
        active_turn_registered_at=ctx.active_turn_registered_at,
        text=ctx.text,
        validated=ctx.validated,
        _logger=lifecycle._logger,
    )
    if prompt_decision.cancelled:
        err = lifecycle.ErrorItem(message=prompt_decision.reason or "prompt rejected")
        ctx.turn.items.append(err)
        await ctx.runtime._emit_item_started(ctx.turn, ctx.log, ctx.emitter, err)
        err.status = lifecycle.ItemStatus.FAILED
        await ctx.runtime._emit_item_completed(ctx.turn, ctx.log, ctx.emitter, err)
        ctx.turn.status = lifecycle.TurnStatus.FAILED
        lifecycle._close_turn(ctx.log, ctx.thread_id, ctx.turn)
        # ``intent`` isn't built yet on the prompt-rejected path;
        # the snapshot helper accepts None so the legacy thread
        # store still records the failed turn for the sidebar.
        ctx.runtime._record_failed_turn_proposal(
            ctx.turn,
            intent=None,
            failure_source="prompt_rejected",
        )
        ctx.runtime._snapshot_to_thread_store(ctx.thread_id, ctx.log, None)
        return True
    if prompt_decision.modified_prompt is not None:
        ctx.text = prompt_decision.modified_prompt
    if not ctx.text:
        err = lifecycle.ErrorItem(message="empty input")
        ctx.turn.items.append(err)
        await ctx.runtime._emit_item_started(ctx.turn, ctx.log, ctx.emitter, err)
        await ctx.runtime._emit_item_completed(ctx.turn, ctx.log, ctx.emitter, err)
        ctx.turn.status = lifecycle.TurnStatus.FAILED
        lifecycle._close_turn(ctx.log, ctx.thread_id, ctx.turn)
        ctx.runtime._record_failed_turn_proposal(
            ctx.turn,
            intent=None,
            failure_source="empty_input",
        )
        return True

    # ── PHASE 3.5 · Echo session-reference mention resolution ──
    # Resolve @session: / @subagent: / canonical echo-session: mentions
    # (plus historical dsh-session: references)
    # into a read-only referenced-sessions frame. The frame is injected
    # into the model's user context (never the sidebar text); any
    # failure degrades to the raw prompt.
    (
        ctx.text,
        ctx.session_reference_frame,
        ctx.user_item,
        ctx.user_message_visible_at,
    ) = await lifecycle._anchor_user_message(
        text=ctx.text,
        thread_id=ctx.thread_id,
        validated=ctx.validated,
        delivery=ctx.delivery,
        turn=ctx.turn,
        runtime=ctx.runtime,
        log=ctx.log,
        emitter=ctx.emitter,
        turn_started_visible_at=ctx.turn_started_visible_at,
        turn_created_at=ctx.turn_created_at,
        _resolve_session_reference_mentions=lifecycle._resolve_session_reference_mentions,
        _logger=lifecycle._logger,
    )

    # ``turn/interrupt`` may race the prompt hooks or user-item emission.
    # Keep the user's message as the durable conversation anchor, but do
    # not start report discovery, model routing, or any tool-capable driver
    # after the Stop has already been acknowledged.
    if lifecycle._finish_startup_interrupt(
        ctx.runtime,
        ctx.turn,
        ctx.log,
        ctx.emitter,
        intent=None,
    ):
        return True

    # dsh inject-at-next-wake: claim every parked report owned by this
    # thread only after the user's Send is durably visible.  The worker
    # hop also keeps a cold all-session scan from blocking the realtime
    # event loop.  Warm scans still inject before history replay; a scan
    # that exceeds the budget keeps running and reaches the live steering
    # queue at the next safe model/tool boundary.  If the turn has already
    # ended, injection returns false and the worker deliberately does not
    # ack, leaving the durable report for the next turn.
    await lifecycle._await_pending_subagent_reports(
        _auto_wake=ctx._auto_wake,
        runtime=ctx.runtime,
        thread_id=ctx.thread_id,
        turn=ctx.turn,
        emitter=ctx.emitter,
        user_message_visible_at=ctx.user_message_visible_at,
        turn_started_visible_at=ctx.turn_started_visible_at,
        _schedule_subagent_wake_budget_refill=lifecycle._schedule_subagent_wake_budget_refill,
        _schedule_pending_subagent_reports=lifecycle._schedule_pending_subagent_reports,
        _PENDING_REPORT_STARTUP_BUDGET_S=lifecycle._PENDING_REPORT_STARTUP_BUDGET_S,
        _STARTUP_INTERRUPT_POLL_S=lifecycle._STARTUP_INTERRUPT_POLL_S,
        _logger=lifecycle._logger,
    )
    if lifecycle._finish_startup_interrupt(  # noqa: SIM103 - keep the original phase boundary
        ctx.runtime,
        ctx.turn,
        ctx.log,
        ctx.emitter,
        intent=None,
    ):
        return True

    return False


def _compose_turn_intent(ctx: _TurnContext) -> None:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    ctx.conversation_messages = []
    with lifecycle.contextlib.suppress(Exception):
        ctx.conversation_messages = lifecycle._conversation_messages_for_react(ctx.log.replay())

    ctx.intent = lifecycle._build_intent(
        ctx.text,
        ctx.validated,
        workspaces=ctx.runtime._workspaces,
        thread_store=ctx.runtime._thread_store,
        allow_client_auto_approve=ctx.runtime._allow_client_auto_approve,
        allow_local_workspace_access=ctx.runtime._allow_local_workspace_access,
        conversation_messages=ctx.conversation_messages,
    )
    resolved_execution_workspace = ctx.intent.user_context.get("cwd")
    ctx.turn.execution_workspace_path = (
        resolved_execution_workspace.strip()
        if isinstance(resolved_execution_workspace, str) and resolved_execution_workspace.strip()
        else None
    )
    # Make a newly-created thread queryable as soon as its authenticated
    # user anchor and execution context exist. Previously the derived HTTP
    # thread store was written only at terminal completion, so workbench
    # and sidebar queries saw several seconds of transient 404s while the
    # live turn was already streaming successfully.
    ctx.runtime._snapshot_to_thread_store(ctx.thread_id, ctx.log, ctx.intent)
    if ctx.session_reference_frame is not None:
        ctx.intent = ctx.intent.model_copy(
            update={
                "user_context": {
                    **ctx.intent.user_context,
                    "session_reference_context": ctx.session_reference_frame,
                }
            }
        )


async def _prepare_turn_agent(ctx: _TurnContext) -> bool:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    (
        ctx.explicit_project_command,
        _planned_pattern_execution,
    ) = await lifecycle._apply_cowork_turn_context(
        runtime=ctx.runtime,
        thread_id=ctx.thread_id,
        text=ctx.text,
        intent=ctx.intent,
        delivery=ctx.delivery,
        apply_delivery_context=ctx.apply_delivery_context,
        user_item=ctx.user_item,
        emitter=ctx.emitter,
    )
    if (
        (ctx.intent.user_context or {}).get("cowork_waiting_for_mention")
        and not ctx.explicit_project_command
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
        ctx.runtime._set_turn_steering_accepting(ctx.turn, False)
        ctx.turn.status = lifecycle.TurnStatus.COMPLETED
        ctx.turn.outcome_reason = "cowork_waiting_for_mention"
        ctx.log.turn_updated(
            ctx.thread_id,
            ctx.turn.id,
            objective_id=ctx.turn.objective_id,
            task_id=ctx.turn.task_id,
            outcome_reason=ctx.turn.outcome_reason,
        )
        lifecycle._close_turn(ctx.log, ctx.thread_id, ctx.turn)
        ctx.runtime._snapshot_to_thread_store(ctx.thread_id, ctx.log, ctx.intent)
        return True
    resume_intent = await lifecycle._attach_resume_context(
        runtime=ctx.runtime, thread_id=ctx.thread_id, text=ctx.text, intent=ctx.intent
    )
    if isinstance(resume_intent, dict) and resume_intent.get("requires_confirmation") is True:
        await ctx.runtime._record_pending_resume_intent(ctx.thread_id, resume_intent)
        await ctx.runtime._emit_agent_message(
            ctx.turn,
            ctx.log,
            ctx.emitter,
            lifecycle._resume_confirmation_text(resume_intent),
        )
        ctx.turn.status = lifecycle.TurnStatus.COMPLETED
        lifecycle._close_turn(ctx.log, ctx.thread_id, ctx.turn)
        await ctx.runtime._maybe_compact(ctx.thread_id, ctx.log, ctx.emitter)
        ctx.runtime._snapshot_to_thread_store(ctx.thread_id, ctx.log, ctx.intent)
        return True

    ctx.provider, ctx.agent = lifecycle._resolve_turn_provider_and_agent(
        runtime=ctx.runtime,
        thread_id=ctx.thread_id,
        turn=ctx.turn,
        intent=ctx.intent,
        text=ctx.text,
        emitter=ctx.emitter,
        validated=ctx.validated,
    )
    # Agent resolution and resume plumbing can yield to async stores. A
    # Stop accepted during that window still belongs to startup and must
    # close before dispatch selects any model/tool-capable driver.
    if lifecycle._finish_startup_interrupt(  # noqa: SIM103 - keep the original phase boundary
        ctx.runtime,
        ctx.turn,
        ctx.log,
        ctx.emitter,
        intent=ctx.intent,
    ):
        return True

    return False
