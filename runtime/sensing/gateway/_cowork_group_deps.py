"""Shared dependencies for the ``/api/cowork/*`` thread-group router.

Pure structural split of ``cowork_group_router.create_cowork_group_router`` —
no logic changes. ``build_cowork_group_deps`` builds, once per router, the
stores, access helpers, and route-dependency callables that the factory used
to keep as closures, and hands them to every ``_register_*`` endpoint group as
one ``CoworkGroupDeps`` bundle. Each field is the exact object the endpoints
used to capture, so lazily-built stores and FastAPI dependency identity are
shared across groups just as before.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, Request

from runtime.memory.cowork.group_store import GroupStore
from runtime.memory.threads.event_log import validate_thread_id

from ._cowork_group_access import CoworkGroupAccess
from ._cowork_group_models import EnsureRoomBody
from ._cowork_group_session import CoworkGroupSessionView
from .thread_access import ThreadAccessResolver


@dataclass(frozen=True)
class CoworkGroupDeps:
    """Closures and stores shared by the cowork router's endpoint groups."""

    group_store: GroupStore
    runtime: Any
    # The injected store as passed to the factory (may be ``None``); the
    # ``collaboration_store`` callable below falls back to a default one.
    injected_collaboration_store: Any
    team_rooms_router: Any
    team_tasks_router: Any
    thread_access: ThreadAccessResolver
    session_view: CoworkGroupSessionView
    access: CoworkGroupAccess
    collaboration_store: Callable[[], Any]
    project_store: Callable[[], Any]
    async_store: Callable[[], Any]
    presence_store: Callable[[], Any]
    room_message_store: Callable[[], Any]
    room_tasks: Callable[..., Any]
    room_snapshot: Callable[..., Any]
    session_payload: Callable[..., Any]
    principal: Callable[..., Any]
    require_owned_thread: Callable[..., Any]
    require_room_member: Callable[..., Any]
    actor: Callable[..., Any]
    ensure_project_for_thread: Callable[..., Any]
    ensure_room: Callable[..., Any]
    project_linked_room_roster: Callable[..., Any]
    broadcast_social_change: Callable[..., Any]
    auth_dep: Callable[..., Any]
    owner_dep: Callable[..., Any]
    thread_access_dep: Callable[..., Any]


