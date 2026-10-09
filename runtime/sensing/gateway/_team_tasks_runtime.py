"""Task-store, broadcast, execution, and action helpers for the team tasks router.

Pure structural split of ``team_tasks_router.create_team_tasks_router`` — no
logic changes. Each ``_make_*`` function defines the closures the factory used
to define inline and returns them; the factory passes in its own ``lock``,
``tasks`` and ``running`` objects (mutated in place, never rebound), so every
closure keeps sharing the same state.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import threading
from collections.abc import Callable
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import uuid4

from runtime.safety.approval.cancellation import CancellationSource
from runtime.sensing.gateway._team_tasks_helpers import (
    _LOG,
    _SOP_TEMPLATE_PATTERN,
    RunnerFactory,
    TaskProjection,
    TeamEventBroadcaster,
    _jsonable,
    _now,
    _prepare_team_run,
    _save_state,
)
from runtime.sensing.gateway._team_tasks_models import (
    CreateTeamTaskRequest,
    TeamTaskWire,
)

try:
    from fastapi import APIRouter, HTTPException, Request

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover
    FASTAPI_AVAILABLE = False
    APIRouter = None  # type: ignore[assignment,misc]
    HTTPException = None  # type: ignore[assignment,misc]
    Request = None  # type: ignore[assignment,misc]


def _make_task_persistence(
    *,
    path: Path,
    lock: Lock,
    tasks: dict[str, TeamTaskWire],
    task_projection: TaskProjection | None,
    task_delete_projection: Callable[[str], None] | None,
    team_event_broadcaster: TeamEventBroadcaster | None,
) -> tuple[Callable[..., Any], ...]:
    def _validate_sop_template(value: str) -> str:
        """Normalize and reject sop_template values that could escape
        the meta_skills directory. Empty string means freeform task."""
        normalized = (value or "").strip()
        if not normalized:
            return ""
        if not _SOP_TEMPLATE_PATTERN.fullmatch(normalized):
            raise HTTPException(
                400,
                "sop_template must match [a-zA-Z0-9_.-]+ (no slashes, no traversal)",
            )
        return normalized

    def _save() -> None:
        _save_state(path, tasks)

    def _project_task(task: TeamTaskWire) -> None:
        if task_projection is None:
            return
        try:
            task_projection(task.room_id, task.model_dump())
        except Exception:  # noqa: BLE001 - projection must not block task writes
            _LOG.warning("team task projection failed for %s", task.id, exc_info=True)

    def _project_task_delete(task_id: str) -> None:
        if task_delete_projection is None:
            return
        try:
            task_delete_projection(task_id)
        except Exception:  # noqa: BLE001 - projection must not block task deletion
            _LOG.warning("team task delete projection failed for %s", task_id, exc_info=True)

    async def _broadcast_task_event(room_id: str, payload: dict[str, Any]) -> None:
        if team_event_broadcaster is None:
            return
        result = team_event_broadcaster(room_id, payload)
        if result is not None:
            await result

    def _broadcast_from_worker(
        _loop: asyncio.AbstractEventLoop | None,
        room_id: str,
        payload: dict[str, Any],
    ) -> None:
        if team_event_broadcaster is None:
            return

        coro = _broadcast_task_event(room_id, payload)
        try:
            asyncio.run(coro)
        except (
            RuntimeError,
            TimeoutError,
            concurrent.futures.CancelledError,
            concurrent.futures.TimeoutError,
            OSError,
        ):
            coro.close()
            _LOG.debug("team task broadcast failed", exc_info=True)

    def _log_broadcast_result(
        future: asyncio.Future[Any] | concurrent.futures.Future[Any],
    ) -> None:
        try:
            future.result()
        except (
            asyncio.CancelledError,
            RuntimeError,
            TimeoutError,
            concurrent.futures.TimeoutError,
            OSError,
        ):
            _LOG.debug("team task broadcast failed", exc_info=True)

    return (
        _validate_sop_template,
        _save,
        _project_task,
        _project_task_delete,
        _broadcast_task_event,
        _broadcast_from_worker,
    )


def _make_task_records(
    *,
    lock: Lock,
    tasks: dict[str, TeamTaskWire],
    save: Callable[[], None],
    project_task: Callable[[TeamTaskWire], None],
) -> tuple[Callable[..., Any], ...]:
    _save = save
    _project_task = project_task

    def _task_payload(
        task: TeamTaskWire,
        *,
        event: str,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "type": "task:progress",
            "team_id": task.room_id,
            "room_id": task.room_id,
            "task_id": task.id,
            "task": task.model_dump(),
            "event": event,
            "server_time": _now(),
            **(extra or {}),
        }

    def _persist_task(
        task_id: str,
        updates: dict[str, Any],
    ) -> TeamTaskWire | None:
        with lock:
            current = tasks.get(task_id)
            if current is None:
                return None
            updated = current.model_copy(update={"updated_at": _now(), **updates})
            tasks[task_id] = updated
            _save()
            _project_task(updated)
            return updated

    def _build_terminal_task(
        task_id: str,
        updates: dict[str, Any],
        *,
        status: str,
        error: str = "",
    ) -> TeamTaskWire | None:
        with lock:
            current = tasks.get(task_id)
            if current is None:
                return None
            completed_at = str(updates.get("completed_at") or _now())
            raw_metadata = updates.get("metadata")
            metadata = (
                dict(raw_metadata) if isinstance(raw_metadata, dict) else dict(current.metadata)
            )
            events = [item for item in metadata.get("process_events", []) if isinstance(item, dict)]
            events.append(
                _jsonable(
                    {
                        "ts": completed_at,
                        "type": f"run_{status}",
                        "status": status,
                        "error": error,
                    }
                )
            )
            metadata["process_events"] = events[-300:]
            return current.model_copy(
                update={
                    "updated_at": _now(),
                    **updates,
                    "status": status,
                    "completed_at": completed_at,
                    "metadata": metadata,
                }
            )

    def _persist_prebuilt_task(task: TeamTaskWire) -> TeamTaskWire | None:
        with lock:
            if task.id not in tasks:
                return None
            tasks[task.id] = task
            _save()
            _project_task(task)
            return task

    def _append_process_event(task_id: str, event: dict[str, Any]) -> None:
        with lock:
            current = tasks.get(task_id)
            if current is None:
                return
            metadata = dict(current.metadata)
            events = [item for item in metadata.get("process_events", []) if isinstance(item, dict)]
            events.append(_jsonable(event))
            metadata["process_events"] = events[-300:]
            updated = current.model_copy(
                update={
                    "metadata": metadata,
                    "updated_at": _now(),
                }
            )
            tasks[task_id] = updated
            _save()
            _project_task(updated)

    return (
        _task_payload,
        _build_terminal_task,
        _persist_prebuilt_task,
        _append_process_event,
    )


def _make_task_execution(
    *,
    lock: Lock,
    tasks: dict[str, TeamTaskWire],
    runner_factory: RunnerFactory | None,
    workspace_root: Path | None,
    logs_root: Path | None,
) -> tuple[Callable[..., Any], ...]:
    def _current_metadata(
        task_id: str, *, fallback: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        with lock:
            current = tasks.get(task_id)
            if current is None:
                return dict(fallback or {})
            return dict(current.metadata)

    def _runner_instance(event_emitter: Callable[[dict[str, Any]], None]) -> Any:
        if runner_factory is None:
            from runtime.safety.organization.team_runner import TeamRunner

            return TeamRunner(timeout_seconds=900, event_emitter=event_emitter)
        try:
            return runner_factory(timeout_seconds=900, event_emitter=event_emitter)
        except TypeError:
            return runner_factory()

    def _host_execution_boundary(
        task: TeamTaskWire,
        *,
        actor: str | None,
        tenant_id: str,
        goal: str,
    ) -> Any:
        """Create one server-owned task shared by every role in this run."""

        from runtime.execution.artifact_contracts import HandoffRecorder
        from runtime.execution.host_boundary import create_host_execution_boundary

        normalized_tenant = tenant_id.strip() if actor else ""
        execution_thread_id = f"team-{task.id}"
        execution_task_id = f"team-run-{uuid4().hex}"
        metadata: dict[str, Any] = {
            "source": "team_tasks_http",
            "mode": "team",
            "team_id": task.room_id,
        }

        if workspace_root is not None:
            from runtime.platform.runtime_policy.workspaces import (
                WorkspaceManager,
                managed_workspace_metadata,
                managed_workspace_path,
            )

            manager = WorkspaceManager(Path(workspace_root))
            if actor and normalized_tenant:
                managed = managed_workspace_path(
                    workspace_root,
                    tenant_id=normalized_tenant,
                    actor_id=actor,
                    thread_id=execution_thread_id,
                )
                layout = manager.bind_managed(execution_thread_id, managed)
                metadata.update(
                    managed_workspace_metadata(
                        workspace_root,
                        tenant_id=normalized_tenant,
                        actor_id=actor,
                        thread_id=execution_thread_id,
                    )
                )
            else:
                layout = manager.layout(execution_thread_id)
                metadata["workspace_path"] = str(layout.root)
            metadata["_host_workspace_read_root"] = layout.root
            metadata["_artifact_output_root"] = str(layout.final)

        recorder = None
        if logs_root is not None:
            from runtime.memory.threads.event_log import EventLog, thread_log_path

            event_log = EventLog(thread_log_path(logs_root, execution_thread_id))

            def read_handoffs() -> tuple[dict[str, Any], ...]:
                return tuple(
                    dict(event.payload)
                    for event in event_log.iter_events()
                    if event.event == "execution_handoff" and event.thread_id == execution_thread_id
                )

            def write_handoff(receipt: dict[str, Any]) -> None:
                event_log.execution_handoff(
                    execution_thread_id,
                    execution_task_id,
                    receipt,
                )

            recorder = HandoffRecorder(
                write_handoff,
                read_handoffs,
            )

        return create_host_execution_boundary(
            task_id=execution_task_id,
            thread_id=execution_thread_id,
            goal=goal,
            timeout_s=900.0,
            actor_id=actor,
            tenant_id=normalized_tenant or None,
            metadata=metadata,
            handoff_recorder=recorder,
        )

    return _current_metadata, _runner_instance, _host_execution_boundary


def _make_task_actions(
    *,
    lock: Lock,
    tasks: dict[str, TeamTaskWire],
    running: dict[str, CancellationSource],
    max_concurrent_runs: int,
    identity: Callable[..., Any],
    require_member: Callable[..., Any],
    validate_sop_template: Callable[[str], str],
    save: Callable[[], None],
    project_task: Callable[[TeamTaskWire], None],
    broadcast_task_event: Callable[..., Any],
    task_payload: Callable[..., dict[str, Any]],
    host_execution_boundary: Callable[..., Any],
    append_process_event: Callable[..., None],
    run_task_worker: Callable[..., None],
) -> tuple[Callable[..., Any], ...]:
    _identity = identity
    _require_member = require_member
    _validate_sop_template = validate_sop_template
    _save = save
    _project_task = project_task
    _broadcast_task_event = broadcast_task_event
    _task_payload = task_payload
    _host_execution_boundary = host_execution_boundary
    _append_process_event = append_process_event
    _run_task_worker = run_task_worker

    async def _create_task_for_actor(
        actor: str | None,
        tenant_id: str,
        body: CreateTeamTaskRequest,
    ) -> TeamTaskWire:
        title = body.title.strip()
        if not title:
            raise HTTPException(400, "title is required")
        room_id = body.room_id.strip()
        if not room_id:
            raise HTTPException(400, "room_id is required")
        _require_member(actor, room_id, tenant_id, write=True)
        sop_template = _validate_sop_template(body.sop_template)
        now = _now()
        task = TeamTaskWire(
            id=f"task-{uuid4().hex[:12]}",
            room_id=room_id,
            title=title,
            description=body.description.strip(),
            sop_template=sop_template,
            status="pending",
            assignees=list(body.assignees),
            created_by=actor,
            created_at=now,
            updated_at=now,
            metadata=dict(body.metadata),
        )
        with lock:
            tasks[task.id] = task
            _save()
        _project_task(task)
        await _broadcast_task_event(
            task.room_id,
            _task_payload(task, event="task_created"),
        )
        return task

    async def _run_task_for_actor(
        actor: str | None,
        tenant_id: str,
        task_id: str,
    ) -> TeamTaskWire:
        with lock:
            current = tasks.get(task_id)
            if current is None:
                raise HTTPException(404, f"task not found: {task_id}")
            room_id = current.room_id
        _require_member(actor, room_id, tenant_id, write=True)
        if current.status == "running":
            return current
        try:
            prepared = _prepare_team_run(current)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        try:
            host_boundary = _host_execution_boundary(
                current,
                actor=actor,
                tenant_id=tenant_id,
                goal=prepared["task_input"],
            )
        except (OSError, RuntimeError, ValueError) as exc:
            raise HTTPException(409, "team task execution workspace is unavailable") from exc

        now = _now()
        source = CancellationSource()
        metadata = {
            **dict(current.metadata),
            "runner": {
                "status": "running",
                "meta_skill": prepared.get("meta_skill"),
                "topology": prepared["topology"].name,
                "topology_fingerprint": prepared["topology"].fingerprint,
                "task_graph": prepared.get("task_graph"),
            },
        }
        with lock:
            # Concurrency cap checked inside lock — closing TOCTOU window
            # where two requests could both pass the check before either
            # inserts into running{}.
            if len(running) >= max_concurrent_runs:
                raise HTTPException(
                    429,
                    f"too many concurrent runs ({len(running)}/{max_concurrent_runs})",
                )
            latest = tasks.get(task_id)
            if latest is None:
                raise HTTPException(404, f"task not found: {task_id}")
            if latest.status == "running":
                return latest
            updated = latest.model_copy(
                update={
                    "status": "running",
                    "started_at": now,
                    "completed_at": None,
                    "updated_at": now,
                    "metadata": metadata,
                }
            )
            tasks[task_id] = updated
            running[task_id] = source
            _save()
        _project_task(updated)

        await _broadcast_task_event(
            updated.room_id,
            _task_payload(updated, event="run_started"),
        )
        _append_process_event(
            task_id,
            {
                "ts": now,
                "type": "run_started",
                "status": "running",
                "actor": actor,
                "topology": metadata["runner"].get("topology"),
                "topology_fingerprint": metadata["runner"].get("topology_fingerprint"),
                "task_graph": metadata["runner"].get("task_graph"),
            },
        )
        loop = asyncio.get_running_loop()
        thread = threading.Thread(
            target=_run_task_worker,
            args=(updated, prepared, source, loop, host_boundary),
            name=f"team-task-run-{task_id}",
            daemon=True,
        )
        thread.start()
        return updated

    async def _create_task_from_payload(
        request: Request,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        body = CreateTeamTaskRequest.model_validate(payload)
        actor, tenant_id = _identity(request)
        return (await _create_task_for_actor(actor, tenant_id, body)).model_dump()

    async def _run_task_from_request(
        request: Request,
        task_id: str,
    ) -> dict[str, Any]:
        actor, tenant_id = _identity(request)
        return (await _run_task_for_actor(actor, tenant_id, task_id)).model_dump()

    return (
        _create_task_for_actor,
        _run_task_for_actor,
        _create_task_from_payload,
        _run_task_from_request,
    )
