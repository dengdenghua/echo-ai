from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from runtime.safety.approval.permission_modes import canonical_permission_mode


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _new_run_id() -> str:
    return uuid4().hex


def _normalize_optional_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


class LoopRunStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    VERIFYING = "verifying"
    REPAIRING = "repairing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    # Startup reconciliation (audit R-02): the process exited while the
    # run was in flight. Terminal (nothing is driving it after a
    # restart) but resumable — attempts are preserved.
    INTERRUPTED = "interrupted"
    # The ReAct attempt stopped at a checkpointed pause (budget limit,
    # an approval nobody could answer, wall-time cap, operator pause).
    # Not a failure: nothing is driving the run, ``pause_reason`` says
    # why, and ``resume`` (optionally with a raised budget / different
    # permission policy) or ``cancel`` decides what happens next.
    PAUSED = "paused"


class LoopMode(StrEnum):
    CODE = "code"
    PLAN = "plan"
    SPEC = "spec"
    GOAL = "goal"


class LoopPolicy(BaseModel):
    model_config = ConfigDict(extra="ignore")

    max_attempts: int = Field(default=2, ge=1, le=10)
    max_iterations: int = Field(default=8, ge=1, le=50)
    goal_mode: bool = False
    max_tokens_budget: int = Field(default=100_000, ge=1, le=2_000_000)
    max_usd_budget: float = Field(default=1.0, ge=0.0, le=100.0)
    # Unattended background work stops at the budget instead of spending
    # past it. The controller turns that stop into a resumable ``paused``
    # run (with the reason), never a failure; resume with a higher budget.
    budget_auto_pause: bool = True
    verifier_profile: str = "auto"
    # Default permission contract for background loops: Codex-style
    # automatic review (``acceptEdits`` == "approve for me" in this repo).
    # Boundary-crossing tool calls are judged by the auto-reviewer instead
    # of being pre-approved; an approval nobody can answer pauses the run.
    # ``sandbox_mode="full"`` here only means "write in place inside the
    # loop workspace" — ``"sandbox"`` would redirect writes to
    # ``.echo-work/<thread>`` where the verifier never looks. Writable roots
    # widen to the whole filesystem only for an explicit
    # ``bypassPermissions`` + ``execution_environment="local"`` policy.
    auto_approve: bool = False
    sandbox_mode: str = "full"
    permission_mode: str = "acceptEdits"
    execution_environment: str = "local"
    model: str | None = None

    @model_validator(mode="after")
    def _bypass_implies_auto_approve(self) -> LoopPolicy:
        # ``bypassPermissions`` is the full-access contract (the realtime
        # gateway pairs it with approval_policy="never" as well). The ReAct
        # approval gate only reads ``auto_approve``, so an explicit bypass
        # policy that left it at the new ``False`` default would otherwise
        # stall on every gated tool.
        if canonical_permission_mode(self.permission_mode) == "bypassPermissions":
            self.auto_approve = True
        return self


