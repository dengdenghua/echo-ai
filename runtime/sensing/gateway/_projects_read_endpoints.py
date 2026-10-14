"""Read endpoints for the Project OS router: lists, state, reports, audit.

Pure structural split of ``projects_router.create_projects_router`` — no
logic changes. Each ``_register_*`` function attaches its endpoints to the
injected router, reading shared state from the ``ProjectsDeps`` bundle; the
factory still owns the registration order.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from ._projects_router_deps import ProjectsDeps


def _register_project_reads(router: APIRouter, d: ProjectsDeps) -> None:
    """Project list / portfolio / thread lookups, state, report, PM, retro, events."""
    project_store = d.project_store
    thread_access = d.thread_access
    _principal = d.principal
    _bad_request = d.bad_request
    _thread_access = d.check_thread_access
    _full_state = d.full_state
    _project_or_404 = d.project_or_404
    _project_read_store = d.project_read_store
    _visible_projects = d.visible_projects

    @router.get("/api/projects")
    def list_projects(request: Request) -> dict[str, Any]:
        return {"projects": [p.to_dict() for p in _visible_projects(request)]}

    @router.get("/api/projects/portfolio")
    def portfolio(request: Request) -> dict[str, Any]:
        """Cross-project roll-up: every visible project's PM row in one read.

        Declared before ``/api/projects/{project_id}`` so the literal path is
        not captured by the parameterised route.

        One project's read failure must not blank the whole portfolio: the
        entry is still emitted with ``readable=False`` so the sidebar can show
        the project instead of silently dropping it.
        """
        from runtime.projectos.pm import build_pm_report, build_portfolio_entry

        entries: list[dict[str, Any]] = []
        for project in _visible_projects(request):
            try:
                report = build_pm_report(
                    _project_read_store(request, project),
                    project.id,
                )
            except ValueError:
                report = None
            entries.append(build_portfolio_entry(project, report))
        return {"projects": entries}

    @router.get("/api/projects/by-thread/{thread_id}")
    def get_project_by_thread(request: Request, thread_id: str) -> dict[str, Any]:
        _thread_access(request, thread_id)
        try:
            project = project_store.project_for_thread(thread_id)
        except ValueError as exc:
            raise _bad_request(exc) from exc
        if project is None:
            raise HTTPException(404, "project not found for thread")
        return _full_state(request, project.id, allow_collaborator_read=True)

    @router.get("/api/projects/thread-map")
    def thread_project_map(request: Request) -> dict[str, str]:
        principal = _principal(request)
        mapping = project_store.thread_project_map()
        if principal is None:
            return mapping
        filtered: dict[str, str] = {}
        for thread_id, project_id in mapping.items():
            project = project_store.get_project(project_id)
            if project is None or project.tenant_id != principal.tenant_id:
                continue
            if (
                project.owner_id == principal.actor_id
                or principal.roles.intersection({"admin", "operator"})
                or thread_access.resolve(
                    thread_id,
                    principal.actor_id,
                    principal.tenant_id,
                ).can_read
            ):
                filtered[thread_id] = project_id
        return filtered

    @router.get("/api/projects/{project_id}")
    def get_project(request: Request, project_id: str) -> dict[str, Any]:
        return _full_state(request, project_id, allow_collaborator_read=True)

    @router.get("/api/projects/{project_id}/report")
    def report(request: Request, project_id: str) -> dict[str, Any]:
        """A milestone report: each milestone + its tasks' status/output."""
        project = _project_or_404(request, project_id, allow_collaborator_read=True)
        out = []
        try:
            scoped_store = _project_read_store(request, project)
            milestones = scoped_store.milestones_for(project_id)
        except ValueError as exc:
            raise _bad_request(exc) from exc
        for m in milestones:
            out.append(
                {
                    "id": m.id,
                    "name": m.name,
                    "status": m.status,
                    "success_criteria": m.success_criteria,
                    "tasks": [
                        {
                            "id": t.id,
                            "role": t.assigned_role,
                            "type": t.type,
                            "status": t.status,
                            "output": t.output,
                        }
                        for t in scoped_store.tasks_for_milestone(m.id)
                    ],
                }
            )
        return {"project": project.name, "status": project.status, "milestones": out}

    @router.get("/api/projects/{project_id}/pm")
    def pm_console(request: Request, project_id: str) -> dict[str, Any]:
        """PM 驾驶舱：里程碑健康度、燃尽、风险/阻塞、下一步、指派。"""
        project = _project_or_404(request, project_id, allow_collaborator_read=True)
        try:
            scoped_store = _project_read_store(request, project)
        except ValueError as exc:
            raise _bad_request(exc) from exc
        from runtime.projectos.pm import build_pm_report

        report = build_pm_report(scoped_store, project_id)
        return {
            "project_id": project_id,
            "project": project.name,
            "status": project.status,
            "pm": report or {},
        }

    @router.get("/api/projects/{project_id}/retro")
    def retro(request: Request, project_id: str) -> dict[str, Any]:
        """复盘：完工项目的交付、成本与建议。"""
        project = _project_or_404(request, project_id, allow_collaborator_read=True)
        try:
            scoped_store = _project_read_store(request, project)
        except ValueError as exc:
            raise _bad_request(exc) from exc
        from runtime.projectos.pm import build_retro

        return {
            "project_id": project_id,
            "project": project.name,
            "retro": build_retro(scoped_store, project_id) or {},
        }

    @router.get("/api/projects/{project_id}/events")
    def events(request: Request, project_id: str, limit: int = 100) -> dict[str, Any]:
        """Project audit trail: recoveries, interventions, and future operator actions."""
        project = _project_or_404(request, project_id, allow_collaborator_read=True)
        try:
            audit_events = _project_read_store(request, project).events_for_project(
                project_id,
                limit=limit,
            )
        except ValueError as exc:
            raise _bad_request(exc) from exc
        return {
            "project_id": project_id,
            "events": audit_events,
        }
