"""One task approval route, with optional consent binding for upgraded clients."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

try:
    from fastapi import APIRouter, HTTPException, Request
except ImportError:  # pragma: no cover
    APIRouter = None  # type: ignore[assignment, misc]
    HTTPException = None  # type: ignore[assignment, misc]
    Request = None  # type: ignore[assignment, misc]

from runtime.platform.process.task_supervisor import LostTaskLease, task_lease_health
from runtime.sensing._fastapi_guard import require_fastapi


class TaskApprovalDecisionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    approved: bool
    reason: str | None = None
    expected_approval_version: str | None = Field(
        default=None, min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$"
    )

    @field_validator("reason", mode="before")
    @classmethod
    def _normalize_reason(cls, value: Any) -> str | None:
        text = str(value or "").strip()
        return text or None


def register_task_approval_route(
    router: APIRouter,
    *,
    auth: Callable[[Request], Any],
    store: Callable[[], Any],
    supervisor: Callable[[], Any],
    require_access: Callable[[Any, Any], Any],
) -> None:
    require_fastapi(__name__)

    @router.post("/api/task-runs/{task_id}/approval-decision")
    def api_task_run_approval_decision(
        task_id: str,
        body: TaskApprovalDecisionRequest,
        request: Request,
    ) -> dict[str, Any]:
        actor = auth(request)
        task = store().get(task_id)
        if task is None:
            raise HTTPException(404, "task run not found")
        require_access(task, actor)
        try:
            consent = (
                {"expected_approval_version": body.expected_approval_version}
                if body.expected_approval_version is not None
                else {}
            )
            updated = supervisor().record_approval_decision(
                task_id,
                approved=body.approved,
                decided_by=actor,
                reason=body.reason or "",
                **consent,
            )
        except (LostTaskLease, ValueError) as exc:
            raise HTTPException(409, str(exc)) from exc
        except KeyError as exc:
            raise HTTPException(404, "task run not found") from exc
        return {
            "schema": "echo.task_run_approval_decision.v1",
            "task_run": updated.model_dump(mode="json"),
            "lease_health": task_lease_health(updated),
        }