class VerifierFinding(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    command: str = ""
    category: str = ""
    passed: bool = False
    exit_code: int = 0
    stdout: str = ""
    stderr: str = ""
    duration_ms: int = 0
    execution_policy: dict[str, Any] = Field(default_factory=dict)


class VerifierResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    profile: str
    kind: str = "unknown"
    failure_category: str = ""
    passed: bool = False
    findings: list[VerifierFinding] = Field(default_factory=list)
    checked_at: str = Field(default_factory=_now_iso)
    summary: str = ""


class LoopAttempt(BaseModel):
    model_config = ConfigDict(extra="ignore")

    attempt_index: int = Field(ge=1)
    prompt: str
    started_at: str = Field(default_factory=_now_iso)
    completed_at: str | None = None
    status: str = "running"
    success: bool | None = None
    terminated_reason: str = ""
    final_answer: str = ""
    completion_receipt: dict[str, Any] = Field(default_factory=dict)
    completion_decision: dict[str, Any] = Field(default_factory=dict)
    effect_summary: dict[str, Any] = Field(default_factory=dict)
    verifier_result: VerifierResult | None = None
    error: str = ""


class LoopRun(BaseModel):
    model_config = ConfigDict(extra="ignore")

    run_id: str = Field(default_factory=_new_run_id)
    tenant_id: str | None = None
    owner_id: str | None = None
    parent_run_id: str | None = None
    origin_run_id: str | None = None
    resume_checkpoint_id: str | None = None
    goal: str = Field(..., min_length=1)
    mode: LoopMode = LoopMode.CODE
    status: LoopRunStatus = LoopRunStatus.PENDING
    thread_id: str | None = None
    workspace_path: str | None = None
    policy: LoopPolicy = Field(default_factory=LoopPolicy)
    attempts: list[LoopAttempt] = Field(default_factory=list)
    last_verifier_result: VerifierResult | None = None
    last_review: dict[str, Any] | None = None
    last_review_queue_result: dict[str, Any] | None = None
    last_evolution_candidate_result: dict[str, Any] | None = None
    cancel_requested_at: str | None = None
    cancel_reason: str = ""
    # Set while ``status == paused``: machine-readable reason
    # (``budget_near_limit`` / ``approval_required`` / ``external`` / ...)
    # plus the human-readable note the ReAct pause recorded.
    pause_reason: str = ""
    pause_detail: str = ""
    paused_at: str | None = None
    last_error: str = ""
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)
    started_at: str | None = None
    completed_at: str | None = None

    @field_validator(
        "owner_id",
        "tenant_id",
        "parent_run_id",
        "origin_run_id",
        "resume_checkpoint_id",
        "thread_id",
        "workspace_path",
        mode="before",
    )
    @classmethod
    def _normalize_optional_fields(cls, value: Any) -> str | None:
        return _normalize_optional_text(value)


class CreateLoopRunRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    goal: str = Field(..., min_length=1)
    mode: LoopMode = LoopMode.CODE
    thread_id: str | None = None
    workspace_path: str | None = None
    policy: LoopPolicy = Field(default_factory=LoopPolicy)
    execute: bool = False
    background: bool = False

    @field_validator("thread_id", "workspace_path", mode="before")
    @classmethod
    def _normalize_optionals(cls, value: Any) -> str | None:
        return _normalize_optional_text(value)


class CancelLoopRunRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    reason: str | None = None

    @field_validator("reason", mode="before")
    @classmethod
    def _normalize_reason(cls, value: Any) -> str | None:
        return _normalize_optional_text(value)


class RestartLoopRunRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    goal: str | None = None
    thread_id: str | None = None
    workspace_path: str | None = None
    policy: LoopPolicy | None = None
    execute: bool = False
    background: bool = False
    reuse_workspace: bool = True

    @field_validator("goal", "thread_id", "workspace_path", mode="before")
    @classmethod
    def _normalize_optionals(cls, value: Any) -> str | None:
        return _normalize_optional_text(value)


class LoopRunListResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    runs: list[LoopRun] = Field(default_factory=list)
    total: int = 0


class LoopRunRuntimeStateResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    run_id: str
    parent_run_id: str | None = None
    origin_run_id: str | None = None
    resume_checkpoint_id: str | None = None
    status: LoopRunStatus
    is_running: bool = False
    attempt_count: int = 0
    last_error: str = ""
    pause_reason: str = ""
    pause_detail: str = ""
    workspace_path: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    updated_at: str
    review_available: bool = False
    cancel_requested: bool = False
    cancel_requested_at: str | None = None
    cancel_reason: str = ""
    task_run: dict[str, Any] = Field(default_factory=dict)
    task_lease_health: dict[str, Any] = Field(default_factory=dict)
    task_recovery: dict[str, Any] = Field(default_factory=dict)
    recovery_audit: dict[str, Any] = Field(default_factory=dict)


class LoopRunsOverviewResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    total: int = 0
    active_dispatches: int = 0
    active_run_ids: list[str] = Field(default_factory=list)
    by_status: dict[str, int] = Field(default_factory=dict)
    by_mode: dict[str, int] = Field(default_factory=dict)
    reviewed_runs: int = 0
    task_health: dict[str, Any] = Field(default_factory=dict)
    recovery_audit: dict[str, Any] = Field(default_factory=dict)