def _require_thread_path(thread_id: str) -> None:
    try:
        validate_thread_id(thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def _make_ensure_project_for_thread(
    *,
    runtime: Any,
    group_store: GroupStore,
    require_auth: bool,
    principal: Callable[..., Any],
    project_store: Callable[[], Any],
) -> Callable[[str, Request], str | None]:
    _principal = principal
    _project_store = project_store

    def _ensure_project_for_thread(thread_id: str, request: Request) -> str | None:
        """Bind a Project OS project to the thread if none exists yet.

        This compatibility path lets an old client that still submits
        ``mode=project`` attach project state without turning project into a
        response strategy or running any project work. It fails soft when
        planning is unavailable."""
        try:
            from runtime.projectos.cowork_bridge import ensure_project_for_thread

            name = ""
            thread_store = getattr(runtime, "thread_store", None)
            get_state = getattr(thread_store, "get_state", None)
            if callable(get_state):
                try:
                    st = get_state(thread_id)
                    values = st.get("values") if isinstance(st, dict) else None
                    title = values.get("title") if isinstance(values, dict) else None
                    if isinstance(title, str) and title.strip():
                        name = title.strip()
                except Exception:  # noqa: BLE001
                    name = ""
            principal = _principal(request)
            scoped_project_store = _project_store()
            owner_id = ""
            tenant_id = ""
            if principal is not None:
                from runtime.safety.auth.scope import scope_from_principal

                scope = scope_from_principal(
                    principal,
                    allow_cross_tenant=bool(principal.roles.intersection({"admin", "operator"})),
                )
                with_scope = getattr(scoped_project_store, "with_scope", None)
                if not callable(with_scope):
                    raise RuntimeError("scoped project store is unavailable")
                scoped_project_store = with_scope(scope)
                owner_id = principal.actor_id
                tenant_id = principal.tenant_id
            elif require_auth:
                raise RuntimeError("authenticated project principal is unavailable")
            return ensure_project_for_thread(
                scoped_project_store,
                group_store,
                thread_id,
                name=name,
                goal=name,
                owner_id=owner_id,
                tenant_id=tenant_id,
            )
        except Exception as exc:  # noqa: BLE001
            _logger = __import__("logging").getLogger("echo.cowork")
            _logger.warning("legacy project attach failed for %s: %s", thread_id, exc)
            return None

    return _ensure_project_for_thread


def _make_lazy_room_stores(
    *, group_store: GroupStore, room_message_store: Any
) -> tuple[Callable[[], Any], Callable[[], Any]]:
    """Presence and room-transcript stores, built on first use, once per router."""
    _presence_holder: dict[str, Any] = {}

    def _presence_store():
        store = _presence_holder.get("v")
        if store is None:
            from runtime.memory.cowork.presence import PresenceStore

            store = PresenceStore(base_dir=group_store.base_dir)
            _presence_holder["v"] = store
        return store

    _room_msg_holder: dict[str, Any] = {}

    def _room_message_store():
        if room_message_store is not None:
            return room_message_store
        store = _room_msg_holder.get("v")
        if store is None:
            from runtime.memory.cowork.room_messages import RoomMessageStore

            # Default teamroom dir — shared with the team_rooms router's store,
            # so a linked room's transcript is the same one it persists.
            store = RoomMessageStore()
            _room_msg_holder["v"] = store
        return store

    return _presence_store, _room_message_store


def _make_project_linked_room_roster(
    *,
    group_store: GroupStore,
    team_rooms_router: Any,
    room_snapshot: Callable[..., Any],
    room_members_for_projection: Callable[..., Any],
    collaboration_store: Callable[[], Any],
) -> Callable[[str, Request, Any], dict[str, Any] | None]:
    _room_snapshot = room_snapshot
    _room_members_for_projection = room_members_for_projection
    _collaboration_store = collaboration_store

    def _project_linked_room_roster(
        thread_id: str,
        request: Request,
        state: Any,
    ) -> dict[str, Any] | None:
        """Keep the optional Team Room read model aligned with GroupStore."""

        room_id = str(getattr(state, "room_id", None) or "").strip()
        if not room_id:
            return None
        roster_projector = getattr(team_rooms_router, "replace_team_agent_members", None)
        if not callable(roster_projector):
            return {"ok": False, "room_id": room_id}
        try:
            projection_state = state
            for _attempt in range(5):
                current_room = _room_snapshot(room_id) or {}
                projected_room = roster_projector(
                    request,
                    room_id,
                    _room_members_for_projection(
                        thread_id,
                        existing=current_room.get("members") or [],
                        state=projection_state,
                    ),
                    current_room.get("leaderId"),
                )
                _collaboration_store().upsert_room(thread_id, dict(projected_room))
                latest_state = group_store.state(thread_id)
                if latest_state.event_count == projection_state.event_count:
                    return {"ok": True, "room_id": room_id}
                # Another membership transaction committed while this
                # projection was writing. Re-project the newer generation so
                # a delayed response cannot overwrite the canonical roster.
                projection_state = latest_state
            return {"ok": False, "room_id": room_id, "stale": True}
        except Exception as exc:  # noqa: BLE001 - canonical GroupStore mutation already committed
            __import__("logging").getLogger("echo.cowork").warning(
                "linked room roster projection failed for %s: %s",
                thread_id,
                exc,
            )
            return {"ok": False, "room_id": room_id}

    return _project_linked_room_roster


def build_cowork_group_deps(
    *,
    store: GroupStore | None,
    async_store: Any,
    collaboration_store: Any,
    room_message_store: Any,
    team_rooms_state_path: Any,
    team_tasks_state_path: Any,
    team_rooms_router: Any,
    team_tasks_router: Any,
    runtime: Any,
    project_store: Any,
    identity_store: Any,
    require_auth: bool,
    jwt_secret: str | None,
    jwt_issuer: str | None,
    jwt_audience: str | None,
) -> CoworkGroupDeps:
    """Build the shared state in the same order the factory used to."""
    group_store = store or GroupStore()
    bind_team_group_store = getattr(team_rooms_router, "bind_group_store", None)
    if callable(bind_team_group_store):
        bind_team_group_store(group_store)

    def _collaboration_store():
        if collaboration_store is not None:
            return collaboration_store
        from runtime.memory.cowork.collaboration_store import CollaborationStore

        return CollaborationStore(base_dir=group_store.base_dir)

    def _project_store():
        if project_store is not None:
            return project_store
        from runtime.projectos.store import ProjectStore

        return ProjectStore()

    thread_access = ThreadAccessResolver(
        thread_store=getattr(runtime, "thread_store", None),
        group_store=group_store,
        collaboration_store=collaboration_store,
        team_rooms_router=team_rooms_router,
        identity_store=identity_store,
    )

    def _async_store():
        if async_store is not None:
            return async_store
        from runtime.memory.cowork.async_work import AsyncWorkStore

        return AsyncWorkStore(base_dir=group_store.base_dir, group_store=group_store)

    _presence_store, _room_message_store = _make_lazy_room_stores(
        group_store=group_store, room_message_store=room_message_store
    )

    session_view = CoworkGroupSessionView(
        group_store=group_store,
        collaboration_store=_collaboration_store,
        async_store=_async_store,
        presence_store=_presence_store,
        room_message_store=_room_message_store,
        team_rooms_state_path=team_rooms_state_path,
        team_tasks_state_path=team_tasks_state_path,
    )
    _room_participants = session_view.room_participants
    _room_tasks = session_view.room_tasks
    _room_messages = session_view.room_messages
    _room_snapshot = session_view.room_snapshot
    _session_payload = session_view.session_payload
    _room_members_from_group = session_view.room_members_from_group
    _room_members_for_projection = session_view.room_members_for_projection

    access = CoworkGroupAccess(
        runtime=runtime,
        identity_store=identity_store,
        require_auth=require_auth,
        jwt_secret=jwt_secret,
        jwt_issuer=jwt_issuer,
        jwt_audience=jwt_audience,
        thread_access=thread_access,
        team_rooms_router=team_rooms_router,
        room_snapshot=_room_snapshot,
    )
    _principal = access.principal
    _require_owned_thread = access.require_owned_thread
    _require_collaborative_thread = access.require_collaborative_thread
    _require_room_member = access.require_room_member
    _ensure_project_for_thread = _make_ensure_project_for_thread(
        runtime=runtime,
        group_store=group_store,
        require_auth=require_auth,
        principal=_principal,
        project_store=_project_store,
    )

    async def _ensure_room(
        thread_id: str,
        body: EnsureRoomBody,
        request: Request,
    ) -> tuple[dict[str, Any], bool]:
        from runtime.sensing.gateway._cowork_group_room_ensure import (
            ensure_session_room_fail_safe,
        )

        return await ensure_session_room_fail_safe(
            thread_id=thread_id,
            body=body,
            request=request,
            group_store=group_store,
            team_rooms_router=team_rooms_router,
            room_snapshot=_room_snapshot,
            require_room_member=_require_room_member,
            require_owned_thread=_require_owned_thread,
            room_members_for_projection=_room_members_for_projection,
            room_members_from_group=_room_members_from_group,
            collaboration_store=_collaboration_store,
            actor=_actor,
            ensure_project_for_thread=_ensure_project_for_thread,
        )

    _actor = access.actor
    _project_linked_room_roster = _make_project_linked_room_roster(
        group_store=group_store,
        team_rooms_router=team_rooms_router,
        room_snapshot=_room_snapshot,
        room_members_for_projection=_room_members_for_projection,
        collaboration_store=_collaboration_store,
    )

    def _auth_dep(request: Request) -> None:
        thread_id = str(getattr(request, "path_params", {}).get("thread_id") or "")
        _require_collaborative_thread(thread_id, request, write=True)

    def _owner_dep(request: Request) -> None:
        thread_id = str(getattr(request, "path_params", {}).get("thread_id") or "")
        _require_owned_thread(thread_id, request)

    def _thread_access_dep(thread_id: str, request: Request) -> None:
        _require_thread_path(thread_id)
        _require_collaborative_thread(thread_id, request)

    async def _broadcast_social_change(room_id: str, thread_id: str, reason: str) -> None:
        from .collaboration_events import broadcast_thread_update

        await broadcast_thread_update(
            team_rooms_router,
            room_id=room_id,
            thread_id=thread_id,
            reason=reason,
        )

    return CoworkGroupDeps(
        group_store=group_store,
        runtime=runtime,
        injected_collaboration_store=collaboration_store,
        team_rooms_router=team_rooms_router,
        team_tasks_router=team_tasks_router,
        thread_access=thread_access,
        session_view=session_view,
        access=access,
        collaboration_store=_collaboration_store,
        project_store=_project_store,
        async_store=_async_store,
        presence_store=_presence_store,
        room_message_store=_room_message_store,
        room_tasks=_room_tasks,
        room_snapshot=_room_snapshot,
        session_payload=_session_payload,
        principal=_principal,
        require_owned_thread=_require_owned_thread,
        require_room_member=_require_room_member,
        actor=_actor,
        ensure_project_for_thread=_ensure_project_for_thread,
        ensure_room=_ensure_room,
        project_linked_room_roster=_project_linked_room_roster,
        broadcast_social_change=_broadcast_social_change,
        auth_dep=_auth_dep,
        owner_dep=_owner_dep,
        thread_access_dep=_thread_access_dep,
    )
