"""Authorized task actions against the single canonical TeamTask authority."""

from __future__ import annotations

import asyncio
import math
import sqlite3
import threading
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

try:
    from fastapi import HTTPException, Request
except ImportError:  # pragma: no cover
    HTTPException = None  # type: ignore[assignment,misc]
    Request = None  # type: ignore[assignment,misc]

from runtime.memory.cowork._collaboration_team_records import (
    TeamTaskCapacity,
    TeamTaskConflict,
    TeamTaskSnapshot,
)
from runtime.memory.cowork.team_task_authority import TeamTaskAuthority
from runtime.safety.approval.cancellation import CancellationSource
from runtime.sensing.gateway._team_task_events import TeamTaskEvents
from runtime.sensing.gateway._team_task_execution import _make_task_execution
from runtime.sensing.gateway._team_task_worker import TeamTaskWorker, task_wire
from runtime.sensing.gateway._team_tasks_access import TeamTaskAccess
from runtime.sensing.gateway._team_tasks_helpers import (
    _SOP_TEMPLATE_PATTERN,
    _normalize_status,
    _now,
    _prepare_team_run,
)
from runtime.sensing.gateway._team_tasks_models import (
    CreateTeamTaskRequest,
    TeamTaskWire,
    UpdateTeamTaskRequest,
)


def state_conflict(exc: Exception) -> HTTPException:
    return HTTPException(409, {"code": "TEAM_TASK_STATE_CONFLICT", "message": str(exc)})


def authority_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(503, "team task authority is unavailable")


def validate_sop(value: str) -> str:
    normalized = (value or "").strip()
    if normalized and not _SOP_TEMPLATE_PATTERN.fullmatch(normalized):
        raise HTTPException(
            400, "sop_template must match [a-zA-Z0-9_.-]+ (no slashes, no traversal)"
        )
    return normalized


@dataclass
class _RunHandle:
    worker: TeamTaskWorker
    ready: threading.Event


