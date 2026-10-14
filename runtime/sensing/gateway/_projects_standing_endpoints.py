"""Explicit authenticated owner decisions for unattended project progress."""

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from runtime.projectos.standing_http_models import (
    StandingConfirmationResponse,
    StandingConfirmBody,
    StandingGrantResponse,
    StandingReviewBody,
    StandingReviewResponse,
    StandingRevocationResponse,
    StandingStateResponse,
)
from runtime.projectos.standing_review import (
    confirm_standing_authorization,
    review_standing_authorization,
    revoke_reviewed_authorization,
    standing_authorization_state,
)

from ._projects_router_deps import ProjectsDeps


def register_project_standing_authorization(router: APIRouter, d: ProjectsDeps) -> None:
    def decide(request: Request, project_id: str, operation: Callable[..., Any], **kwargs: Any):
        project = d.project_or_404(request, project_id, allow_operator=False)
        principal = d.principal(request)
        if (
            principal is None
            or not principal.actor_id
            or not principal.tenant_id
            or principal.actor_id != project.owner_id
            or principal.tenant_id != project.tenant_id
        ):
            raise HTTPException(403, "an authenticated project owner is required")
        try:
            return operation(
                d.scoped_store(request),
                project_id,
                actor_id=principal.actor_id,
                tenant_id=principal.tenant_id,
                **kwargs,
            )
        except PermissionError as exc:
            raise HTTPException(404, "project not found") from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @router.get("/api/projects/{project_id}/standing-authorization")
    def state(request: Request, project_id: str) -> StandingStateResponse:
        grant = decide(request, project_id, standing_authorization_state)
        return StandingStateResponse(grant=StandingGrantResponse(**grant) if grant else None)

    @router.post("/api/projects/{project_id}/standing-authorization/review")
    def review(
        request: Request, project_id: str, body: StandingReviewBody
    ) -> StandingReviewResponse:
        result = decide(
            request,
            project_id,
            review_standing_authorization,
            phase_ids=body.phase_ids,
            limit_usd=body.limit_usd,
        )
        return StandingReviewResponse(**result)

    @router.post("/api/projects/{project_id}/standing-authorization/confirm")
    def confirm(
        request: Request, project_id: str, body: StandingConfirmBody
    ) -> StandingConfirmationResponse:
        return StandingConfirmationResponse(
            **decide(
                request,
                project_id,
                confirm_standing_authorization,
                review_id=body.review_id,
            )
        )

    @router.delete("/api/projects/{project_id}/standing-authorization")
    def revoke(request: Request, project_id: str) -> StandingRevocationResponse:
        return StandingRevocationResponse(
            **decide(request, project_id, revoke_reviewed_authorization)
        )
