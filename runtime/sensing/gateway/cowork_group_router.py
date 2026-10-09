"""Thread-group API: WeChat-style membership + mode + shared blackboard.

A thread *is* the group (1:1 = the N=2 case), so these endpoints hang off the
thread id. In shared/authenticated deployments every read and write is bound to
the server-owned thread principal; local no-auth mode keeps the original
single-user behaviour. Mutations are attributed to the resolved actor.

Path is ``/api/cowork/*`` to avoid colliding with ``/api/groups/*`` (which is the
static AgentGroupRegistry of agent-team *templates*, a different concept).
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import suppress
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from runtime.memory.cowork.async_work import AsyncWorkQueueFullError
from runtime.memory.cowork.group import (
    LEGACY_PROJECT_MODE,
    ContextGrant,
    MemberEvent,
    normalize_member_kind,
    responders,
)
from runtime.memory.cowork.group_store import GroupStore
from runtime.memory.cowork.service import set_driver

from ._cowork_group_collector_endpoints import (
    _register_collector_cancel,
    _register_collector_retry,
)
from ._cowork_group_deps import CoworkGroupDeps, _require_thread_path, build_cowork_group_deps
from ._cowork_group_models import (
    AssignBody,
    BoardBody,
    BreakoutBody,
    CompleteBody,
    DriverBody,
    HeartbeatBody,
    InviteBody,
    MergeBody,
    ModeBody,
    ReadBody,
    RosterBody,
    response_mode,
)
from ._cowork_group_models import GrantBody as GrantBody
from ._cowork_group_room_endpoints import (
    _register_room_link,
    _register_room_messages,
    _register_room_social,
)
from ._cowork_group_run_endpoints import (
    _register_collab_runs,
    _register_collector_child_controls,
    _register_deliveries,
)


def create_cowork_group_router(
    *,
    store: GroupStore | None = None,
    async_store: Any = None,
    collaboration_store: Any = None,
    room_message_store: Any = None,
    team_rooms_state_path: Any = None,
    team_tasks_state_path: Any = None,
    team_rooms_router: Any = None,
    team_tasks_router: Any = None,
    runtime: Any = None,
    project_store: Any = None,
    identity_store: Any = None,
    require_auth: bool = False,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
) -> APIRouter:
    """Create the ``/api/cowork/*`` thread-group router."""
    d = build_cowork_group_deps(
        store=store,
        async_store=async_store,
        collaboration_store=collaboration_store,
        room_message_store=room_message_store,
        team_rooms_state_path=team_rooms_state_path,
        team_tasks_state_path=team_tasks_state_path,
        team_rooms_router=team_rooms_router,
        team_tasks_router=team_tasks_router,
        runtime=runtime,
        project_store=project_store,
        identity_store=identity_store,
        require_auth=require_auth,
        jwt_secret=jwt_secret,
        jwt_issuer=jwt_issuer,
        jwt_audience=jwt_audience,
    )
    group_store = d.group_store
    thread_access = d.thread_access
    access = d.access
    _collaboration_store = d.collaboration_store
    _async_store = d.async_store
    _thread_access_dep = d.thread_access_dep

    router = APIRouter(tags=["cowork"], dependencies=[Depends(_thread_access_dep)])

    from runtime.memory.cowork.coordination_service import CoordinationService

    from ._cowork_coordination import mount_coordination_routes

    coordination = getattr(runtime, "coordination", None) or CoordinationService(
        group_store, _collaboration_store(), _async_store(), getattr(runtime, "thread_store", None)
    )

    def _coordination_authorized(thread: str, actor: str, tenant: str, write: bool) -> bool:
        if not require_auth:
            return True
        decision = thread_access.resolve(thread, actor, tenant)
        return decision.can_write if write else decision.can_read

    coordination.authorize = _coordination_authorized
    mount_coordination_routes(
        router,
        coordination,
        access,
        runtime,
        invite=lambda thread, member, request: invite_member(
            thread,
            InviteBody(target_id=member),
            request,
        ),
    )

    # Registration order is FastAPI's path-matching priority — keep it.
    _register_group_reads(router, d)
    _register_collab_runs(router, d)
    _register_collector_child_controls(router, d)
    _register_collector_retry(router, d)
    _register_collector_cancel(router, d)
    _register_deliveries(router, d)
    _register_room_social(router, d)
    _register_room_link(router, d)
    _register_room_messages(router, d)
    _register_turn_and_presence(router, d)
    _register_tasks_and_breakouts(router, d)
    invite_member = _register_membership(router, d)

    return router


def _register_group_reads(router: APIRouter, d: CoworkGroupDeps) -> None:
    """Folded group state, the trust report, and the unified session read."""
    group_store = d.group_store
    _principal = d.principal
    _project_store = d.project_store
    _require_room_member = d.require_room_member
    _session_payload = d.session_payload

    @router.get("/api/cowork/{thread_id}")
    def get_group(thread_id: str, until_seq: int | None = None) -> dict[str, Any]:
        """Folded group state (roster + mode), the shared blackboard, the raw
        membership timeline, and who would respond this turn under the mode.
        ``until_seq`` replays the group as it was at that event (time-travel)."""
        state = group_store.state(thread_id, until_seq=until_seq)
        return {
            "thread_id": thread_id,
            "state": state.to_dict(),
            "blackboard": group_store.blackboard_snapshot(thread_id),
            "events": [e.to_dict() for e in group_store.events(thread_id)],
            "responders": responders(state),
        }

    @router.get("/api/cowork/{thread_id}/trust")
    def get_trust(thread_id: str, request: Request) -> dict[str, Any]:
        """闲鱼式成员信任分：交付记录（封签链）+ 接管历史 → 可解释分数。

        信号全部来自已封签的事件源（成员时间线、任务审核链），评分权重
        显式暴露在响应里。外包/外部成员进群前先看这一眼。"""
        state = group_store.state(thread_id)
        events = group_store.events(thread_id)
        tasks: list[dict[str, Any]] = []
        try:
            project_store = _project_store()
            principal = _principal(request)
            if principal is not None:
                from runtime.safety.auth.scope import scope_from_principal

                scope = scope_from_principal(
                    principal,
                    allow_cross_tenant=bool(principal.roles.intersection({"admin", "operator"})),
                )
                with_scope = getattr(project_store, "with_scope", None)
                if callable(with_scope):
                    project_store = with_scope(scope)
            project = project_store.project_for_thread(thread_id)
            if project is not None:
                for milestone in project_store.milestones_for(project.id):
                    tasks.extend(
                        task.to_dict() for task in project_store.tasks_for_milestone(milestone.id)
                    )
        except Exception as exc:  # noqa: BLE001 — trust degrades to roster-only
            _logger = __import__("logging").getLogger("echo.cowork")
            _logger.warning("trust report project read failed for %s: %s", thread_id, exc)
        from runtime.memory.cowork.trust import trust_report

        report = trust_report(state, tasks, events)
        return {"thread_id": thread_id, **report}

    @router.get("/api/collab/{thread_id}")
    def get_session(thread_id: str, request: Request) -> dict[str, Any]:
        """Unified collaboration session — one read over roster/mode/room link,
        shared blackboard, async tasks, and presence (instead of stitching the
        per-surface endpoints). The cowork thread is the canonical session; a
        Team Room is its optional linked surface."""
        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        return _session_payload(thread_id)


def _register_turn_and_presence(router: APIRouter, d: CoworkGroupDeps) -> None:
    """Turn nomination, session search, presence / read markers, catch-up."""
    group_store = d.group_store
    collaboration_store = d.injected_collaboration_store
    session_view = d.session_view
    _require_room_member = d.require_room_member
    _async_store = d.async_store
    _room_tasks = d.room_tasks
    _presence_store = d.presence_store
    _auth_dep = d.auth_dep

    @router.get("/api/cowork/{thread_id}/nominate")
    def nominate_turn(thread_id: str, text: str = "", threshold: float = 0.5) -> dict[str, Any]:
        """Self-nomination gate: of the participant agents, who is relevant enough
        to speak for ``text`` — so a swarm doesn't pile on every turn."""
        from runtime.memory.cowork.nominate import gate

        state = group_store.state(thread_id)
        participants = [
            (m.id, m.id)
            for m in state.roster
            if m.kind == "agent" and m.role == "participant" and not m.muted
        ]
        return {"nominated": gate(participants, text, threshold=threshold)}

    @router.get("/api/cowork/{thread_id}/search")
    def search(
        thread_id: str,
        request: Request,
        q: str = "",
        limit: int = 20,
        kinds: str = "",
        until_seq: int | None = None,
    ) -> dict[str, Any]:
        """Replayable, session-wide search across the shared blackboard, async
        tasks, the membership/mode event log, and (when a room is linked) the
        room transcript + team tasks. ``kinds`` is a comma-separated subset of
        ``blackboard,task,event,room_message,room_task`` (default all);
        ``until_seq`` bounds the event scan to a past point (time-travel)."""
        from runtime.memory.cowork.search import search_group

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        kind_filter = tuple(k.strip() for k in kinds.split(",") if k.strip()) or None
        hits = search_group(
            group_store,
            thread_id,
            q,
            limit=max(1, min(100, limit)),
            kinds=kind_filter,
            until_seq=until_seq,
            async_store=_async_store(),
            room_message_store=session_view.message_search(thread_id),
            room_task_provider=_room_tasks,
        )
        return {"thread_id": thread_id, "query": q, "hits": [h.to_dict() for h in hits]}

    @router.get("/api/cowork/{thread_id}/presence")
    def presence(thread_id: str, online_window_s: int = 60) -> dict[str, Any]:
        """Per-member presence + unread for the thread's roster. Unread counts
        group events past each member's read marker (floored at their join)."""
        from runtime.memory.cowork.presence import group_presence

        message_head: int | None = None
        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id and collaboration_store is not None:
            messages_for_room = getattr(collaboration_store, "messages_for_room", None)
            if callable(messages_for_room):
                with suppress(Exception):
                    latest = messages_for_room(room_id, limit=1, after_seq=0)
                    if latest:
                        message_head = max(int(item.get("seq", 0) or 0) for item in latest)
        members = group_presence(
            group_store,
            _presence_store(),
            thread_id,
            online_window_s=max(1, online_window_s),
            message_head=message_head,
        )
        return {"thread_id": thread_id, "members": [m.to_dict() for m in members]}

    @router.post("/api/cowork/{thread_id}/read", dependencies=[Depends(_auth_dep)])
    def mark_read(thread_id: str, body: ReadBody) -> dict[str, Any]:
        """Mark ``member_id`` caught up to ``seq`` (default: the current event
        head). The marker is monotonic — it never rewinds."""
        if body.message_seq is not None:
            _presence_store().mark_read(
                thread_id,
                body.member_id,
                int(body.message_seq),
                coordinate="message",
            )
            return {"ok": True, **_presence_store().get(thread_id, body.member_id)}
        seq = body.seq
        if seq is None:
            events = group_store.events(thread_id)
            seq = max((e.seq for e in events), default=0)
        _presence_store().mark_read(thread_id, body.member_id, int(seq))
        return {"ok": True, **_presence_store().get(thread_id, body.member_id)}

    @router.post("/api/cowork/{thread_id}/heartbeat", dependencies=[Depends(_auth_dep)])
    def heartbeat(thread_id: str, body: HeartbeatBody) -> dict[str, Any]:
        """Presence ping — refresh ``member_id``'s online status."""
        _presence_store().heartbeat(thread_id, body.member_id)
        return {"ok": True, **_presence_store().get(thread_id, body.member_id)}

    @router.get("/api/cowork/{thread_id}/catchup/{member_id}")
    def catchup(thread_id: str, member_id: str) -> dict[str, Any]:
        """Catch-up brief for a member (roster + shared board + grant scope). The
        realtime layer fills in recent messages via build_catchup in-process."""
        from runtime.memory.cowork.catchup import build_catchup

        cu = build_catchup(
            group_store.state(thread_id),
            member_id,
            messages=[],
            blackboard=group_store.blackboard_snapshot(thread_id),
        )
        if cu is None:
            raise HTTPException(404, "member not in group")
        return {**cu.to_dict(), "render": cu.render()}


def _register_tasks_and_breakouts(router: APIRouter, d: CoworkGroupDeps) -> None:
    """Async cowork tasks, thread health, breakouts, turn plan, member view."""
    group_store = d.group_store
    runtime = d.runtime
    _async_store = d.async_store
    _presence_store = d.presence_store
    _actor = d.actor
    _require_owned_thread = d.require_owned_thread
    _auth_dep = d.auth_dep
    _owner_dep = d.owner_dep

    @router.get("/api/cowork/{thread_id}/tasks")
    def list_tasks(thread_id: str) -> dict[str, Any]:
        """Background tasks in this thread (async coworkers)."""
        return {"tasks": [t.to_dict() for t in _async_store().list(thread_id)]}

    @router.get("/api/cowork/{thread_id}/tasks/summary")
    def tasks_summary(thread_id: str) -> dict[str, Any]:
        """Small operational summary for async cowork task badges/health."""
        store = _async_store()
        if runtime is not None and hasattr(runtime, "status"):
            status = runtime.status(thread_id)
        else:
            status = {
                "runner_enabled": False,
                "runner_reason": "runtime not attached",
                "task_counts": store.counts(thread_id),
            }
        status.setdefault("queue_health", store.queue_health(thread_id))
        return {"thread_id": thread_id, **status}

    @router.get("/api/cowork/{thread_id}/health")
    def health(thread_id: str) -> dict[str, Any]:
        """Unified operational health for a collaboration thread — one call for
        an ops panel: runner state, task queue + failure reasons, presence,
        mode/roster, and recent events. Read-only (like presence/search)."""
        from runtime.memory.cowork.presence import group_presence

        async_store = _async_store()
        tasks = async_store.list(thread_id)
        failures = [
            {"task_id": t.task_id, "assignee": t.assignee, "error": t.result or ""}
            for t in tasks
            if getattr(t, "status", "") == "failed"
        ][:10]
        if runtime is not None and hasattr(runtime, "status"):
            rstatus = runtime.status(thread_id)
            runner = {
                "enabled": bool(rstatus.get("runner_enabled")),
                "reason": rstatus.get("runner_reason") or "",
                "status": rstatus.get("runner_status"),
            }
        else:
            runner = {"enabled": False, "reason": "runtime not attached", "status": None}

        state = group_store.state(thread_id)
        members = group_presence(group_store, _presence_store(), thread_id)
        events = group_store.events(thread_id)
        return {
            "thread_id": thread_id,
            "mode": state.mode,
            "roster_size": len(state.roster),
            "runner": runner,
            "tasks": {
                "counts": async_store.counts(thread_id),
                "failures": failures,
                "queue": async_store.queue_health(thread_id),
            },
            "presence": {
                "members": len(members),
                "online": sum(1 for m in members if m.online),
                "unread": sum(m.unread for m in members),
            },
            "recent_events": [e.to_dict() for e in events[-10:]],
        }

    @router.post("/api/cowork/{thread_id}/tasks", dependencies=[Depends(_auth_dep)])
    def assign_task(thread_id: str, body: AssignBody, request: Request) -> dict[str, Any]:
        """Give a member a task to work in the background; result lands on the
        shared blackboard when complete."""
        async_tasks = _async_store()
        try:
            task = async_tasks.assign(
                thread_id,
                body.assignee,
                body.prompt,
                actor=_actor(request),
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
        return {"ok": True, "task": task.to_dict()}

    @router.post(
        "/api/cowork/{thread_id}/tasks/{task_id}/complete", dependencies=[Depends(_auth_dep)]
    )
    def complete_task(thread_id: str, task_id: str, body: CompleteBody) -> dict[str, Any]:
        """A runner reports a background task done — posts the result to the board."""
        async_store = _async_store()
        task = async_store.get(task_id)
        if task is None or task.thread_id != thread_id:
            raise HTTPException(404, "task not found")
        if task.status == "pending":
            async_store.claim(task_id)
        ok = async_store.complete(task_id, body.result, blackboard_key=body.blackboard_key)
        if not ok:
            raise HTTPException(409, "task is not claimable")
        return {"ok": True, "blackboard": group_store.blackboard_snapshot(thread_id)}

    @router.post("/api/cowork/{thread_id}/breakout", dependencies=[Depends(_owner_dep)])
    def breakout_fork(thread_id: str, body: BreakoutBody, request: Request) -> dict[str, Any]:
        """Spin off a focused side-thread with a subset of members + a grant."""
        from runtime.memory.cowork.breakout import fork
        from runtime.memory.cowork.group import ContextGrant

        _require_thread_path(body.child_thread)
        # Authenticated child threads must already have been created through
        # the canonical thread/realtime flow, which provisions server-owned
        # workspace metadata. Cowork must not mint an unmanaged parallel id.
        _require_owned_thread(body.child_thread, request)
        res = fork(
            group_store,
            thread_id,
            body.child_thread,
            actor=_actor(request),
            members=body.members,
            grant=ContextGrant.from_dict(body.grant),
            at_message=body.at_message,
        )
        return {"ok": True, **res}

    @router.post(
        "/api/cowork/{thread_id}/breakout/{child_thread}/merge",
        dependencies=[Depends(_owner_dep)],
    )
    def breakout_merge(
        thread_id: str, child_thread: str, body: MergeBody, request: Request
    ) -> dict[str, Any]:
        """Merge a breakout's conclusion back onto the parent's blackboard."""
        from runtime.memory.cowork.breakout import merge_back

        _require_thread_path(child_thread)
        _require_owned_thread(child_thread, request)
        res = merge_back(
            group_store, child_thread, thread_id, actor=_actor(request), summary=body.summary
        )
        return {"ok": True, **res, "blackboard": group_store.blackboard_snapshot(thread_id)}

    @router.get("/api/cowork/{thread_id}/plan")
    def plan(thread_id: str, text: str = "") -> dict[str, Any]:
        """Given a draft message, who would act this turn and how (mode →
        single / cluster / swarm), honouring @agent mentions. The realtime
        driver reads this to dispatch without a manual mode switch."""
        from runtime.memory.cowork.turn_plan import plan_turn_for_thread

        return plan_turn_for_thread(group_store, thread_id, text).to_dict()

    @router.get("/api/cowork/{thread_id}/view/{member_id}")
    def member_view(thread_id: str, member_id: str, max_message: int = 0) -> dict[str, Any]:
        """The history slice ``member_id`` is allowed to see at ``max_message``
        (their context grant resolved). The context assembler uses this to bound
        what reaches the agent's prompt — the enforcement half of the privacy seam."""
        from runtime.memory.cowork.context_view import resolve_view

        view = resolve_view(group_store.state(thread_id), member_id, max_message)
        if view is None:
            raise HTTPException(404, "member not in group")
        return view.to_dict()


def _register_membership(
    router: APIRouter, d: CoworkGroupDeps
) -> Callable[[str, InviteBody, Request], dict[str, Any]]:
    """Roster membership, takeover driver, response mode, and the blackboard.

    Returns the ``invite_member`` endpoint: the coordination routes mounted
    before it invite members through the very same function.
    """
    group_store = d.group_store
    _actor = d.actor
    _project_linked_room_roster = d.project_linked_room_roster
    _ensure_project_for_thread = d.ensure_project_for_thread
    _owner_dep = d.owner_dep
    _auth_dep = d.auth_dep

    @router.post("/api/cowork/{thread_id}/members", dependencies=[Depends(_owner_dep)])
    def invite_member(thread_id: str, body: InviteBody, request: Request) -> dict[str, Any]:
        """Reference a canonical agent (or human, or 数字员工) from this thread.

        Retrying the same add is a successful no-op.  The group stores only the
        canonical id; it does not clone a role, home, memory, or owner lane.
        ``kind="role"`` requires ``owner`` — the human who answers for it."""
        member_kind = normalize_member_kind(body.kind)
        ev = MemberEvent(
            action="invite",
            actor=_actor(request),
            target_id=body.target_id,
            target_kind=member_kind,
            role="observer" if body.role == "observer" else "participant",
            grant=ContextGrant.from_dict(body.grant.model_dump()),
            at_message=body.at_message,
            owner=str(body.owner or "").strip() if member_kind == "role" else "",
        )
        if member_kind == "role" and not ev.owner:
            raise HTTPException(400, "a role member requires an accountable owner")
        try:
            changed, state = group_store.ensure_member(thread_id, ev)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        result: dict[str, Any] = {
            "ok": True,
            "added": changed is not None,
            "state": state.to_dict(),
        }
        projection = _project_linked_room_roster(thread_id, request, state)
        if projection is not None:
            result["room_projection"] = projection
        return result

    @router.delete(
        "/api/cowork/{thread_id}/members/{member_id}", dependencies=[Depends(_owner_dep)]
    )
    def remove_member(thread_id: str, member_id: str, request: Request) -> dict[str, Any]:
        """Remove a session reference idempotently; attributed history stays."""
        try:
            changed, state = group_store.remove_member_if_present(
                thread_id,
                actor=_actor(request),
                member_id=member_id,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        result: dict[str, Any] = {
            "ok": True,
            "removed": changed is not None,
            "state": state.to_dict(),
        }
        projection = _project_linked_room_roster(thread_id, request, state)
        if projection is not None:
            result["room_projection"] = projection
        return result

    @router.post(
        "/api/cowork/{thread_id}/members/{member_id}/driver",
        dependencies=[Depends(_owner_dep)],
    )
    def set_member_driver(
        thread_id: str,
        member_id: str,
        body: DriverBody,
        request: Request,
    ) -> dict[str, Any]:
        """接管 / 交还: hand a member's wheel to its AI or to a person.

        While ``driver="human"`` the member is removed from ``responders`` — the
        AI stands down so no utterance can have two drivers. Takes over a role
        member only when it has an accountable owner. The event is appended, so
        the whole takeover history is replayable and auditable."""
        try:
            ev = set_driver(
                group_store,
                thread_id,
                actor=_actor(request),
                target_id=member_id,
                driver=body.driver,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        state = group_store.state(thread_id)
        result: dict[str, Any] = {
            "ok": True,
            "event": ev.to_dict(),
            "state": state.to_dict(),
        }
        projection = _project_linked_room_roster(thread_id, request, state)
        if projection is not None:
            result["room_projection"] = projection
        return result

    @router.post("/api/cowork/{thread_id}/mode", dependencies=[Depends(_owner_dep)])
    def set_mode(thread_id: str, body: ModeBody, request: Request) -> dict[str, Any]:
        """Switch how AI participants respond: chat, cluster, or swarm.

        ``project`` is accepted only as a deprecated client wire value. It is
        projected to ``chat`` and may attach an idle Project for continuity;
        it is never stored as a fourth response mode and never starts work.
        """
        canonical_mode = response_mode(body.mode)
        group_store.append(
            thread_id,
            MemberEvent(action="mode", actor=_actor(request), mode=canonical_mode),
        )
        bound_project_id: str | None = None
        if body.mode == LEGACY_PROJECT_MODE:
            bound_project_id = _ensure_project_for_thread(thread_id, request)
        state = group_store.state(thread_id).to_dict()
        if bound_project_id is not None:
            state["bound_project_id"] = bound_project_id
        return {"ok": True, "state": state}

    @router.put("/api/cowork/{thread_id}/roster", dependencies=[Depends(_owner_dep)])
    def replace_roster(thread_id: str, body: RosterBody, request: Request) -> dict[str, Any]:
        """Replace the desired agent roster and mode as one atomic mutation.

        Human participants are intentionally untouched. The store calculates
        the diff against its own transactional snapshot, appends only the
        necessary leave/invite/mode events, and returns the canonical fold.
        """

        canonical_mode = response_mode(body.mode)
        try:
            changed, state = group_store.replace_agent_roster(
                thread_id,
                actor=_actor(request),
                agent_ids=body.agent_ids,
                mode=canonical_mode,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        payload = state.to_dict()
        room_projection = _project_linked_room_roster(thread_id, request, state)
        if body.mode == LEGACY_PROJECT_MODE:
            bound_project_id = _ensure_project_for_thread(thread_id, request)
            if bound_project_id is not None:
                payload["bound_project_id"] = bound_project_id
        result = {
            "ok": True,
            "state": payload,
            "events": [event.to_dict() for event in changed],
        }
        if room_projection is not None:
            result["room_projection"] = room_projection
        return result

    @router.post("/api/cowork/{thread_id}/blackboard", dependencies=[Depends(_auth_dep)])
    def write_board(thread_id: str, body: BoardBody, request: Request) -> dict[str, Any]:
        """Write a key to the group's shared blackboard, attributed to the actor."""
        board = group_store.blackboard(thread_id)
        board.write(body.key, body.value, writer=_actor(request))
        return {"ok": True, "blackboard": group_store.blackboard_snapshot(thread_id)}

    return invite_member
