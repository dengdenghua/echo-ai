"""Project creation and cowork-group binding endpoints for the Project OS router.

Pure structural split of ``projects_router.create_projects_router`` — no
logic changes. Each ``_register_*`` function attaches its endpoints to the
injected router, reading shared state from the ``ProjectsDeps`` bundle; the
factory still owns the registration order.
"""

from __future__ import annotations

from contextlib import nullcontext
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from runtime.projectos.cowork_bridge import (
    run_project_from_group,
)
from runtime.projectos.store import (
    ProjectBindingActiveError,
)

from ._projects_models import (
    DetachFromGroupBody,
    FromGroupBody,
    MoveThreadBody,
    PlanBody,
    ProjectGroupBody,
)
from ._projects_router_deps import ProjectsDeps


def _register_project_creation(router: APIRouter, d: ProjectsDeps) -> None:
    """Plan a project, or create a project with its collaboration group."""
    collaboration_store = d.collaboration_store
    team_rooms_router = d.team_rooms_router
    thread_store = d.thread_store
    workspace_root = d.workspace_root
    require_auth = d.require_auth
    _principal = d.principal
    _engine = d.engine
    _bad_request = d.bad_request
    _scoped_store = d.scoped_store
    _group_store = d.group_store
    _full_state = d.full_state
    _project_to_collaboration = d.project_to_collaboration
    _auth_dep = d.auth_dep

    @router.post("/api/projects", dependencies=[Depends(_auth_dep)])
    def plan(request: Request, body: PlanBody) -> dict[str, Any]:
        """Turn a one-line goal into a project with generated milestones."""
        principal = _principal(request)
        try:
            project = _engine(principal).plan(body.name, body.goal)
        except ValueError as exc:
            raise _bad_request(exc) from exc
        except RuntimeError as exc:
            raise HTTPException(503, "项目规划失败，请检查执行模型后重试。") from exc
        _project_to_collaboration(request, project.id)
        return {"ok": True, **_full_state(request, project.id)}

    @router.post("/api/projects/group", dependencies=[Depends(_auth_dep)])
    def create_project_group(request: Request, body: ProjectGroupBody) -> dict[str, Any]:
        """Create a project and its canonical collaboration group as one saga.

        This is the preferred creation boundary.  The older project, thread,
        cowork and room endpoints remain available for clients that still
        manage those surfaces independently.
        """

        from runtime.projectos.group_service import (
            ProjectGroupBindingChanged,
            ProjectGroupCreationRecoveryPending,
            ProjectGroupCreationService,
        )

        principal = _principal(request)
        normalized_agents: list[dict[str, Any]] = []
        seen: set[str] = set()
        for raw_agent in body.initial_agents:
            agent_id = raw_agent.id.strip()
            if not agent_id or agent_id in seen:
                continue
            seen.add(agent_id)
            normalized_agents.append(
                {
                    "id": agent_id,
                    "display_name": (raw_agent.display_name or "").strip() or agent_id,
                    "description": raw_agent.description.strip(),
                    "avatar_url": raw_agent.avatar_url,
                    "icon": (raw_agent.icon or "").strip() or None,
                }
            )
        if not normalized_agents:
            normalized_agents = [{"id": "general", "display_name": "通用助手"}]

        actor_id = principal.actor_id if principal is not None else ""
        tenant_id = principal.tenant_id if principal is not None else ""
        service = ProjectGroupCreationService(
            project_store=_scoped_store(request),
            group_store=_group_store(),
            collaboration_store=collaboration_store,
            team_rooms_router=team_rooms_router,
            thread_store=thread_store,
            workspace_root=workspace_root,
            require_auth=require_auth,
        )
        try:
            created = service.create(
                request=request,
                name=body.name.strip(),
                goal=(body.goal or "").strip() or body.name.strip(),
                agents=normalized_agents,
                actor_id=actor_id,
                tenant_id=tenant_id,
                plan_project=lambda project_id: _engine(principal).plan(
                    body.name.strip(),
                    (body.goal or "").strip() or body.name.strip(),
                    project_id=project_id,
                ),
            )
        except (ProjectGroupBindingChanged, ProjectGroupCreationRecoveryPending) as exc:
            raise HTTPException(409, detail=exc.detail()) from exc
        except HTTPException:
            raise
        except ValueError as exc:
            raise _bad_request(exc) from exc
        except RuntimeError as exc:
            status = 503 if "not wired" in str(exc) else 500
            raise HTTPException(status, "project group creation failed") from exc
        except Exception as exc:  # noqa: BLE001 - keep store internals out of the API
            raise HTTPException(500, "project group creation failed") from exc

        return {
            "ok": True,
            **created["project_state"],
            "thread_id": created["thread_id"],
            "thread": created["thread"],
            "room": created["room"],
            "group": created["group_state"].to_dict(),
        }


