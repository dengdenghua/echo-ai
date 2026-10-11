"""Verification evidence, bounded repair and terminal outcomes for one turn."""

from __future__ import annotations

from typing import Any

from runtime.protocol import Turn


async def _repair_failed_verification(
    *,
    runtime: Any,
    turn: Turn,
    log: Any,
    emitter: Any,
    thread_id: str,
    intent: Any,
    validated: Any,
    execution: Any,
    params: dict[str, Any],
    turn_driver: str,
) -> tuple[int, int, Turn | None]:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    repair_attempt = 0
    requested_sandbox = params.get("sandboxPolicy")
    from runtime.safety.evolution.auto_verifier import (
        _sandbox_allows_auto_verification,
    )

    repair_limit = (
        2
        if turn_driver == "react"
        and _sandbox_allows_auto_verification(requested_sandbox)
        and _sandbox_allows_auto_verification(validated.sandbox_policy)
        else 0
    )
    if lifecycle._turn_has_failed_code_verification(turn):
        failed_items = [
            item
            for item in turn.items
            if isinstance(item, lifecycle.VerificationItem)
            and item.status == lifecycle.ItemStatus.FAILED
        ]
        # ── Environment-blocked degrade ──────────────────────
        # All failed verification items are environment-blocked
        # (missing tool / no network): don't burn repair attempts or
        # hard-fail the turn on an environment problem. Surface a
        # manual-confirmation item and complete.
        if not repair_limit and lifecycle._turn_verification_environment_blocked(turn):
            degrade_item = lifecycle.VerificationItem(
                command="manual verification required (environment blocked)",
                kind="manual",
                status=lifecycle.ItemStatus.COMPLETED,
                exit_code=None,
                summary=(
                    "代码已修改，但验证命令因环境受限未能执行 "
                    "(工具缺失/网络不可用)。请人工运行下列推荐命令确认后继续。"
                ),
                stdout_tail=lifecycle._verification_plan_stdout_tail(
                    lifecycle._verification_plan_for_code_paths(
                        lifecycle._code_change_paths(turn), intent
                    )
                ),
                stderr_tail=None,
                related_files=lifecycle._code_change_paths(turn),
                related_change_item_ids=lifecycle._file_change_item_ids(turn),
            )
            turn.items.append(degrade_item)
            await runtime._emit_item_started(turn, log, emitter, degrade_item)
            await runtime._emit_item_completed(turn, log, emitter, degrade_item)
            turn.status = lifecycle.TurnStatus.COMPLETED
            lifecycle._close_turn(log, thread_id, turn)
            runtime._snapshot_to_thread_store(thread_id, log, intent)
            return (repair_attempt, repair_limit, turn)
        if repair_limit:
            from runtime.safety.evolution.auto_verifier import (
                build_verification_repair_request,
            )

            verification_plan = lifecycle._verification_plan_for_code_paths(
                lifecycle._code_change_paths(turn),
                intent,
            )
            repair_attempt = 1
            repair_request = build_verification_repair_request(
                verification_plan,
                failed_items,
                attempt=repair_attempt,
                max_attempts=repair_limit,
            )
            with lifecycle.contextlib.suppress(Exception):
                from runtime.safety.evolution.auto_verifier_metrics import (
                    record_auto_verifier_repair_attempt,
                )

                record_auto_verifier_repair_attempt(
                    attempt=repair_attempt,
                    max_attempts=repair_limit,
                    status="requested",
                    failed_commands=[item.command for item in failed_items],
                )
            repair_context = dict(intent.user_context or {})
            repair_context["verification_repair"] = repair_request
            repair_intent = intent.model_copy(
                update={
                    "raw": repair_request["prompt"],
                    "normalized_goal": repair_request["prompt"],
                    "user_context": repair_context,
                }
            )
            await execution.execute(
                lifecycle.TurnExecutionRequest(
                    repair_intent, repair_intent.normalized_goal, validated.model
                ),
                phase=lifecycle.ExecutionPhase.REPAIR,
            )
            if turn.status == lifecycle.TurnStatus.INTERRUPTED:
                lifecycle._close_turn(log, thread_id, turn)
                runtime._snapshot_to_thread_store(thread_id, log, intent)
                return (repair_attempt, repair_limit, turn)
            if turn.status == lifecycle.TurnStatus.FAILED:
                lifecycle._close_turn(log, thread_id, turn)
                runtime._record_failed_turn_proposal(
                    turn,
                    intent=intent,
                    failure_source="verification_repair_failed",
                )
                runtime._snapshot_to_thread_store(thread_id, log, intent)
                return (repair_attempt, repair_limit, turn)
        else:
            turn.status = lifecycle.TurnStatus.FAILED
            lifecycle._close_turn(log, thread_id, turn)
            runtime._record_failed_turn_proposal(
                turn,
                intent=intent,
                failure_source="verification_failed",
            )
            runtime._snapshot_to_thread_store(thread_id, log, intent)
            return (repair_attempt, repair_limit, turn)

    return repair_attempt, repair_limit, None


