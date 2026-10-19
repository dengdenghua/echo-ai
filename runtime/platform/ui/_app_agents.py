"""Agent + team router wiring for ``create_app``.

Extracted from ``app.py`` during the god-file reduction (§2.3 of the
navigation map). Auto-loads the agent registry when none is supplied,
mounts the agents router + filesystem watcher, and wires the team
rooms / team tasks routers with collaboration projections.
"""

from __future__ import annotations

import logging
from typing import Any

from ._app_context import AppContext


def _collaboration_store_for_app(ctx: Any) -> Any:
    """Use one app-owned canonical store even when the cowork runtime is absent."""
    from runtime.memory.cowork.collaboration_store import CollaborationStore

    store = getattr(ctx.cowork_runtime, "collaboration_store", None)
    if store is None:
        store = getattr(ctx.app.state, "collaboration_store", None)
    if store is None:
        store = CollaborationStore()
    ctx.app.state.collaboration_store = store
    return store


def mount_agents(
    ctx: AppContext,
    *,
    agent_registry: Any,
    group_registry: Any,
) -> None:
    """Mount agents + team-rooms + team-tasks routers; return adv. context."""
    app = ctx.app
    stack = ctx.stack
    state = ctx.state

    # Auto-load agents if registry was not provided (e.g. cli.py failed
    # to build one due to missing runtime deps). This ensures /api/agents
    # is always available so the frontend agent picker works.
    if agent_registry is None:
        try:
            from runtime.execution.agents.base import AgentRegistry
            from runtime.execution.agents.loader import load_all_agents

            agent_registry = AgentRegistry()
            _runtime = stack.runtime if stack is not None else None
            if _runtime is not None:
                for agent in load_all_agents(_runtime):
                    try:
                        agent_registry.register(agent)
                    except (TypeError, ValueError, KeyError):
                        continue
            # Also load admin explicitly (excluded from load_all_agents)
            try:
                from runtime.execution.agents.presets import make_admin_agent

                if _runtime is not None:
                    agent_registry.register(make_admin_agent(_runtime))
            except (
                ImportError,
                AttributeError,
                TypeError,
                ValueError,
            ):  # — optional agent preset; skip if unavailable
                pass
        except (
            ImportError,
            AttributeError,
            TypeError,
            OSError,
        ):  # — optional agent preset group; skip if unavailable
            pass
    ctx.agent_registry = agent_registry

    # The unified subsystem owns every worker's authoritative agent identity.
    if stack is not None:
        try:
            from runtime.safety.evolution.service import get_evolution_service

            get_evolution_service().bind_agent_registry(agent_registry)
        except (ImportError, AttributeError, TypeError) as exc:
            logging.getLogger(__name__).debug("evolution registry bind skipped: %s", exc)

    if agent_registry is not None:
        from runtime.sensing.gateway.agents_router import create_agents_router

        app.include_router(
            create_agents_router(
                registry=agent_registry,
                identity_store=ctx.identity_store,
                require_auth=ctx.require_auth,
                jwt_secret=ctx.jwt_secret,
                jwt_issuer=ctx.jwt_issuer,
                jwt_audience=ctx.jwt_audience,
                journal=state.journal,  # /api/conversations/*
                group_registry=group_registry,  # /api/groups/*
                runtime=stack.runtime if stack is not None else None,  # /api/agents/{id}/reload
                allow_local_workspace_access=ctx.allow_local_workspace_access,
            )
        )

        # Filesystem watcher · auto-reload agents on disk edits.
        # Saves a SOUL.md → watchdog fires → registry.replace() → next
        # turn uses the new persona. Manual POST /api/agents/<id>/reload
        # still works even without watchdog installed. The observer lives
        # with the app lifespan: started on startup, reaped on shutdown.
        if stack is not None and hasattr(stack, "runtime"):
            from runtime.platform.ui.agent_watcher_lifecycle import (
                register_agent_watcher_lifecycle,
            )

            register_agent_watcher_lifecycle(app, registry=agent_registry, runtime=stack.runtime)

    from runtime.platform.ui.team_twin_speaker import make_twin_responder
    from runtime.sensing.gateway.team_rooms_router import create_team_rooms_router

    _collaboration_store_for_app(ctx)

    def _project_room_to_collaboration(room: dict[str, Any]) -> None:
        collab_store = getattr(app.state, "collaboration_store", None)
        upsert_room = getattr(collab_store, "upsert_room_by_id", None)
        if callable(upsert_room):
            upsert_room(room)

    def _delete_room_from_collaboration(room_id: str) -> None:
        collab_store = getattr(app.state, "collaboration_store", None)
        delete_room = getattr(collab_store, "delete_room_by_id", None)
        if callable(delete_room):
            delete_room(room_id)

    from ._app_realtime import configure_collaboration_realtime

    configure_collaboration_realtime(ctx)
    team_rooms_router = create_team_rooms_router(
        shared_bus=ctx.shared_realtime,
        live_presence=ctx.live_presence,
        identity_store=ctx.identity_store,
        require_auth=ctx.require_auth,
        jwt_secret=ctx.jwt_secret,
        jwt_issuer=ctx.jwt_issuer,
        jwt_audience=ctx.jwt_audience,
        reset_callback=getattr(getattr(app.state, "thread_store", None), "clear", None),
        # Bridge bound digital twins to the model router so they actually
        # generate + emit speech when the floor reaches them. None-safe: no
        # router (e.g. no planner) → twins stay silent, human paths unchanged.
        room_projection=_project_room_to_collaboration,
        room_delete_projection=_delete_room_from_collaboration,
        collaboration_store=app.state.collaboration_store,
        group_store=(
            getattr(ctx.cowork_runtime, "group_store", None)
            if ctx.cowork_runtime is not None
            else None
        ),
        twin_responder=make_twin_responder(stack),
    )
    app.state.team_rooms_router = team_rooms_router
    app.include_router(team_rooms_router)
    ctx.team_rooms_router = team_rooms_router

    # Team tasks: persistent task units inside team rooms (HACO M0).
    # Same auth knobs as team_rooms_router so a single actor flows through.
    from runtime.sensing.gateway.team_tasks_router import create_team_tasks_router

    _broadcast_room = getattr(team_rooms_router, "broadcast", None)
    _resolve_room_members = getattr(team_rooms_router, "list_room_members", None)
    _resolve_room_participant = getattr(team_rooms_router, "get_room_participant", None)

    async def _team_event_broadcaster(room_id: str, payload: dict[str, Any]) -> None:
        sync = getattr(
            getattr(app.state, "company_router", None),
            "sync_team_task_event",
            None,
        )
        if callable(sync):
            try:
                sync(payload)
            except Exception:  # noqa: BLE001
                logging.getLogger(__name__).warning(
                    "company task sync failed for team event",
                    exc_info=True,
                )
        # _broadcast has a kw-only ``exclude`` arg; the team-tasks router
        # uses a 2-arg shape, so we adapt here rather than leaking the
        # rooms-router signature through the tasks router contract.
        if _broadcast_room is None:
            return
        await _broadcast_room(room_id, payload)

    team_tasks_router = create_team_tasks_router(
        collaboration_store=app.state.collaboration_store,
        workspace_root=ctx.thread_workspace_root,
        logs_root=(ctx.paths.data_dir / "threads" if ctx.paths is not None else None),
        identity_store=ctx.identity_store,
        require_auth=ctx.require_auth,
        jwt_secret=ctx.jwt_secret,
        jwt_issuer=ctx.jwt_issuer,
        jwt_audience=ctx.jwt_audience,
        team_event_broadcaster=(_team_event_broadcaster if _broadcast_room is not None else None),
        room_membership_resolver=_resolve_room_members,
        room_participant_resolver=_resolve_room_participant,
    )
    app.state.team_tasks_router = team_tasks_router
    app.include_router(team_tasks_router)
    ctx.team_tasks_router = team_tasks_router