class TeamTaskRuntime:
    def __init__(
        self,
        *,
        authority: TeamTaskAuthority,
        access: TeamTaskAccess,
        events: TeamTaskEvents,
        max_concurrent_runs: int,
        runner_factory: Any,
        workspace_root: Any,
        logs_root: Any,
        lease: float,
        heartbeat_interval: float,
        reset_callback: Any,
    ) -> None:
        if (
            not math.isfinite(lease)
            or not math.isfinite(heartbeat_interval)
            or not 0 < heartbeat_interval < lease
        ):
            raise ValueError(
                "team task heartbeat must be positive and shorter than its finite lease"
            )
        self.authority, self.access, self.events = authority, access, events
        self.max_concurrent_runs, self.lease, self.heartbeat_interval = (
            max_concurrent_runs,
            lease,
            heartbeat_interval,
        )
        self.reset_callback = reset_callback
        self.runner, self.host_boundary = _make_task_execution(
            runner_factory=runner_factory, workspace_root=workspace_root, logs_root=logs_root
        )
        self.lock = threading.Lock()
        self.running: dict[str, TeamTaskWorker] = {}

    def current(self, task_id: str) -> TeamTaskSnapshot:
        try:
            current = self.authority.get(task_id)
        except TeamTaskConflict as exc:
            raise state_conflict(exc) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except (sqlite3.Error, OSError) as exc:
            raise authority_unavailable(exc) from exc
        if current is None:
            raise HTTPException(404, f"task not found: {task_id}")
        return current

    def list_tasks(self, room_id: str | None) -> list[TeamTaskSnapshot]:
        try:
            return self.authority.list(room_id=room_id)
        except TeamTaskConflict as exc:
            raise state_conflict(exc) from exc
        except (sqlite3.Error, OSError) as exc:
            raise authority_unavailable(exc) from exc

    def create(
        self, actor: str | None, tenant_id: str, body: CreateTeamTaskRequest
    ) -> TeamTaskWire:
        title, room_id = body.title.strip(), body.room_id.strip()
        if not title or not room_id:
            raise HTTPException(400, "title and room_id are required")
        self.access.require_member(actor, room_id, tenant_id, write=True)
        now = _now()
        payload = TeamTaskWire(
            id=f"task-{uuid4().hex[:12]}",
            room_id=room_id,
            title=title,
            description=body.description.strip(),
            sop_template=validate_sop(body.sop_template),
            assignees=body.assignees,
            created_by=actor,
            created_at=now,
            updated_at=now,
            metadata=dict(body.metadata),
        ).model_dump(exclude={"revision"})
        try:
            session_id = self.authority.store.session_id_for_room(room_id)
        except (sqlite3.Error, OSError) as exc:
            raise authority_unavailable(exc) from exc
        if session_id is None:
            raise state_conflict(TeamTaskConflict("task requires an existing canonical team room"))
        try:
            committed = task_wire(self.authority.create(session_id, payload))
        except TeamTaskConflict as exc:
            raise state_conflict(exc) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except (sqlite3.Error, OSError) as exc:
            raise authority_unavailable(exc) from exc
        self.events.project(committed)
        return committed

    def update(
        self, actor: str | None, tenant_id: str, task_id: str, body: UpdateTeamTaskRequest
    ) -> TeamTaskWire:
        current = self.current(task_id)
        self.access.require_member(actor, current.payload["room_id"], tenant_id, write=True)
        updates: dict[str, Any] = {"updated_at": _now()}
        if body.title is not None:
            if not body.title.strip():
                raise HTTPException(400, "title cannot be empty")
            updates["title"] = body.title.strip()
        if body.description is not None:
            updates["description"] = body.description.strip()
        if body.sop_template is not None:
            updates["sop_template"] = validate_sop(body.sop_template)
        if body.assignees is not None:
            updates["assignees"] = [item.model_dump() for item in body.assignees]
        if body.status is not None:
            status = _normalize_status(body.status)
            updates["status"] = status
            if status == "running" and current.payload["status"] != "running":
                updates["started_at"] = _now()
            if status in {"done", "failed", "cancelled"}:
                updates["completed_at"] = _now()
        try:
            committed = task_wire(
                self.authority.mutate(
                    task_id,
                    lambda payload: {**payload, **updates},
                    expected_revision=body.expected_revision
                    if body.expected_revision is not None
                    else current.revision,
                )
            )
        except TeamTaskConflict as exc:
            raise state_conflict(exc) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except (sqlite3.Error, OSError) as exc:
            raise authority_unavailable(exc) from exc
        if body.status is not None and updates["status"] != "running":
            self.cancel_local(task_id, "team task status changed")
        self.events.project(committed)
        return committed

    def delete(self, actor: str | None, tenant_id: str, task_id: str) -> TeamTaskWire:
        current = self.current(task_id)
        self.access.require_member(actor, current.payload["room_id"], tenant_id, write=True)
        try:
            self.authority.delete(task_id, expected_revision=current.revision)
        except TeamTaskConflict as exc:
            raise state_conflict(exc) from exc
        except (sqlite3.Error, OSError) as exc:
            raise authority_unavailable(exc) from exc
        self.cancel_local(task_id, "team task deleted")
        self.events.project_delete(task_id)
        return task_wire(current)

    def cancel_local(self, task_id: str, reason: str) -> None:
        with self.lock:
            workers = [worker for worker in self.running.values() if worker.task.id == task_id]
        for worker in workers:
            worker.source.cancel(reason=reason)

    def worker_exited(self, token: str) -> None:
        with self.lock:
            self.running.pop(token, None)

    def prepare_run(
        self, actor: str | None, tenant_id: str, task_id: str, loop: asyncio.AbstractEventLoop
    ) -> TeamTaskWire | _RunHandle:
        try:
            self.authority.reconcile()
        except (sqlite3.Error, OSError) as exc:
            raise authority_unavailable(exc) from exc
        current = self.current(task_id)
        task = task_wire(current)
        self.access.require_member(actor, task.room_id, tenant_id, write=True)
        if task.status == "running":
            return task
        try:
            prepared = _prepare_team_run(task)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        try:
            boundary = self.host_boundary(
                task, actor=actor, tenant_id=tenant_id, goal=prepared["task_input"]
            )
        except (OSError, RuntimeError, ValueError) as exc:
            raise HTTPException(409, "team task execution workspace is unavailable") from exc
        self.access.require_member(actor, task.room_id, tenant_id, write=True)

        def merge(payload: dict[str, Any]) -> dict[str, Any]:
            runner = {
                "status": "running",
                "meta_skill": prepared.get("meta_skill"),
                "topology": prepared["topology"].name,
                "topology_fingerprint": prepared["topology"].fingerprint,
                "task_graph": prepared.get("task_graph"),
            }
            metadata = {**payload.get("metadata", {}), "runner": runner}
            prior = [item for item in metadata.get("process_events", []) if isinstance(item, dict)]
            metadata["process_events"] = [
                *prior,
                {
                    "ts": _now(),
                    "type": "run_started",
                    "status": "running",
                    "actor": actor,
                    **{
                        key: runner[key]
                        for key in ("topology", "topology_fingerprint", "task_graph")
                    },
                },
            ][-300:]
            return {**payload, "metadata": metadata}

        try:
            snapshot, claim = self.authority.claim(
                task_id,
                expected_revision=current.revision,
                max_concurrent_runs=self.max_concurrent_runs,
                lease=self.lease,
                mutation=merge,
            )
        except TeamTaskCapacity as exc:
            raise HTTPException(
                429, f"too many concurrent runs (shared limit {self.max_concurrent_runs})"
            ) from exc
        except TeamTaskConflict as exc:
            # A second request for the same live execution is idempotent.
            latest = self.current(task_id)
            if latest.payload["status"] == "running":
                return task_wire(latest)
            raise state_conflict(exc) from exc
        except (sqlite3.Error, OSError) as exc:
            raise authority_unavailable(exc) from exc
        ready = threading.Event()
        worker = TeamTaskWorker(
            authority=self.authority,
            events=self.events,
            task=task_wire(snapshot),
            run_token=claim.run_token,
            prepared=prepared,
            boundary=boundary,
            runner=self.runner,
            source=CancellationSource(),
            loop=loop,
            lease=self.lease,
            heartbeat_interval=self.heartbeat_interval,
            on_exit=self.worker_exited,
        )

        def run_after_notice() -> None:
            # If the request disconnects while its notice is pending, the
            # already committed execution must not remain an unstarted claim.
            ready.wait(timeout=1.0)
            worker.run()

        with self.lock:
            self.running[claim.run_token] = worker
        try:
            threading.Thread(
                target=run_after_notice, name=f"team-task-run-{task_id}", daemon=True
            ).start()
        except RuntimeError as exc:
            self.worker_exited(claim.run_token)
            self.authority.release(task_id, claim.run_token)
            raise HTTPException(503, "team task worker could not start") from exc
        self.events.project(worker.task)
        return _RunHandle(worker, ready)

    async def create_for_actor(
        self, actor: str | None, tenant_id: str, body: CreateTeamTaskRequest
    ) -> TeamTaskWire:
        task = await asyncio.to_thread(self.create, actor, tenant_id, body)
        await self.events.broadcast(task, "task_created")
        return task

    async def run_for_actor(self, actor: str | None, tenant_id: str, task_id: str) -> TeamTaskWire:
        started = await asyncio.to_thread(
            self.prepare_run, actor, tenant_id, task_id, asyncio.get_running_loop()
        )
        if isinstance(started, TeamTaskWire):
            return started
        try:
            await self.events.broadcast(started.worker.task, "run_started")
        finally:
            started.ready.set()
        return started.worker.task

    async def create_from_payload(
        self, request: Request, payload: dict[str, Any]
    ) -> dict[str, Any]:
        actor, tenant = self.access.identity(request)
        return (
            await self.create_for_actor(
                actor, tenant, CreateTeamTaskRequest.model_validate(payload)
            )
        ).model_dump()

    async def run_from_request(self, request: Request, task_id: str) -> dict[str, Any]:
        actor, tenant = self.access.identity(request)
        return (await self.run_for_actor(actor, tenant, task_id)).model_dump()

    def reset(self) -> None:
        self.authority.reset()
        with self.lock:
            workers = list(self.running.values())
        for worker in workers:
            worker.source.cancel(reason="team task router reset")
        if callable(self.reset_callback):
            self.reset_callback()
