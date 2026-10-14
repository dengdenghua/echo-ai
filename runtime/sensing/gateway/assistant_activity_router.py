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
    return bool(known_pairs) and all((business == execution for business, execution in known_pairs))


class _ActivityProjection:
    """One request's authorized ledger view; never reuse membership decisions across requests."""

    def __init__(
        self,
        request: Request,
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
    ):
        self.request = request
        self.supervisor = supervisor
        self.project_store = project_store
        self.collaboration_store = collaboration_store
        self.thread_store = thread_store
        self.group_store = group_store
        self.team_rooms_router = team_rooms_router
        self.identity_store = identity_store
        self.require_auth = require_auth
        self.jwt_secret = jwt_secret
        self.jwt_issuer = jwt_issuer
        self.jwt_audience = jwt_audience
        self.principal = resolve_principal(
            self.request,
            self.identity_store,
            self.require_auth,
            jwt_secret=self.jwt_secret,
            jwt_issuer=self.jwt_issuer,
            jwt_audience=self.jwt_audience,
        )
        if "owner_id" in self.request.query_params:
            raise HTTPException(400, "owner_id is not supported by personal assistant activity")
        self.request.state.cowork_principal = self.principal
        self.decisions: dict[str, Any] = {}
        self.group_states: dict[str, Any] = {}
        self.rooms_by_thread: dict[str, dict[str, Any]] = {}
        self.rooms_by_id: dict[str, dict[str, Any]] = {}
        self.room_permissions: dict[str, bool] = {}
        self.resolver = ThreadAccessResolver(
            thread_store=self.thread_store,
            group_store=SimpleNamespace(state=self.group_state)
            if self.group_store is not None
            else None,
            collaboration_store=self.collaboration_store,
            team_rooms_router=self.team_rooms_router,
            identity_store=self.identity_store,
        )
        self.room_access = CoworkGroupAccess(
            runtime=None,
            identity_store=self.identity_store,
            require_auth=True,
            jwt_secret=self.jwt_secret,
            jwt_issuer=self.jwt_issuer,
            jwt_audience=self.jwt_audience,
            thread_access=self.resolver,
            team_rooms_router=self.team_rooms_router,
            room_snapshot=self.room_by_id,
        )
        self.items: list[AssistantActivityItem] = []
        self.business: dict[str, list[AssistantActivityItem]] = {}
        self.project_keys: set[tuple[str, str]] = set()
        self.visible_projects: dict[str, Any] = {}

    def group_state(self, thread_id: str) -> Any:
        if thread_id not in self.group_states:
            self.group_states[thread_id] = self.group_store.state(thread_id)
        return self.group_states[thread_id]

    def room_by_id(self, room_id: str) -> dict[str, Any]:
        if room_id not in self.rooms_by_id:
            self.rooms_by_id[room_id] = (
                _dict(self.collaboration_store.room_by_id(room_id))
                if self.collaboration_store
                else {}
            )
        return self.rooms_by_id[room_id]

    def decision(self, thread_id: str) -> Any:
        if thread_id not in self.decisions:
            self.decisions[thread_id] = self.resolver.resolve(
                thread_id,
                self.principal.actor_id if self.principal else None,
                self.principal.tenant_id if self.principal else None,
            )
        return self.decisions[thread_id]

    def room_for(self, thread_id: str) -> dict[str, Any]:
        if not self.collaboration_store or not thread_id:
            return {}
        if thread_id not in self.rooms_by_thread:
            room = _dict(self.collaboration_store.room_for_session(thread_id))
            if not room and self.group_store is not None:
                room_id = _text(self.group_state(thread_id).room_id)
                if room_id:
                    room = self.room_by_id(room_id)
            if room_id := _text(room.get("id")):
                self.rooms_by_id[room_id] = room
            self.rooms_by_thread[thread_id] = room
        return self.rooms_by_thread[thread_id]

    def room_allowed(self, room: dict[str, Any]) -> bool:
        if self.principal is None:
            return True
        room_id = _text(room.get("id"))
        if room_id in self.room_permissions:
            return self.room_permissions[room_id]
        tenant = _text(room.get("tenant_id") or _dict(room.get("metadata")).get("tenant_id"))
        allowed = bool(room_id and tenant == self.principal.tenant_id)
        if allowed:
            try:
                self.room_access.require_room_member(room_id, self.request)
            except HTTPException:
                allowed = False
        self.room_permissions[room_id] = allowed
        return allowed

    def shared_participant(self, thread_id: str) -> bool:
        access = self.decision(thread_id)
        return bool(
            access.thread is not None
            and access.can_read
            and access.room_id
            and (access.room_role in {"owner", "member", "viewer"})
        )

    def navigation_room(self, thread_id: str) -> dict[str, Any]:
        room = self.room_for(thread_id)
        if room:
            return room if self.principal is None or self.room_allowed(room) else {}
        if self.principal is not None and thread_id and self.shared_participant(thread_id):
            return {"id": self.decision(thread_id).room_id}
        return {}

    def personal_thread_allowed(self, thread_id: str) -> bool:
        if self.principal is None:
            return True
        access = self.decision(thread_id)
        if not access.can_read or access.thread is None:
            return False
        metadata = _dict(access.thread.get("metadata"))
        owner = _text(metadata.get("owner_actor_id") or metadata.get("actor_id"))
        if owner == self.principal.actor_id:
            return True
        room = self.room_for(thread_id)
        return self.room_allowed(room) if room else self.shared_participant(thread_id)

    def history_allowed(self, thread_id: str, metadata: dict[str, Any]) -> bool:
        if self.principal is None or self.group_store is None or (not thread_id):
            return True
        access = self.decision(thread_id)
        if access.can_manage:
            return True
        member = next(
            (
                member
                for member in self.group_state(thread_id).roster
                if member.id == self.principal.actor_id
            ),
            None,
        )
        if member is None or member.kind != "human" or member.grant.scope == "all":
            return True
        index = metadata.get("source_message_index", metadata.get("at_message"))
        if isinstance(index, bool) or not isinstance(index, int) or index < 0:
            return False
        bounds = visible_message_range(member, current_max_message=index)
        return bounds is not None and bounds[0] <= index <= bounds[1]

    def _add_project_tasks(self):
        for project in self.project_store.list_projects() if self.project_store else []:
            if self.principal is not None and (
                project.tenant_id != self.principal.tenant_id or not project.owner_id
            ):
                continue
            thread_id = self.project_store.thread_for_project(project.id) or ""
            if (
                self.principal is not None
                and project.owner_id != self.principal.actor_id
                and (not thread_id or not self.personal_thread_allowed(thread_id))
            ):
                continue
            self.visible_projects[project.id] = project
            nav_thread = (
                thread_id if thread_id and self.personal_thread_allowed(thread_id) else None
            )
            room = self.navigation_room(nav_thread or "")
            times: dict[str, str] = {}
            for event in self.project_store.events_for_project(project.id, limit=500):
                event_task = _text(_dict(event.get("payload")).get("task_id"))
                timestamp = _timestamp(event.get("created_at"))
                if event_task and _seconds(timestamp) >= _seconds(times.get(event_task, "")):
                    times[event_task] = timestamp
            for milestone in self.project_store.milestones_for(project.id):
                for task in self.project_store.tasks_for_milestone(milestone.id):
                    if project.owner_id != getattr(self.principal, "actor_id", None) and (
                        not self.history_allowed(thread_id, _dict(task.input))
                    ):
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
                    self.items.append(item)
                    self.project_keys.add((project.id, task.id))
                    self.business.setdefault(task.id, []).append(item)

    def _add_collaboration_tasks(self):
        offset = 0
        while self.collaboration_store:
            sessions = self.collaboration_store.list_session_ids(limit=500, offset=offset)
            for session_id in sessions:
                room = self.room_for(session_id)
                access = self.decision(session_id)
                canonical_thread = session_id if access.thread is not None else None
                if self.principal is not None:
                    if canonical_thread:
                        if not access.can_read or (room and (not self.room_allowed(room))):
                            continue
                        metadata = _dict(access.thread.get("metadata"))
                        owner = _text(metadata.get("owner_actor_id") or metadata.get("actor_id"))
                        if (
                            owner != self.principal.actor_id
                            and (not room)
                            and (not self.shared_participant(session_id))
                        ):
                            continue
                    elif not room or not self.room_allowed(room):
                        continue
                if canonical_thread:
                    room = self.navigation_room(canonical_thread)
                for task in self.collaboration_store.tasks_for_session(session_id):
                    metadata = _dict(task.get("metadata"))
                    if (
                        self.principal is not None
                        and metadata.get("tenant_id")
                        and (metadata["tenant_id"] != self.principal.tenant_id)
                    ):
                        continue
                    project_id = _text(task.get("project_id") or metadata.get("project_id"))
                    task_id = _text(task.get("id"))
                    if (project_id, task_id) in self.project_keys:
                        continue
                    if (
                        project_id
                        and self.project_store
                        and (self.project_store.get_project(project_id) is not None)
                        and (project_id not in self.visible_projects)
                    ):
                        continue
                    if not self.history_allowed(session_id, metadata):
                        continue
                    status = _text(task.get("status")) or "pending"
                    project = self.visible_projects.get(project_id)
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
                    self.items.append(item)
                    self.business.setdefault(task_id, []).append(item)
            if len(sessions) < 500:
                break
            offset += len(sessions)

    def _add_runs(self):
        run_store = (
            self.supervisor or TaskSupervisor(TaskSupervisorStore(app_paths().task_runs_path))
        ).store
        runs = run_store.list_snapshot(
            owner_id=self.principal.actor_id if self.principal else None,
            include_unowned=self.principal is None,
        )
        runs.sort(key=lambda run: (_seconds(run.updated_at), run.task_id), reverse=True)
        attached: set[str] = set()
        for run in runs:
            metadata = _dict(run.metadata)
            thread_id = _text(run.thread_id)
            if self.principal is not None:
                if metadata.get("tenant_id") and metadata["tenant_id"] != self.principal.tenant_id:
                    continue
                if (
                    thread_id
                    and self.decision(thread_id).thread is not None
                    and (not self.decision(thread_id).can_read)
                ):
                    continue
                if not self.history_allowed(thread_id, metadata):
                    continue
            nav_thread = (
                thread_id if thread_id and self.decision(thread_id).thread is not None else None
            )
            candidates = [
                item
                for item in self.business.get(_text(run.origin_task_id), [])
                if _same_work_coordinates(item, thread_id, metadata)
            ]
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
            room = self.navigation_room(nav_thread or "")
            status = run.status.value
            self.items.append(
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

    def response(self, limit: int) -> AssistantActivityResponse:
        self._add_project_tasks()
        self._add_collaboration_tasks()
        self._add_runs()
        order = {"attention": 0, "working": 1, "completed": 2}
        self.items.sort(key=lambda item: (order[item.state], -_seconds(item.updated_at), item.id))
        visible_items = self.items[:limit]
        counts = {state: sum(item.state == state for item in visible_items) for state in order}
        return AssistantActivityResponse(
            items=visible_items,
            summary=AssistantActivitySummary(**counts),
            has_more=len(self.items) > limit,
        )


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
        return _ActivityProjection(
            request,
            supervisor=supervisor,
            project_store=project_store,
            collaboration_store=collaboration_store,
            thread_store=thread_store,
            group_store=group_store,
            team_rooms_router=team_rooms_router,
            identity_store=identity_store,
            require_auth=require_auth,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        ).response(limit)

    return router