def _register_project_binding(router: APIRouter, d: ProjectsDeps) -> None:
    """Move a thread, delete a project, attach Project OS to a cowork group."""
    require_auth = d.require_auth
    subagent_runner = d.subagent_runner
    projections = d.projections
    _project_or_404 = d.project_or_404
    _thread_access = d.check_thread_access
    _scoped_store = d.scoped_store
    _bad_request = d.bad_request
    _execution_context_resolver = d.execution_context_resolver
    _base_hooks = d.base_hooks
    _thread_execution_scope = d.thread_execution_scope
    _group_store = d.group_store
    _auth_dep = d.auth_dep

    @router.post("/api/projects/move", dependencies=[Depends(_auth_dep)])
    def move_thread(request: Request, body: MoveThreadBody) -> dict[str, Any]:
        project = _project_or_404(request, body.project_id)
        _thread_access(request, body.thread_id, write=True)
        try:
            scoped = _scoped_store(request)
            projections.move_project_to_thread(
                request,
                body.thread_id,
                project.id,
                scoped,
            )
        except ValueError as exc:
            raise _bad_request(exc) from exc
        except PermissionError as exc:
            raise HTTPException(404, "project not found") from exc
        return {"ok": True, "thread_id": body.thread_id, "project_id": project.id}

    @router.delete("/api/projects/{project_id}", dependencies=[Depends(_auth_dep)])
    def delete_project(request: Request, project_id: str) -> dict[str, Any]:
        scoped = _scoped_store(request)
        try:
            _project_or_404(request, project_id)
        except HTTPException as exc:
            if exc.status_code != 404 or not projections.finalize_deleted_project_projections(
                project_id, scoped
            ):
                raise
            return {"ok": True, "project_id": project_id, "recovered": True}
        projections.delete_project(request, project_id, scoped)
        return {"ok": True, "project_id": project_id}

    @router.post("/api/projects/from-group/{thread_id}", dependencies=[Depends(_auth_dep)])
    def from_group(request: Request, thread_id: str, body: FromGroupBody) -> dict[str, Any]:
        """Attach Project OS to a cowork group and optionally start execution.

        The group remains a normal conversation surface. Its chat/cluster/swarm
        response strategy is independent from the persistent project binding.
        Project work starts only when the caller explicitly requests ``run``.
        """
        principal = _thread_access(request, thread_id, write=True)
        if body.run and require_auth:
            resolver = _execution_context_resolver(principal)
            try:
                if resolver is None:
                    raise RuntimeError("managed thread workspace resolver unavailable")
                resolver(thread_id)
            except (OSError, PermissionError, RuntimeError, TypeError, ValueError) as exc:
                raise HTTPException(
                    409,
                    "project execution requires a verified managed thread workspace",
                ) from exc
        try:
            hooks = _base_hooks()
            resolver = _execution_context_resolver(principal)
            if resolver is not None:
                hooks["resolve_thread_context"] = resolver
            execution_scope = (
                _thread_execution_scope(request, thread_id=thread_id, goal=body.goal)
                if body.run
                else nullcontext()
            )
            with execution_scope:
                result = run_project_from_group(
                    _scoped_store(request),
                    _group_store(),
                    thread_id,
                    name=body.name,
                    goal=body.goal,
                    hooks=hooks,
                    run=body.run,
                    max_ticks=body.max_ticks,
                    subagent_runner=subagent_runner,
                    owner_id=principal.actor_id if principal is not None else "",
                    tenant_id=principal.tenant_id if principal is not None else "",
                    reuse_active=True,
                )
            if result.get("recovery_pending"):
                raise HTTPException(409, result.get("recovery") or result)
            # `run_project_from_group` only returns after `engine.run` has
            # crossed its external execution boundary. Projection
            # compensation must therefore retain this project on run=True.
            result["run_requested"] = body.run
            result["execution_started"] = body.run
            raw_project = result.get("project")
            project = raw_project if isinstance(raw_project, dict) else {}
            project_id = str(project.get("id") or "")
            if project_id:
                projections.project_group_projections_or_compensate(
                    request,
                    thread_id,
                    project_id,
                    result,
                )
            return result
        except ValueError as exc:
            raise _bad_request(exc) from exc
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, "project run failed") from exc


