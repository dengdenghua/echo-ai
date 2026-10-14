"""Collaboration run, collector child, and delivery endpoints for cowork.

Pure structural split of ``cowork_group_router.create_cowork_group_router`` —
no logic changes. Each ``_register_*`` function attaches its endpoints to the
injected router, reading shared state from the ``CoworkGroupDeps`` bundle.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from ._cowork_group_deps import CoworkGroupDeps
from ._cowork_group_models import CollectorChildCancelBody, SteeringBody


def _register_collab_runs(router: APIRouter, d: CoworkGroupDeps) -> None:
    """Run timeline reads: runs, one run, collector long-poll, attempts, steering."""
    group_store = d.group_store
    _collaboration_store = d.collaboration_store
    _require_room_member = d.require_room_member

    @router.get("/api/collab/{thread_id}/runs")
    def list_collaboration_runs(
        thread_id: str,
        request: Request,
        status: str = "",
        limit: int = 100,
    ) -> dict[str, Any]:
        """Durable multi-agent executions for timeline replay and recovery UI."""

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        statuses = [part.strip() for part in status.split(",") if part.strip()]
        try:
            runs = _collaboration_store().collaboration_runs_for_session(
                thread_id,
                statuses=statuses,
                limit=max(1, min(1000, limit)),
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return {
            "thread_id": thread_id,
            "runs": runs,
            "count": len(runs),
        }

    @router.get("/api/collab/{thread_id}/runs/{run_id}")
    def get_collaboration_run(
        thread_id: str,
        run_id: str,
        request: Request,
    ) -> dict[str, Any]:
        """One run plus its immutable lifecycle events."""

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        store = _collaboration_store()
        try:
            run = store.collaboration_run(run_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if run is None or str(run.get("session_id") or "") != thread_id:
            raise HTTPException(404, "collaboration run not found")
        read_collector = getattr(store, "collaboration_collector", None)
        return {
            "thread_id": thread_id,
            "run": run,
            "events": store.collaboration_run_events(run_id),
            "collector": read_collector(run_id) if callable(read_collector) else None,
        }

    @router.get("/api/collab/{thread_id}/runs/{run_id}/collector")
    async def get_collaboration_collector(
        thread_id: str,
        run_id: str,
        request: Request,
        after_revision: int = 0,
        wait_ms: int = 0,
    ) -> dict[str, Any]:
        """Revision-aware long poll for durable child results."""

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        store = _collaboration_store()
        after_revision = max(0, int(after_revision))
        wait_ms = max(0, min(30_000, int(wait_ms)))
        deadline = asyncio.get_running_loop().time() + wait_ms / 1000
        collector = None
        run = None
        while True:
            try:
                run = await asyncio.to_thread(store.collaboration_run, run_id)
                collector = await asyncio.to_thread(store.collaboration_collector, run_id)
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
            if run is None or str(run.get("session_id") or "") != thread_id:
                raise HTTPException(404, "collaboration run not found")
            if collector is None:
                raise HTTPException(404, "collaboration collector not found")
            revision = int(collector.get("revision") or 0)
            if (
                revision > after_revision
                or collector.get("status") != "collecting"
                or wait_ms == 0
                or asyncio.get_running_loop().time() >= deadline
            ):
                break
            await asyncio.sleep(0.1)
        return {
            "thread_id": thread_id,
            "changed": int(collector.get("revision") or 0) > after_revision,
            "collector": collector,
        }

    @router.get("/api/collab/{thread_id}/runs/{run_id}/collector/attempts")
    def get_collaboration_collector_attempts(
        thread_id: str,
        run_id: str,
        request: Request,
    ) -> dict[str, Any]:
        """Append-only attempt history retained across member retries."""

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        store = _collaboration_store()
        try:
            run = store.collaboration_run(run_id)
            attempts = store.collaboration_collector_attempts(run_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if run is None or str(run.get("session_id") or "") != thread_id:
            raise HTTPException(404, "collaboration run not found")
        if store.collaboration_collector(run_id) is None:
            raise HTTPException(404, "collaboration collector not found")
        return {"thread_id": thread_id, "attempts": attempts, "count": len(attempts)}

    @router.get("/api/collab/{thread_id}/runs/{run_id}/collector/steering")
    def get_collaboration_collector_steering(
        thread_id: str,
        run_id: str,
        request: Request,
        child_id: str = "",
        generation: int | None = None,
        after_seq: int = 0,
    ) -> dict[str, Any]:
        """Ordered correction history for one collector generation."""

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        store = _collaboration_store()
        try:
            run = store.collaboration_run(run_id)
            if run is None or str(run.get("session_id") or "") != thread_id:
                raise HTTPException(404, "collaboration run not found")
            rows = store.collaboration_collector_steering(
                run_id,
                child_id=child_id or None,
                generation=generation,
                after_seq=max(0, after_seq),
            )
        except KeyError as exc:
            raise HTTPException(404, "collaboration collector not found") from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return {"thread_id": thread_id, "steering": rows, "count": len(rows)}


def _register_collector_child_controls(router: APIRouter, d: CoworkGroupDeps) -> None:
    """Steer or cancel exactly one still-running collector member."""
    group_store = d.group_store
    _collaboration_store = d.collaboration_store
    _async_store = d.async_store
    _require_room_member = d.require_room_member
    _actor = d.actor
    _auth_dep = d.auth_dep

    @router.post(
        "/api/collab/{thread_id}/runs/{run_id}/collector/{child_id}/steer",
        dependencies=[Depends(_auth_dep)],
    )
    def steer_collaboration_collector_child(
        thread_id: str,
        run_id: str,
        child_id: str,
        body: SteeringBody,
        request: Request,
    ) -> dict[str, Any]:
        """Persist a user correction for exactly one still-running member."""

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        store = _collaboration_store()
        try:
            run = store.collaboration_run(run_id)
            if run is None or str(run.get("session_id") or "") != thread_id:
                raise HTTPException(404, "collaboration run not found")
            result = store.submit_collaboration_collector_steering(
                run_id,
                child_id=child_id,
                text=body.text,
                actor_id=_actor(request),
            )
        except KeyError as exc:
            raise HTTPException(404, "collaboration collector not found") from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        return {"ok": True, "thread_id": thread_id, **result}

    @router.post(
        "/api/collab/{thread_id}/runs/{run_id}/collector/{child_id}/cancel",
        dependencies=[Depends(_auth_dep)],
    )
    def cancel_collaboration_collector_child(
        thread_id: str,
        run_id: str,
        child_id: str,
        body: CollectorChildCancelBody,
        request: Request,
    ) -> dict[str, Any]:
        """Stop exactly one active member while the rest of the group continues."""

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        store = _collaboration_store()
        try:
            run = store.collaboration_run(run_id)
            if run is None or str(run.get("session_id") or "") != thread_id:
                raise HTTPException(404, "collaboration run not found")
            collector = store.collaboration_collector(run_id)
            if collector is None:
                raise HTTPException(404, "collaboration collector not found")
            if child_id not in collector.get("expected_child_ids", []):
                raise HTTPException(404, "collaboration member not found")
            existing = next(
                (
                    item
                    for item in collector.get("results") or []
                    if isinstance(item, dict) and item.get("child_id") == child_id
                ),
                None,
            )
            if isinstance(existing, dict) and existing.get("status") == "cancelled":
                return {
                    "ok": True,
                    "thread_id": thread_id,
                    "collector": collector,
                    "cancelled_task_count": 0,
                }
            if child_id not in collector.get("remaining_child_ids", []):
                raise HTTPException(409, "collaboration member has already settled")
            generation = int(collector.get("generation") or 1)
            bindings = store.collaboration_collector_retry_tasks(
                run_id,
                generation=generation,
            )
            task_ids = [
                str(binding["task_id"])
                for binding in bindings
                if str(binding.get("child_id") or "") == child_id
            ]
            reason = str(body.reason or "member cancelled by user").strip()[:1000]
            if not reason:
                reason = "member cancelled by user"
            cancelled_task_count = _async_store().cancel_batch(
                task_ids,
                reason=reason,
            )
            collector = store.record_collaboration_collector_result(
                run_id,
                child_id=child_id,
                status="cancelled",
                result={
                    "agent_id": child_id,
                    "actor_id": _actor(request),
                    "error": reason,
                    "source": "member_cancel",
                },
                expected_generation=generation,
            )
        except HTTPException:
            raise
        except KeyError as exc:
            raise HTTPException(404, "collaboration collector not found") from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        return {
            "ok": True,
            "thread_id": thread_id,
            "collector": collector,
            "cancelled_task_count": cancelled_task_count,
        }


def _register_deliveries(router: APIRouter, d: CoworkGroupDeps) -> None:
    """Reliable result-delivery reads plus retry / dismiss."""
    group_store = d.group_store
    runtime = d.runtime
    _collaboration_store = d.collaboration_store
    _require_room_member = d.require_room_member
    _auth_dep = d.auth_dep

    @router.get("/api/collab/{thread_id}/deliveries")
    def list_collaboration_deliveries(
        thread_id: str,
        request: Request,
        status: str = "",
        limit: int = 100,
    ) -> dict[str, Any]:
        """Reliable result-delivery state for recovery and operator visibility."""

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        statuses = [part.strip() for part in status.split(",") if part.strip()]
        try:
            deliveries = _collaboration_store().collaboration_deliveries_for_session(
                thread_id,
                statuses=statuses,
                limit=max(1, min(1000, limit)),
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return {
            "thread_id": thread_id,
            "deliveries": deliveries,
            "count": len(deliveries),
        }

    def _collaboration_delivery_for_thread(
        thread_id: str,
        delivery_id: str,
    ) -> tuple[Any, dict[str, Any]]:
        store = _collaboration_store()
        try:
            delivery = store.collaboration_delivery(delivery_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if delivery is None or str(delivery.get("session_id") or "") != thread_id:
            raise HTTPException(404, "collaboration delivery not found")
        return store, delivery

    @router.get("/api/collab/{thread_id}/deliveries/{delivery_id}")
    def get_collaboration_delivery(
        thread_id: str,
        delivery_id: str,
    ) -> dict[str, Any]:
        store, delivery = _collaboration_delivery_for_thread(thread_id, delivery_id)
        return {
            "thread_id": thread_id,
            "delivery": delivery,
            "events": store.collaboration_delivery_events(delivery_id),
        }

    @router.post(
        "/api/collab/{thread_id}/deliveries/{delivery_id}/retry",
        dependencies=[Depends(_auth_dep)],
    )
    def retry_collaboration_delivery(
        thread_id: str,
        delivery_id: str,
    ) -> dict[str, Any]:
        store, _delivery = _collaboration_delivery_for_thread(thread_id, delivery_id)
        try:
            delivery = store.retry_collaboration_delivery(delivery_id)
            logs_root = getattr(runtime, "_logs_root", None)
            if logs_root is not None:
                from runtime.sensing.gateway.collaboration_delivery_outbox import (
                    drain_collaboration_delivery_outbox,
                )

                drain_collaboration_delivery_outbox(
                    store,
                    logs_root=logs_root,
                    session_id=thread_id,
                    limit=100,
                )
                delivery = store.collaboration_delivery(delivery_id) or delivery
        except RuntimeError as exc:
            raise HTTPException(409, str(exc)) from exc
        return {"ok": True, "delivery": delivery}

    @router.post(
        "/api/collab/{thread_id}/deliveries/{delivery_id}/dismiss",
        dependencies=[Depends(_auth_dep)],
    )
    def dismiss_collaboration_delivery(
        thread_id: str,
        delivery_id: str,
    ) -> dict[str, Any]:
        store, _delivery = _collaboration_delivery_for_thread(thread_id, delivery_id)
        try:
            delivery = store.dismiss_collaboration_delivery(delivery_id)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        return {"ok": True, "delivery": delivery}