async def _run_auto_verification(
    *,
    runtime: Any,
    turn: Turn,
    log: Any,
    emitter: Any,
    thread_id: str,
    intent: Any,
    validated: Any,
    execution: Any,
    verification_plan: Any,
    repair_attempt: int,
    repair_limit: int,
) -> tuple[list[Any], Any, Turn | None]:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    auto_items: list[lifecycle.VerificationItem] = []
    while True:
        try:
            from runtime.safety.evolution.auto_verifier import (
                build_verification_repair_request,
                run_verification_plan,
            )

            auto_items = run_verification_plan(
                verification_plan,
                sandbox_policy=validated.sandbox_policy,
            )
        except Exception:  # noqa: BLE001 - auto verification is best-effort
            auto_items = []
        for auto_item in auto_items:
            turn.items.append(auto_item)
            await runtime._emit_item_started(turn, log, emitter, auto_item)
            await runtime._emit_item_completed(turn, log, emitter, auto_item)
        if repair_attempt:
            with lifecycle.contextlib.suppress(Exception):
                from runtime.safety.evolution.auto_verifier_metrics import (
                    record_auto_verifier_repair_attempt,
                )

                record_auto_verifier_repair_attempt(
                    attempt=repair_attempt,
                    max_attempts=repair_limit,
                    status=(
                        "passed"
                        if auto_items
                        and all(
                            item.status == lifecycle.ItemStatus.COMPLETED for item in auto_items
                        )
                        else "failed"
                        if auto_items
                        else "no_evidence"
                    ),
                    failed_commands=[],
                    fresh_evidence_commands=[item.command for item in auto_items],
                )
        if all(item.status == lifecycle.ItemStatus.COMPLETED for item in auto_items):
            if not auto_items:
                break
            turn.status = lifecycle.TurnStatus.COMPLETED
            lifecycle._close_turn(log, thread_id, turn)
            runtime._record_successful_turn_example(turn, intent=intent)
            await runtime._maybe_compact(thread_id, log, emitter)
            runtime._snapshot_to_thread_store(thread_id, log, intent)
            return (auto_items, verification_plan, turn)
        if not auto_items or repair_attempt >= repair_limit:
            break

        repair_attempt += 1
        repair_request = build_verification_repair_request(
            verification_plan,
            auto_items,
            attempt=repair_attempt,
            max_attempts=repair_limit,
        )
        with lifecycle.contextlib.suppress(Exception):
            from runtime.safety.evolution.auto_verifier_metrics import (
                record_auto_verifier_repair_attempt,
            )

            record_auto_verifier_repair_attempt(
                attempt=repair_attempt,
                max_attempts=repair_limit,
                status="requested",
                failed_commands=[item.command for item in auto_items],
            )
        repair_context = dict(intent.user_context or {})
        repair_context["verification_repair"] = repair_request
        repair_intent = intent.model_copy(
            update={
                "raw": repair_request["prompt"],
                "normalized_goal": repair_request["prompt"],
                "user_context": repair_context,
            }
        )
        await execution.execute(
            lifecycle.TurnExecutionRequest(
                repair_intent, repair_intent.normalized_goal, validated.model
            ),
            phase=lifecycle.ExecutionPhase.REPAIR,
        )
        if turn.status == lifecycle.TurnStatus.INTERRUPTED:
            lifecycle._close_turn(log, thread_id, turn)
            runtime._snapshot_to_thread_store(thread_id, log, intent)
            return (auto_items, verification_plan, turn)
        verification_plan = lifecycle._verification_plan_for_code_paths(
            lifecycle._code_change_paths(turn),
            intent,
        )

    return auto_items, verification_plan, None


