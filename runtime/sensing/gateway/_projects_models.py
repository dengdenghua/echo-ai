"""Request bodies for the Project OS router.

Moved verbatim out of ``projects_router`` (which re-exports them) so the
endpoint-group modules can import them without a circular import.
"""

from __future__ import annotations

from typing import Any

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from runtime.projectos.engine import DEFAULT_RUN_MAX_TICKS, HARD_MAX_RUN_TICKS


class PlanBody(BaseModel):
    name: str = Field(min_length=1)
    goal: str = Field(min_length=1)


class ProjectGroupAgentBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str = Field(min_length=1)
    display_name: str | None = Field(
        default=None,
        validation_alias=AliasChoices("display_name", "displayName"),
    )
    description: str = ""
    avatar_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("avatar_url", "avatarUrl"),
    )
    icon: str | None = None


class ProjectGroupBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    name: str = Field(min_length=1)
    goal: str | None = None
    initial_agents: list[ProjectGroupAgentBody] = Field(
        default_factory=list,
        validation_alias=AliasChoices("initial_agents", "initialAgents"),
    )


class MoveThreadBody(BaseModel):
    thread_id: str = Field(min_length=1)
    project_id: str = Field(min_length=1)


class RunBody(BaseModel):
    max_ticks: int = Field(default=DEFAULT_RUN_MAX_TICKS, ge=1, le=HARD_MAX_RUN_TICKS)


class RecoverBody(BaseModel):
    task_ids: list[str] = Field(default_factory=list)
    reset_attempts: bool = True
    clear_outputs: bool = True
    run: bool = False
    max_ticks: int = Field(default=DEFAULT_RUN_MAX_TICKS, ge=1, le=HARD_MAX_RUN_TICKS)


class TaskInterventionBody(BaseModel):
    action: str = Field(min_length=1)
    assigned_agent: str | None = None
    assigned_role: str | None = None
    output: Any = None
    reason: str = ""
    reset_attempts: bool = True
    cascade: bool = True
    run: bool = False
    max_ticks: int = Field(default=DEFAULT_RUN_MAX_TICKS, ge=1, le=HARD_MAX_RUN_TICKS)


class FromGroupBody(BaseModel):
    name: str = Field(min_length=1)
    goal: str = Field(min_length=1)
    run: bool = False
    max_ticks: int = Field(default=DEFAULT_RUN_MAX_TICKS, ge=1, le=HARD_MAX_RUN_TICKS)


class DetachFromGroupBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    force: bool = False
    expected_project_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("expected_project_id", "expectedProjectId"),
    )
