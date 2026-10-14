"""Owner decisions for governed projects over HTTP (the project page).

Chat collects these decisions through approval prompts; the page sends them as
explicit calls carrying the fingerprint of what the owner reviewed (from the
``governance`` block of the project state). Each endpoint records the same
event as chat via :mod:`runtime.projectos.owner_decisions` and never starts
execution — ``/run`` stays a separate, explicit request.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypedDict

from fastapi import APIRouter, Depends, HTTPException, Request

from runtime.memory.cowork.group import MemberEvent
from runtime.projectos.owner_decisions import (
    OwnerDecisionError,
    accept_delivery,
    approve_initiation,
    authorize_phase,
    set_budget,
)
from runtime.projectos.store import ProjectClaimActiveError

from ._projects_models import (
    InitiationApprovalBody,
    OwnerDecisionBody,
    ProjectBudgetBody,
    ProjectCancelBody,
)
from ._projects_router_deps import ProjectsDeps


class _InitiationBudget(TypedDict, total=False):
    ai_budget_usd: float | None


def _register_project_governance(
    router: APIRouter,
    d: ProjectsDeps,
    *,
    cancel_execution: Callable[..., Any] | None = None,
) -> None:
    """Initiation approval, phase authorization, delivery acceptance, budget, cancel."""
    _principal = d.principal
    _scoped_store = d.scoped_store
    _project_or_404 = d.project_or_404
    _full_state = d.full_state
    _project_to_collaboration = d.project_to_collaboration
    _project_roster = d.project_roster
    _auth_dep = d.auth_dep

    def _decide(
        request: Request,
        project_id: str,
        decide: Callable[[Any, str], dict[str, Any]],
    ) -> dict[str, Any]:
        _project_or_404(request, project_id)
        principal = _principal(request)
        actor = principal.actor_id if principal is not None else "local"
        try:
            decision = decide(_scoped_store(request), actor)
        except OwnerDecisionError as exc:
            raise HTTPException(exc.status, exc.to_detail()) from exc
        except ProjectClaimActiveError as exc:
            raise HTTPException(
                409,
                {
                    "code": "CLAIM_ACTIVE",
                    "message": "a worker claim is active; wait for it to finish",
                    "project_id": exc.project.id,
                    "task_ids": list(exc.task_ids),
                    "milestone_ids": list(exc.milestone_ids),
                },
            ) from exc
        except PermissionError as exc:
            raise HTTPException(404, "project not found") from exc
        thread_id = _scoped_store(request).thread_for_project(project_id) or ""
        _project_to_collaboration(request, project_id, thread_id=thread_id)
        return {"ok": True, "decision": decision, **_full_state(request, project_id)}

    @router.post(
        "/api/projects/{project_id}/initiation/approve",
        dependencies=[Depends(_auth_dep)],
    )
    def approve_project_initiation(
        request: Request, project_id: str, body: InitiationApprovalBody
    ) -> dict[str, Any]:
        """Approve the plan and team; a legacy project gets its governance fields."""
        budget: _InitiationBudget = (
            {"ai_budget_usd": body.ai_budget_usd}
            if "ai_budget_usd" in body.model_fields_set
            else {}
        )
        return _decide(
            request,
            project_id,
            lambda store, actor: approve_initiation(
                store,
                project_id,
                actor=actor,
                expected_fingerprint=body.expected_fingerprint,
                roster=_project_roster(request, project_id),
                **budget,
            ),
        )

    @router.post(
        "/api/projects/{project_id}/phases/{milestone_id}/authorize",
        dependencies=[Depends(_auth_dep)],
    )
    def authorize_project_phase(
        request: Request, project_id: str, milestone_id: str, body: OwnerDecisionBody
    ) -> dict[str, Any]:
        """Authorize the next phase's members and scope, like chat's phase prompt."""

        def invite_members(store: Any, actor: str) -> Callable[[list[str]], None]:
            def invite(agent_ids: list[str]) -> None:
                thread_id = store.thread_for_project(project_id) or ""
                if not thread_id:
                    return
                present = set(_project_roster(request, project_id))
                for agent_id in agent_ids:
                    if agent_id not in present:
                        d.group_store().append(
                            thread_id,
                            MemberEvent(action="invite", actor=actor, target_id=agent_id),
                        )

            return invite

        return _decide(
            request,
            project_id,
            lambda store, actor: authorize_phase(
                store,
                project_id,
                milestone_id,
                actor=actor,
                expected_fingerprint=body.expected_fingerprint,
                invite_members=invite_members(store, actor),
            ),
        )

    @router.post(
        "/api/projects/{project_id}/milestones/{milestone_id}/accept",
        dependencies=[Depends(_auth_dep)],
    )
    def accept_project_delivery(
        request: Request, project_id: str, milestone_id: str, body: OwnerDecisionBody
    ) -> dict[str, Any]:
        """Accept a phase's delivered outputs so the next run can advance."""
        return _decide(
            request,
            project_id,
            lambda store, actor: accept_delivery(
                store,
                project_id,
                milestone_id,
                actor=actor,
                expected_fingerprint=body.expected_fingerprint,
            ),
        )

    @router.post("/api/projects/{project_id}/budget", dependencies=[Depends(_auth_dep)])
    def set_project_budget(
        request: Request, project_id: str, body: ProjectBudgetBody
    ) -> dict[str, Any]:
        """Change the AI cap on every phase; the current phase needs re-authorizing."""
        return _decide(
            request,
            project_id,
            lambda store, actor: set_budget(
                store,
                project_id,
                actor=actor,
                ai_budget_usd=body.ai_budget_usd,
                expected_fingerprint=body.expected_fingerprint,
            ),
        )

    @router.post("/api/projects/{project_id}/cancel", dependencies=[Depends(_auth_dep)])
    def cancel_project(
        request: Request,
        project_id: str,
        body: ProjectCancelBody | None = None,
    ) -> dict[str, Any]:
        """Abandon a project: terminal ``failed``, live claims voided, deletable."""
        project = _project_or_404(request, project_id)
        principal = _principal(request)
        try:
            cancelled = d.engine(principal).cancel(
                project_id,
                reason=(body or ProjectCancelBody()).reason.strip(),
                actor=principal.actor_id if principal is not None else "",
            )
        except PermissionError as exc:
            raise HTTPException(404, "project not found") from exc
        except ValueError as exc:
            raise d.bad_request(exc) from exc
        if "project_not_found" in cancelled["events"]:
            raise HTTPException(404, "project not found")
        if any(str(event).startswith("project_not_cancellable:") for event in cancelled["events"]):
            raise HTTPException(
                409,
                {
                    "code": "PROJECT_NOT_CANCELLABLE",
                    "message": "project is already done and cannot be cancelled",
                    "project_id": project_id,
                    "status": cancelled["project_status"],
                },
            )
        if cancel_execution is not None:
            cancel_execution(project, reason=(body or ProjectCancelBody()).reason.strip())
        thread_project = _scoped_store(request).thread_for_project(project_id)
        _project_to_collaboration(request, project_id, thread_id=thread_project or "")
        return {"ok": True, "cancel": cancelled, **_full_state(request, project_id)}