async def _finish_unverified_changes(
    *,
    runtime: Any,
    turn: Turn,
    log: Any,
    emitter: Any,
    thread_id: str,
    intent: Any,
    validated: Any,
    execution: Any,
    auto_items: list[Any],
    verification_plan: Any,
    code_change_paths: list[str],
) -> Turn:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    if not auto_items:
        # ── Agent-driven verification loop-back ────────────
        # Auto-verification produced no evidence (sandbox didn't
        # allow it, or no allowlisted command fit) and the agent
        # ended without recording a verification step. Instead of
        # hard-ending with a manual "verification required" error,
        # give the agent a bounded round to run the recommended
        # commands itself, fix anything that fails, and report.
        from runtime.safety.evolution.auto_verifier import (
            build_agent_verification_request,
        )

        agent_verify_attempt = 0
        while agent_verify_attempt < lifecycle._AGENT_VERIFY_ROUND_LIMIT:
            if not lifecycle._turn_has_unverified_code_changes(turn):
                break
            agent_verify_attempt += 1
            verify_request = build_agent_verification_request(
                verification_plan,
                attempt=agent_verify_attempt,
            )
            verify_context = dict(intent.user_context or {})
            verify_context["verification_repair"] = verify_request
            verify_intent = intent.model_copy(
                update={
                    "raw": verify_request["prompt"],
                    "normalized_goal": verify_request["prompt"],
                    "user_context": verify_context,
                }
            )
            await execution.execute(
                lifecycle.TurnExecutionRequest(
                    verify_intent, verify_intent.normalized_goal, validated.model
                ),
                phase=lifecycle.ExecutionPhase.VERIFICATION,
            )
            if turn.status in {
                lifecycle.TurnStatus.INTERRUPTED,
                lifecycle.TurnStatus.CANCELLED,
                lifecycle.TurnStatus.PAUSED,
                lifecycle.TurnStatus.FAILED,
            }:
                lifecycle._close_turn(log, thread_id, turn)
                runtime._snapshot_to_thread_store(thread_id, log, intent)
                return turn
        if not lifecycle._turn_has_unverified_code_changes(turn):
            turn.status = lifecycle.TurnStatus.COMPLETED
            lifecycle._close_turn(log, thread_id, turn)
            runtime._record_successful_turn_example(turn, intent=intent)
            await runtime._maybe_compact(thread_id, log, emitter)
            runtime._snapshot_to_thread_store(thread_id, log, intent)
            return turn

    if auto_items:
        # ── Environment-blocked degrade ──────────────────────
        # The verifier could not run at all (missing tool /
        # no network / corepack download failure), so a hard
        # failure would blame the code for an environment
        # problem. Degrade to a manual-confirmation turn: the
        # change is preserved, the UI shows the exact command
        # the user must run to close the loop.
        if lifecycle._turn_verification_environment_blocked(turn):
            degrade_item = lifecycle.VerificationItem(
                command="manual verification required (environment blocked)",
                kind="manual",
                status=lifecycle.ItemStatus.COMPLETED,
                exit_code=None,
                summary=(
                    "代码已修改，但验证命令因环境受限未能执行 "
                    "(工具缺失/网络不可用)。请人工运行下列推荐命令确认后继续。"
                ),
                stdout_tail=lifecycle._verification_plan_stdout_tail(verification_plan),
                stderr_tail=None,
                related_files=code_change_paths,
                related_change_item_ids=lifecycle._file_change_item_ids(turn),
            )
            turn.items.append(degrade_item)
            await runtime._emit_item_started(turn, log, emitter, degrade_item)
            await runtime._emit_item_completed(turn, log, emitter, degrade_item)
            turn.status = lifecycle.TurnStatus.COMPLETED
            lifecycle._close_turn(log, thread_id, turn)
            runtime._snapshot_to_thread_store(thread_id, log, intent)
            return turn

        turn.status = lifecycle.TurnStatus.FAILED
        lifecycle._close_turn(log, thread_id, turn)
        runtime._record_failed_turn_proposal(
            turn,
            intent=intent,
            failure_source="verification_failed",
        )
        runtime._snapshot_to_thread_store(thread_id, log, intent)
        return turn

    verification_item = lifecycle.VerificationItem(
        command="verification required",
        kind="manual",
        status=lifecycle.ItemStatus.FAILED,
        exit_code=None,
        summary=(
            "Code changes were produced but no verification step was recorded before final answer."
        ),
        stdout_tail=lifecycle._verification_plan_stdout_tail(verification_plan),
        stderr_tail=None,
        related_files=code_change_paths,
        related_change_item_ids=lifecycle._file_change_item_ids(turn),
    )
    turn.items.append(verification_item)
    await runtime._emit_item_started(turn, log, emitter, verification_item)
    await runtime._emit_item_completed(turn, log, emitter, verification_item)
    # ── Environment-blocked degrade ──────────────────────
    # The agent changed code but could not run ANY verifier
    # because the environment itself is broken (missing tool /
    # no network / corepack shim download failure). Keep the
    # change visible and ask the user to confirm manually instead
    # of failing the turn on an environment problem.
    if lifecycle._turn_verification_environment_blocked(turn):
        turn.status = lifecycle.TurnStatus.COMPLETED
        lifecycle._close_turn(log, thread_id, turn)
        runtime._snapshot_to_thread_store(thread_id, log, intent)
        return turn
    turn.status = lifecycle.TurnStatus.FAILED
    lifecycle._close_turn(log, thread_id, turn)
    runtime._record_failed_turn_proposal(
        turn,
        intent=intent,
        failure_source="verification_required",
    )
    runtime._snapshot_to_thread_store(thread_id, log, intent)
    return turn


