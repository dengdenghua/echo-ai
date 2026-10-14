"""Composer routing and coordinated delivery acceptance for realtime turns."""

from __future__ import annotations

from typing import Any

from runtime.protocol import Turn
from runtime.sensing.gateway._realtime_turn_context import _TurnContext


def _apply_composer_markers(*, validated: Any) -> tuple[bool, str, Any]:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    _input_meta = lifecycle._input_metadata(validated)
    _auto_wake = bool(
        isinstance(_input_meta.get("context"), dict)
        and bool(_input_meta["context"].get("auto_wake"))
    )
    text = lifecycle._join_text(validated.input)
    stripped_text, marker_mode = lifecycle._extract_codex_composer_mode(text)
    if marker_mode is not None:
        text = stripped_text
        patched_input: list[dict[str, Any]] = []
        marker_applied = False
        for block in validated.input:
            if (
                not marker_applied
                and isinstance(block, dict)
                and block.get("type") == "text"
                and isinstance(block.get("text"), str)
            ):
                next_block = dict(block)
                next_block["text"] = stripped_text
                metadata = dict(next_block.get("metadata") or {})
                context = dict(metadata.get("context") or {})
                context.setdefault("workflow_mode", marker_mode)
                context.setdefault("completion_policy", marker_mode)
                context.setdefault("mode_preset", f"{marker_mode}.mode")
                context.setdefault("workflow_preset", f"{marker_mode}.mode")
                if marker_mode == "goal":
                    context.setdefault("goal_mode", True)
                metadata["context"] = context
                next_block["metadata"] = metadata
                patched_input.append(next_block)
                marker_applied = True
                continue
            patched_input.append(block)
        validated = validated.model_copy(
            update={
                "input": patched_input,
                **({"planning_mode": True} if marker_mode in {"plan", "spec"} else {}),
            },
        )

    return _auto_wake, text, validated


def _route_simple_turn_model(*, text: str, validated: Any) -> Any:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    try:
        from runtime.core.cerebrum.todo_protocol import (
            should_require_todo_protocol,
        )
        from runtime.core.cerebrum.turn_complexity import (
            estimate_turn_complexity,
            select_model_for_complexity,
        )
        from runtime.sensing.gateway.realtime_turn_routing import (
            looks_like_tool_intent,
        )

        _meta = lifecycle._input_metadata(validated)
        _user_ctx_for_complexity = (
            _meta.get("context") if isinstance(_meta.get("context"), dict) else _meta
        )
        _mode_str = (
            _user_ctx_for_complexity.get("mode")
            if isinstance(_user_ctx_for_complexity, dict)
            else None
        ) or ""
        _capability_mode_str = (
            _user_ctx_for_complexity.get("capability_mode")
            if isinstance(_user_ctx_for_complexity, dict)
            else None
        ) or ""
        _external_model_owner = lifecycle.external_model_owner(validated)
        _is_code_mode_for_routing = bool(_mode_str == "code" or _capability_mode_str)
        _verdict = estimate_turn_complexity(
            text,
            has_explicit_model=bool(
                "model" in getattr(validated, "model_fields_set", set()) and validated.model
            ),
            has_topology=bool(getattr(validated, "topology_id", None)),
            is_code_mode=_is_code_mode_for_routing,
            is_swarm_mode=str(_mode_str).lower() in {"swarm", "swarms"},
            is_research_mode=str(_mode_str).lower() in {"deep", "deep_research", "research"},
            is_goal_mode=bool(getattr(validated, "planning_mode", False)),
            looks_tool_intent=looks_like_tool_intent(text),
            requires_todo_protocol=should_require_todo_protocol(
                text,
                _user_ctx_for_complexity,
            ),
        )
        # AI mode override (Marvis-style efficiency / privacy).
        # Privacy mode pins every turn to ``local`` regardless of
        # complexity so no data leaves the box. Efficiency is a
        # pass-through.
        try:
            from runtime.core.cerebrum.ai_mode import apply_ai_mode_override

            _verdict = apply_ai_mode_override(_verdict)
        except ImportError:  # noqa: BLE001 — ai mode is optional
            pass
        if _external_model_owner:
            # External engines own their effective models. Realtime still estimates complexity for its own
            # lifecycle policy, but must not overwrite or report a model that
            # will never execute.
            _routed_model, _route_reason = None, f"external_engine:{_external_model_owner}"
        else:
            _routed_model, _route_reason = select_model_for_complexity(
                _verdict,
                user_model=validated.model,
                is_code_mode=_is_code_mode_for_routing,
            )
        if _routed_model:
            validated = validated.model_copy(update={"model": _routed_model})
            lifecycle._logger.info(
                "smart routing: %s → %s (%s)",
                text[:60].replace("\n", " "),
                _routed_model,
                _route_reason,
            )
    except Exception as exc:  # noqa: BLE001 — smart routing is best-effort; never block a turn
        lifecycle._logger.debug("smart routing skipped: %s", exc, exc_info=True)

    return validated


