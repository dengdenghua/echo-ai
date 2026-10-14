"""Wire receipts for explicit background project execution."""

from typing import Any, Literal

from pydantic import BaseModel


class ProjectExecutionReceipt(BaseModel):
    accepted: Literal[True] = True
    task_id: str
    project_id: str
    request_id: str
    status: Literal["queued"] = "queued"


class ProjectExecutionAccepted(BaseModel):
    ok: Literal[True] = True
    execution: ProjectExecutionReceipt


class ProjectExecutionState(BaseModel):
    task_id: str
    project_id: str
    request_id: str | None
    status: str
    updated_at: str
    completed_at: str | None
    cancel_requested: bool
    result: dict[str, Any] | None
    can_takeover: bool


class ProjectExecutionStateResponse(BaseModel):
    execution: ProjectExecutionState | None