def _register_group_detach(router: APIRouter, d: ProjectsDeps) -> None:
    """Detach Project OS from a cowork group without deleting the group."""
    projections = d.projections
    _thread_access = d.check_thread_access
    _scoped_store = d.scoped_store
    _bad_request = d.bad_request
    _clear_project_group_projections = d.clear_project_group_projections
    _auth_dep = d.auth_dep

    @router.delete("/api/projects/from-group/{thread_id}", dependencies=[Depends(_auth_dep)])
    def detach_from_group(
        request: Request,
        thread_id: str,
        body: DetachFromGroupBody | None = None,
    ) -> dict[str, Any]:
        """Close a group's project capability without deleting the group.

        The project record and all project/chat history remain inspectable.
        Running or blocked work is protected unless the owner explicitly uses
        ``force``. The optional expected id makes UI retries safe against a
        concurrent rebind.
        """

        principal = _thread_access(request, thread_id, write=True)
        options = body or DetachFromGroupBody()
        scoped = _scoped_store(request)
        try:
            project, binding_generation = scoped.binding_snapshot(thread_id)
        except ValueError as exc:
            raise _bad_request(exc) from exc
        if project is None:
            prior_project = None
            if options.expected_project_id:
                try:
                    prior_project = scoped.get_project(options.expected_project_id)
                except ValueError as exc:
                    raise _bad_request(exc) from exc
                if prior_project is not None:
                    try:
                        _clear_project_group_projections(
                            thread_id,
                            options.expected_project_id,
                            generation=binding_generation,
                        )
                    except Exception as exc:  # noqa: BLE001 - retryable cross-store cleanup
                        raise HTTPException(500, "project detach failed") from exc
            return {
                "ok": True,
                "thread_id": thread_id,
                "project_id": options.expected_project_id or "",
                "detached": False,
                "project": prior_project.to_dict() if prior_project is not None else None,
            }
        if options.expected_project_id and project.id != options.expected_project_id:
            raise HTTPException(
                409,
                {
                    "code": "PROJECT_BINDING_CHANGED",
                    "message": "thread project binding changed",
                    "project_id": project.id,
                },
            )
        # Legacy plans are persisted as ``running`` before the first tick even
        # though no work has started. ``started_at`` is the durable execution
        # boundary; blocked work is always considered active/recoverable.
        project_is_active = project.status == "blocked" or (
            project.status == "running" and bool(project.started_at)
        )
        if project_is_active and not options.force:
            raise HTTPException(
                409,
                {
                    "code": "PROJECT_ACTIVE",
                    "message": "project is still active; complete it or explicitly detach with force=true",
                    "project_id": project.id,
                    "status": project.status,
                    "force_required": True,
                },
            )

        try:
            detached, generation = scoped.unbind_thread_versioned(
                thread_id,
                expected_project_id=project.id,
                event_kind="project.detached_from_group",
                event_payload={
                    "thread_id": thread_id,
                    "actor": principal.actor_id if principal is not None else "local",
                    "force": options.force,
                    "status_at_detach": project.status,
                },
                reject_active=not options.force,
            )
            if detached is None:
                return {
                    "ok": True,
                    "thread_id": thread_id,
                    "project_id": project.id,
                    "detached": False,
                    "project": project.to_dict(),
                }
            try:
                _clear_project_group_projections(
                    thread_id,
                    project.id,
                    generation=generation,
                )
            except Exception as projection_error:
                projections.compensate_detach_projection_failure(
                    request,
                    thread_id,
                    project,
                    projection_error,
                )
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        except ProjectBindingActiveError as exc:
            raise HTTPException(
                409,
                {
                    "code": "PROJECT_ACTIVE",
                    "message": "project is still active; complete it or explicitly detach with force=true",
                    "project_id": exc.project.id,
                    "status": exc.project.status,
                    "force_required": True,
                },
            ) from exc
        except PermissionError as exc:
            raise HTTPException(404, "project not found") from exc
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, "project detach failed") from exc

        refreshed = scoped.get_project(project.id)
        return {
            "ok": True,
            "thread_id": thread_id,
            "project_id": project.id,
            "detached": True,
            "project": (refreshed or detached).to_dict(),
        }
