"""A read-only personal projection of existing work ledgers.

This endpoint does not create a new task registry. Project tasks retain their
delivery state even when an associated execution has already completed.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from runtime.memory.cowork.group import visible_message_range
from runtime.platform.process.paths import app_paths
from runtime.platform.process.task_supervisor import TaskSupervisor, TaskSupervisorStore
from runtime.safety.auth.principal import resolve_principal
from runtime.sensing.gateway._cowork_group_access import CoworkGroupAccess
from runtime.sensing.gateway.thread_access import ThreadAccessResolver

ActivityState = Literal["working", "attention", "completed"]


class AssistantActivityItem(BaseModel):
    id: str
    source: Literal["run", "project_task", "collaboration_task"]
    title: str
    status: str
    state: ActivityState
    updated_at: str
    thread_id: str | None = None
    project_id: str | None = None
    room_id: str | None = None
    task_id: str | None = None
    run_id: str | None = None
    agent_ids: list[str] = Field(default_factory=list)
    project_name: str | None = None
    room_name: str | None = None
    reason: str | None = None


class AssistantActivitySummary(BaseModel):
    working: int = 0
    attention: int = 0
    completed: int = 0


class AssistantActivityResponse(BaseModel):
    schema_version: Literal["echo.assistant_activity.v1"] = Field(
        default="echo.assistant_activity.v1", alias="schema"
    )
    items: list[AssistantActivityItem]
    summary: AssistantActivitySummary
    has_more: bool


def _text(value: Any) -> str:
    return str(value or "").strip()


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _state(status: str) -> ActivityState:
    if status in {"done", "completed"}:
        return "completed"
    if status in {
        "pending",
        "ready",
        "queued",
        "running",
        "verifying",
        "repairing",
        "planning",
        "in_progress",
        "active",
    }:
        return "working"
    return "attention"


def _timestamp(value: Any) -> str:
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value, UTC).isoformat()
        except (ValueError, OverflowError, OSError):
            return ""
    return _text(value)


def _seconds(value: str) -> float:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return (
            parsed.replace(tzinfo=UTC).timestamp() if parsed.tzinfo is None else parsed.timestamp()
        )
    except (ValueError, OverflowError, OSError):
        return 0.0


def _agents(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    return sorted(
        {
            _text(v.get("agent_id") or v.get("ref") or v.get("id"))
            if isinstance(v, dict)
            else _text(v)
            for v in values
            if not isinstance(v, dict) or v.get("kind") not in {"human", "participant"}
        }
        - {""}
    )


def _same_work_coordinates(
    item: AssistantActivityItem, thread_id: str, metadata: dict[str, Any]
) -> bool:
    known_pairs = [
        (business, execution)
        for business, execution in (
            (item.thread_id, thread_id),
            (item.project_id, _text(metadata.get("project_id"))),
            (item.room_id, _text(metadata.get("room_id"))),
        )
        if business and execution
    ]
    return bool(known_pairs) and all(business == execution for business, execution in known_pairs)


def create_assistant_activity_router(
    *,
    supervisor: TaskSupervisor | None = None,
    project_store: Any = None,
    collaboration_store: Any = None,
    thread_store: Any = None,
    group_store: Any = None,
    team_rooms_router: Any = None,
    identity_store: Any = None,
    require_auth: bool = False,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
) -> APIRouter:
    router = APIRouter(tags=["assistant"])

    @router.get("/api/assistant/activity", response_model=AssistantActivityResponse)
    def activity(
        request: Request, limit: int = Query(default=100, ge=1, le=200)
    ) -> AssistantActivityResponse:
        principal = resolve_principal(
            request,
            identity_store,
            require_auth,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )
        if "owner_id" in request.query_params:
            raise HTTPException(400, "owner_id is not supported by personal assistant activity")
        request.state.cowork_principal = principal
        decisions: dict[str, Any] = {}
        group_states: dict[str, Any] = {}
        rooms_by_thread: dict[str, dict[str, Any]] = {}
        rooms_by_id: dict[str, dict[str, Any]] = {}
        room_permissions: dict[str, bool] = {}

        # These snapshots last only for this request. Membership and context
        # grants must be resolved again on the next poll after a revocation.
        def group_state(thread_id: str) -> Any:
            if thread_id not in group_states:
                group_states[thread_id] = group_store.state(thread_id)
            return group_states[thread_id]

        def room_by_id(room_id: str) -> dict[str, Any]:
            if room_id not in rooms_by_id:
                rooms_by_id[room_id] = (
                    _dict(collaboration_store.room_by_id(room_id)) if collaboration_store else {}
                )
            return rooms_by_id[room_id]

        resolver = ThreadAccessResolver(
            thread_store=thread_store,
            group_store=SimpleNamespace(state=group_state) if group_store is not None else None,
            collaboration_store=collaboration_store,
            team_rooms_router=team_rooms_router,
            identity_store=identity_store,
        )
        room_access = CoworkGroupAccess(
            runtime=None,
            identity_store=identity_store,
            require_auth=True,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
            thread_access=resolver,
            team_rooms_router=team_rooms_router,
            room_snapshot=room_by_id,
        )

        def decision(thread_id: str) -> Any:
            if thread_id not in decisions:
                decisions[thread_id] = resolver.resolve(
                    thread_id,
                    principal.actor_id if principal else None,
                    principal.tenant_id if principal else None,
                )
            return decisions[thread_id]

        def room_for(thread_id: str) -> dict[str, Any]:
            if not collaboration_store or not thread_id:
                return {}
            if thread_id not in rooms_by_thread:
                room = _dict(collaboration_store.room_for_session(thread_id))
                if not room and group_store is not None:
                    room_id = _text(group_state(thread_id).room_id)
                    if room_id:
                        room = room_by_id(room_id)
                if room_id := _text(room.get("id")):
                    rooms_by_id[room_id] = room
                rooms_by_thread[thread_id] = room
            return rooms_by_thread[thread_id]

        def room_allowed(room: dict[str, Any]) -> bool:
            if principal is None:
                return True
            room_id = _text(room.get("id"))
            if room_id in room_permissions:
                return room_permissions[room_id]
            tenant = _text(room.get("tenant_id") or _dict(room.get("metadata")).get("tenant_id"))
            allowed = bool(room_id and tenant == principal.tenant_id)
            if allowed:
                try:
                    room_access.require_room_member(room_id, request)
                except HTTPException:
                    allowed = False
            room_permissions[room_id] = allowed
            return allowed

        def shared_participant(thread_id: str) -> bool:
            access = decision(thread_id)
            # A resolver-proven current room role can outlive a missing local
            # projection. Ownerless legacy can_manage alone proves no membership.
            return bool(
                access.thread is not None
                and access.can_read
                and access.room_id
                and access.room_role in {"owner", "member", "viewer"}
            )

        def navigation_room(thread_id: str) -> dict[str, Any]:
            room = room_for(thread_id)
            if room:
                return room if principal is None or room_allowed(room) else {}
            if principal is not None and thread_id and shared_participant(thread_id):
                return {"id": decision(thread_id).room_id}
            return {}

        def personal_thread_allowed(thread_id: str) -> bool:
            if principal is None:
                return True
            access = decision(thread_id)
            if not access.can_read or access.thread is None:
                return False
            metadata = _dict(access.thread.get("metadata"))
            owner = _text(metadata.get("owner_actor_id") or metadata.get("actor_id"))
            if owner == principal.actor_id:
                return True
            room = room_for(thread_id)
            return room_allowed(room) if room else shared_participant(thread_id)

        def history_allowed(thread_id: str, metadata: dict[str, Any]) -> bool:
            if principal is None or group_store is None or not thread_id:
                return True
            access = decision(thread_id)
            if access.can_manage:
                return True
            member = next(
                (
                    member
                    for member in group_state(thread_id).roster
                    if member.id == principal.actor_id
                ),
                None,
            )
            if member is None or member.kind != "human" or member.grant.scope == "all":
                return True
            # Activity titles can reveal historic instructions. Unknown coordinates
            # and summary-only grants cannot authorize that raw content.
            index = metadata.get("source_message_index", metadata.get("at_message"))
            if isinstance(index, bool) or not isinstance(index, int) or index < 0:
                return False
            bounds = visible_message_range(member, current_max_message=index)
            return bounds is not None and bounds[0] <= index <= bounds[1]

        items: list[AssistantActivityItem] = []
        business: dict[str, list[AssistantActivityItem]] = {}
        project_keys: set[tuple[str, str]] = set()
        visible_projects: dict[str, Any] = {}
        for project in project_store.list_projects() if project_store else []:
            if principal is not None and (
                project.tenant_id != principal.tenant_id or not project.owner_id
            ):
                continue
            thread_id = project_store.thread_for_project(project.id) or ""
            if (
                principal is not None
                and project.owner_id != principal.actor_id
                and (not thread_id or not personal_thread_allowed(thread_id))
            ):
                continue
            visible_projects[project.id] = project
            nav_thread = thread_id if thread_id and personal_thread_allowed(thread_id) else None
            room = navigation_room(nav_thread or "")
            times: dict[str, str] = {}
            for event in project_store.events_for_project(project.id, limit=500):
                event_task = _text(_dict(event.get("payload")).get("task_id"))
                timestamp = _timestamp(event.get("created_at"))
                if event_task and _seconds(timestamp) >= _seconds(times.get(event_task, "")):
                    times[event_task] = timestamp
            for milestone in project_store.milestones_for(project.id):
                for task in project_store.tasks_for_milestone(milestone.id):
                    if project.owner_id != getattr(
                        principal, "actor_id", None
                    ) and not history_allowed(thread_id, _dict(task.input)):
                        continue
                    item = AssistantActivityItem(
                        id=f"project_task:{project.id}:{task.id}",
                        source="project_task",
                        title=task.goal or task.id,
                        status=task.status,
                        state=_state(task.status),
                        updated_at=times.get(task.id)
                        or project.finished_at
                        or project.started_at
                        or project.created_at,
                        thread_id=nav_thread,
                        project_id=project.id,
                        room_id=_text(room.get("id")) or None,
                        task_id=task.id,
                        agent_ids=[task.assigned_agent] if task.assigned_agent else [],
                        project_name=project.name,
                        room_name=_text(room.get("name")) or None,
                        reason=task.status if _state(task.status) == "attention" else None,
                    )
                    items.append(item)
                    project_keys.add((project.id, task.id))
                    business.setdefault(task.id, []).append(item)

        offset = 0
        while collaboration_store:
            sessions = collaboration_store.list_session_ids(limit=500, offset=offset)
            for session_id in sessions:
                room = room_for(session_id)
                access = decision(session_id)
                canonical_thread = session_id if access.thread is not None else None
                if principal is not None:
                    if canonical_thread:
                        if not access.can_read or (room and not room_allowed(room)):
                            continue
                        # The resolver's legacy ownerless compatibility must not
                        # turn an administrator's personal view into a global inbox.
                        metadata = _dict(access.thread.get("metadata"))
                        owner = _text(metadata.get("owner_actor_id") or metadata.get("actor_id"))
                        if (
                            owner != principal.actor_id
                            and not room
                            and not shared_participant(session_id)
                        ):
                            continue
                    elif not room or not room_allowed(room):
                        continue
                if canonical_thread:
                    room = navigation_room(canonical_thread)
                for task in collaboration_store.tasks_for_session(session_id):
                    metadata = _dict(task.get("metadata"))
                    if (
                        principal is not None
                        and metadata.get("tenant_id")
                        and metadata["tenant_id"] != principal.tenant_id
                    ):
                        continue
                    project_id = _text(task.get("project_id") or metadata.get("project_id"))
                    task_id = _text(task.get("id"))
                    if (project_id, task_id) in project_keys:
                        continue
                    if (
                        project_id
                        and project_store
                        and project_store.get_project(project_id) is not None
                        and project_id not in visible_projects
                    ):
                        continue
                    # The historical grant belongs to the ledger's session even
                    # when its canonical thread row is absent. Navigation still
                    # uses canonical_thread so no missing thread is invented.
                    if not history_allowed(session_id, metadata):
                        continue
                    status = _text(task.get("status")) or "pending"
                    project = visible_projects.get(project_id)
                    item = AssistantActivityItem(
                        id=f"collaboration_task:{session_id}:{task_id}",
                        source="collaboration_task",
                        title=_text(task.get("title") or task.get("description")) or task_id,
                        status=status,
                        state=_state(status),
                        updated_at=_timestamp(task.get("updated_at") or task.get("created_at")),
                        thread_id=canonical_thread,
                        project_id=project.id if project else None,
                        room_id=_text(task.get("room_id") or room.get("id")) or None,
                        task_id=task_id,
                        agent_ids=_agents(task.get("assignees")),
                        project_name=project.name if project else None,
                        room_name=_text(room.get("name")) or None,
                        reason=_text(task.get("reason") or metadata.get("reason"))
                        or (status if _state(status) == "attention" else None),
                    )
                    items.append(item)
                    business.setdefault(task_id, []).append(item)
            if len(sessions) < 500:
                break
            offset += len(sessions)

        run_store = (
            supervisor or TaskSupervisor(TaskSupervisorStore(app_paths().task_runs_path))
        ).store
        runs = run_store.list_snapshot(
            owner_id=principal.actor_id if principal else None,
            include_unowned=principal is None,
        )
        runs.sort(key=lambda run: (_seconds(run.updated_at), run.task_id), reverse=True)
        attached: set[str] = set()
        for run in runs:
            metadata = _dict(run.metadata)
            thread_id = _text(run.thread_id)
            if principal is not None:
                if metadata.get("tenant_id") and metadata["tenant_id"] != principal.tenant_id:
                    continue
                if (
                    thread_id
                    and decision(thread_id).thread is not None
                    and not decision(thread_id).can_read
                ):
                    continue
                if not history_allowed(thread_id, metadata):
                    continue
            nav_thread = thread_id if thread_id and decision(thread_id).thread is not None else None
            candidates = [
                item
                for item in business.get(_text(run.origin_task_id), [])
                if _same_work_coordinates(item, thread_id, metadata)
            ]
            # An exact origin id needs at least one matching work coordinate and
            # no conflicting known coordinates; preserve ambiguous source cards.
            if len(candidates) == 1:
                item = candidates[0]
                if item.id not in attached:
                    item.run_id = run.task_id
                    item.updated_at = max((item.updated_at, run.updated_at), key=_seconds)
                    if _state(run.status.value) == "attention" and item.state != "completed":
                        item.state = "attention"
                        item.reason = f"run:{run.status.value}"
                    elif run.status.value == "completed" and item.state != "completed":
                        item.reason = "execution_completed"
                    attached.add(item.id)
                continue
            room = navigation_room(nav_thread or "")
            status = run.status.value
            items.append(
                AssistantActivityItem(
                    id=f"run:{run.task_id}",
                    source="run",
                    title=run.title or run.goal or run.task_id,
                    status=status,
                    state=_state(status),
                    updated_at=run.updated_at,
                    thread_id=nav_thread,
                    room_id=_text(room.get("id")) or None,
                    task_id=run.origin_task_id or run.task_id,
                    run_id=run.task_id,
                    agent_ids=_agents(metadata.get("agent_ids"))
                    or _agents([metadata.get("agent_id")]),
                    room_name=_text(room.get("name")) or None,
                    reason=run.terminal_reason
                    or (status if _state(status) == "attention" else None),
                )
            )

        order = {"attention": 0, "working": 1, "completed": 2}
        items.sort(key=lambda item: (order[item.state], -_seconds(item.updated_at), item.id))
        visible_items = items[:limit]
        counts = {state: sum(item.state == state for item in visible_items) for state in order}
        return AssistantActivityResponse(
            items=visible_items,
            summary=AssistantActivitySummary(**counts),
            has_more=len(items) > limit,
        )

    return router
