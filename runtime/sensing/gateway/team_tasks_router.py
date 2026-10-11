"""Canonical team tasks API with process-fenced execution inside a team room."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from pathlib import Path
from typing import Any

from runtime.platform.process.paths import app_paths
from runtime.sensing.gateway._team_tasks_access import TeamTaskAccess
from runtime.sensing.gateway._team_tasks_helpers import (
    _MAX_CONCURRENT_RUNS,
    RoomMembershipResolver,
    RoomParticipantResolver,
    RunnerFactory,
    TaskProjection,
    TeamEventBroadcaster,
    _team_task_process_timeline,
)
from runtime.sensing.gateway._team_tasks_helpers import _fallback_topology as _fallback_topology
from runtime.sensing.gateway._team_tasks_helpers import _task_input_text as _task_input_text
from runtime.sensing.gateway._team_tasks_models import (
    CreateTeamTaskRequest,
    TaskAssigneeWire,
    TeamTaskWire,
    UpdateTeamTaskRequest,
)

try:
    from fastapi import APIRouter, HTTPException, Request

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover
    FASTAPI_AVAILABLE = False
    APIRouter = None  # type: ignore[assignment,misc]
    HTTPException = None  # type: ignore[assignment,misc]
    Request = None  # type: ignore[assignment,misc]

from runtime.sensing._fastapi_guard import require_fastapi  # noqa: E402
from runtime.sensing.gateway._team_task_events import TeamTaskEvents  # noqa: E402
from runtime.sensing.gateway._team_task_worker import task_wire  # noqa: E402
from runtime.sensing.gateway._team_tasks_runtime import TeamTaskRuntime  # noqa: E402


def create_team_tasks_router(
    *,
    state_path: Path | None = None,
    collaboration_store: Any = None,
    workspace_root: Path | None = None,
    logs_root: Path | None = None,
    identity_store: Any = None,
    require_auth: bool = False,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
    reset_callback: Any = None,
    team_event_broadcaster: TeamEventBroadcaster | None = None,
    task_projection: TaskProjection | None = None,
    task_delete_projection: Callable[[str], None] | None = None,
    runner_factory: RunnerFactory | None = None,
    room_membership_resolver: RoomMembershipResolver | None = None,
    room_participant_resolver: RoomParticipantResolver | None = None,
    max_concurrent_runs: int = _MAX_CONCURRENT_RUNS,
    claim_lease_seconds: float = 15.0,
    heartbeat_interval_seconds: float = 1.0,
) -> Any:
    """Create routes on the existing canonical collaboration database.

    ``state_path`` identifies only the retired JSON import source. A custom
    source without an explicit store uses ``source.parent/cowork``. Rooms must
    already have canonical bindings; neither development mode nor migration
    invents a roomless session. Compatibility projection callbacks run only
    after the authoritative commit and are not task storage.
    """
    require_fastapi(__name__)
    from runtime.memory.cowork.collaboration_store import CollaborationStore
    from runtime.memory.cowork.team_task_authority import TeamTaskAuthority

    path = state_path or (app_paths().data_dir / "team_tasks.json")
    store = (
        collaboration_store
        if collaboration_store is not None
        else CollaborationStore(path.parent / "cowork")
    )
    authority = TeamTaskAuthority(store)
    authority.import_legacy(path)
    authority.reconcile()
    access = TeamTaskAccess(
        identity_store=identity_store,
        require_auth=require_auth,
        jwt_secret=jwt_secret,
        jwt_issuer=jwt_issuer,
        jwt_audience=jwt_audience,
        room_membership_resolver=room_membership_resolver,
        room_participant_resolver=room_participant_resolver,
        http_exception=HTTPException,
    )
    runtime = TeamTaskRuntime(
        authority=authority,
        access=access,
        events=TeamTaskEvents(team_event_broadcaster, task_projection, task_delete_projection),
        max_concurrent_runs=max_concurrent_runs,
        runner_factory=runner_factory,
        workspace_root=workspace_root,
        logs_root=logs_root,
        lease=claim_lease_seconds,
        heartbeat_interval=heartbeat_interval_seconds,
        reset_callback=reset_callback,
    )
    router: Any = APIRouter(tags=["team-tasks"])
    _register_task_routes(
        router,
        runtime,
        require_auth=require_auth,
        has_membership_resolver=room_membership_resolver is not None
        or room_participant_resolver is not None,
    )
    router.reset_state = runtime.reset
    router.create_task_from_payload = runtime.create_from_payload
    router.run_task_from_request = runtime.run_from_request
    router.task_authority = authority
    return router


def _register_task_routes(
    router: Any,
    runtime: TeamTaskRuntime,
    *,
    require_auth: bool,
    has_membership_resolver: bool,
) -> None:
    # Keep HTTP route declarations here for the capability evidence scanner.
    @router.get("/api/team-tasks")
    def list_tasks(request: Request, room_id: str | None = None) -> dict[str, Any]:
        actor, tenant = runtime.access.identity(request)
        if room_id:
            runtime.access.require_member(actor, room_id, tenant)
        elif require_auth and not has_membership_resolver:
            raise HTTPException(503, "room membership resolver unavailable")
        items = runtime.list_tasks(room_id)
        if require_auth and room_id is None:
            items = [
                item
                for item in items
                if runtime.access.is_member(actor, item.payload["room_id"], tenant)
            ]
        return {"tasks": [task_wire(item).model_dump() for item in items], "count": len(items)}

    @router.post("/api/team-tasks")
    async def create_task(request: Request, body: CreateTeamTaskRequest) -> dict[str, Any]:
        actor, tenant = runtime.access.identity(request)
        return (await runtime.create_for_actor(actor, tenant, body)).model_dump()

    @router.get("/api/team-tasks/{task_id}")
    def get_task(request: Request, task_id: str) -> dict[str, Any]:
        actor, tenant = runtime.access.identity(request)
        task = task_wire(runtime.current(task_id))
        runtime.access.require_member(actor, task.room_id, tenant)
        return task.model_dump()

    @router.get("/api/team-tasks/{task_id}/process-timeline")
    def get_task_process_timeline(request: Request, task_id: str) -> dict[str, Any]:
        actor, tenant = runtime.access.identity(request)
        task = task_wire(runtime.current(task_id))
        runtime.access.require_member(actor, task.room_id, tenant)
        return {"timeline": _team_task_process_timeline(task.model_dump())}

    @router.post("/api/team-tasks/{task_id}/run")
    async def run_task(request: Request, task_id: str) -> dict[str, Any]:
        actor, tenant = runtime.access.identity(request)
        return (await runtime.run_for_actor(actor, tenant, task_id)).model_dump()

    @router.patch("/api/team-tasks/{task_id}")
    async def update_task(
        request: Request, task_id: str, body: UpdateTeamTaskRequest
    ) -> dict[str, Any]:
        actor, tenant = runtime.access.identity(request)
        task = await asyncio.to_thread(runtime.update, actor, tenant, task_id, body)
        await runtime.events.broadcast(task, "task_updated")
        return task.model_dump()

    @router.delete("/api/team-tasks/{task_id}")
    async def delete_task(request: Request, task_id: str) -> dict[str, Any]:
        actor, tenant = runtime.access.identity(request)
        task = await asyncio.to_thread(runtime.delete, actor, tenant, task_id)
        await runtime.events.broadcast(task, "task_deleted", deleted=True)
        return {"ok": True, "deleted": True, "task_id": task_id}


__all__ = [
    "create_team_tasks_router",
    "TaskAssigneeWire",
    "TeamTaskWire",
    "CreateTeamTaskRequest",
    "UpdateTeamTaskRequest",
    "TeamEventBroadcaster",
    "TaskProjection",
    "RunnerFactory",
    "RoomMembershipResolver",
    "RoomParticipantResolver",
]