async def _verify_turn_code_changes(
    *,
    runtime: Any,
    turn: Turn,
    log: Any,
    emitter: Any,
    thread_id: str,
    intent: Any,
    validated: Any,
    execution: Any,
    params: dict[str, Any],
    turn_driver: str,
) -> Turn | None:
    from runtime.sensing.gateway import realtime_turn_lifecycle as lifecycle

    repair_attempt, repair_limit, terminal = await _repair_failed_verification(
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

    if lifecycle._turn_has_unverified_code_changes(turn):
        # ── Await in-flight background verification ─────────────
        # The model may have handed verification to a background task
        # (background_exec) that is still running when the loop
        # returned. Failing with "verification required" while those
        # tasks are in flight would blame the model for work that is
        # genuinely still finishing. Wait a bounded window for their
        # outcome; if one is still running afterwards, close the turn
        # as completed-with-background (the verifier keeps running)
        # instead of a spurious verification-required failure.
        pending_bg_tasks = [
            task for task in runtime._thread_background_tasks.get(thread_id, []) if not task.done()
        ]
        # Only bypass the gate when a pending task is plausibly the
        # delegated verification itself. An unrelated watcher / dev
        # server / poller still running is not a reason to silently
        # green unverified code — in that case fall through to the
        # normal verification gate below.
        if any(
            lifecycle._background_task_is_verification(task.get_name()) for task in pending_bg_tasks
        ):
            await lifecycle.asyncio.wait(
                pending_bg_tasks,
                timeout=lifecycle._BACKGROUND_VERIFY_WAIT_S,
            )
            if any(not task.done() for task in pending_bg_tasks):
                turn.status = lifecycle.TurnStatus.COMPLETED
                turn.outcome_reason = "completed_with_background"
                lifecycle._close_turn(log, thread_id, turn)
                runtime._snapshot_to_thread_store(thread_id, log, intent)
                return turn

        code_change_paths = lifecycle._code_change_paths(turn)
        verification_plan = lifecycle._verification_plan_for_code_paths(
            code_change_paths,
            intent,
        )
        auto_items, verification_plan, terminal = await _run_auto_verification(
            runtime=runtime,
            turn=turn,
            log=log,
            emitter=emitter,
            thread_id=thread_id,
            intent=intent,
            validated=validated,
            execution=execution,
            verification_plan=verification_plan,
            repair_attempt=repair_attempt,
            repair_limit=repair_limit,
        )
        if terminal is not None:
            return terminal
        return await _finish_unverified_changes(
            runtime=runtime,
            turn=turn,
            log=log,
            emitter=emitter,
            thread_id=thread_id,
            intent=intent,
            validated=validated,
            execution=execution,
            auto_items=auto_items,
            verification_plan=verification_plan,
            code_change_paths=code_change_paths,
        )
    return None