async def _repair_coordinated_delivery(
    *,
    runtime: Any,
    turn: Turn,
    log: Any,
    emitter: Any,
    thread_id: str,
    intent: Any,
    validated: Any,
    execution: Any,
    text: str,
    explicit_project_command: bool,
    _team_pattern_execution: str,
    turn_driver: str,
) -> str:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    coordination = getattr(runtime, "_cowork_coordination", None)
    waiting_for_members = bool(
        coordination is not None and coordination.delivery.waiting_for_turn(thread_id, turn.id)
    )
    if waiting_for_members:
        turn.outcome_reason = "completed_with_background"
        log.turn_updated(thread_id, turn.id, outcome_reason=turn.outcome_reason)
    if (
        _team_pattern_execution == "orchestrated"
        and not waiting_for_members
        # Project OS owns durable execution and acceptance evidence. Its
        # control response must not launch a second chat orchestration run.
        and not explicit_project_command
        and turn.status
        not in {
            lifecycle.TurnStatus.PAUSED,
            lifecycle.TurnStatus.CANCELLED,
            lifecycle.TurnStatus.INTERRUPTED,
            lifecycle.TurnStatus.FAILED,
        }
        and not lifecycle._turn_has_cowork_delivery_evidence(turn)
    ):
        has_coordination = lifecycle._turn_has_cowork_coordination_evidence(turn)
        repair_reason = (
            "missing_coordinator_synthesis" if has_coordination else "missing_delegation_evidence"
        )
        # The repair pass receives a synthetic instruction. Bind it to the
        # current turn explicitly because its frozen conversation snapshot
        # may end at an older unfinished task. Without this objective
        # anchor, a valid new request can accidentally resume that old task
        # during orchestration repair.
        repair_objective = lifecycle.json.dumps(str(text or "").strip(), ensure_ascii=False)
        repair_prompt = (
            "协调执行验收未通过：成员调用已有记录，但缺少队长在成员结果之后的统一结论。"
            "请核验已有成员结果并立即给出最终综合交付，不要再次重复分派。"
            f"本轮唯一目标（JSON 字符串）是：{repair_objective}。"
            "只围绕这个目标修复，不得恢复其他历史任务。"
            if has_coordination
            else (
                "协调执行验收未通过：本轮只有计划或文字结论，没有服务端可核验的成员调用记录。"
                "请现在实际调用合适的成员代理完成拆分任务，核验成员结果后再统一交付；"
                "不要只声称‘已分派’或重复计划。"
                f"本轮唯一目标（JSON 字符串）是：{repair_objective}。"
                "只围绕这个目标修复，不得恢复其他历史任务。"
            )
        )
        repair_context = dict(intent.user_context or {})
        repair_context["cowork_orchestration_repair"] = {
            "attempt": 1,
            "max_attempts": 1,
            "reason": repair_reason,
        }
        repair_notice = lifecycle.AgentMessageItem(
            text=(
                "成员结果已经返回，但缺少队长综合，正在自动补齐最终交付。"
                if has_coordination
                else "首次交付缺少真实成员执行记录，正在自动重新分派并验收。"
            ),
            message_kind="commentary",
        )
        turn.items.append(repair_notice)
        await runtime._emit_item_started(turn, log, emitter, repair_notice)
        repair_notice.status = lifecycle.ItemStatus.COMPLETED
        await runtime._emit_item_completed(turn, log, emitter, repair_notice)
        repair_intent = intent.model_copy(
            update={
                "raw": repair_prompt,
                "normalized_goal": repair_prompt,
                "user_context": repair_context,
            }
        )
        turn_driver = execution.route.driver_for(lifecycle.ExecutionPhase.REPAIR)
        await execution.execute(
            lifecycle.TurnExecutionRequest(repair_intent, repair_prompt, validated.model),
            phase=lifecycle.ExecutionPhase.REPAIR,
        )
        if turn.status not in {
            lifecycle.TurnStatus.PAUSED,
            lifecycle.TurnStatus.CANCELLED,
            lifecycle.TurnStatus.INTERRUPTED,
            lifecycle.TurnStatus.FAILED,
        } and not lifecycle._turn_has_cowork_delivery_evidence(turn):
            err = lifecycle.ErrorItem(
                message=(
                    "协调执行缺少成员调用或队长最终综合，已停止将不完整交付误报为任务完成。"
                    "该任务可继续恢复。"
                ),
                error_info={
                    "code": "coordination_delivery_incomplete",
                    "reason": repair_reason,
                    "repair_attempts": 1,
                    "recoverable": True,
                },
            )
            turn.items.append(err)
            await runtime._emit_item_started(turn, log, emitter, err)
            await runtime._emit_item_completed(turn, log, emitter, err)
            turn.status = lifecycle.TurnStatus.INTERRUPTED
            turn.outcome_reason = "coordination_delivery_incomplete"
            log.turn_updated(
                thread_id,
                turn.id,
                objective_id=turn.objective_id,
                task_id=turn.task_id,
                outcome_reason=turn.outcome_reason,
            )

    return turn_driver


