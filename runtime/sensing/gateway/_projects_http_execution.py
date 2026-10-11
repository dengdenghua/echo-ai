"""Background HTTP project routes and execution adapter."""

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response

from runtime.platform.process.task_supervisor import TaskLeaseConflict
from runtime.projectos.governance import INITIATION_REQUIRED_STATES, initiation_state
from runtime.projectos.http_dispatcher import ProjectHTTPDispatcher
from runtime.projectos.http_models import ProjectExecutionStateResponse
from runtime.projectos.standing_review import standing_authorization_state

from ._projects_router_deps import ProjectsDeps


def require_project_initiation(d: ProjectsDeps, request: Request, project: Any) -> None:
    """Refuse to drive a project whose initiation the owner has not approved."""
    if project.status not in {"planning", "running"}:
        return
    state = initiation_state(d.scoped_store(request), project)
    if state in INITIATION_REQUIRED_STATES:
        raise HTTPException(
            409,
            {
                "code": "INITIATION_APPROVAL_REQUIRED",
                "message": "the owner must approve the project initiation before it runs",
                "project_id": project.id,
                "initiation_state": state,
            },
        )


def register_project_http_execution(
    router: APIRouter, d: ProjectsDeps, dispatcher: ProjectHTTPDispatcher
):
    _project_or_404 = d.project_or_404
    _require_execution_context = d.require_execution_context
    _principal = d.principal
    _project_execution_scope = d.project_execution_scope
    _execution_engine = d.execution_engine
    _scoped_store = d.scoped_store
    _project_to_collaboration = d.project_to_collaboration

    def _require_initiation(request: Request, project: Any) -> None:
        require_project_initiation(d, request, project)

    def _submit(
        request: Request, project_id: str, max_ticks: int, response: Response
    ) -> dict[str, Any]:
        project = _project_or_404(request, project_id)
        _require_execution_context(request, project_id)
        _require_initiation(request, project)
        # Keep only the resolved server principal and app in the worker request;
        # neither client headers nor a closed ASGI receive channel are retained.
        detached = Request(
            {
                "type": "http",
                "app": request.app,
                "headers": [],
                "state": {
                    "principal": _principal(request),
                    "project_principal": _principal(request),
                },
            }
        )

        def execute() -> dict[str, Any]:
            _require_execution_context(detached, project_id)
            _require_initiation(detached, _project_or_404(detached, project_id))
            with _project_execution_scope(detached, project_id):
                result = _execution_engine(detached, project_id).run(
                    project_id, max_ticks=max_ticks
                )
            thread_id = _scoped_store(detached).thread_for_project(project_id) or ""
            _project_to_collaboration(detached, project_id, thread_id=thread_id)
            return result

        try:
            receipt = dispatcher.submit(
                project,
                execute,
                thread_id=_scoped_store(request).thread_for_project(project_id) or "",
            )
        except TaskLeaseConflict as exc:
            raise HTTPException(409, "project execution is already queued or running") from exc
        except OverflowError as exc:
            raise HTTPException(429, "project execution queue is full") from exc
        except RuntimeError as exc:
            raise HTTPException(503, "project worker is unavailable") from exc
        response.status_code = 202
        return {"ok": True, "execution": receipt}

    @router.get("/api/projects/{project_id}/execution")
    def execution_state(request: Request, project_id: str) -> ProjectExecutionStateResponse:
        project = _project_or_404(request, project_id)
        return ProjectExecutionStateResponse(execution=dispatcher.state(project))

    @router.post("/api/projects/{project_id}/execution/cancel")
    def cancel_execution(request: Request, project_id: str) -> ProjectExecutionStateResponse:
        project = _project_or_404(request, project_id)
        grant = (
            standing_authorization_state(
                d.project_store,
                project_id,
                actor_id=project.owner_id,
                tenant_id=project.tenant_id,
            )
            if project.owner_id and project.tenant_id
            else None
        )
        return ProjectExecutionStateResponse(
            execution=dispatcher.cancel(
                project,
                standing_grant_id=grant["grant_id"] if grant else "",
            )
        )

    return _submit
