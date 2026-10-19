"""Background scheduler registrations for ``echo-ai serve``.

Split out of :mod:`runtime.cli_serve` so that module stays under the 1000-line
god-file ratchet. Every function here takes the runner (and, for intel, the
stack) and registers one periodic job; none of them import at module scope
beyond ``os``/``logging``, so this file has no runtime cost of its own.

``runtime.cli_serve`` re-exports all of them: tests and ``run_serve`` import
these names from there, and the split must not move the import site.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from typing import Any


def register_intel_task(
    runner: Any,
    src: Any,
    stack: Any,
) -> int:
    """Register one static IntelSourceConfig item with the scheduler."""
    from runtime.safety.recovery import IntelCollector, IntelSource

    if not stack.registry.has("web_search"):
        return 0

    source = IntelSource(
        source_id=src.source_id,
        query=src.query,
        max_results=src.max_results,
        fetch_top_n=src.fetch_top_n,
    )

    def _tick() -> None:
        IntelCollector(
            sources=[source],
            journal=stack.journal,
            registry=stack.registry,
        ).run_once()

    runner.add_periodic(
        f"intel_{src.source_id}",
        interval_s=float(src.frequency_seconds),
        callback=_tick,
        jitter_s=min(30.0, src.frequency_seconds * 0.1),
    )
    return 1


def register_intelligence_subscriptions_task(runner: Any) -> int:
    """Schedule UI-created intelligence subscriptions."""

    try:
        interval_s = int(os.environ.get("ECHO_INTELLIGENCE_POLL_SECONDS") or "1800")
    except ValueError:
        interval_s = 1800
    if interval_s <= 0:
        return 0

    def _tick() -> None:
        from runtime.sensing.gateway.intelligence_router import (
            run_enabled_subscriptions_once,
        )

        run_enabled_subscriptions_once(
            due_only=True,
            max_subscriptions=5,
            max_results_per_query=5,
        )

    runner.add_periodic(
        "intelligence_subscriptions",
        interval_s=float(interval_s),
        callback=_tick,
        jitter_s=min(120.0, interval_s * 0.1),
    )
    return 1


def register_memory_distill_task(runner: Any, stack: Any) -> int:
    """Periodically roll memory facts up into the six summary buckets.

    Uses the planner's model router when available (LLM-compressed
    summaries); otherwise the deterministic heuristic path still runs,
    so the buckets fill even in no-LLM deployments. Interval via
    ``ECHO_MEMORY_DISTILL_SECONDS`` (default 3600; <=0 disables).
    """
    try:
        interval_s = int(os.environ.get("ECHO_MEMORY_DISTILL_SECONDS") or "3600")
    except ValueError:
        interval_s = 3600
    if interval_s <= 0:
        return 0

    from runtime.execution.model_services import background_model_router

    router = background_model_router(stack)

    def _tick() -> None:
        from runtime.memory.users.distill import distill_user_memory

        distill_user_memory(router)

    runner.add_periodic(
        "memory_distill",
        interval_s=float(interval_s),
        callback=_tick,
        jitter_s=min(120.0, interval_s * 0.1),
    )
    return 1


def register_cron_executor_task(
    runner: Any,
    channel_manager_holder: list | None = None,
    shutdown_callbacks: list[Callable[[], None]] | None = None,
) -> int:
    """Fire persisted cron jobs (settings-UI shell jobs + schedule_task prompts).

    The store/router/skill only *register* jobs — without this periodic
    tick nothing ever runs them. Env kill-switches:
    ``ECHO_CRON_EXECUTOR=0`` disables outright;
    ``ECHO_CRON_EXECUTOR_POLL_SECONDS`` retunes the poll (default 30s,
    finer than the 1-minute cron resolution so jobs fire ≤30s late).

    ``channel_manager_holder`` is an optional one-element list that gets
    populated with the live ``ChannelManager`` *after* startup wiring, so
    agent-scheduled jobs recorded with a ``channel_id`` / ``thread_id``
    (章鱼助手订阅推送) can push their result back over IM.
    """
    if os.environ.get("ECHO_CRON_EXECUTOR", "1").lower() in ("0", "false", "no"):
        return 0
    try:
        interval_s = int(os.environ.get("ECHO_CRON_EXECUTOR_POLL_SECONDS") or "30")
    except ValueError:
        interval_s = 30
    if interval_s <= 0:
        return 0

    # Audit T-02: reclaim jobs left in-flight by a previous process BEFORE
    # the first tick. The tick skips marked jobs, so without this sweep a
    # crashed job would be stuck "running" forever while its orphaned
    # process group kept executing. Recovery kills the group and stamps
    # last_run so the catch-up tick does not double-fire the job.
    try:
        from runtime.execution.cron_executor import recover_interrupted_cron_jobs

        # Trusted global caller: owned jobs too, or a crashed one stays "running".
        recovered = recover_interrupted_cron_jobs(allow_cross_tenant=True)
        if recovered.get("interrupted"):
            logging.getLogger(__name__).warning(
                "cron recovery: %d job(s) interrupted at startup: %s",
                recovered["interrupted"],
                ", ".join(recovered.get("jobs") or []),
            )
    except Exception:  # noqa: BLE001 — recovery must never block boot
        logging.getLogger(__name__).exception("cron recovery failed at startup")

    def _deliver(record: dict) -> None:
        """Push a finished cron run back to its recorded IM conversation."""
        if not channel_manager_holder:
            return
        cm = (
            channel_manager_holder[0]
            if isinstance(channel_manager_holder, list) and channel_manager_holder
            else None
        )
        if cm is None:
            return
        channel_id = str(record.get("channel_id") or "")
        thread_id = str(record.get("thread_id") or "")
        if not channel_id or not cm.has(channel_id):
            return
        name = str(record.get("name") or "定时任务")
        excerpt = str(record.get("output_excerpt") or "(无输出)")
        status = str(record.get("status") or "")
        text = f"[章鱼助手 · 定时订阅] {name}\n状态：{status}\n{excerpt}"
        try:
            cm.deliver_cron_result(channel_id, thread_id, text)
        except Exception:  # noqa: BLE001 — delivery must never break the cron tick
            logging.getLogger(__name__).exception("cron delivery failed for %r", name)

    # Audit T-11 / R-05: cron subprocess waits (up to the 1800s prompt
    # timeout) must NOT occupy the shared scheduler pool — a long job would
    # block every other periodic task (intel, governance audit, memory
    # distill) for its whole duration. Dispatch each tick to a dedicated
    # cron executor and skip overlapping ticks: the in-flight markers
    # (audit T-02) plus the flock already prevent double-firing, so the
    # scheduler thread only ever does a fast submit.
    import threading as _threading
    from concurrent.futures import ThreadPoolExecutor as _ThreadPoolExecutor

    _cron_pool = _ThreadPoolExecutor(max_workers=2, thread_name_prefix="cron-exec")
    _tick_in_flight = _threading.Event()
    _tick_drained = _threading.Event()
    _tick_drained.set()
    _stopping = _threading.Event()
    _shutdown_lock = _threading.Lock()
    _shutdown_started = False

    def _shutdown() -> None:
        """Stop dispatch and cooperatively terminate an active cron process."""
        nonlocal _shutdown_started
        with _shutdown_lock:
            if _shutdown_started:
                return
            _shutdown_started = True
            _stopping.set()
            _cron_pool.shutdown(wait=False, cancel_futures=True)
        if _tick_in_flight.is_set() and not _tick_drained.wait(timeout=5.0):
            logging.getLogger(__name__).warning(
                "cron executor did not drain within 5s during service shutdown"
            )

    if shutdown_callbacks is not None:
        shutdown_callbacks.append(_shutdown)

    def _tick() -> None:
        if _stopping.is_set() or _tick_in_flight.is_set():
            return  # previous tick still draining; the next poll retries
        from runtime.execution.cron_executor import run_due_cron_jobs

        def _run() -> None:
            try:
                # Trusted global scheduler: without the flag owned jobs never fire.
                run_due_cron_jobs(deliver=_deliver, stop_event=_stopping, allow_cross_tenant=True)
            except Exception:  # noqa: BLE001 — a tick fault must not kill the cron pool
                logging.getLogger(__name__).exception("cron tick failed")

        def _done(_future: Any) -> None:
            _tick_in_flight.clear()
            _tick_drained.set()

        _tick_in_flight.set()
        _tick_drained.clear()
        try:
            future = _cron_pool.submit(_run)
            future.add_done_callback(_done)
        except RuntimeError:
            # Pool shut down while serve is stopping — drop this tick.
            _tick_in_flight.clear()
            _tick_drained.set()

    runner.add_periodic(
        "cron_job_executor",
        interval_s=float(interval_s),
        callback=_tick,
        jitter_s=min(10.0, interval_s * 0.1),
        # Catch up once on startup for jobs missed while the server was
        # down (recurring jobs fire a single catch-up run, one-shots
        # whose fire_at passed fire immediately).
        run_on_start=True,
    )
    return 1


def register_reflection_tasks(
    runner: Any,
    stack: Any,
    interval_s: int,
) -> int:
    """Register the periodic self-improvement tasks for serve mode."""
    from runtime.core.cerebrum import LLMPlanner, StaticPlanner

    count = 0
    jitter = min(30.0, interval_s * 0.05)

    if isinstance(stack.planner, LLMPlanner):

        def _learn_rules() -> None:
            stack.planner.learn_from_journal(stack.journal)

        def _learn_memories() -> None:
            stack.planner.learn_memories_from_journal(stack.journal)

        def _learn_kg() -> None:
            stack.planner.learn_kg_from_journal(stack.journal)

        def _assess_recipe() -> None:
            stack.planner.assess_recipe_from_journal(stack.journal)

        runner.add_periodic(
            "reflect_rules",
            interval_s,
            _learn_rules,
            jitter_s=jitter,
        )
        runner.add_periodic(
            "reflect_memories",
            interval_s,
            _learn_memories,
            jitter_s=jitter,
        )
        runner.add_periodic(
            "reflect_kg",
            interval_s,
            _learn_kg,
            jitter_s=jitter,
        )
        runner.add_periodic(
            "reflect_recipe",
            interval_s,
            _assess_recipe,
            jitter_s=jitter,
        )
        count += 4

    if isinstance(stack.planner, StaticPlanner):

        def _rewrite() -> None:
            stack.planner.rewrite_from_journal(stack.journal)

        runner.add_periodic(
            "reflect_workflow",
            interval_s,
            _rewrite,
            jitter_s=jitter,
        )
        count += 1

    def _forge() -> None:
        from runtime.safety.recovery import ForgeConfig, SkillForge

        SkillForge(
            journal=stack.journal,
            registry=stack.registry,
            config=ForgeConfig(governed_rollout=True),
        ).run()

    runner.add_periodic(
        "reflect_skill_forge",
        interval_s,
        _forge,
        jitter_s=jitter,
    )
    count += 1

    return count