async def _select_and_bind_turn_driver(ctx: _TurnContext) -> None:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    ctx.topology_id = getattr(ctx.validated, "topology_id", None)
    _cowork_context = ctx.intent.user_context or {}
    _team_pattern = _cowork_context.get("team_pattern")
    ctx._team_pattern_execution = (
        str(_team_pattern.get("execution") or "").strip() if isinstance(_team_pattern, dict) else ""
    )
    # The declarative team pattern is authoritative. A focused reply
    # must not inherit a stale cluster topology, an orchestrated task
    # must not be forced back into the legacy bubble fan-out by
    # serve_mesh/cowork_is_multi compatibility flags, and neither may be
    # re-routed to the mesh by a client-supplied topology.
    if ctx._team_pattern_execution in {"focused", "orchestrated"}:
        # ``orchestrated`` is decided by the server together with the
        # coordinator contract and any recoverable run snapshot. A
        # client-supplied ``topology_id`` (the legacy 集群 field) would
        # otherwise win route precedence and dispatch ``swarm_mesh``
        # instead, while the deliverable-completeness gate below still
        # audits this turn as coordinated execution.
        if ctx.topology_id:
            lifecycle._logger.info(
                "ignoring topology_id %r under server-owned team pattern %r",
                ctx.topology_id,
                ctx._team_pattern_execution,
            )
            ctx.validated = ctx.validated.model_copy(update={"topology_id": None})
        ctx.topology_id = None
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
    _mode_str = (lifecycle._turn_mode(ctx.validated) or "").lower()
    if ctx.topology_id and _mode_str in {"chat", "react", "deep"}:
        lifecycle._logger.info(
            "ignoring topology_id %r in single-agent mode %r",
            ctx.topology_id,
            _mode_str,
        )
        ctx.topology_id = None
        ctx.validated = ctx.validated.model_copy(
            update={"topology_id": None},
        )

    # 能力包 / Meta-Skill soft hand-off: if the user's text
    # strongly matches one of the curated workflow packs,
    # surface a hint so the user can switch to the catalog
    # page. ReAct still runs — the hint is informational,
    # not a redirect, until the graph runtime is wired
    # through the realtime gateway.
    await lifecycle._emit_turn_hints(
        text=ctx.text,
        emitter=ctx.emitter,
        thread_id=ctx.thread_id,
        turn=ctx.turn,
        explicit_project_command=ctx.explicit_project_command,
        _logger=lifecycle._logger,
    )

    reflection, route = await lifecycle._select_turn_route(
        _cowork_context=_cowork_context,
        _team_pattern_execution=ctx._team_pattern_execution,
        text=ctx.text,
        explicit_project_command=ctx.explicit_project_command,
        topology_id=ctx.topology_id,
        agent=ctx.agent,
        validated=ctx.validated,
        runtime=ctx.runtime,
        conversation_messages=ctx.conversation_messages,
        thread_id=ctx.thread_id,
        turn=ctx.turn,
        intent=ctx.intent,
    )
    if route.engine in {"opencode", "codex"}:
        ctx.validated = ctx.validated.model_copy(
            update={"model": ctx.requested_model_before_routing}
        )
        ctx.turn.params = ctx.validated
        external_context = {
            **(ctx.intent.user_context or {}),
            "model_name": ctx.requested_model_before_routing,
        }
        # Preserve the host's existing no-tool classification for
        # OpenCode.  Without this handoff, greetings and explicit
        # discussion-only turns still built and connected the full
        # per-turn MCP bridge before asking the model for text.
        if route.engine == "opencode":
            external_context["direct_conversation_reply"] = reflection
        ctx.intent = ctx.intent.model_copy(update={"user_context": external_context})
    # The explicit model still governs every member of an orchestrated
    # topology. Engine selection does not change model ownership.
    if route.driver == "swarm_mesh":
        team_model = str(ctx.validated.model or "").strip()
        if team_model and team_model.lower() not in {"auto", "default"}:
            ctx.intent = ctx.intent.model_copy(
                update={
                    "user_context": {
                        **(ctx.intent.user_context or {}),
                        "model_name": team_model,
                    }
                }
            )
    ctx.turn_driver = route.driver
    ctx.execution = lifecycle.bind_turn_execution(
        ctx.runtime,
        ctx.turn,
        ctx.log,
        ctx.emitter,
        ctx.provider,
        ctx.agent,
        route,
        topology_id=ctx.topology_id,
    )


