"""Project OS API — drive milestone-driven projects over HTTP.

Reads (project state + report) are public; mutations (plan / tick / run) are
auth-gated, mirroring the cowork router. The engine uses LLM hooks when a model
router is available, else deterministic stubs so the endpoints always work.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from runtime.projectos.store import (
    ProjectClaimActiveError,
    ProjectStore,
)
from runtime.projectos.timeline import project_process_timeline

from ._projects_group_endpoints import (
    _register_group_detach,
    _register_project_binding,
    _register_project_creation,
)
from ._projects_models import (
    DetachFromGroupBody as DetachFromGroupBody,
)
from ._projects_models import (
    FromGroupBody as FromGroupBody,
)
from ._projects_models import (
    MoveThreadBody as MoveThreadBody,
)
from ._projects_models import (
    PlanBody as PlanBody,
)
from ._projects_models import (
    ProjectGroupAgentBody as ProjectGroupAgentBody,
)
from ._projects_models import (
    ProjectGroupBody as ProjectGroupBody,
)
from ._projects_models import (
    RecoverBody as RecoverBody,
)
from ._projects_models import (
    RunBody as RunBody,
)
from ._projects_models import (
    TaskInterventionBody as TaskInterventionBody,
)
from ._projects_read_endpoints import _register_project_reads
from ._projects_router_deps import ProjectsDeps, build_projects_deps


def _claim_active(exc: ProjectClaimActiveError) -> HTTPException:
    return HTTPException(
        409,
        {
            "code": "CLAIM_ACTIVE",
            "message": "a worker claim is active; wait for it to finish",
            "project_id": exc.project.id,
            "task_ids": list(exc.task_ids),
            "milestone_ids": list(exc.milestone_ids),
        },
    )


def create_projects_router(
    *,
    store: ProjectStore | None = None,
    group_store: Any = None,
    collaboration_store: Any = None,
    team_rooms_router: Any = None,
    thread_store: Any = None,
    workspace_root: Any = None,
    logs_root: Any = None,
    model_router: Any = None,
    planning_model: str | None = None,
    subagent_runner: Any = None,
    identity_store: Any = None,
    require_auth: bool = False,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
) -> APIRouter:
    """Create the ``/api/projects/*`` router."""
    d = build_projects_deps(
        store=store,
        group_store=group_store,
        collaboration_store=collaboration_store,
        team_rooms_router=team_rooms_router,
        thread_store=thread_store,
        workspace_root=workspace_root,
        logs_root=logs_root,
        model_router=model_router,
        planning_model=planning_model,
        subagent_runner=subagent_runner,
        identity_store=identity_store,
        require_auth=require_auth,
        jwt_secret=jwt_secret,
        jwt_issuer=jwt_issuer,
        jwt_audience=jwt_audience,
    )
    _auth_dep = d.auth_dep
    router = APIRouter(tags=["projectos"], dependencies=[Depends(_auth_dep)])

    # Registration order is FastAPI's path-matching priority — keep it.
    _register_project_reads(router, d)
    _register_process_timeline(router, d)
    _register_project_creation(router, d)
    _register_project_binding(router, d)
    _register_group_detach(router, d)
    _register_project_execution(router, d)

    return router


# The two groups below stay in this file: capability evidence scanners in
# runtime/safety/evolution/ look for the process-timeline route and the
# ``thread_for_project`` binding in ``projects_router.py`` itself.
def _register_process_timeline(router: APIRouter, d: ProjectsDeps) -> None:
    """Persisted plan / run / control evidence for one project."""
    _project_or_404 = d.project_or_404
    _project_read_store = d.project_read_store
    _bad_request = d.bad_request

    @router.get("/api/projects/{project_id}/process-timeline")
    def process_timeline(request: Request, project_id: str, limit: int = 100) -> dict[str, Any]:
        """Project process timeline: persisted plan/run/control evidence."""
        project = _project_or_404(request, project_id, allow_collaborator_read=True)
        try:
            timeline = project_process_timeline(
                _project_read_store(request, project),
                project_id,
                limit=limit,
            )
        except ValueError as exc:
            raise _bad_request(exc) from exc
        if timeline is None:
            raise HTTPException(404, "project not found")
        return {"timeline": timeline}


def _register_project_execution(router: APIRouter, d: ProjectsDeps) -> None:
    """Tick, run, recover, and per-task interventions (execution boundary)."""
    _principal = d.principal
    _engine = d.engine
    _scoped_store = d.scoped_store
    _bad_request = d.bad_request
    _project_or_404 = d.project_or_404
    _require_execution_context = d.require_execution_context
    _project_execution_scope = d.project_execution_scope
    _full_state = d.full_state
    _project_to_collaboration = d.project_to_collaboration
    _auth_dep = d.auth_dep

    @router.post("/api/projects/{project_id}/tick", dependencies=[Depends(_auth_dep)])
    def tick(request: Request, project_id: str) -> dict[str, Any]:
        """Advance the project one loop iteration."""
        _project_or_404(request, project_id)
        _require_execution_context(request, project_id)
        try:
            with _project_execution_scope(request, project_id):
                result = _engine(_principal(request)).tick(project_id)
            thread_project = _scoped_store(request).thread_for_project(project_id)
            _project_to_collaboration(request, project_id, thread_id=thread_project or "")
            return result
        except ValueError as exc:
            raise _bad_request(exc) from exc

    @router.post("/api/projects/{project_id}/run", dependencies=[Depends(_auth_dep)])
    def run(request: Request, project_id: str, body: RunBody) -> dict[str, Any]:
        """Drive the loop until the project is done/blocked or max_ticks."""
        _project_or_404(request, project_id)
        _require_execution_context(request, project_id)
        try:
            with _project_execution_scope(request, project_id):
                result = _engine(_principal(request)).run(
                    project_id,
                    max_ticks=body.max_ticks,
                )
            thread_project = _scoped_store(request).thread_for_project(project_id)
            _project_to_collaboration(request, project_id, thread_id=thread_project or "")
            return result
        except ValueError as exc:
            raise _bad_request(exc) from exc

    @router.post("/api/projects/{project_id}/recover", dependencies=[Depends(_auth_dep)])
    def recover(request: Request, project_id: str, body: RecoverBody) -> dict[str, Any]:
        """Reopen blocked project work after an operator fixes the cause."""
        _project_or_404(request, project_id)
        engine = _engine(_principal(request))
        try:
            recovered = engine.recover(
                project_id,
                task_ids=body.task_ids,
                reset_attempts=body.reset_attempts,
                clear_outputs=body.clear_outputs,
            )
        except ProjectClaimActiveError as exc:
            raise _claim_active(exc) from exc
        except ValueError as exc:
            raise _bad_request(exc) from exc
        if body.run:
            _require_execution_context(request, project_id)
            try:
                with _project_execution_scope(request, project_id):
                    run_result = engine.run(project_id, max_ticks=body.max_ticks)
            except ValueError as exc:
                raise _bad_request(exc) from exc
            thread_project = _scoped_store(request).thread_for_project(project_id)
            _project_to_collaboration(request, project_id, thread_id=thread_project or "")
            return {
                "ok": True,
                "recover": recovered,
                "run": run_result,
                **_full_state(request, project_id),
            }
        thread_project = _scoped_store(request).thread_for_project(project_id)
        _project_to_collaboration(request, project_id, thread_id=thread_project or "")
        return {"ok": True, "recover": recovered, **_full_state(request, project_id)}

    @router.post(
        "/api/projects/{project_id}/tasks/{task_id}/intervene",
        dependencies=[Depends(_auth_dep)],
    )
    def intervene_task(
        request: Request,
        project_id: str,
        task_id: str,
        body: TaskInterventionBody,
    ) -> dict[str, Any]:
        """Manually reassign, reset, complete, or skip a task."""
        _project_or_404(request, project_id)
        principal = _principal(request)
        engine = _engine(principal)
        try:
            intervention = engine.intervene_task(
                project_id,
                task_id,
                action=body.action,
                assigned_agent=body.assigned_agent,
                assigned_role=body.assigned_role,
                output=body.output,
                reason=body.reason,
                reset_attempts=body.reset_attempts,
                cascade=body.cascade,
                actor=principal.actor_id if principal is not None else "",
            )
        except ProjectClaimActiveError as exc:
            raise _claim_active(exc) from exc
        except ValueError as exc:
            raise _bad_request(exc) from exc
        if any(str(event).startswith("task_not_found:") for event in intervention["events"]):
            raise HTTPException(404, "task not found")
        if any(str(event).startswith("unknown_task_action:") for event in intervention["events"]):
            raise HTTPException(400, "unknown task intervention action")
        if body.run:
            _require_execution_context(request, project_id)
            try:
                with _project_execution_scope(request, project_id):
                    run_result = engine.run(project_id, max_ticks=body.max_ticks)
            except ValueError as exc:
                raise _bad_request(exc) from exc
            thread_project = _scoped_store(request).thread_for_project(project_id)
            _project_to_collaboration(request, project_id, thread_id=thread_project or "")
            return {
                "ok": True,
                "intervention": intervention,
                "run": run_result,
                **_full_state(request, project_id),
            }
        thread_project = _scoped_store(request).thread_for_project(project_id)
        _project_to_collaboration(request, project_id, thread_id=thread_project or "")
        return {
            "ok": True,
            "intervention": intervention,
            **_full_state(request, project_id),
        }
