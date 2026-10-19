"""Split out of :mod:`_realtime_react_stream_drive` so that module stays under the 1000-line
god-file ratchet. Everything here is re-exported by the original module, so
import sites do not move.
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
import time
from collections.abc import Callable, Iterator
from concurrent.futures import CancelledError as FutureCancelledError
from concurrent.futures import Future, InvalidStateError
from typing import TYPE_CHECKING, Any, TypedDict

if TYPE_CHECKING:
    from runtime.protocol import Turn
    from runtime.sensing.gateway.realtime_cerebrum import CerebrumRuntime

from runtime.execution.subagents._ambient import react_stack_scope
from runtime.memory.threads.event_log import EventLog
from runtime.platform.models import ParsedIntent
from runtime.platform.models.llm import default_reasoning_effort
from runtime.protocol import TurnStatus
from runtime.safety.approval.approval_gate import ApprovalProvider
from runtime.sensing.gateway._realtime_react_stream_apply import (
    _apply_react_event,
    _start_orchestrator_bridge,
)
from runtime.sensing.gateway._realtime_react_stream_helpers import (
    _CRITICAL_STRUCTURAL_EVENT_TYPES,
    _REACT_QUEUE_PUT_TIMEOUT_S,
    _SINGLE_AGENT_HEARTBEAT_INTERVAL_S,
    _TERMINAL_REACT_EVENT_TYPES,
    _agentic_stream_event_to_react_event,
    _apply_react_session_metadata,
    _emit_turn_heartbeat,
    _is_coalescable_delta,
    _lease_renewal_interval_s,
    _logger,
    _QueuedReactEvent,
    _ReactStructuralDeliveryError,
    _safe_stream_error_message,
    _should_use_native_tool_loop,
    _ToolStartAuditError,
)
from runtime.sensing.gateway.realtime_gateway import EventEmitter
from runtime.sensing.gateway.realtime_react_stream_drive_verify import (  # noqa: F401  re-export: import sites stay stable
    _SUBAGENT_PROGRESS_EMIT_CHARS as _SUBAGENT_PROGRESS_EMIT_CHARS,
)
from runtime.sensing.gateway.realtime_react_stream_drive_verify import (
    _SUBAGENT_PROGRESS_EMIT_INTERVAL_S as _SUBAGENT_PROGRESS_EMIT_INTERVAL_S,
)
from runtime.sensing.gateway.realtime_react_stream_drive_verify import (
    _SUBAGENT_PROGRESS_PREVIEW_CHARS as _SUBAGENT_PROGRESS_PREVIEW_CHARS,
)
from runtime.sensing.gateway.realtime_react_stream_drive_verify import (
    _start_subagent_lifecycle_bridge as _start_subagent_lifecycle_bridge,
)
from runtime.sensing.gateway.realtime_turn_input import _resume_task_id_from_intent


class _ReactBudgetKwargs(TypedDict, total=False):
    max_tokens_budget: int
    max_usd_budget: float


_INTERRUPT_PRODUCER_DRAIN_TIMEOUT_S = 0.75


async def _drive_react(
    runtime: CerebrumRuntime,
    turn: Turn,
    log: EventLog,
    emitter: EventEmitter,
    intent: ParsedIntent,
    provider: ApprovalProvider,
    agent: Any,
    *,
    model: str | None = None,
) -> None:
    """Pump the react_loop iterator, mapping each event to ``item/*``.

    The loop runs on a worker thread (``asyncio.to_thread``) so
    synchronous LLM calls inside ``stream_react_loop`` don't block
    the event loop. Each yielded event is delivered back to the
    coroutine via a queue.
    """
    from runtime.core.cerebrum.react_loop import stream_react_loop
    from runtime.core.cerebrum.react_step_evaluator import build_runtime_step_evaluator
    from runtime.safety.approval.cancellation import (
        CancellationSource,
        scoped_cancellation,
    )

    queue: asyncio.Queue[_QueuedReactEvent | dict[str, Any]] = asyncio.Queue(maxsize=64)
    loop = asyncio.get_running_loop()
    producer_done = asyncio.Event()
    interrupt_requested = asyncio.Event()
    consumer_closed = threading.Event()

    # Per-turn cancellation source. Tripped when the gateway records a
    # ``turn/interrupt`` for this turn id; every tool call inside
    # ``stream_react_loop`` sees the same token via the
    # ``scoped_cancellation`` contextvar and bails out fast.
    cancel_source = CancellationSource()
    pending_apply_receipts: set[Future[None]] = set()
    pending_apply_receipts_lock = threading.Lock()
    producer_failure: BaseException | None = None

    def _settle_apply_receipt(
        receipt: Future[None] | None,
        *,
        error: BaseException | None = None,
    ) -> None:
        if receipt is None:
            return
        with contextlib.suppress(InvalidStateError):
            if error is None:
                receipt.set_result(None)
            else:
                receipt.set_exception(error)

    def _safe_put(event: dict[str, Any], *, timeout: float | None = None) -> None:
        """Bounded blocking ``queue.put`` from the worker thread.

        ``run_coroutine_threadsafe(...).result()`` without a timeout
        deadlocks the worker if the consumer exits early (exception
        in the dispatch loop, ws error, etc.). Bounded blocking
        preserves backpressure for the normal case while leaving a
        kill-switch when something downstream is wedged.

        Coalescable decorative deltas bypass the blocking put: they are
        high-frequency and individually disposable, so on a full queue we
        drop the newest delta instead of stalling the producer 10s (which
        used to cascade and lose *structural* events downstream).
        """
        event_kind = str(event.get("type") or "")
        if consumer_closed.is_set():
            # Never let a provider that wakes up after the turn was already
            # cancelled advance past ``yield tool_start`` into the real side
            # effect. Decorative/prose/terminal events are simply abandoned;
            # the turn already has an authoritative terminal snapshot.
            if event_kind == "tool_start":
                raise _ToolStartAuditError(
                    "tool execution blocked because the interrupted turn already closed"
                )
            return

        timeout_s = _REACT_QUEUE_PUT_TIMEOUT_S if timeout is None else max(0.01, timeout)
        if _is_coalescable_delta(event):
            coalesce_future: Future[None] | None = None
            try:
                # put_nowait is a plain method, so wrap it in a coroutine that
                # swallows QueueFull: on a full queue the decorative delta is
                # dropped rather than making the producer block 10s.
                async def _coalesce() -> None:
                    with contextlib.suppress(asyncio.QueueFull):
                        queue.put_nowait(event)

                coalesce_future = asyncio.run_coroutine_threadsafe(
                    _coalesce(),
                    loop,
                )
                coalesce_future.result(timeout=0.05)
            except (RuntimeError, TimeoutError):
                if coalesce_future is not None:
                    coalesce_future.cancel()
                # Loop closed or consumer wedged — drop the decorative delta.
                _logger.debug(
                    "react bridge coalesced-delta drop (consumer slow) event=%s",
                    event.get("type") if isinstance(event, dict) else None,
                )
            return

        apply_receipt: Future[None] | None = None
        queued_event: _QueuedReactEvent | dict[str, Any] = event
        if isinstance(event, dict) and event.get("type") == "tool_start":
            apply_receipt = Future()
            queued_event = _QueuedReactEvent(event=event, applied=apply_receipt)
            with pending_apply_receipts_lock:
                pending_apply_receipts.add(apply_receipt)

        put_future = asyncio.run_coroutine_threadsafe(
            queue.put(queued_event),
            loop,
        )
        try:
            put_future.result(timeout=timeout_s)
        except (FutureCancelledError, RuntimeError, TimeoutError) as exc:
            put_future.cancel()
            if event_kind in _CRITICAL_STRUCTURAL_EVENT_TYPES:
                if apply_receipt is not None:
                    apply_receipt.cancel()
                cancel_source.cancel(reason=f"critical {event_kind} enqueue failed")
                with pending_apply_receipts_lock:
                    if apply_receipt is not None:
                        pending_apply_receipts.discard(apply_receipt)
                error_type = (
                    _ToolStartAuditError
                    if event_kind == "tool_start"
                    else _ReactStructuralDeliveryError
                )
                raise error_type(
                    f"critical react event {event_kind!r} could not be enqueued"
                ) from exc
            # RuntimeError: loop closed.
            # TimeoutError: consumer stuck — drop this event rather
            # than block the worker indefinitely.
            _logger.warning(
                "react bridge enqueue failed/timed out (event=%s) — "
                "text/tool events may be lost, frontend may show incomplete output",
                event.get("type") if isinstance(event, dict) else event,
            )
            return

        if apply_receipt is None:
            return
        try:
            # Advancing the generator after ``yield tool_start`` executes the
            # real handler. Wait until the async reducer has durably journaled
            # the CommandExecution item (and completed its live notification)
            # before allowing that next() call.
            apply_receipt.result(timeout=timeout_s)
        except Exception as exc:
            apply_receipt.cancel()
            cancel_source.cancel(reason="tool_start durable audit failed")
            raise _ToolStartAuditError(
                "tool execution blocked because its start event was not durably applied"
            ) from exc
        finally:
            with pending_apply_receipts_lock:
                pending_apply_receipts.discard(apply_receipt)

    def _push_chunk(call_id: str, stream: str, chunk: str) -> None:
        # Called from a reader sub-thread inside the tool's subprocess
        # plumbing. Hop back to the asyncio loop so the queue stays
        # single-producer-from-the-event-loop's-perspective.
        #
        # We use a SHORT timeout here (vs the 10s in _safe_put):
        # tool stdout chunks are high-frequency and individually
        # disposable — better to drop a chunk than block the
        # subprocess reader thread for 10s if the consumer is slow.
        evt = {
            "type": "tool_output_delta",
            "tool_call_id": call_id,
            "stream": stream,
            "delta": chunk,
        }

        async def _enqueue_chunk() -> None:
            with contextlib.suppress(asyncio.QueueFull):
                queue.put_nowait(evt)

        put_future = asyncio.run_coroutine_threadsafe(_enqueue_chunk(), loop)
        try:
            put_future.result(timeout=0.05)
        except (FutureCancelledError, RuntimeError, TimeoutError):
            put_future.cancel()
            _logger.warning(
                "tool_output_delta drop (consumer slow) — command output may be truncated in the UI"
            )

    def producer() -> None:
        nonlocal producer_failure
        # ``asyncio.to_thread`` copies ContextVars from the calling
        # task, so installing the cancellation scope here makes the
        # token visible to every subprocess call downstream.
        from runtime.execution.request import current_execution_request
        from runtime.memory.journal.journal_context import journal_context
        from runtime.platform.process.session import Session, current_session, session_scope

        session_metadata = dict(intent.user_context or {})
        _apply_react_session_metadata(session_metadata, runtime._stack, provider)
        shared_request = current_execution_request()
        host_session = current_session()
        if (
            shared_request is not None
            and shared_request.task.task_id == turn.id
            and host_session is not None
        ):
            # Preserve the authenticated parent and shared write coordination
            # across verification/repair producer threads. Engine-private
            # context is never copied into ParsedIntent or the event log.
            session_metadata.update(host_session.metadata)
        # Prompt guidance is not a sufficient mutation boundary. Derive a
        # private, server-owned read-only marker from the actual turn goal so
        # the executor and delegated children fail closed even when a model
        # emits a write call during a diagnostic/read-only request.
        from runtime.core.cerebrum.react_explicit_reads import _explicit_read_only_goal
        from runtime.core.cerebrum.todo_protocol import _is_read_only_analysis_goal

        _turn_goal = str(intent.normalized_goal or intent.raw or "")
        if _explicit_read_only_goal(_turn_goal) or _is_read_only_analysis_goal(_turn_goal):
            session_metadata["_read_only_turn_enforced"] = True
        # Sub-agents spawned inside the turn (run_orchestration fan-out,
        # call_agent_parallel, ...) mirror their lifecycle/tool events onto
        # the journal ONLY when the bound Session carries one
        # (see _ephemeral_events._emit_subagent_lifecycle_event). The
        # realtime WS is not a journal subscriber, so this injection is what
        # lets the per-turn bridge below lift those events onto the workbench.
        _stack_journal = getattr(getattr(runtime, "_stack", None), "journal", None)
        if _stack_journal is not None:
            session_metadata.setdefault("journal", _stack_journal)
        if runtime._workspaces is not None:
            session_metadata["_artifact_output_root"] = str(
                runtime._workspaces.layout(turn.thread_id).final,
            )
        if runtime._trace_store is not None:
            session_metadata["_trace_store"] = runtime._trace_store
        session_agent = agent if hasattr(agent, "agent_id") else None
        _journal_tenant_id = str(session_metadata.get("tenant_id") or "").strip() or None
        _journal_owner_actor_id = str(session_metadata.get("owner_actor_id") or "").strip() or None
        turn_session = Session(
            actor=shared_request.task.actor_id
            if shared_request is not None
            else getattr(intent, "actor", None) or _journal_owner_actor_id,
            agent=session_agent,
            thread_id=turn.thread_id,
            conversation_id=turn.thread_id,
            turn_id=turn.id,
            metadata=session_metadata,
        )
        # journal_context drives a SEPARATE contextvar that journal
        # write_* methods read for conversation_id/agent_id; without
        # it every journal/trace row lands with thread_id=None.
        # session_scope alone does not feed it.
        _journal_agent_id = getattr(session_agent, "agent_id", None)
        from runtime.execution.suckers.delegation_skills import (
            orchestration_progress_scope,
            workflow_settlement_scope,
        )

        def _orchestration_progress(line: str) -> None:
            _safe_put({"type": "thinking_delta", "delta": line + "\n"})

        def _workflow_settlement(payload: dict) -> None:
            """Handle workflow completion and emit notification to client."""
            try:
                from runtime.protocol import ServerMethod

                # Build notification payload
                notification_payload = {
                    "threadId": turn.thread_id,
                    "workflowName": payload.get("workflowName", "workflow"),
                    "workflowDescription": payload.get("workflowDescription", ""),
                    "runId": payload.get("runId", ""),
                    "stopReason": payload.get("stopReason", "unknown"),
                    "success": payload.get("success", False),
                    "agentsStarted": payload.get("agentsStarted", 0),
                    "error": payload.get("error"),
                }

                # Schedule notification on the event loop (emitter.notify is async)
                import asyncio

                asyncio.create_task(
                    emitter.notify(
                        ServerMethod.WORKFLOW_COMPLETED,
                        notification_payload,
                    )
                )
            except Exception:  # noqa: BLE001 — notification is best-effort
                pass

        with (
            session_scope(turn_session),
            journal_context(
                conversation_id=turn.thread_id,
                agent_id=_journal_agent_id,
                tenant_id=_journal_tenant_id,
                owner_actor_id=_journal_owner_actor_id,
            ),
            scoped_cancellation(cancel_source.token),
            orchestration_progress_scope(_orchestration_progress),
            workflow_settlement_scope(_workflow_settlement),
            react_stack_scope(runtime._stack),
        ):
            # Per-turn sub-agent lifecycle bridge. Launched once the react
            # boot yields ``react_started`` — the task_id it carries is the
            # only reliable key for the journal events sub-agents mirror.
            unsubscribe_lifecycle: Callable[[], None] | None = None
            try:
                _planning_mode = bool(
                    (intent.user_context or {}).get("planning_mode", False),
                )
                if _should_use_native_tool_loop(
                    runtime._stack,
                    intent,
                    planning_mode=_planning_mode,
                    model=model,
                ):
                    from runtime.sensing.gateway.tool_bridge import (
                        stream_agentic_fallback,
                    )

                    for kind, delta, final in stream_agentic_fallback(
                        runtime._stack,
                        intent,
                        agent,
                        model=model,
                        steering_drain=lambda: runtime._drain_turn_steering(turn.id),
                    ):
                        evt = _agentic_stream_event_to_react_event(
                            kind,
                            delta,
                            final,
                        )
                        if evt is not None:
                            _safe_put(evt)
                else:
                    _resume_task_id = _resume_task_id_from_intent(intent)

                    def _on_auto_parallel_batch(batch_id: str) -> None:
                        # The auto-parallel short-circuit (running on the
                        # producer thread) dispatched a parallel batch. Hop
                        # back to the event loop and start the orchestrator
                        # bridge so the workbench renders each sub-task as a
                        # live tile immediately.
                        async def _spawn() -> None:
                            _start_orchestrator_bridge(runtime, turn, log, emitter, batch_id)

                        with contextlib.suppress(RuntimeError):
                            asyncio.run_coroutine_threadsafe(_spawn(), loop)

                    budget_kwargs: _ReactBudgetKwargs = {}
                    if shared_request is not None:
                        budget_kwargs = {
                            "max_tokens_budget": shared_request.task.resources.token_target,
                            "max_usd_budget": shared_request.task.resources.usd_target,
                        }
                    events: Iterator[dict[str, Any]] = stream_react_loop(
                        runtime._stack,
                        intent,
                        agent,
                        thread_id=turn.thread_id,
                        max_iterations=runtime._max_iterations,
                        resume_task_id=_resume_task_id,
                        approval_provider=provider,
                        output_chunk_sink=_push_chunk,
                        step_evaluator=build_runtime_step_evaluator(),
                        planning_mode=_planning_mode,
                        model=model,
                        reasoning_effort=(
                            (intent.user_context or {}).get("reasoning_effort")
                            or default_reasoning_effort(model)
                        ),
                        steering_drain=lambda: runtime._drain_turn_steering(turn.id),
                        on_auto_parallel_batch=_on_auto_parallel_batch,
                        **budget_kwargs,
                    )
                    for evt in events:
                        if (
                            isinstance(evt, dict)
                            and evt.get("type") == "react_started"
                            and unsubscribe_lifecycle is None
                        ):
                            _react_task_id = str(evt.get("task_id") or "").strip()
                            if _react_task_id:
                                # Stamp task_id onto the session so sub-agent
                                # journal events carry it (they read
                                # session.metadata, and the react boot
                                # generates the id after this session was
                                # created).
                                with contextlib.suppress(Exception):
                                    turn_session.metadata["task_id"] = _react_task_id
                                unsubscribe_lifecycle = _start_subagent_lifecycle_bridge(
                                    runtime,
                                    turn,
                                    log,
                                    emitter,
                                    loop,
                                    _react_task_id,
                                )
                        _safe_put(evt)
            except Exception as exc:
                producer_failure = exc
                # The queue may be the very resource that failed. Keep the
                # exception in shared control-plane state above, then make a
                # best effort to publish the ordinary react_error event. The
                # consumer converts the shared failure to an explicit failed
                # turn after it drains all events that did make it through.
                with contextlib.suppress(Exception):
                    _safe_put(
                        {
                            "type": "react_error",
                            "kind": exc.__class__.__name__,
                            "message": _safe_stream_error_message(exc),
                        }
                    )
            finally:
                if unsubscribe_lifecycle is not None:
                    with contextlib.suppress(Exception):
                        unsubscribe_lifecycle()
                # Completion cannot be a capacity-bound queue sentinel: signal
                # it independently, then let the consumer drain the queue.
                with contextlib.suppress(RuntimeError):
                    loop.call_soon_threadsafe(producer_done.set)

    worker = asyncio.create_task(asyncio.to_thread(producer))
    state = runtime._make_bridge_state(turn.thread_id, turn.id, agent=agent)

    async def _interrupt_watcher() -> None:
        # Polls the gateway's interrupt registry. Consumer-side polling
        # alone isn't enough: if the producer is blocked inside a long
        # subprocess.wait, no events reach the queue and the consumer
        # never wakes to notice. This task trips cancellation the
        # instant the flag flips, unblocking the subprocess wait via
        # current_cancellation_token() inside stream_run.
        try:
            while not cancel_source.is_cancelled:
                if emitter.is_turn_interrupted(turn.id):
                    interrupt_requested.set()
                    cancel_source.cancel(reason="user interrupted turn")
                    return
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            return

    watcher = asyncio.create_task(_interrupt_watcher())

    # ── Supervisor lease renewal ─────────────────────────────────
    # The realtime react loop (unlike the execution/loops controller
    # path) never renews its TaskSupervisor lease. A turn that outlives
    # the default 300s TTL fails at finish with "lease is no longer
    # current" and stays a zombie "running" task. Heartbeat from the
    # consumer loop (throttled to lease_ttl/3, matching the loops path)
    # keeps the lease alive for long tasks and still lets them
    # terminate cleanly.
    supervisor = getattr(runtime, "_task_supervisor", None)
    _last_supervisor_heartbeat = time.monotonic()
    _supervisor_heartbeat_interval = 0.0
    if supervisor is not None:
        try:
            _supervisor_heartbeat_interval = _lease_renewal_interval_s(
                float(supervisor.lease_ttl_seconds)
            )
        except Exception:  # noqa: BLE001 — malformed supervisor; skip renewal
            _supervisor_heartbeat_interval = 0.0

    def _supervisor_heartbeat_if_due(now: float) -> None:
        nonlocal _last_supervisor_heartbeat
        if (
            supervisor is None
            or _supervisor_heartbeat_interval <= 0.0
            or now - _last_supervisor_heartbeat < _supervisor_heartbeat_interval
        ):
            return
        task_id = turn.task_id or ""
        if not task_id:
            # react_started not seen yet — nothing registered to renew.
            return
        _last_supervisor_heartbeat = now
        try:
            supervisor.heartbeat(task_id)
        except Exception as exc:  # noqa: BLE001 — lease lost/revoked; abort turn
            _logger.warning(
                "react supervisor heartbeat failed for %s: %s — cancelling turn",
                task_id,
                exc,
            )
            if not cancel_source.is_cancelled:
                cancel_source.cancel(reason="task supervisor lease lost")

    saw_terminal_event = False
    structural_apply_failure: dict[str, Any] | None = None
    user_interrupt_terminal = False

    def _mark_user_interrupted_turn() -> None:
        nonlocal user_interrupt_terminal
        user_interrupt_terminal = True
        if not cancel_source.is_cancelled:
            cancel_source.cancel(reason="user interrupted turn")
        turn.status = TurnStatus.CANCELLED
        turn.outcome_reason = "user_cancelled"
        if not turn.interrupt_reason:
            with contextlib.suppress(Exception):
                reason = emitter.get_interrupt_reason(turn.id)
                if reason:
                    turn.interrupt_reason = reason

    producer_done_waiter = asyncio.create_task(producer_done.wait())
    interrupt_waiter = asyncio.create_task(interrupt_requested.wait())
    queue_getter: asyncio.Task[_QueuedReactEvent | dict[str, Any]] | None = None
    try:
        loop_started = time.monotonic()
        while True:
            _supervisor_heartbeat_if_due(time.monotonic())
            if producer_done.is_set() and queue.empty():
                break
            queue_getter = asyncio.create_task(queue.get())
            ready, _pending = await asyncio.wait(
                {queue_getter, producer_done_waiter, interrupt_waiter},
                timeout=_SINGLE_AGENT_HEARTBEAT_INTERVAL_S,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if interrupt_waiter in ready:
                queue_getter.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await queue_getter
                _mark_user_interrupted_turn()
                # Do not wait for a provider iterator that is stuck before its
                # first byte. The finally block gives cooperative producers a
                # short drain window, then detaches them safely.
                break
            if queue_getter in ready:
                queued = queue_getter.result()
            elif producer_done_waiter in ready:
                # Done is set after all producer puts settle. Drain anything
                # already queued; an empty queue is now terminal.
                if queue.empty():
                    queue_getter.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await queue_getter
                    break
                queued = await queue_getter
            else:
                queue_getter.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await queue_getter
                # No event for a while: the model is thinking or a tool is
                # running silently. Emit a keepalive (unless the turn is
                # already winding down) so the frontend reads "working",
                # not "stuck", then keep waiting.
                if not (cancel_source.is_cancelled or emitter.is_turn_interrupted(turn.id)):
                    await runtime._publish_discovered_steering(turn, emitter)
                    await _emit_turn_heartbeat(emitter, turn, loop_started)
                continue
            if isinstance(queued, _QueuedReactEvent):
                evt = queued.event
                apply_receipt = queued.applied
            else:
                evt = queued
                apply_receipt = None
            await runtime._publish_discovered_steering(turn, emitter)
            event_kind = str(evt.get("type") or "")
            if emitter.is_turn_interrupted(turn.id):
                _settle_apply_receipt(
                    apply_receipt,
                    error=_ToolStartAuditError(
                        "tool_start was skipped because the turn was interrupted"
                    ),
                )
                _mark_user_interrupted_turn()
                # The turn's control-plane terminal state must not wait for a
                # silent provider. Teardown below drains queued receipts and
                # closes the consumer boundary before detaching if needed.
                break
            try:
                await _apply_react_event(runtime, turn, log, emitter, state, evt)
            except asyncio.CancelledError:
                _settle_apply_receipt(
                    apply_receipt,
                    error=_ToolStartAuditError(
                        "tool_start apply was cancelled before the audit boundary"
                    ),
                )
                raise
            except Exception as exc:  # noqa: BLE001
                _settle_apply_receipt(apply_receipt, error=exc)
                if event_kind in _CRITICAL_STRUCTURAL_EVENT_TYPES:
                    cancel_source.cancel(reason=f"critical {event_kind} reducer apply failed")
                    if structural_apply_failure is None:
                        structural_apply_failure = {
                            "code": "react_structural_event_apply_failed",
                            "message": _safe_stream_error_message(exc),
                            "event_type": event_kind,
                            "exception_type": exc.__class__.__name__,
                        }
                    turn.status = TurnStatus.FAILED
                    turn.outcome_reason = "react_structural_event_apply_failed"
                    turn.error = dict(structural_apply_failure)
                # A single bad event shouldn't kill the dispatch
                # loop. Critical lifecycle failures still mark the turn
                # failed and cancel production above; draining lets queued
                # receipts close without converting that failure to success.
                _logger.warning(
                    "react event apply failed (kind=%s): %s",
                    evt.get("type") if isinstance(evt, dict) else "?",
                    exc,
                    exc_info=True,
                )
            else:
                if event_kind in _TERMINAL_REACT_EVENT_TYPES:
                    saw_terminal_event = True
                if apply_receipt is not None and (
                    cancel_source.is_cancelled or emitter.is_turn_interrupted(turn.id)
                ):
                    _settle_apply_receipt(
                        apply_receipt,
                        error=_ToolStartAuditError(
                            "tool_start was durably recorded but execution was cancelled"
                        ),
                    )
                else:
                    _settle_apply_receipt(apply_receipt)
    finally:
        # Trip cancellation so the producer THREAD (asyncio.to_thread)
        # observes it and bails — task cancellation alone can't stop a
        # real OS thread. Since audit T-01 the consumer only tears down
        # when the turn genuinely ends (terminal event, explicit
        # interrupt, or supervisor lease loss) — a dropped WebSocket no
        # longer reaches this path; the turn runs on server-side.
        cancel_source.cancel(reason="consumer teardown")
        consumer_closed.set()
        if queue_getter is not None and not queue_getter.done():
            queue_getter.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await queue_getter
        if not producer_done_waiter.done():
            producer_done_waiter.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await producer_done_waiter
        if not interrupt_waiter.done():
            interrupt_waiter.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await interrupt_waiter
        # Reject receipts before awaiting the worker so teardown cannot
        # advance a stranded tool_start into its side effect.
        with pending_apply_receipts_lock:
            teardown_receipts = tuple(pending_apply_receipts)
        for receipt in teardown_receipts:
            _settle_apply_receipt(
                receipt,
                error=_ToolStartAuditError("tool_start skipped during consumer teardown"),
            )
        while True:
            try:
                abandoned = queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            if isinstance(abandoned, _QueuedReactEvent):
                _settle_apply_receipt(
                    abandoned.applied,
                    error=_ToolStartAuditError("tool_start skipped during consumer teardown"),
                )
        watcher.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await watcher
        if user_interrupt_terminal and not worker.done():
            try:
                await asyncio.wait_for(
                    asyncio.shield(worker),
                    timeout=_INTERRUPT_PRODUCER_DRAIN_TIMEOUT_S,
                )
            except TimeoutError:
                # ``asyncio.to_thread`` cannot kill the underlying OS thread.
                # Leave its wrapper detached so the provider can still unwind
                # and release the executor thread. The cancellation token plus
                # ``consumer_closed`` keep the late producer from publishing
                # output or starting a tool. Retrieve the eventual result to
                # avoid a detached-task exception warning.
                _logger.warning(
                    "react producer did not drain within %.2fs after interrupt; detaching it",
                    _INTERRUPT_PRODUCER_DRAIN_TIMEOUT_S,
                )

                def _consume_detached_worker_result(task: asyncio.Task[Any]) -> None:
                    with contextlib.suppress(asyncio.CancelledError, Exception):
                        task.result()

                worker.add_done_callback(_consume_detached_worker_result)
            except Exception:  # noqa: BLE001 - producer records its own failure
                pass
        else:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await worker
        # Cancel any live orchestrator bridges for this turn. Each bridge
        # subscribes to a parallel batch that already terminated (the loop
        # consumed its synthetic observation), so leaving them running would
        # only leak tasks idling until batch GC.
        bridge_tasks: set[asyncio.Task] = getattr(runtime, "_orchestrator_bridge_tasks", set())
        for task in list(bridge_tasks):
            task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.gather(*bridge_tasks, return_exceptions=True)

    # Finalize anything still open. Wrapped in suppress so a torn-
    # down ws doesn't take the whole turn-completion path with it.
    if structural_apply_failure is not None:
        # A later drained pause/cancel cannot mask the audit failure.
        turn.status = TurnStatus.FAILED
        turn.outcome_reason = "react_structural_event_apply_failed"
        turn.error = dict(structural_apply_failure)
    if producer_failure is not None and turn.status == TurnStatus.IN_PROGRESS:
        structural_delivery_failure = isinstance(
            producer_failure,
            _ReactStructuralDeliveryError,
        )
        failure_code = (
            "react_structural_event_delivery_failed"
            if structural_delivery_failure
            else "react_producer_failed"
        )
        turn.status = TurnStatus.FAILED
        turn.outcome_reason = failure_code
        turn.error = {
            "code": failure_code,
            "message": _safe_stream_error_message(producer_failure),
            "exception_type": producer_failure.__class__.__name__,
        }
    if not saw_terminal_event and turn.status == TurnStatus.IN_PROGRESS:
        answer_text = (
            str(state.agent_message.text or "").strip() if state.agent_message is not None else ""
        )
        if answer_text:
            # Some provider adapters finish after yielding the complete
            # text_delta stream but omit the trailing react_completed event.
            # The answer item is already user-visible and is stronger terminal
            # evidence than the generator's empty return value; finalize it as
            # success instead of appending a contradictory error card.
            await _apply_react_event(
                runtime,
                turn,
                log,
                emitter,
                state,
                {"type": "react_completed", "recovered_from_text": True},
            )
        else:
            # A generator that returns ``None`` without a terminal event used
            # to make any earlier tool/commentary item count as a successful
            # turn, leaving the user with progress fragments and no final
            # answer. Fail explicitly while preserving those fragments for a
            # later Continue.
            await _apply_react_event(
                runtime,
                turn,
                log,
                emitter,
                state,
                {
                    "type": "react_error",
                    "kind": "missing_terminal_answer",
                    "message": (
                        "模型执行已结束，但没有生成可确认的最终答案。阶段进度已保留；"
                        "请点击继续重新收敛，或切换模型后重试。"
                    ),
                },
            )
    with contextlib.suppress(Exception):
        await state.flush(
            turn,
            log,
            emitter,
            status=state.prose_status_for_turn(turn.status),
        )
    # Every terminal path must settle the workbench. Previously only the
    # implicit-success path reached this call; producer/audit failures left the
    # sidebar at "0/4 running" even though the turn had already failed.
    with contextlib.suppress(Exception):
        await state.finalize_workbench(
            turn,
            log,
            emitter,
            terminal_status=(
                TurnStatus.COMPLETED if turn.status == TurnStatus.IN_PROGRESS else turn.status
            ),
        )
