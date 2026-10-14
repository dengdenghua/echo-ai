"""Background loops / sub-agents default to automatic review + budget pause.

Covers the permission contract of unattended work: the ``LoopPolicy``
defaults (acceptEdits, no blanket auto-approve, budget auto-pause), that a
dangerous tool is reviewed rather than auto-passed (and not double-held by the
executor gate once reviewed), that an unanswerable approval and an exhausted
budget park the loop as a resumable ``paused`` run, that explicit bypass
choices still apply, and that react-driven sub-agents inherit their parent's
permission mode.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import pytest

from runtime.core.cerebrum._react_execution_phase6d import _approval_could_not_reach_user
from runtime.core.cerebrum.pause_control import PauseController
from runtime.core.cerebrum.react_loop import run_react_loop
from runtime.core.cerebrum.react_types import ReActResult
from runtime.execution.loops.controller import LoopController
from runtime.execution.loops.models import (
    CreateLoopRunRequest,
    LoopPolicy,
    LoopRun,
    LoopRunStatus,
    VerifierResult,
)
from runtime.execution.loops.store import LoopRunStore
from runtime.execution.suckers import Skill, SkillRegistry
from runtime.execution.tool_engine import ToolExecutor
from runtime.platform.process.service_provider import get_provider
from runtime.platform.process.session import Session, session_scope
from runtime.platform.process.task_supervisor import TaskRunStatus, TaskSupervisor
from runtime.platform.runtime_policy.workspaces import WorkspaceManager
from runtime.safety.approval.approval_gate import ApprovalDecision
from runtime.safety.auth import TrustEngine
from runtime.safety.governance import (
    ExecutionPolicyContext,
    GovernanceOutcome,
    build_execution_instruction,
    evaluate_execution_policy,
)
from runtime.safety.governance.execution_policy import caller_reviewed_tool_call

# ── fakes ────────────────────────────────────────────────────────────────


@dataclass
class _Response:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    finish_reason: str = "stop"
    cost_usd: float = 0.0


class _ScriptedRouter:
    """Main-model router: one scripted reply (and optional USD cost) per call."""

    def __init__(self, scripts: list[str], *, costs: list[float] | None = None) -> None:
        self.scripts = list(scripts)
        self.costs = list(costs or [])
        self.calls = 0

    def call(self, req: Any) -> _Response:  # noqa: ARG002
        if self.calls >= len(self.scripts):
            raise RuntimeError("router exhausted")
        cost = self.costs[self.calls] if self.calls < len(self.costs) else 0.0
        text = self.scripts[self.calls]
        self.calls += 1
        return _Response(text=text, input_tokens=10, output_tokens=2, cost_usd=cost)

    def call_stream(self, req: Any):
        from runtime.sensing.model_router.models import (
            CostEntry,
            ModelResponse,
            ModelStreamEvent,
        )

        resp = self.call(req)
        if resp.text:
            yield ModelStreamEvent(type="text_delta", delta=resp.text)
        yield ModelStreamEvent(
            type="done",
            final=ModelResponse(
                text=resp.text,
                model="test-model",
                input_tokens=resp.input_tokens,
                output_tokens=resp.output_tokens,
                finish_reason=resp.finish_reason,
                cost=CostEntry(usd=resp.cost_usd),
            ),
        )


class _ReviewerRouter:
    """Automatic-review model: allow / deny verdicts, or unavailable."""

    def __init__(self, outcome: str | None) -> None:
        self.outcome = outcome
        self.requests: list[Any] = []

    def call(self, req: Any) -> _Response:
        self.requests.append(req)
        if self.outcome is None:
            raise ConnectionError("reviewer offline")
        verdict = {"outcome": self.outcome, "risk": "low", "reason": "matches the goal"}
        return _Response(text=json.dumps(verdict))


class _FakePlanner:
    def __init__(self, router: Any) -> None:
        self.router = router
        self.planner_model = "test-model"


class _Stack:
    def __init__(self, router: Any, reviewer: Any, shell_calls: list[str]) -> None:
        self.planner = _FakePlanner(router)
        self.approval_router = reviewer
        registry = SkillRegistry()
        registry.register(
            Skill(
                name="echo",
                description="echo text back",
                affinity=["io"],
                trusted_source="builtin://echo",
                handler=lambda text="", **_kw: {"echoed": text},
            ),
            verify_tests=False,
        )

        def _shell(command: str = "", **_kw: Any) -> dict[str, Any]:
            shell_calls.append(command)
            return {"argv": command.split(), "exit_code": 0, "stdout": "ok", "stderr": ""}

        registry.register(
            Skill(
                name="exec_shell",
                description="run a shell command",
                affinity=["shell", "exec", "dangerous"],
                trusted_source="builtin://exec_shell",
                handler=_shell,
            ),
            verify_tests=False,
        )
        self.executor = ToolExecutor(
            registry=registry,
            immunity=TrustEngine(trusted_sources=["builtin://*"], unknown_policy="allow"),
        )


class _PassingVerifiers:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def run(self, profile: str, workspace_path: str) -> VerifierResult:
        self.calls.append((profile, workspace_path))
        return VerifierResult(profile=profile, kind="python", passed=True, summary="ok")


def _real_react_runner(**kwargs: Any) -> ReActResult | None:
    """Drive the real ReAct loop with the context the controller built.

    An injected runner only receives the base kwargs, so forward the
    loop's per-run budget the way the default runner wiring does.
    """
    intent = kwargs["intent"]
    return run_react_loop(
        kwargs["stack"],
        intent,
        kwargs["agent"],
        model=kwargs.get("model"),
        max_iterations=kwargs.get("max_iterations") or 4,
        thread_id=kwargs.get("thread_id"),
        max_tokens_budget=int(intent.user_context["max_tokens_budget"]),
        max_usd_budget=float(intent.user_context["max_usd_budget"]),
    )


@pytest.fixture
def pause_controller(tmp_path, monkeypatch) -> PauseController:
    monkeypatch.setenv("ECHO_DATA_DIR", str(tmp_path / "data"))
    controller = PauseController(store_path=None)
    # The ReAct loop resolves the process-wide controller; share one in-memory
    # instance with the loop controller so nothing touches the real data dir.
    get_provider().register_instance("pause_controller", controller)
    return controller


def _controller(
    tmp_path,
    stack: Any,
    *,
    pause_controller: PauseController,
    react_runner: Any = _real_react_runner,
    verifiers: Any = None,
) -> tuple[LoopController, LoopRunStore, TaskSupervisor]:
    store = LoopRunStore(tmp_path / "loop_runs.json")
    supervisor = TaskSupervisor.from_path(tmp_path / "task_runs.json", holder_id="loop-worker")
    controller = LoopController(
        store=store,
        stack=stack,
        workspace_manager=WorkspaceManager(tmp_path / "workspaces"),
        verifier_registry=verifiers or _PassingVerifiers(),
        task_supervisor=supervisor,
        react_runner=react_runner,
        pause_controller=pause_controller,
    )
    return controller, store, supervisor


def _new_run(store: LoopRunStore, tmp_path, *, policy: LoopPolicy | None = None) -> LoopRun:
    workspace = tmp_path / "repo"
    workspace.mkdir(exist_ok=True)
    run = LoopRun(
        goal="run the smoke check",
        workspace_path=str(workspace),
        policy=policy or LoopPolicy(max_attempts=1, max_iterations=4),
    )
    return store.create(run)


# ── policy defaults & explicit choices ─────────────────────────────────


def test_loop_policy_defaults_to_accept_edits_with_budget_auto_pause() -> None:
    policy = LoopPolicy()

    assert policy.permission_mode == "acceptEdits"
    assert policy.auto_approve is False
    # "full" = write in place inside the loop workspace; the filesystem-wide
    # roots stay reserved for an explicit bypassPermissions + local policy.
    assert policy.sandbox_mode == "full"
    assert policy.execution_environment == "local"
    assert policy.budget_auto_pause is True
    assert CreateLoopRunRequest(goal="x").policy == policy


def test_explicit_bypass_and_auto_approve_choices_still_apply() -> None:
    bypass = LoopPolicy.model_validate({"permission_mode": "bypassPermissions"})
    assert bypass.permission_mode == "bypassPermissions"
    assert bypass.auto_approve is True

    auto_only = LoopPolicy.model_validate({"auto_approve": True})
    assert auto_only.auto_approve is True
    assert auto_only.permission_mode == "acceptEdits"

    request = CreateLoopRunRequest.model_validate(
        {"goal": "x", "policy": {"permission_mode": "bypassPermissions"}}
    )
    assert request.policy.auto_approve is True


def test_persisted_runs_keep_their_previous_policy(tmp_path) -> None:
    legacy_policy = {
        "auto_approve": True,
        "sandbox_mode": "full",
        "permission_mode": "bypassPermissions",
        "execution_environment": "local",
        "budget_auto_pause": False,
    }
    store = LoopRunStore(tmp_path / "loop_runs.json")
    created = store.create(LoopRun.model_validate({"goal": "legacy", "policy": legacy_policy}))

    reloaded = LoopRunStore(tmp_path / "loop_runs.json").get(created.run_id)

    assert reloaded is not None
    assert reloaded.policy.model_dump(include=set(legacy_policy)) == legacy_policy


def test_loop_attempt_hands_the_permission_contract_to_react(tmp_path, pause_controller) -> None:
    seen: dict[str, Any] = {}

    def runner(*, stack, intent, agent, model=None, max_iterations=0, thread_id=None):
        from runtime.platform.process.session import current_session

        seen["user_context"] = dict(intent.user_context)
        seen["session"] = dict(current_session().metadata)
        return ReActResult(final_answer="done", success=True)

    controller, store, _ = _controller(
        tmp_path,
        SimpleNamespace(name="stack"),
        pause_controller=pause_controller,
        react_runner=runner,
    )
    run = _new_run(store, tmp_path)

    controller.execute(run.run_id)

    context = seen["user_context"]
    assert context["permission_mode"] == "acceptEdits"
    assert context["auto_approve"] is False
    assert context["budget_auto_pause"] is True
    assert context["pause_on_unavailable_review"] is True
    # With a task supervisor the executor chokepoint enforces approval too.
    assert seen["session"]["enforce_executor_approval"] is True
    assert seen["session"]["auto_approve"] is False


# ── approvals under the default policy ─────────────────────────────────


def test_default_policy_reviews_dangerous_tool_instead_of_auto_approving(
    tmp_path, pause_controller
) -> None:
    shell_calls: list[str] = []
    reviewer = _ReviewerRouter("allow")
    stack = _Stack(
        _ScriptedRouter(
            [
                'Thought: run it\nAction: exec_shell({"command": "echo smoke"})\n',
                "Final Answer: the smoke check printed ok",
            ]
        ),
        reviewer,
        shell_calls,
    )
    controller, store, supervisor = _controller(tmp_path, stack, pause_controller=pause_controller)
    run = _new_run(store, tmp_path)

    finished = controller.execute(run.run_id)

    # Reviewed (not auto-passed), and the approved call ran exactly once:
    # the executor's enforce_executor_approval gate did not hold it again.
    assert len(reviewer.requests) == 1
    assert shell_calls == ["echo smoke"]
    record = supervisor.store.get(run.run_id)
    assert record is not None
    assert record.status != TaskRunStatus.WAITING_APPROVAL
    assert finished.status == LoopRunStatus.COMPLETED


def test_default_policy_does_not_run_a_tool_the_reviewer_denies(tmp_path, pause_controller) -> None:
    shell_calls: list[str] = []
    reviewer = _ReviewerRouter("deny")
    stack = _Stack(
        _ScriptedRouter(
            [
                'Thought: run it\nAction: exec_shell({"command": "rm -rf build"})\n',
                "Final Answer: the reviewer declined the command",
            ]
        ),
        reviewer,
        shell_calls,
    )
    controller, store, _ = _controller(tmp_path, stack, pause_controller=pause_controller)
    run = _new_run(store, tmp_path)

    controller.execute(run.run_id)

    assert len(reviewer.requests) == 1
    assert shell_calls == []


def test_explicit_bypass_policy_skips_review(tmp_path, pause_controller) -> None:
    shell_calls: list[str] = []
    reviewer = _ReviewerRouter("deny")
    stack = _Stack(
        _ScriptedRouter(
            [
                'Thought: run it\nAction: exec_shell({"command": "echo smoke"})\n',
                "Final Answer: the smoke check printed ok",
            ]
        ),
        reviewer,
        shell_calls,
    )
    controller, store, _ = _controller(tmp_path, stack, pause_controller=pause_controller)
    run = _new_run(
        store,
        tmp_path,
        policy=LoopPolicy(max_attempts=1, max_iterations=4, permission_mode="bypassPermissions"),
    )

    controller.execute(run.run_id)

    assert reviewer.requests == []
    assert shell_calls == ["echo smoke"]


def test_unanswered_review_pauses_the_loop_and_resume_continues(tmp_path, pause_controller) -> None:
    shell_calls: list[str] = []
    reviewer = _ReviewerRouter(None)  # nobody can answer the approval
    verifiers = _PassingVerifiers()
    stack = _Stack(
        _ScriptedRouter(['Thought: run it\nAction: exec_shell({"command": "echo smoke"})\n']),
        reviewer,
        shell_calls,
    )
    controller, store, supervisor = _controller(
        tmp_path, stack, pause_controller=pause_controller, verifiers=verifiers
    )
    run = _new_run(store, tmp_path)

    paused = controller.execute(run.run_id)

    assert paused.status == LoopRunStatus.PAUSED
    assert paused.pause_reason == "approval_required"
    assert "exec_shell" in paused.pause_detail
    assert paused.completed_at is None
    assert paused.attempts[-1].status == "paused"
    assert shell_calls == []
    # A pause is not a verdict: no verification, no repair attempt.
    assert verifiers.calls == []
    assert len(paused.attempts) == 1
    # The loop owns continuation, so the per-turn ReAct pause record is released.
    assert pause_controller.list_pending() == []
    assert pause_controller.list_paused() == []
    record = supervisor.store.get(run.run_id)
    assert record is not None
    assert record.status == TaskRunStatus.PAUSED
    queue_item = supervisor.store.recovery_queue()["items"][0]
    assert queue_item["pause_reason"] == "approval_required"
    # Re-dispatching a paused run is a no-op; it continues through resume.
    assert controller.execute(run.run_id).status == LoopRunStatus.PAUSED

    reviewer.outcome = "allow"
    stack.planner.router = _ScriptedRouter(
        [
            'Thought: run it\nAction: exec_shell({"command": "echo smoke"})\n',
            "Final Answer: the smoke check printed ok",
        ]
    )
    child = controller.resume(run.run_id)
    assert child.parent_run_id == run.run_id
    resumed = controller.execute(child.run_id)

    assert resumed.status == LoopRunStatus.COMPLETED
    assert shell_calls == ["echo smoke"]
    assert "Paused because: approval_required" in resumed.attempts[0].prompt


# ── budget ──────────────────────────────────────────────────────────────


def test_budget_exhaustion_pauses_and_resumes_with_a_higher_budget(
    tmp_path, pause_controller
) -> None:
    verifiers = _PassingVerifiers()
    stack = _Stack(
        _ScriptedRouter(
            [
                'Thought: gather evidence\nAction: echo({"text": "step"})\n',
                "Final Answer: must not be reached before the budget pause",
            ],
            # Code-mode turns floor the USD ceiling at $3; this call alone
            # crosses the 95% pause threshold.
            costs=[5.0, 0.0],
        ),
        _ReviewerRouter("allow"),
        [],
    )
    controller, store, supervisor = _controller(
        tmp_path, stack, pause_controller=pause_controller, verifiers=verifiers
    )
    run = _new_run(store, tmp_path)

    paused = controller.execute(run.run_id)

    assert paused.status == LoopRunStatus.PAUSED
    assert paused.pause_reason == "budget_near_limit"
    assert "成本预算临界" in paused.pause_detail
    assert paused.last_error == ""
    assert verifiers.calls == []
    record = supervisor.store.get(run.run_id)
    assert record is not None
    assert record.status == TaskRunStatus.PAUSED
    assert record.metadata["pause_reason"] == "budget_near_limit"
    assert record.latest_checkpoint_id

    # Raise only the budget: the rest of the run's policy carries over.
    child = controller.resume(
        run.run_id,
        policy=LoopPolicy.model_validate({"max_usd_budget": 50.0}),
    )
    assert child.policy.max_usd_budget == 50.0
    assert child.policy.permission_mode == "acceptEdits"
    assert child.policy.max_attempts == 1

    stack.planner.router = _ScriptedRouter(
        [
            'Thought: gather evidence\nAction: echo({"text": "step"})\n',
            "Final Answer: evidence gathered within the raised budget",
        ],
        costs=[5.0, 0.0],
    )
    resumed = controller.execute(child.run_id)

    assert resumed.status == LoopRunStatus.COMPLETED
    assert "Paused because: budget_near_limit" in resumed.attempts[0].prompt


def test_paused_run_can_be_cancelled(tmp_path, pause_controller) -> None:
    def runner(*, stack, intent, agent, model=None, max_iterations=0, thread_id=None):
        pause_controller.request_pause(
            task_id="react-task",
            reason="budget_near_limit",
            requested_by="system",
            note="budget",
            thread_id=thread_id,
        )
        return ReActResult(final_answer="paused", success=False, terminated_reason="paused")

    controller, store, _ = _controller(
        tmp_path,
        SimpleNamespace(name="stack"),
        pause_controller=pause_controller,
        react_runner=runner,
    )
    run = _new_run(store, tmp_path)
    assert controller.execute(run.run_id).status == LoopRunStatus.PAUSED

    cancelled = controller.request_cancel(run.run_id, reason="not worth more budget")

    assert cancelled.status == LoopRunStatus.CANCELLED
    assert cancelled.cancel_reason == "not worth more budget"


def test_resuming_a_legacy_bypass_run_with_more_budget_keeps_bypass(
    tmp_path, pause_controller
) -> None:
    def runner(*, stack, intent, agent, model=None, max_iterations=0, thread_id=None):
        return ReActResult(final_answer="paused", success=False, terminated_reason="paused")

    controller, store, _ = _controller(
        tmp_path,
        SimpleNamespace(name="stack"),
        pause_controller=pause_controller,
        react_runner=runner,
    )
    run = _new_run(
        store,
        tmp_path,
        policy=LoopPolicy(
            max_attempts=1,
            permission_mode="bypassPermissions",
            auto_approve=True,
            budget_auto_pause=False,
        ),
    )
    paused = controller.execute(run.run_id)
    assert paused.status == LoopRunStatus.PAUSED
    # No ReAct pause record for this thread: still parked, with a generic reason.
    assert paused.pause_reason == "paused"

    child = controller.resume(run.run_id, policy=LoopPolicy.model_validate({"max_usd_budget": 9}))

    assert child.policy.permission_mode == "bypassPermissions"
    assert child.policy.auto_approve is True
    assert child.policy.budget_auto_pause is False
    assert child.policy.max_usd_budget == 9


# ── executor gate & approval classification ────────────────────────────


def test_caller_review_lets_exactly_the_approved_call_through_the_executor_gate() -> None:
    context = ExecutionPolicyContext(enforce_approval=True)

    def decide(tool: str, command: str):
        instruction = build_execution_instruction(
            instruction_id="i",
            tool_name=tool,
            caller="react_loop",
            args={"command": command},
        )
        return evaluate_execution_policy(instruction, context=context)

    assert decide("exec_shell", "echo hi").outcome == GovernanceOutcome.HOLD
    with caller_reviewed_tool_call("exec_shell"):
        assert decide("exec_shell", "echo hi").outcome == GovernanceOutcome.ALLOW
        # Consumed: a nested dispatch inside the approved call is still held.
        assert decide("exec_shell", "echo again").outcome == GovernanceOutcome.HOLD
    with caller_reviewed_tool_call("write_text_file"):
        assert decide("exec_shell", "echo hi").outcome == GovernanceOutcome.HOLD

    deny_all = ExecutionPolicyContext.from_metadata(
        {
            "enforce_executor_approval": True,
            "approval_risk_policy": {"medium": "deny", "high": "deny", "critical": "deny"},
        }
    )
    instruction = build_execution_instruction(
        instruction_id="i",
        tool_name="exec_shell",
        caller="react_loop",
        args={"command": "echo hi"},
    )
    with caller_reviewed_tool_call("exec_shell"):
        assert (
            evaluate_execution_policy(instruction, context=deny_all).outcome
            == GovernanceOutcome.DENY
        )


def test_unavailable_auto_review_counts_as_unanswered_only_when_opted_in() -> None:
    decision = ApprovalDecision(
        approved=False,
        reason="automatic review was unavailable or timed out",
    )

    assert not _approval_could_not_reach_user(decision)
    assert _approval_could_not_reach_user(decision, include_unavailable_review=True)
    assert not _approval_could_not_reach_user(
        ApprovalDecision(approved=False, reason="auto-review: unsafe"),
        include_unavailable_review=True,
    )


# ── sub-agents ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("parent_metadata", "expected"),
    [
        ({"permission_mode": "bypassPermissions"}, ("bypassPermissions", True)),
        ({"permission_mode": "default", "approval_policy": "never"}, ("default", True)),
        ({"permission_mode": "acceptEdits", "auto_approve": True}, ("acceptEdits", True)),
        ({"permission_mode": "acceptEdits"}, ("acceptEdits", False)),
        ({"permission_mode": "default", "approval_policy": "on-request"}, ("default", False)),
        ({"permission_mode": "plan"}, ("plan", False)),
        ({}, ("acceptEdits", False)),
        (None, ("acceptEdits", False)),
    ],
)
def test_subagent_permissions_inherit_from_the_parent_turn(parent_metadata, expected) -> None:
    from runtime.execution.subagents.react_drive import inherited_subagent_permissions

    assert inherited_subagent_permissions(parent_metadata) == expected


def test_react_driven_subagent_runs_under_the_parent_permission_mode(monkeypatch) -> None:
    from runtime.execution.subagents import react_drive

    captured: dict[str, Any] = {}

    def fake_stream(stack, intent, agent, **kwargs):
        captured["user_context"] = dict(intent.user_context)
        return ReActResult(final_answer="child done", success=True)
        yield  # pragma: no cover - generator marker

    monkeypatch.setattr(react_drive, "stream_react_loop", fake_stream)

    with session_scope(
        Session(
            thread_id="parent",
            metadata={"permission_mode": "default", "approval_policy": "on-request"},
        )
    ):
        result = react_drive.run_subagent_react_loop(
            SimpleNamespace(),
            prompt="check the logs",
            role_id="researcher",
            model="m",
            thread_id="child",
        )

    assert result is not None and result.final_answer == "child done"
    assert captured["user_context"]["permission_mode"] == "default"
    assert captured["user_context"]["auto_approve"] is False
