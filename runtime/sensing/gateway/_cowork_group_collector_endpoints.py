"""Collector retry / cancel / archive endpoints for the cowork router.

Pure structural split of ``cowork_group_router.create_cowork_group_router`` —
no logic changes. The plan helpers that only read their arguments are plain
module functions; the two that touch the shared stores take the
``CoworkGroupDeps`` bundle explicitly.
"""

from __future__ import annotations

import os
from contextlib import suppress
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request

from runtime.memory.cowork.async_work import AsyncWorkQueueFullError

from ._cowork_group_deps import CoworkGroupDeps
from ._cowork_group_models import (
    CollectorBatchArchiveBody,
    CollectorBatchCancelBody,
    CollectorBatchRetryBody,
    CollectorRetryBody,
)


def _collector_retryable_ids(collector: dict[str, Any]) -> list[str]:
    if collector.get("status") == "collecting" or collector.get("archived"):
        return []
    retryable = [
        str(item.get("child_id") or "")
        for item in collector.get("results") or []
        if isinstance(item, dict) and item.get("status") in {"failed", "cancelled"}
    ]
    retryable.extend(str(item) for item in collector.get("cancellation_requested_child_ids") or [])
    return list(dict.fromkeys(item for item in retryable if item))


def _collector_cancel_plan(
    store: Any,
    *,
    thread_id: str,
    run_id: str,
) -> dict[str, Any]:
    try:
        run = store.collaboration_run(run_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if run is None or str(run.get("session_id") or "") != thread_id:
        raise HTTPException(404, "collaboration run not found")
    collector = store.collaboration_collector(run_id)
    if collector is None:
        raise HTTPException(404, "collaboration collector not found")
    return {"run": run, "collector": collector}


def _cancel_collector_plans(
    d: CoworkGroupDeps,
    *,
    thread_id: str,
    plans: list[dict[str, Any]],
    reason: str,
) -> dict[str, Any]:
    """Stop active collector generations and fence their late results."""
    _collaboration_store = d.collaboration_store
    _async_store = d.async_store

    store = _collaboration_store()
    async_tasks = _async_store()
    reason = str(reason or "collaboration cancelled by user").strip()[:1000]
    if not reason:
        reason = "collaboration cancelled by user"
    task_ids: list[str] = []
    for plan in plans:
        collector = plan["collector"]
        if collector.get("status") != "collecting":
            continue
        generation = int(collector.get("generation") or 1)
        bindings = store.collaboration_collector_retry_tasks(
            str(plan["run"]["run_id"]),
            generation=generation,
        )
        task_ids.extend(str(binding["task_id"]) for binding in bindings)

    # Cancel background rows before settling collectors. This makes the
    # async task status a durable fence, so provider responses that arrive
    # late cannot write to the blackboard or collector observer.
    cancelled_task_count = async_tasks.cancel_batch(task_ids, reason=reason)
    cancelled_run_ids: list[str] = []
    collectors: list[dict[str, Any]] = []
    for plan in plans:
        run = plan["run"]
        collector = plan["collector"]
        run_id = str(run["run_id"])
        if collector.get("status") == "collecting":
            collector = store.close_collaboration_collector(
                run_id,
                status="cancelled",
                reason=reason,
            )
            cancelled_run_ids.append(run_id)
        if str(run.get("status") or "") in {
            "queued",
            "running",
            "waiting",
            "interrupted",
        }:
            run = store.transition_collaboration_run(
                run_id,
                status="cancelled",
                error=reason,
                event_type="cancelled_by_user",
                payload={"reason": reason},
            )
        collectors.append(
            {
                "run_id": run_id,
                "run_status": run.get("status"),
                "collector": collector,
            }
        )
    return {
        "ok": True,
        "thread_id": thread_id,
        "cancelled_run_ids": cancelled_run_ids,
        "cancelled_run_count": len(cancelled_run_ids),
        "cancelled_task_count": cancelled_task_count,
        "collectors": collectors,
        "queue": async_tasks.queue_health(thread_id),
    }


def _collector_retry_plan(
    store: Any,
    *,
    thread_id: str,
    run_id: str,
    requested_child_ids: list[str] | None = None,
) -> dict[str, Any]:
    try:
        run = store.collaboration_run(run_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if run is None or str(run.get("session_id") or "") != thread_id:
        raise HTTPException(404, "collaboration run not found")
    original = run.get("input") if isinstance(run.get("input"), dict) else {}
    message = str(original.get("message") or original.get("objective") or "").strip()
    if not message:
        raise HTTPException(409, "collaboration run has no retryable task brief")
    current = store.collaboration_collector(run_id)
    if current is None:
        raise HTTPException(404, "collaboration collector not found")
    retryable = _collector_retryable_ids(current)
    retrying = list(dict.fromkeys(requested_child_ids)) if requested_child_ids else retryable
    unknown = [
        child_id for child_id in retrying if child_id not in current.get("expected_child_ids", [])
    ]
    if unknown:
        raise HTTPException(
            409,
            f"child_id is not registered with this collector: {unknown[0]}",
        )
    not_retryable = [child_id for child_id in retrying if child_id not in retryable]
    if not_retryable:
        raise HTTPException(
            409,
            f"child_id already has a successful result: {not_retryable[0]}",
        )
    if not retrying:
        raise HTTPException(409, "collector has no failed or cancelled children to retry")
    previous = {
        str(item.get("child_id") or ""): item
        for item in current.get("results") or []
        if isinstance(item, dict)
    }
    return {
        "run_id": run_id,
        "message": message,
        "retrying": retrying,
        "previous": previous,
    }


def _dispatch_collector_retry_plans(
    d: CoworkGroupDeps,
    *,
    thread_id: str,
    plans: list[dict[str, Any]],
    actor: str,
) -> dict[str, Any]:
    runtime = d.runtime
    _collaboration_store = d.collaboration_store
    _async_store = d.async_store
    runner = getattr(runtime, "runner", None)
    if runner is None:
        raise HTTPException(503, "background cowork runner is not available")
    store = _collaboration_store()
    async_tasks = _async_store()
    bindings: list[dict[str, str]] = []
    staged_specs: list[tuple[str, str, str]] = []
    for plan in plans:
        run_id = str(plan["run_id"])
        message = str(plan["message"])
        previous = plan["previous"]
        for child_id in plan["retrying"]:
            prior = previous.get(str(child_id), {})
            raw_prior_result = prior.get("result")
            prior_result: dict[str, Any] = (
                raw_prior_result if isinstance(raw_prior_result, dict) else {}
            )
            reason = str(prior_result.get("error") or prior.get("status") or "未完成")[:1000]
            prompt = (
                "你正在重试一个多人协作中的定向子任务。\n"
                f"原始请求：{message}\n"
                f"上次未通过原因：{reason}\n"
                "请直接完成与自己角色相关的部分，给出本轮已经得到的结果和必要依据；"
                "不要承诺稍后处理，也不要复述重试说明。"
            )
            task_id = f"collector-retry:{uuid4().hex}"
            bindings.append({"task_id": task_id, "run_id": run_id, "child_id": str(child_id)})
            staged_specs.append((task_id, str(child_id), prompt))
    try:
        staged_tasks = async_tasks.stage_batch(
            thread_id,
            staged_specs,
            actor=actor,
        )
    except AsyncWorkQueueFullError as exc:
        raise HTTPException(
            429,
            {
                "code": "COWORK_QUEUE_FULL",
                "message": "background collaboration queue is at capacity",
                "requested": exc.requested,
                "queue": exc.health,
            },
        ) from exc

    task_ids = [task.task_id for task in staged_tasks]
    reopened: list[tuple[dict[str, Any], dict[str, Any]]] = []
    try:
        for binding in bindings:
            store.bind_collaboration_collector_retry_task(
                binding["run_id"],
                child_id=binding["child_id"],
                task_id=binding["task_id"],
            )
        for plan in plans:
            collector = store.reopen_collaboration_collector(
                plan["run_id"],
                child_ids=plan["retrying"],
            )
            reopened.append((plan, collector))
        activated = async_tasks.activate_staged(task_ids)
        if activated != len(staged_tasks):
            raise RuntimeError("collector retry batch activation was not atomic")
    except Exception as exc:  # noqa: BLE001 - settle every reopened lane on dispatch failure
        discarded = async_tasks.discard_staged(task_ids)
        if discarded == len(task_ids):
            with suppress(Exception):
                store.discard_collaboration_collector_retry_tasks(task_ids)
        for plan, collector in reopened:
            generation = int(collector.get("generation") or 0)
            for child_id in plan["retrying"]:
                with suppress(Exception):
                    store.record_collaboration_collector_result(
                        plan["run_id"],
                        child_id=child_id,
                        status="failed",
                        result={"error": f"retry dispatch failed: {type(exc).__name__}"},
                        expected_generation=generation,
                    )
        status_code = 409 if isinstance(exc, (KeyError, ValueError)) else 500
        raise HTTPException(status_code, str(exc)) from exc

    binding_by_task = {binding["task_id"]: binding for binding in bindings}
    tasks = [
        {
            **task.to_dict(),
            **binding_by_task[task.task_id],
            "status": "pending",
        }
        for task in staged_tasks
    ]
    wake = getattr(runner, "wake", None)
    if callable(wake):
        wake()
    return {
        "ok": True,
        "thread_id": thread_id,
        "collectors": [store.collaboration_collector(str(plan["run_id"])) for plan in plans],
        "tasks": tasks,
        "count": len(tasks),
        "run_count": len(plans),
        "queue": async_tasks.queue_health(thread_id),
    }


def _register_collector_retry(router: APIRouter, d: CoworkGroupDeps) -> None:
    """Cross-run collector view plus single-run and batch retry."""
    group_store = d.group_store
    _collaboration_store = d.collaboration_store
    _async_store = d.async_store
    _require_room_member = d.require_room_member
    _actor = d.actor
    _auth_dep = d.auth_dep

    @router.get("/api/collab/{thread_id}/collectors")
    def list_collaboration_collectors(
        thread_id: str,
        request: Request,
        retryable_only: bool = False,
        include_archived: bool = False,
        limit: int = 100,
    ) -> dict[str, Any]:
        """Cross-run collector operations view for long-lived projects."""

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        store = _collaboration_store()
        # Reads remain available when an operator supplied a malformed value;
        # startup applies the validated fallback policy separately.
        with suppress(TypeError, ValueError):
            store.apply_collaboration_collector_retention(
                session_id=thread_id,
                ttl_seconds=max(
                    0,
                    int(
                        os.environ.get(
                            "ECHO_COWORK_COLLECTOR_RETENTION_SECONDS",
                            str(90 * 24 * 60 * 60),
                        )
                    ),
                ),
                max_collectors_per_session=max(
                    0,
                    int(os.environ.get("ECHO_COWORK_COLLECTOR_RETENTION_COUNT", "1000")),
                ),
            )
        try:
            runs = store.collaboration_runs_for_session(
                thread_id,
                limit=max(1, min(100, limit)),
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        items = []
        for run in runs:
            collector = store.collaboration_collector(str(run["run_id"]))
            if collector is None:
                continue
            if collector.get("archived") and not include_archived:
                continue
            retryable_ids = _collector_retryable_ids(collector)
            if retryable_only and not retryable_ids:
                continue
            items.append(
                {
                    "run_id": run["run_id"],
                    "run_status": run["status"],
                    "updated_at": run["updated_at"],
                    "retryable_child_ids": retryable_ids,
                    "collector": collector,
                }
            )
        return {
            "thread_id": thread_id,
            "collectors": items,
            "count": len(items),
            "retryable_run_count": sum(bool(item["retryable_child_ids"]) for item in items),
            "cancellable_run_count": sum(
                item["collector"].get("status") == "collecting" for item in items
            ),
            "archived_run_count": sum(bool(item["collector"].get("archived")) for item in items),
            "queue": _async_store().queue_health(thread_id),
        }

    @router.post(
        "/api/collab/{thread_id}/runs/{run_id}/collector/retry",
        dependencies=[Depends(_auth_dep)],
    )
    def retry_collaboration_collector(
        thread_id: str,
        run_id: str,
        body: CollectorRetryBody,
        request: Request,
    ) -> dict[str, Any]:
        """Re-dispatch selected failed lanes through the durable cowork queue."""

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        store = _collaboration_store()
        plan = _collector_retry_plan(
            store,
            thread_id=thread_id,
            run_id=run_id,
            requested_child_ids=body.child_ids,
        )
        result = _dispatch_collector_retry_plans(
            d,
            thread_id=thread_id,
            plans=[plan],
            actor=_actor(request),
        )
        result["collector"] = result["collectors"][0]
        return result

    @router.post(
        "/api/collab/{thread_id}/collectors/retry",
        dependencies=[Depends(_auth_dep)],
    )
    def retry_collaboration_collectors(
        thread_id: str,
        body: CollectorBatchRetryBody,
        request: Request,
    ) -> dict[str, Any]:
        """Atomically reserve and retry failed lanes across collaboration runs."""

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        store = _collaboration_store()
        run_ids = list(dict.fromkeys(body.run_ids))
        if not run_ids:
            runs = store.collaboration_runs_for_session(thread_id, limit=100)
            run_ids = [
                str(run["run_id"])
                for run in runs
                if (
                    (collector := store.collaboration_collector(str(run["run_id"]))) is not None
                    and _collector_retryable_ids(collector)
                )
            ]
        if not run_ids:
            raise HTTPException(409, "no failed collaboration collectors to retry")
        plans = [
            _collector_retry_plan(store, thread_id=thread_id, run_id=run_id) for run_id in run_ids
        ]
        return _dispatch_collector_retry_plans(
            d,
            thread_id=thread_id,
            plans=plans,
            actor=_actor(request),
        )


def _register_collector_cancel(router: APIRouter, d: CoworkGroupDeps) -> None:
    """Single-run and batch cancel, plus archive of terminal collectors."""
    group_store = d.group_store
    _collaboration_store = d.collaboration_store
    _async_store = d.async_store
    _require_room_member = d.require_room_member
    _auth_dep = d.auth_dep

    @router.post(
        "/api/collab/{thread_id}/runs/{run_id}/collector/cancel",
        dependencies=[Depends(_auth_dep)],
    )
    def cancel_collaboration_collector(
        thread_id: str,
        run_id: str,
        body: CollectorBatchCancelBody,
        request: Request,
    ) -> dict[str, Any]:
        """Stop one collector generation; repeated calls are idempotent."""

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        result = _cancel_collector_plans(
            d,
            thread_id=thread_id,
            plans=[
                _collector_cancel_plan(
                    _collaboration_store(),
                    thread_id=thread_id,
                    run_id=run_id,
                )
            ],
            reason=body.reason,
        )
        result["collector"] = result["collectors"][0]["collector"]
        return result

    @router.post(
        "/api/collab/{thread_id}/collectors/cancel",
        dependencies=[Depends(_auth_dep)],
    )
    def cancel_collaboration_collectors(
        thread_id: str,
        body: CollectorBatchCancelBody,
        request: Request,
    ) -> dict[str, Any]:
        """Stop selected active collector generations across a long project."""

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        store = _collaboration_store()
        run_ids = list(dict.fromkeys(body.run_ids))
        if not run_ids:
            run_ids = [
                str(run["run_id"])
                for run in store.collaboration_runs_for_session(thread_id, limit=100)
                if (
                    (collector := store.collaboration_collector(str(run["run_id"]))) is not None
                    and collector.get("status") == "collecting"
                )
            ]
        if not run_ids:
            return {
                "ok": True,
                "thread_id": thread_id,
                "cancelled_run_ids": [],
                "cancelled_run_count": 0,
                "cancelled_task_count": 0,
                "collectors": [],
                "queue": _async_store().queue_health(thread_id),
            }
        plans = [
            _collector_cancel_plan(store, thread_id=thread_id, run_id=run_id) for run_id in run_ids
        ]
        return _cancel_collector_plans(
            d,
            thread_id=thread_id,
            plans=plans,
            reason=body.reason,
        )

    @router.post(
        "/api/collab/{thread_id}/collectors/archive",
        dependencies=[Depends(_auth_dep)],
    )
    def archive_collaboration_collectors(
        thread_id: str,
        body: CollectorBatchArchiveBody,
        request: Request,
    ) -> dict[str, Any]:
        """Compact selected terminal collectors while retaining audit metadata."""

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        store = _collaboration_store()
        run_ids = list(dict.fromkeys(body.run_ids))
        plans = [
            _collector_cancel_plan(store, thread_id=thread_id, run_id=run_id) for run_id in run_ids
        ]
        active = [
            str(plan["run"]["run_id"])
            for plan in plans
            if plan["collector"].get("status") == "collecting"
        ]
        if active:
            raise HTTPException(
                409, f"active collaboration collector cannot be archived: {active[0]}"
            )
        previously_archived = sum(bool(plan["collector"].get("archived")) for plan in plans)
        try:
            collectors = store.archive_collaboration_collectors(
                run_ids,
                reason=body.reason,
            )
        except (KeyError, ValueError) as exc:
            raise HTTPException(409, str(exc)) from exc
        return {
            "ok": True,
            "thread_id": thread_id,
            "archived_run_ids": [str(item["run_id"]) for item in collectors],
            "archived_run_count": max(0, len(collectors) - previously_archived),
            "collectors": collectors,
        }
