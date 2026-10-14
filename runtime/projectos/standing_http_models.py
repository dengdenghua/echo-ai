"""Typed owner review and confirmation contracts for standing authorization."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StandingReviewBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    phase_ids: list[str] = Field(min_length=1, max_length=100)
    limit_usd: float = Field(gt=0, allow_inf_nan=False, strict=True)


class StandingConfirmBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    review_id: str = Field(min_length=1, max_length=128)
    confirmed: Literal[True]

    @field_validator("confirmed", mode="before")
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError("confirmed must be the JSON boolean true")
        return value


class StandingReviewedPhase(BaseModel):
    id: str
    name: str
    fingerprint: str
    ai_budget_usd: float


class StandingReviewResponse(BaseModel):
    review_id: str
    project_id: str
    owner_id: str
    tenant_id: str
    phases: list[StandingReviewedPhase]
    limit_usd: float = Field(gt=0, allow_inf_nan=False)
    expires_at: float
    budget_basis: Literal["cumulative_project_spend"]


class StandingConfirmationResponse(BaseModel):
    grant_id: str
    replayed: bool


class StandingGrantResponse(BaseModel):
    grant_id: str
    project_id: str
    owner_id: str
    tenant_id: str
    granted_by: str
    review_id: str
    phase_ids: list[str]
    phase_fingerprints: list[str]
    limit_usd: float = Field(gt=0, allow_inf_nan=False)
    budget_basis: Literal["cumulative_project_spend"]


class StandingStateResponse(BaseModel):
    grant: StandingGrantResponse | None


class StandingRevocationResponse(BaseModel):
    revocation_id: str
