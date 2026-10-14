"""Request bodies for the Project OS router.

Moved verbatim out of ``projects_router`` (which re-exports them) so the
endpoint-group modules can import them without a circular import.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import AfterValidator, AliasChoices, BaseModel, ConfigDict, Field

from runtime.projectos.appearance import (
    PROJECT_CATEGORY_MAX_LENGTH,
    PROJECT_ICON_PATTERN,
    normalize_project_category,
)
from runtime.projectos.engine import DEFAULT_RUN_MAX_TICKS, HARD_MAX_RUN_TICKS

# Optional AI spending cap in USD for a governed project, across all phases
# and members. Omitted means no cap — the chat initiation default.
AiBudgetUsd = Annotated[float | None, Field(ge=0, allow_inf_nan=False)]


def _category_label(raw: str | None) -> str | None:
    value = normalize_project_category(raw)
    if value is None and raw is not None and raw.strip():
        raise ValueError("category must be a single-line label")
    return value


# Display metadata picked in the 新建项目 dialog; omitted means none. The icon
# is a line-icon id (``trending-up``), never an emoji or URL.
ProjectIconId = Annotated[str | None, Field(pattern=PROJECT_ICON_PATTERN)]
ProjectCategory = Annotated[
    str | None,
    Field(max_length=PROJECT_CATEGORY_MAX_LENGTH),
    AfterValidator(_category_label),
]


class PlanBody(BaseModel):
    name: str = Field(min_length=1)
    goal: str = Field(min_length=1)
    ai_budget_usd: AiBudgetUsd = None
    icon: ProjectIconId = None
    category: ProjectCategory = None


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
    ai_budget_usd: float | None = Field(
        default=None,
        ge=0,
        allow_inf_nan=False,
        validation_alias=AliasChoices("ai_budget_usd", "aiBudgetUsd"),
    )
    icon: ProjectIconId = None
    category: ProjectCategory = None


class MoveThreadBody(BaseModel):
    thread_id: str = Field(min_length=1)
    project_id: str = Field(min_length=1)


class RunBody(BaseModel):
    max_ticks: int = Field(default=DEFAULT_RUN_MAX_TICKS, ge=1, le=HARD_MAX_RUN_TICKS)
    background: bool = False


class RecoverBody(BaseModel):
    task_ids: list[str] = Field(default_factory=list)
    reset_attempts: bool = True
    clear_outputs: bool = True
    run: bool = False
    background: bool = False
    max_ticks: int = Field(default=DEFAULT_RUN_MAX_TICKS, ge=1, le=HARD_MAX_RUN_TICKS)


class TaskInterventionBody(BaseModel):
    action: str = Field(min_length=1)
    background: bool = False
    assigned_agent: str | None = None
    assigned_role: str | None = None
    output: Any = None
    reason: str = ""
    reset_attempts: bool = True
    cascade: bool = True
    run: bool = False
    max_ticks: int = Field(default=DEFAULT_RUN_MAX_TICKS, ge=1, le=HARD_MAX_RUN_TICKS)


class ProjectCancelBody(BaseModel):
    reason: str = Field(default="", max_length=2000)


class FromGroupBody(BaseModel):
    name: str = Field(min_length=1)
    goal: str = Field(min_length=1)
    run: bool = False
    max_ticks: int = Field(default=DEFAULT_RUN_MAX_TICKS, ge=1, le=HARD_MAX_RUN_TICKS)
    ai_budget_usd: AiBudgetUsd = None


class OwnerDecisionBody(BaseModel):
    """An owner decision on exactly what was shown (``governance`` fingerprints)."""

    expected_fingerprint: str = Field(min_length=1, max_length=128)


class InitiationApprovalBody(OwnerDecisionBody):
    # Only applied when sent; omitted keeps each phase's cap (legacy: no cap).
    ai_budget_usd: AiBudgetUsd = None


class ProjectBudgetBody(OwnerDecisionBody):
    ai_budget_usd: AiBudgetUsd


class DetachFromGroupBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    force: bool = False
    expected_project_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("expected_project_id", "expectedProjectId"),
    )
