"""Automatic review: turn-wide denial breaker + loop network review.

Codex auto-review stops a turn after 3 consecutive denials or 10 denials in
the last 50 reviews; Claude Code's auto mode then asks the user. Covers:

- ``AutoReviewApprovalProvider`` turn accounting (consecutive / windowed
  denials, approvals reset the streak, unavailable reviews are not denials,
  spent review budget, the same-action breaker is kept);
- the ReAct turn reuses one provider across iterations, and a turn stop
  pauses with ``approval_required`` (interactive and background) or, with no
  pause controller, becomes an explicit "stop trying" denial;
- background loops: shell network stays off by default, sandbox escalation
  is one-shot, and network-reaching tools go through the reviewer.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest

from runtime.core.cerebrum._react_approval_pause import (
    _approval_could_not_reach_user,
    _approval_denied_observation,
    _pause_for_unavailable_approval,
    _turn_auto_review_provider,
)
from runtime.core.cerebrum.pause_control import PauseController
from runtime.core.cerebrum.react_loop import run_react_loop
from runtime.core.cerebrum.react_loop_state import _LoopState
from runtime.core.cerebrum.react_types import ReActResult
from runtime.execution.loops.models import LoopPolicy, LoopRunStatus
from runtime.execution.suckers import Skill
from runtime.platform.models.pipeline import ParsedIntent
from runtime.platform.process.service_provider import get_provider
from runtime.safety.approval.approval_gate import (
    ApprovalDecision,
    ApprovalRequest,
    ApprovalRiskPolicy,
    approval_action_for_tool,
)
from runtime.safety.approval.guardian_review import (
    AUTO_REVIEW_TURN_STOP_PREFIX,
    AutoReviewApprovalProvider,
    is_auto_review_turn_stop,
)
from runtime.safety.governance import (
    ExecutionPolicyContext,
    GovernanceOutcome,
    build_execution_instruction,
    evaluate_execution_policy,
)
from runtime.safety.governance.execution_policy import caller_reviewed_tool_call
from tests.test_background_task_permissions import (
    _controller,
    _new_run,
    _Response,
    _ScriptedRouter,
    _Stack,
)

# ── fakes ────────────────────────────────────────────────────────────────


@pytest.fixture
def pause_controller(tmp_path, monkeypatch) -> PauseController:
    monkeypatch.setenv("ECHO_DATA_DIR", str(tmp_path / "data"))
    controller = PauseController(store_path=None)
    # The ReAct loop resolves the process-wide controller; share one in-memory
    # instance so nothing touches the real data dir.
    get_provider().register_instance("pause_controller", controller)
    return controller


class _SequenceReviewer:
    """Reviewer model replaying one verdict per call (``None`` = unavailable)."""

    def __init__(self, outcomes: list[str | None], *, default: str | None = "deny") -> None:
        self.outcomes = list(outcomes)
        self.default = default
        self.requests: list[Any] = []

    def call(self, req: Any) -> _Response:
        self.requests.append(req)
        outcome = self.outcomes.pop(0) if self.outcomes else self.default
        if outcome is None:
            raise ConnectionError("reviewer offline")
        verdict = {"outcome": outcome, "risk": "medium", "reason": f"{outcome} by review"}
        return _Response(text=json.dumps(verdict))


def _provider(reviewer: _SequenceReviewer, **kwargs: Any) -> AutoReviewApprovalProvider:
    return AutoReviewApprovalProvider(reviewer, user_intent="整理仓库", timeout_s=0, **kwargs)


def _ask(provider: AutoReviewApprovalProvider, n: int, *, tool: str = "exec_shell") -> Any:
    return provider.request(
        ApprovalRequest(
            thread_id="th",
            tool_name=tool,
            tool_call_id=f"call-{n}",
            args_preview=f"command #{n}",
        )
    )


def _shell_script(*commands: str, final: str = "Final Answer: done") -> list[str]:
    return [
        f'Thought: step {idx}\nAction: exec_shell({{"command": "{command}"}})\n'
        for idx, command in enumerate(commands)
    ] + [final]


# ── provider: turn-wide accounting ───────────────────────────────────────


def test_three_consecutive_denials_of_different_actions_stop_the_turn() -> None:
    reviewer = _SequenceReviewer([], default="deny")
    provider = _provider(reviewer)

    first, second = _ask(provider, 1), _ask(provider, 2)
    third = _ask(provider, 3)

    assert first.reason == "auto-review: deny by review"
    assert not is_auto_review_turn_stop(second.reason)
    assert third.approved is False
    assert third.reason.startswith(AUTO_REVIEW_TURN_STOP_PREFIX)
    assert "3 consecutive denials" in third.reason
    assert "do not work around" in third.reason
    assert provider.turn_stop is not None
    assert provider.turn_stop.cause == "consecutive_denials"
    assert provider.turn_stop.denials == 3

    # Stopped: later requests are refused without consulting the reviewer.
    later = _ask(provider, 4, tool="write_text_file")
    assert later.approved is False
    assert is_auto_review_turn_stop(later.reason)
    assert len(reviewer.requests) == 3


def test_an_approval_resets_the_consecutive_streak() -> None:
    reviewer = _SequenceReviewer(["deny", "deny", "allow", "deny", "deny", "deny"])
    provider = _provider(reviewer)

    decisions = [_ask(provider, n) for n in range(5)]

    assert decisions[2].approved is True
    assert not any(is_auto_review_turn_stop(d.reason) for d in decisions)
    assert provider.turn_stop is None
    assert is_auto_review_turn_stop(_ask(provider, 5).reason)


def test_ten_denials_in_the_last_fifty_reviews_stop_the_turn() -> None:
    # Alternating verdicts never make 3 in a row; the 10th denial trips.
    reviewer = _SequenceReviewer(["deny", "allow"] * 10)
    provider = _provider(reviewer, per_turn_limit=200)

    decisions = [_ask(provider, n) for n in range(18)]
    assert not any(is_auto_review_turn_stop(d.reason) for d in decisions)

    tenth_denial = _ask(provider, 18)

    assert is_auto_review_turn_stop(tenth_denial.reason)
    assert "10 denials in the last 19 reviews" in tenth_denial.reason
    assert provider.turn_stop is not None
    assert provider.turn_stop.cause == "recent_denials"
    assert provider.turn_stop.denials == 10


def test_denials_older_than_the_window_age_out() -> None:
    # 9 denials early on, then 41 approvals: only 4 of those denials remain
    # in the last 50 reviews, so one more denial does not trip.
    reviewer = _SequenceReviewer(["deny", "allow"] * 9 + ["allow"] * 41 + ["deny"])
    provider = _provider(reviewer, per_turn_limit=200)

    decisions = [_ask(provider, n) for n in range(60)]

    assert decisions[-1].approved is False
    assert not is_auto_review_turn_stop(decisions[-1].reason)
    assert provider.turn_stop is None


def test_unavailable_reviews_are_not_denials() -> None:
    reviewer = _SequenceReviewer(["deny", "deny", None, None, None, "allow", "deny", "deny"])
    provider = _provider(reviewer)

    decisions = [_ask(provider, n) for n in range(8)]

    assert [d.reason for d in decisions[2:5]] == [
        "automatic review was unavailable or timed out"
    ] * 3
    # deny, deny, (3 unavailable), allow, deny, deny → never 3 denials in a row.
    assert provider.turn_stop is None
    assert not any(is_auto_review_turn_stop(d.reason) for d in decisions)


def test_spent_review_budget_hands_the_turn_back_to_a_person() -> None:
    reviewer = _SequenceReviewer([], default="allow")
    provider = _provider(reviewer, per_turn_limit=2)

    assert _ask(provider, 1).approved and _ask(provider, 2).approved
    third = _ask(provider, 3)

    assert third.approved is False
    assert is_auto_review_turn_stop(third.reason)
    assert "limit of 2 reviews" in third.reason
    assert provider.turn_stop is not None
    assert provider.turn_stop.cause == "review_budget"
    assert len(reviewer.requests) == 2


def test_same_action_breaker_is_kept() -> None:
    # A, B, A, C, A: the turn streak keeps resetting, the same-action
    # breaker still opens after the third denial of A.
    reviewer = _SequenceReviewer(["deny", "allow", "deny", "allow", "deny"])
    provider = _provider(reviewer)
    same = ApprovalRequest(
        thread_id="th", tool_name="exec_shell", tool_call_id="a", args_preview="A"
    )

    for other in ("B", "C", None):
        provider.request(same)
        if other is not None:
            provider.request(
                ApprovalRequest(
                    thread_id="th", tool_name="exec_shell", tool_call_id=other, args_preview=other
                )
            )
    blocked = provider.request(same)

    assert blocked.reason == "automatic review stopped after repeated denials"
    assert not is_auto_review_turn_stop(blocked.reason)
    assert provider.turn_stop is None
    assert len(reviewer.requests) == 5


def test_user_intent_can_be_updated_between_iterations() -> None:
    reviewer = _SequenceReviewer([], default="allow")
    provider = _provider(reviewer)
    provider.update_user_intent("只读检查，不要改文件")
    provider.update_user_intent("")  # an empty extraction keeps the last request

    _ask(provider, 1)

    prompt = reviewer.requests[0].messages[-1].content
    assert "只读检查，不要改文件" in prompt


# ── ReAct turn: one provider per turn, stop → pause ──────────────────────


def _state(**wiring: Any) -> _LoopState:
    intent = ParsedIntent(
        raw="整理仓库",
        intent_type="task",
        normalized_goal="整理仓库",
        user_context={"permission_mode": "acceptEdits"},
    )
    stack = SimpleNamespace(approval_router=_SequenceReviewer([], default="deny"))
    return _LoopState(intent=intent, stack=stack, thread_id="th", **wiring)


def test_turn_reuses_one_reviewer_across_iterations() -> None:
    state = _state()

    first = _turn_auto_review_provider(state)
    second = _turn_auto_review_provider(state)

    assert isinstance(first, AutoReviewApprovalProvider)
    assert second is first
    state.wiring.intent.user_context["permission_mode"] = "default"
    assert _turn_auto_review_provider(state) is None


def _stopped_decision(state: _LoopState) -> ApprovalDecision:
    provider = _turn_auto_review_provider(state)
    decisions = [_ask(provider, n) for n in range(3)]
    return decisions[-1]


class _RecordingPauses:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    def request_pause(self, **kwargs: Any) -> None:
        self.requests.append(kwargs)


def test_turn_stop_pauses_for_a_person_even_in_interactive_turns() -> None:
    pauses = _RecordingPauses()
    state = _state(pause_controller=pauses, react_task_id="task-1")
    decision = _stopped_decision(state)

    preview = _pause_for_unavailable_approval(
        state,
        decision,
        iteration=2,
        tool_name="exec_shell",
        detail="exec_shell wants to execute",
    )

    assert _approval_could_not_reach_user(decision)
    assert "需要你决定" in preview
    assert len(pauses.requests) == 1
    assert pauses.requests[0]["reason"] == "approval_required"
    assert pauses.requests[0]["note"].startswith("自动审查本轮已拒绝 3 次")
    assert state.iteration.iteration_limit >= 4


def test_turn_stop_without_a_pause_controller_tells_the_agent_to_stop() -> None:
    state = _state(pause_controller=None, react_task_id="task-1")
    decision = _stopped_decision(state)

    preview = _pause_for_unavailable_approval(
        state,
        decision,
        iteration=0,
        tool_name="exec_shell",
        detail="exec_shell wants to execute",
    )
    observation = _approval_denied_observation(decision)

    assert preview == ""
    assert "不要再尝试同类操作" in observation
    assert "绕过" in observation
    assert "do not work around" in decision.reason
    # Ordinary denials keep their existing wording.
    plain = ApprovalDecision(approved=False, reason="auto-review: unsafe")
    assert _approval_denied_observation(plain).startswith("(工具审批未通过)")
    assert _approval_denied_observation(plain, sandbox_escalation=True).startswith(
        "(工具被沙箱拦截"
    )


def test_interactive_turn_denials_accumulate_across_iterations_and_pause(
    pause_controller: PauseController,
) -> None:
    shell_calls: list[str] = []
    reviewer = _SequenceReviewer([], default="deny")
    stack = _Stack(
        _ScriptedRouter(_shell_script("echo one", "echo two", "echo three", "echo four")),
        reviewer,
        shell_calls,
    )
    intent = ParsedIntent(
        raw="clean the build",
        intent_type="task",
        normalized_goal="clean the build",
        user_context={"permission_mode": "acceptEdits"},
    )

    result = run_react_loop(stack, intent, None, max_iterations=8, thread_id="th-interactive")

    assert result is not None
    assert result.terminated_reason == "paused"
    # One reviewer for the whole turn: the 3rd denial (3rd iteration) stops it.
    assert len(reviewer.requests) == 3
    assert shell_calls == []
    paused = pause_controller.list_paused()
    assert len(paused) == 1
    assert paused[0].reason == "approval_required"
    assert paused[0].note.startswith("自动审查本轮已拒绝 3 次")


# ── background loop ──────────────────────────────────────────────────────


@pytest.mark.parametrize("mode", ["default", "acceptEdits"])
@pytest.mark.parametrize("approved", [False, True])
def test_interactive_batch_reviews_each_shell_action(mode, approved) -> None:
    shell_calls: list[str] = []
    reviewer = _SequenceReviewer([], default="allow" if approved else "deny")
    human_requests: list[Any] = []

    class HumanApproval:
        def request(self, request, **_kwargs):
            human_requests.append(request)
            return ApprovalDecision(approved=approved, reason="human decision")

    batch = (
        "Thought: execute both requested commands\nAction:\n"
        'exec_shell({"command":"rm -rf a"})\n'
        'exec_shell({"command":"rm -rf b"})\n'
    )
    stack = _Stack(_ScriptedRouter([batch, "Final Answer: done"]), reviewer, shell_calls)
    intent = ParsedIntent(
        raw="clean both directories",
        intent_type="task",
        normalized_goal="clean both directories",
        user_context={"permission_mode": mode},
    )
    result = run_react_loop(
        stack, intent, None, max_iterations=4, thread_id="batch", approval_provider=HumanApproval()
    )

    assert result is not None
    assert len(human_requests if mode == "default" else reviewer.requests) == 2
    assert shell_calls == (["rm -rf a", "rm -rf b"] if approved else [])


def test_batch_review_stop_pauses_before_remaining_actions(pause_controller) -> None:
    shell_calls: list[str] = []
    reviewer = _SequenceReviewer([], default="deny")
    batch = "Thought: clean all directories\nAction:\n" + "\n".join(
        f'exec_shell({{"command":"rm -rf {target}"}})' for target in ("a", "b", "c", "d")
    )
    stack = _Stack(_ScriptedRouter([batch]), reviewer, shell_calls)
    intent = ParsedIntent(
        raw="clean directories",
        intent_type="task",
        normalized_goal="clean directories",
        user_context={"permission_mode": "acceptEdits"},
    )

    result = run_react_loop(stack, intent, None, max_iterations=4, thread_id="batch-pause")

    assert result.terminated_reason == "paused"
    assert len(reviewer.requests) == 3
    assert shell_calls == []
    assert len(pause_controller.list_paused()) == 1
    assert pause_controller.list_paused()[0].reason == "approval_required"


def test_loop_pauses_for_a_person_after_repeated_review_denials(
    tmp_path, pause_controller: PauseController
) -> None:
    shell_calls: list[str] = []
    reviewer = _SequenceReviewer([], default="deny")
    stack = _Stack(
        _ScriptedRouter(_shell_script("rm -rf a", "rm -rf b", "rm -rf c", "rm -rf d")),
        reviewer,
        shell_calls,
    )
    controller, store, _ = _controller(tmp_path, stack, pause_controller=pause_controller)
    run = _new_run(store, tmp_path, policy=LoopPolicy(max_attempts=1, max_iterations=6))

    paused = controller.execute(run.run_id)

    assert paused.status == LoopRunStatus.PAUSED
    assert paused.pause_reason == "approval_required"
    assert "自动审查本轮已拒绝 3 次" in paused.pause_detail
    assert len(reviewer.requests) == 3
    assert shell_calls == []


def test_loop_shell_has_no_network_by_default(tmp_path, pause_controller) -> None:
    from runtime.execution.suckers._write_skills_exec import _resolved_allow_network
    from runtime.platform.process.session import current_session

    seen: dict[str, Any] = {}

    def runner(*, stack, intent, agent, model=None, max_iterations=0, thread_id=None):
        seen["metadata"] = dict(current_session().metadata)
        seen["default"] = _resolved_allow_network(None)
        seen["model_asks"] = _resolved_allow_network(True)
        return ReActResult(final_answer="done", success=True)

    controller, store, _ = _controller(
        tmp_path,
        SimpleNamespace(name="stack"),
        pause_controller=pause_controller,
        react_runner=runner,
    )
    controller.execute(_new_run(store, tmp_path).run_id)

    assert "sandbox_policy" not in seen["metadata"]
    assert seen["default"] is False
    assert seen["model_asks"] is False


def _network_probe_stack(
    reviewer: Any, router: Any, seen: list[bool], *, tool_name: str = "lint"
) -> _Stack:
    """A sandboxed tool: the first attempt fails, only an approved retry can run."""
    from runtime.execution.suckers._write_skills_exec import _resolved_allow_network

    stack = _Stack(router, reviewer, [])

    def _lint(command: str = "", **_kw: Any) -> dict[str, Any]:
        allowed = _resolved_allow_network(None)
        seen.append(allowed)
        if not allowed:
            return {"error": "sandbox_violation: network access denied", "argv": [command]}
        return {"argv": command.split(), "exit_code": 0, "stdout": "clean", "stderr": ""}

    stack.executor.registry.register(
        Skill(
            name=tool_name,
            description="lint the workspace",
            affinity=["shell", "exec", "dangerous"]
            if tool_name == "exec_shell"
            else ["lint", "verify"],
            trusted_source=f"builtin://{tool_name}",
            handler=_lint,
        ),
        verify_tests=False,
        replace=tool_name == "exec_shell",
    )
    return stack


@pytest.mark.parametrize("tool_name", ["lint", "exec_shell"])
def test_loop_sandbox_escalation_is_one_shot(tmp_path, pause_controller, tool_name) -> None:
    seen: list[bool] = []
    reviewer = _SequenceReviewer([], default="allow")
    script = [
        f'Thought: lint {target}\nAction: {tool_name}({{"command": "lint {target}"}})\n'
        for target in ("a", "b")
    ] + ["Final Answer: lint is clean"]
    stack = _network_probe_stack(reviewer, _ScriptedRouter(script), seen, tool_name=tool_name)
    controller, store, _ = _controller(tmp_path, stack, pause_controller=pause_controller)

    controller.execute(_new_run(store, tmp_path).run_id)

    # Each call starts network-denied; only the reviewed rerun gets network,
    # and the next call is denied again: the escalation was not persisted.
    assert seen == [False, True, False, True]
    # The reviewer only saw the two escalations (lint itself is low risk).
    assert len(reviewer.requests) == (4 if tool_name == "exec_shell" else 2)
    assert all("lint" in req.messages[-1].content for req in reviewer.requests)


def test_sandbox_override_is_restored_when_the_rerun_raises() -> None:
    import uuid

    from runtime.core.cerebrum._react_execution_dispatch import _execute_action_via_beak
    from runtime.platform.process.session import Session, current_session, session_scope

    stack = _Stack(_ScriptedRouter([]), _SequenceReviewer([]), [])

    def _boom(**_kw: Any) -> Any:
        raise OSError("executor crashed mid-rerun")

    stack.executor.execute_step = _boom
    intent = ParsedIntent(raw="x", intent_type="task", normalized_goal="x", user_context={})
    with session_scope(Session(thread_id="t-loop", metadata={"permission_mode": "acceptEdits"})):
        observation, _step = _execute_action_via_beak(
            stack,
            'exec_shell({"command": "curl a"})',
            react_task_id=str(uuid.uuid4()),
            react_step_counter=1,
            intent=intent,
            sandbox_override={"type": "dangerFullAccess", "networkAccess": True},
        )
        assert "OSError" in (observation or "")
        assert "sandbox_policy" not in current_session().metadata


def _web_stack(reviewer: Any, router: Any, web_calls: list[str]) -> _Stack:
    stack = _Stack(router, reviewer, [])
    stack.executor.registry.register(
        Skill(
            name="web_search",
            description="search the web",
            affinity=["web", "search"],
            trusted_source="builtin://web_search",
            handler=lambda query="", **_kw: web_calls.append(query) or {"results": []},
        ),
        verify_tests=False,
    )
    return stack


_WEB_SCRIPT = [
    'Thought: look it up\nAction: web_search({"query": "release notes"})\n',
    "Final Answer: searched",
]


def test_loop_network_tools_go_through_automatic_review(tmp_path, pause_controller) -> None:
    web_calls: list[str] = []
    reviewer = _SequenceReviewer(["deny"])
    stack = _web_stack(reviewer, _ScriptedRouter(list(_WEB_SCRIPT)), web_calls)
    controller, store, _ = _controller(tmp_path, stack, pause_controller=pause_controller)

    controller.execute(_new_run(store, tmp_path).run_id)

    assert len(reviewer.requests) == 1
    assert "web_search" in reviewer.requests[0].messages[-1].content
    assert web_calls == []


def test_interactive_turns_still_auto_run_web_reads(pause_controller) -> None:
    web_calls: list[str] = []
    reviewer = _SequenceReviewer(["deny"])
    stack = _web_stack(reviewer, _ScriptedRouter(list(_WEB_SCRIPT)), web_calls)
    intent = ParsedIntent(
        raw="look it up",
        intent_type="task",
        normalized_goal="look it up",
        user_context={"permission_mode": "acceptEdits"},
    )

    run_react_loop(stack, intent, None, max_iterations=4, thread_id="th-web")

    assert reviewer.requests == []
    assert web_calls == ["release notes"]


@pytest.mark.parametrize(
    ("permission_mode", "expected"),
    [("acceptEdits", {"network": "ask"}), ("bypassPermissions", None), ("default", None)],
)
def test_only_auto_review_loops_route_network_to_review(
    tmp_path, pause_controller, permission_mode: str, expected: Any
) -> None:
    seen: dict[str, Any] = {}

    def runner(*, stack, intent, agent, model=None, max_iterations=0, thread_id=None):
        seen["policy"] = intent.user_context.get("approval_risk_policy")
        return ReActResult(final_answer="done", success=True)

    controller, store, _ = _controller(
        tmp_path,
        SimpleNamespace(name="stack"),
        pause_controller=pause_controller,
        react_runner=runner,
    )
    run = _new_run(
        store,
        tmp_path,
        policy=LoopPolicy(max_attempts=1, max_iterations=4, permission_mode=permission_mode),
    )
    controller.execute(run.run_id)

    assert seen["policy"] == expected


# ── network floor in the risk policy ─────────────────────────────────────


def test_network_floor_only_tightens_network_calls() -> None:
    floor = {"network": "ask"}

    risk, action, policy = approval_action_for_tool("web_search", '{"query": "x"}')
    assert (risk.level, action) == ("low", "allow")
    assert "network_read" in risk.categories
    assert "network" not in policy.to_dict()

    assert approval_action_for_tool("web_search", policy=floor)[1] == "ask"
    assert approval_action_for_tool("web_fetch", policy=floor)[1] == "ask"
    assert approval_action_for_tool("fetch_url", policy={**floor, "medium": "allow"})[1] == "ask"
    assert approval_action_for_tool("read_file", policy=floor)[1] == "allow"
    # A floor never loosens a stricter level action.
    assert approval_action_for_tool("exec_shell", "rm -rf dist", policy=floor)[1] == "confirm"
    assert ApprovalRiskPolicy.from_mapping(floor).to_dict()["network"] == "ask"


def test_executor_gate_holds_unreviewed_network_calls_in_loops() -> None:
    context = ExecutionPolicyContext.from_metadata(
        {"enforce_executor_approval": True, "approval_risk_policy": {"network": "ask"}}
    )
    instruction = build_execution_instruction(
        instruction_id="i",
        tool_name="web_search",
        caller="react_loop",
        args={"query": "x"},
    )

    assert evaluate_execution_policy(instruction, context=context).outcome == GovernanceOutcome.HOLD
    with caller_reviewed_tool_call("web_search"):
        assert (
            evaluate_execution_policy(instruction, context=context).outcome
            == GovernanceOutcome.ALLOW
        )
    interactive = ExecutionPolicyContext.from_metadata({"enforce_executor_approval": True})
    assert (
        evaluate_execution_policy(instruction, context=interactive).outcome
        == GovernanceOutcome.ALLOW
    )
