"""Shared state and access helpers for the Project OS router.

Pure structural split of ``projects_router.create_projects_router`` — no
logic changes. ``build_projects_deps`` builds, once per router and in the
original order, the stores, principal/scope helpers, execution-scope
helpers and project ACL helpers the factory used to keep as closures, and
returns them as one ``ProjectsDeps`` bundle.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, Request

from runtime.projectos.cowork_bridge import (
    full_project_state,
)
from runtime.projectos.engine import (
    ProjectEngine,
    stub_decompose_tasks,
    stub_generate_milestones,
)
from runtime.projectos.store import (
    ProjectStore,
)
from runtime.safety.auth.principal import CurrentPrincipal, resolve_principal
from runtime.safety.auth.scope import TenantScope, scope_from_principal
from runtime.sensing.gateway._projects_group_projections import (
    ProjectGroupProjectionContext,
)
from runtime.sensing.gateway.thread_access import ThreadAccessResolver


@dataclass(frozen=True)
class ProjectsDeps:
    """Per-router stores and closures shared by the endpoint groups."""

    project_store: ProjectStore
    collaboration_store: Any
    team_rooms_router: Any
    thread_store: Any
    workspace_root: Any
    require_auth: bool
    subagent_runner: Any
    thread_access: ThreadAccessResolver
    projections: ProjectGroupProjectionContext
    group_store: Callable[[], Any]
    base_hooks: Callable[[], dict[str, Any]]
    principal: Callable[[Request], CurrentPrincipal | None]
    scoped_store: Callable[[Request], ProjectStore]
    engine: Callable[..., ProjectEngine]
    execution_context_resolver: Callable[..., Any]
    require_execution_context: Callable[[Request, str], None]
    thread_execution_scope: Callable[..., Any]
    project_execution_scope: Callable[[Request, str], Any]
    auth_dep: Callable[[Request], None]
    bad_request: Callable[[ValueError], HTTPException]
    project_or_404: Callable[..., Any]
    project_read_store: Callable[[Request, Any], ProjectStore]
    # The ``_thread_access`` closure (a request-level ACL check); not to be
    # confused with the ``thread_access`` resolver above.
    check_thread_access: Callable[..., CurrentPrincipal | None]
    full_state: Callable[..., dict[str, Any]]
    visible_projects: Callable[[Request], list[Any]]
    project_to_collaboration: Callable[..., Any]
    project_group_projections: Callable[..., Any]
    clear_project_group_projections: Callable[..., Any]


def _make_execution_scopes(
    *,
    require_auth: bool,
    thread_store: Any,
    workspace_root: Any,
    logs_root: Any,
    principal: Callable[[Request], CurrentPrincipal | None],
    scoped_store: Callable[[Request], ProjectStore],
) -> tuple[Callable[..., Any], Callable[..., None], Callable[..., Any], Callable[..., Any]]:
    _principal = principal
    _scoped_store = scoped_store

    def _execution_context_resolver(principal: CurrentPrincipal | None = None):
        if not require_auth:
            return None

        def _resolve(thread_id: str) -> dict[str, Any]:
            if not thread_id or thread_store is None or not hasattr(thread_store, "get"):
                raise RuntimeError("project must be bound to a managed thread workspace")
            thread = thread_store.get(thread_id)
            raw_metadata = thread.get("metadata") if isinstance(thread, dict) else None
            metadata = raw_metadata if isinstance(raw_metadata, dict) else {}
            if principal is not None and not principal.roles.intersection({"admin", "operator"}):
                if metadata.get("owner_actor_id") != principal.actor_id:
                    raise PermissionError("project thread belongs to another actor")
                stored_tenant = str(metadata.get("tenant_id") or "")
                if stored_tenant != principal.tenant_id:
                    raise PermissionError("project thread belongs to another tenant")
            from runtime.sensing.gateway.thread_workspace import verified_managed_workspace

            workspace = verified_managed_workspace(
                workspace_root,
                thread_id=thread_id,
                metadata=metadata,
            )
            if workspace is None:
                raise RuntimeError("project thread has no verified managed workspace")
            return {
                "workspace_path": str(workspace),
                "runtime_session_metadata": {
                    "workspace_path": str(workspace),
                    "_artifact_output_root": str(workspace / "output" / "final"),
                    "tenant_id": str(metadata.get("tenant_id") or ""),
                    "owner_actor_id": str(metadata.get("owner_actor_id") or ""),
                },
            }

        return _resolve

    def _require_execution_context(request: Request, project_id: str) -> None:
        resolver = _execution_context_resolver(_principal(request))
        if resolver is None:
            return
        thread_id = _scoped_store(request).thread_for_project(project_id) or ""
        try:
            resolver(thread_id)
        except (OSError, PermissionError, RuntimeError, TypeError, ValueError) as exc:
            raise HTTPException(
                409,
                "project execution requires a verified managed thread workspace",
            ) from exc

    @contextmanager
    def _thread_execution_scope(
        request: Request,
        *,
        thread_id: str,
        goal: str,
    ) -> Iterator[None]:
        """Bind one HTTP project action to the unified host task boundary."""

        principal = _principal(request)
        resolver = _execution_context_resolver(principal)
        resolved = resolver(thread_id) if resolver is not None else {}
        raw_metadata = resolved.get("runtime_session_metadata")
        metadata = dict(raw_metadata) if isinstance(raw_metadata, dict) else {}
        workspace = resolved.get("workspace_path")
        if isinstance(workspace, str) and workspace:
            metadata.update(mode="code", workspace_path=workspace)
        metadata["source"] = "projectos_http"

        execution_thread_id = thread_id or f"projectos-{uuid4().hex}"
        execution_task_id = f"projectos-http-{uuid4().hex}"
        recorder = None
        if logs_root is not None:
            from runtime.execution.artifact_contracts import HandoffRecorder
            from runtime.memory.threads.event_log import EventLog, thread_log_path

            log = EventLog(thread_log_path(logs_root, execution_thread_id))

            def read_handoffs() -> tuple[dict[str, Any], ...]:
                return tuple(
                    dict(event.payload)
                    for event in log.iter_events()
                    if event.event == "execution_handoff" and event.thread_id == execution_thread_id
                )

            def write_handoff(receipt: dict[str, Any]) -> None:
                log.execution_handoff(execution_thread_id, execution_task_id, receipt)

            recorder = HandoffRecorder(write_handoff, read_handoffs)

        from runtime.execution.host_boundary import create_host_execution_boundary
        from runtime.execution.request import execution_request_scope
        from runtime.platform.process.session import session_scope

        boundary = create_host_execution_boundary(
            task_id=execution_task_id,
            thread_id=execution_thread_id,
            goal=goal,
            timeout_s=900.0,
            actor_id=(principal.actor_id if principal is not None else None),
            tenant_id=(principal.tenant_id if principal is not None else None),
            metadata=metadata,
            handoff_recorder=recorder,
        )
        with execution_request_scope(boundary.request), session_scope(boundary.session):
            yield

    def _project_execution_scope(request: Request, project_id: str) -> Any:
        scoped = _scoped_store(request)
        project = scoped.get_project(project_id)
        if project is None:
            raise HTTPException(404, "project not found")
        thread_id = scoped.thread_for_project(project_id) or ""
        return _thread_execution_scope(
            request,
            thread_id=thread_id,
            goal=project.goal,
        )

    return (
        _execution_context_resolver,
        _require_execution_context,
        _thread_execution_scope,
        _project_execution_scope,
    )


def _make_project_access(
    *,
    project_store: ProjectStore,
    thread_store: Any,
    thread_access: ThreadAccessResolver,
    principal: Callable[[Request], CurrentPrincipal | None],
    scoped_store: Callable[[Request], ProjectStore],
) -> tuple[Callable[..., Any], ...]:
    _principal = principal
    _scoped_store = scoped_store

    def _bad_request(exc: ValueError) -> HTTPException:
        return HTTPException(400, str(exc))

    def _project_or_404(
        request: Request,
        project_id: str,
        *,
        allow_operator: bool = True,
        allow_collaborator_read: bool = False,
    ):
        try:
            project = _scoped_store(request).get_project(project_id)
        except ValueError as exc:
            raise _bad_request(exc) from exc
        principal = _principal(request)
        if project is None and allow_collaborator_read and principal is not None:
            # Owner-scoped storage intentionally hides another actor's row.
            # Resolve the raw record only long enough to prove its tenant and
            # linked canonical-thread ACL; subsequent reads use the persisted
            # project owner's scope, never the caller's arbitrary input.
            try:
                candidate = project_store.get_project(project_id)
            except ValueError as exc:
                raise _bad_request(exc) from exc
            if candidate is not None and candidate.tenant_id == principal.tenant_id:
                thread_id = project_store.thread_for_project(project_id) or ""
                decision = thread_access.resolve(
                    thread_id,
                    principal.actor_id,
                    principal.tenant_id,
                )
                if decision.can_read:
                    project = candidate
        if project is None:
            raise HTTPException(404, "project not found")
        if principal is not None:
            global_operator = bool(principal.roles.intersection({"admin", "operator"}))
            if not project.owner_id or not project.tenant_id:
                if not (allow_operator and global_operator):
                    raise HTTPException(404, "project not found")
            elif project.tenant_id != principal.tenant_id:
                raise HTTPException(404, "project not found")
            elif project.owner_id != principal.actor_id and not global_operator:
                if not allow_collaborator_read:
                    raise HTTPException(404, "project not found")
                thread_id = project_store.thread_for_project(project_id) or ""
                decision = thread_access.resolve(
                    thread_id,
                    principal.actor_id,
                    principal.tenant_id,
                )
                if not decision.can_read:
                    raise HTTPException(404, "project not found")
        return project

    def _project_read_store(request: Request, project: Any) -> ProjectStore:
        principal = _principal(request)
        if principal is None or principal.roles.intersection({"admin", "operator"}):
            return _scoped_store(request)
        if project.owner_id == principal.actor_id:
            return _scoped_store(request)
        return project_store.with_scope(
            TenantScope(
                tenant_id=str(project.tenant_id or ""),
                actor_id=str(project.owner_id or ""),
            )
        )

    def _thread_access(
        request: Request,
        thread_id: str,
        *,
        write: bool = False,
    ) -> CurrentPrincipal | None:
        principal = _principal(request)
        if principal is None:
            return None
        if thread_store is None or not hasattr(thread_store, "get"):
            raise HTTPException(503, "thread ownership unavailable")
        if principal.roles.intersection({"admin", "operator"}):
            return principal
        decision = thread_access.resolve(thread_id, principal.actor_id, principal.tenant_id)
        allowed = decision.can_manage if write else decision.can_read
        if not allowed:
            raise HTTPException(404, "thread not found")
        return principal

    def _full_state(
        request: Request,
        project_id: str,
        *,
        allow_collaborator_read: bool = False,
    ) -> dict[str, Any]:
        project = _project_or_404(
            request,
            project_id,
            allow_collaborator_read=allow_collaborator_read,
        )
        try:
            state = full_project_state(_project_read_store(request, project), project_id)
        except ValueError as exc:
            raise _bad_request(exc) from exc
        if state is None:
            raise HTTPException(404, "project not found")
        return state

    def _visible_projects(request: Request) -> list[Any]:
        """Projects the caller may see, using the list-endpoint rules.

        Kept as one helper so ``/api/projects`` and ``/api/projects/portfolio``
        cannot drift apart — a difference here would leak another tenant's
        project into the cross-project roll-up.
        """
        principal = _principal(request)
        projects = (
            project_store.list_projects()
            if principal is not None
            else _scoped_store(request).list_projects()
        )
        if principal is None:
            return projects
        global_operator = bool(principal.roles.intersection({"admin", "operator"}))
        visible: list[Any] = []
        for project in projects:
            if project.tenant_id and project.tenant_id != principal.tenant_id:
                continue
            if not project.owner_id or not project.tenant_id:
                if global_operator:
                    visible.append(project)
                continue
            if project.owner_id == principal.actor_id or global_operator:
                visible.append(project)
                continue
            thread_id = project_store.thread_for_project(project.id) or ""
            if thread_access.resolve(
                thread_id,
                principal.actor_id,
                principal.tenant_id,
            ).can_read:
                visible.append(project)
        return visible

    return (
        _bad_request,
        _project_or_404,
        _project_read_store,
        _thread_access,
        _full_state,
        _visible_projects,
    )


def build_projects_deps(
    *,
    store: ProjectStore | None,
    group_store: Any,
    collaboration_store: Any,
    team_rooms_router: Any,
    thread_store: Any,
    workspace_root: Any,
    logs_root: Any,
    model_router: Any,
    planning_model: str | None,
    subagent_runner: Any,
    identity_store: Any,
    require_auth: bool,
    jwt_secret: str | None,
    jwt_issuer: str | None,
    jwt_audience: str | None,
) -> ProjectsDeps:
    """Build the shared state in the order the factory used to."""
    project_store = store or ProjectStore()
    bind_team_project_store = getattr(team_rooms_router, "bind_project_store", None)
    if callable(bind_team_project_store):
        bind_team_project_store(project_store)

    def _group_store():
        if group_store is not None:
            return group_store
        from runtime.memory.cowork.group_store import GroupStore

        return GroupStore()

    thread_access = ThreadAccessResolver(
        thread_store=thread_store,
        group_store=_group_store(),
        collaboration_store=collaboration_store,
        team_rooms_router=team_rooms_router,
        identity_store=identity_store,
    )

    def _base_hooks() -> dict[str, Any]:
        """Intelligence hooks: LLM when a model router is available, else stubs."""
        if model_router is not None:
            from runtime.projectos.llm_hooks import create_llm_hooks

            return create_llm_hooks(
                model_router,
                **({"model": planning_model} if planning_model else {}),
                subagent_runner=subagent_runner,
            )
        return {
            "generate_milestones": stub_generate_milestones,
            "decompose_tasks": stub_decompose_tasks,
        }

    def _principal(request: Request) -> CurrentPrincipal | None:
        principal = resolve_principal(
            request,
            identity_store,
            require_auth,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )
        if principal is not None:
            request.state.project_principal = principal
        return principal

    def _scoped_store(request: Request) -> ProjectStore:
        principal = _principal(request)
        if principal is None:
            return project_store
        allow_cross_tenant = bool(principal.roles.intersection({"admin", "operator"}))
        return project_store.with_scope(
            scope_from_principal(principal, allow_cross_tenant=allow_cross_tenant)
        )

    def _engine(principal: CurrentPrincipal | None = None) -> ProjectEngine:
        scope = scope_from_principal(
            principal,
            allow_cross_tenant=bool(
                principal is not None and principal.roles.intersection({"admin", "operator"})
            ),
        )
        return ProjectEngine(
            project_store,
            **_base_hooks(),
            owner_id=principal.actor_id if principal is not None else "",
            tenant_id=principal.tenant_id if principal is not None else "",
            scope=scope,
            resolve_thread_context=_execution_context_resolver(principal),
        )

    (
        _execution_context_resolver,
        _require_execution_context,
        _thread_execution_scope,
        _project_execution_scope,
    ) = _make_execution_scopes(
        require_auth=require_auth,
        thread_store=thread_store,
        workspace_root=workspace_root,
        logs_root=logs_root,
        principal=_principal,
        scoped_store=_scoped_store,
    )

    def _auth_dep(request: Request) -> None:
        _principal(request)

    (
        _bad_request,
        _project_or_404,
        _project_read_store,
        _thread_access,
        _full_state,
        _visible_projects,
    ) = _make_project_access(
        project_store=project_store,
        thread_store=thread_store,
        thread_access=thread_access,
        principal=_principal,
        scoped_store=_scoped_store,
    )

    projections = ProjectGroupProjectionContext(
        collaboration_store=collaboration_store,
        group_store=_group_store,
        scoped_store=_scoped_store,
        thread_store=thread_store,
        team_rooms_router=team_rooms_router,
        require_auth=require_auth,
    )
    _project_to_collaboration = projections.project_to_bound_collaboration
    _project_group_projections = projections.project_group_projections
    _clear_project_group_projections = projections.clear_project_group_projections

    return ProjectsDeps(
        project_store=project_store,
        collaboration_store=collaboration_store,
        team_rooms_router=team_rooms_router,
        thread_store=thread_store,
        workspace_root=workspace_root,
        require_auth=require_auth,
        subagent_runner=subagent_runner,
        thread_access=thread_access,
        projections=projections,
        group_store=_group_store,
        base_hooks=_base_hooks,
        principal=_principal,
        scoped_store=_scoped_store,
        engine=_engine,
        execution_context_resolver=_execution_context_resolver,
        require_execution_context=_require_execution_context,
        thread_execution_scope=_thread_execution_scope,
        project_execution_scope=_project_execution_scope,
        auth_dep=_auth_dep,
        bad_request=_bad_request,
        project_or_404=_project_or_404,
        project_read_store=_project_read_store,
        check_thread_access=_thread_access,
        full_state=_full_state,
        visible_projects=_visible_projects,
        project_to_collaboration=_project_to_collaboration,
        project_group_projections=_project_group_projections,
        clear_project_group_projections=_clear_project_group_projections,
    )