async def _handle_turn_driver_error(ctx: _TurnContext, exc: Exception) -> bool:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    if isinstance(exc, (lifecycle.EngineSelectionError, lifecycle.RolePreparationError)):
        lifecycle._logger.info(
            "CerebrumRuntime: preparation requires attention: %s", type(exc).__name__
        )
    else:
        lifecycle._logger.exception("CerebrumRuntime: turn driver crashed: %s", ctx.turn_driver)
    if isinstance(exc, lifecycle.RolePreparationError):
        selection_error = True
        ctx.turn.error = {**exc.info, "message": str(exc)}
        ctx.turn_driver = "role_preparation"
    elif isinstance(exc, lifecycle.EngineSelectionError):
        selection_error = True
        ctx.turn.error = {
            "code": "execution_unavailable",
            "engine": exc.engine.value,
            "reason": exc.reason,
            "message": str(exc),
            "disposition": "blocked_on_user",
        }
        ctx.turn_driver = "engine_selection"
    else:
        selection_error = False
        ctx.turn.execution_engine = (
            ctx.turn.execution.engine
            if ctx.turn.execution is not None
            else {
                "codex_app_server": "codex",
                "opencode_server": "opencode",
            }.get(ctx.turn_driver, "echo")
        )
    context = ctx.intent.user_context if isinstance(ctx.intent.user_context, dict) else {}
    event_backpressure = isinstance(exc, lifecycle.BackpressureError)
    public_error_message = (
        "Codex event delivery was temporarily overloaded. Completed steps were "
        "preserved; retry to continue."
        if event_backpressure
        else str(exc) or exc.__class__.__name__
    )
    err = lifecycle.ErrorItem(
        message=public_error_message,
        error_info={
            "code": (
                "execution_unavailable"
                if selection_error
                else "codex_event_backpressure"
                if event_backpressure
                else "turn_driver_exception"
            ),
            "driver": ctx.turn_driver,
            "exception_type": exc.__class__.__name__,
            "failure_kind": "backpressure" if event_backpressure else "",
            "cowork_mode": context.get("cowork_mode"),
            "topology_id": ctx.topology_id or "",
            **(
                {
                    "engine": exc.engine.value,
                    "reason": exc.reason,
                    "disposition": "blocked_on_user",
                }
                if isinstance(exc, lifecycle.EngineSelectionError)
                else {}
            ),
            **(exc.info if isinstance(exc, lifecycle.RolePreparationError) else {}),
        },
    )
    ctx.turn.items.append(err)
    await ctx.runtime._emit_item_started(ctx.turn, ctx.log, ctx.emitter, err)
    await ctx.runtime._emit_item_completed(ctx.turn, ctx.log, ctx.emitter, err)
    ctx.turn.status = lifecycle.TurnStatus.FAILED
    lifecycle._close_turn(ctx.log, ctx.thread_id, ctx.turn)
    if not selection_error:
        ctx.runtime._record_failed_turn_proposal(
            ctx.turn,
            intent=ctx.intent,
            failure_source=f"{ctx.turn_driver}_exception",
        )
    ctx.runtime._snapshot_to_thread_store(ctx.thread_id, ctx.log, ctx.intent)
    return True


async def _dispatch_turn(ctx: _TurnContext) -> bool:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    try:
        await _select_and_bind_turn_driver(ctx)
        await ctx.execution.execute(
            lifecycle.TurnExecutionRequest(ctx.intent, ctx.text, ctx.validated.model)
        )
    except Exception as exc:
        return await _handle_turn_driver_error(ctx, exc)
    return False


async def _finish_turn_delivery(ctx: _TurnContext) -> None:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    ctx.turn_driver = await lifecycle._drain_late_steering(
        turn=ctx.turn,
        runtime=ctx.runtime,
        intent=ctx.intent,
        execution=ctx.execution,
        validated=ctx.validated,
        turn_driver=ctx.turn_driver,
    )

    # A coordinated deliverable is not complete merely because the TL
    # wrote a confident answer. Require server-observed delegation. Give
    # the coordinator one bounded repair round so an omitted tool call can
    # be corrected without making the user repeat the request.
    ctx.turn_driver = await lifecycle._repair_coordinated_delivery(
        runtime=ctx.runtime,
        turn=ctx.turn,
        log=ctx.log,
        emitter=ctx.emitter,
        thread_id=ctx.thread_id,
        intent=ctx.intent,
        validated=ctx.validated,
        execution=ctx.execution,
        text=ctx.text,
        explicit_project_command=ctx.explicit_project_command,
        _team_pattern_execution=ctx._team_pattern_execution,
        turn_driver=ctx.turn_driver,
    )
