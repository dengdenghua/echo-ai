"""A refused network request must not be reachable through another tool.

Walkthrough 2026-10-13 (finding AI-18), OpenCode engine, "询问审批" mode: the
user refused ``echo_fetch_url`` for https://example.com, and the agent then read
the same URL through ``echo_web_fetch`` (twice) and ``echo_platform_read``
without a prompt. ``fetch_url`` was ``medium`` (``fetch_`` prefix) while
``web_fetch``/``platform_read`` were ``low`` network reads, and nothing
remembered the refusal.

Covered here:

- every network-reaching tool carries a network risk category;
- "询问审批" (an explicit ``default`` permission mode) floors all of them at
  ``ask``, in the policy resolver every gate uses;
- a refusal is remembered for the turn, per target host (or per tool when the
  call names no host), in the host tool broker and in the ReAct loop.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from runtime.core.cerebrum.react_loop import run_react_loop
from runtime.execution.suckers import Skill
from runtime.execution.suckers.registry import SkillRegistry
from runtime.execution.tool_engine import ToolExecutor
from runtime.execution.tool_engine.host_tool_broker import HostToolBroker
from runtime.memory.journal import InMemoryJournal
from runtime.platform.models.pipeline import ParsedIntent
from runtime.platform.process.session import Session
from runtime.safety.approval.approval_gate import (
    ApprovalDecision,
    ApprovalProvider,
    ApprovalRequest,
    NetworkDenialMemory,
    approval_action_for_tool,
    assess_approval_risk,
    is_network_risk,
    network_targets,
    resolve_approval_risk_policy,
)
from runtime.safety.auth import TrustEngine
from runtime.safety.governance import (
    ExecutionPolicyContext,
    GovernanceOutcome,
    build_execution_instruction,
    evaluate_execution_policy,
)
from tests.test_auto_review_turn_breaker import _SequenceReviewer
from tests.test_background_task_permissions import _ScriptedRouter, _Stack

_NETWORK_TOOLS = (
    "fetch_url",
    "web_fetch",
    "web_search",
    "platform_read",
    "platform_search",
    "crawl_site",
    "research_answer",
    "screenshot_web_full_page",
    "search_image_by_text",
    "browser_navigate",
    "live_browser_navigate",
    "mcp__github__get_issue",
)


class _Human(ApprovalProvider):
    """Whoever answers the approval (person or review agent); every request kept.

    ``answers`` are used in order, then ``approve`` for every later request.
    """

    def __init__(self, *, approve: bool = False, answers: list[bool] | None = None) -> None:
        self.approve = approve
        self.answers = list(answers or [])
        self.requests: list[ApprovalRequest] = []

    def request(self, req: ApprovalRequest, *, timeout: float = 120.0) -> ApprovalDecision:
        self.requests.append(req)
        approved = self.answers.pop(0) if self.answers else self.approve
        return ApprovalDecision(approved=approved, reason="accept" if approved else "decline")


# ── classification and policy ────────────────────────────────────────────


@pytest.mark.parametrize("tool", _NETWORK_TOOLS)
def test_every_network_tool_carries_a_network_category(tool: str) -> None:
    assert is_network_risk(assess_approval_risk(tool))


@pytest.mark.parametrize("tool", ["read_file", "write_text_file", "exec_shell", "echo"])
def test_local_tools_are_not_network(tool: str) -> None:
    assert not is_network_risk(assess_approval_risk(tool))


@pytest.mark.parametrize("tool", _NETWORK_TOOLS)
def test_ask_mode_asks_before_every_network_tool(tool: str) -> None:
    assert approval_action_for_tool(tool, permission_mode="default")[1] in {"ask", "confirm"}


@pytest.mark.parametrize(
    ("permission_mode", "expected"),
    [("default", "ask"), ("acceptEdits", "ask"), ("bypassPermissions", "allow"), (None, "allow")],
)
def test_review_modes_floor_low_risk_network_reads(
    permission_mode: str | None, expected: str
) -> None:
    for tool in ("web_fetch", "platform_read", "web_search"):
        assert approval_action_for_tool(tool, permission_mode=permission_mode)[1] == expected
    assert approval_action_for_tool("read_file", permission_mode="default")[1] == "allow"


def test_resolver_keeps_an_explicit_network_policy() -> None:
    assert resolve_approval_risk_policy({"network": "deny"}, permission_mode="default").network == (
        "deny"
    )
    assert resolve_approval_risk_policy(None, permission_mode="default").to_dict()["network"] == (
        "ask"
    )
    # A missing mode is a headless caller, not the interactive ask contract.
    assert resolve_approval_risk_policy(None, permission_mode="").network is None


def test_executor_gate_holds_network_calls_in_review_modes() -> None:
    instruction = build_execution_instruction(
        instruction_id="i", tool_name="web_fetch", caller="host_tool", args={"url": "https://x.io"}
    )
    ask = ExecutionPolicyContext.from_metadata(
        {"enforce_executor_approval": True, "permission_mode": "default"}
    )
    review = ExecutionPolicyContext.from_metadata(
        {"enforce_executor_approval": True, "permission_mode": "acceptEdits"}
    )
    full = ExecutionPolicyContext.from_metadata(
        {"enforce_executor_approval": True, "permission_mode": "bypassPermissions"}
    )
    assert evaluate_execution_policy(instruction, context=ask).outcome == GovernanceOutcome.HOLD
    assert evaluate_execution_policy(instruction, context=review).outcome == GovernanceOutcome.HOLD
    assert evaluate_execution_policy(instruction, context=full).outcome == GovernanceOutcome.ALLOW


# ── targets and the per-turn refusal memory ──────────────────────────────


@pytest.mark.parametrize(
    ("arguments", "expected"),
    [
        ({"url": "https://www.Example.com/a?b=1"}, {"example.com"}),
        ({"domain": "example.com"}, {"example.com"}),
        (
            {"urls": ["https://a.example.org/x", "http://localhost:8000/"]},
            {"a.example.org", "localhost"},
        ),
        ('{"extract": false, "url": "https://example.com"}', {"example.com"}),
        ("{'url': 'https://example.com', 'extract': False}", {"example.com"}),
        ({"prompt": "compare with https://evil.test/x please"}, {"evil.test"}),
        ({"url": "http://127.0.0.1:9000/"}, {"127.0.0.1"}),
        ({"query": "example.com status code"}, set()),
        ({"site": "news"}, set()),
        ({"path": "notes/example.md"}, set()),
    ],
)
def test_network_targets(arguments: Any, expected: set[str]) -> None:
    assert network_targets(arguments) == expected


def test_refused_host_stays_refused_through_every_network_tool() -> None:
    memory = NetworkDenialMemory()
    memory.note_denial(
        "fetch_url",
        assess_approval_risk("fetch_url"),
        {"url": "https://example.com", "extract": False},
    )

    def refused(tool: str, arguments: dict[str, Any]) -> bool:
        return memory.refusal(tool, assess_approval_risk(tool), arguments) is not None

    assert refused("fetch_url", {"url": "https://example.com", "extract": False})
    assert refused("web_fetch", {"url": "https://example.com", "prompt": "status line"})
    assert refused("platform_read", {"url": "https://example.com"})
    assert refused("browser_navigate", {"url": "https://www.example.com/page"})
    assert refused("crawl_site", {"start_url": "https://docs.example.com"})
    assert not refused("web_fetch", {"url": "https://example.org"})
    # Not a network call, so the refusal does not apply.
    assert not refused("read_file", {"path": "https://example.com"})


def test_shell_commands_and_web_tools_share_refused_hosts() -> None:
    """Live rerun: the agent tried ``echo_exec_shell`` curl before any web tool."""

    shell = assess_approval_risk("exec_shell")
    fetch = assess_approval_risk("fetch_url")

    memory = NetworkDenialMemory()
    memory.note_denial("exec_shell", shell, {"command": '["curl", "-sI", "https://example.com"]'})
    assert memory.refusal("fetch_url", fetch, {"url": "https://example.com"})
    assert memory.refusal("exec_shell", shell, {"command": "wget -qO- example.com"})
    assert memory.refusal("exec_shell", shell, {"command": "ls -la"}) is None

    reverse = NetworkDenialMemory()
    reverse.note_denial("fetch_url", fetch, {"url": "https://example.com"})
    assert reverse.refusal("exec_shell", shell, {"command": "Invoke-WebRequest -Uri example.com"})
    assert reverse.refusal("exec_shell", shell, {"command": "curl https://example.org"}) is None

    # Refusing a local command is not a network refusal.
    local = NetworkDenialMemory()
    local.note_denial("exec_shell", shell, {"command": "rm -rf build"})
    assert local.refusal("exec_shell", shell, {"command": "curl https://example.com"}) is None


def test_refusal_without_a_target_is_remembered_for_that_tool() -> None:
    memory = NetworkDenialMemory()
    memory.note_denial("web_search", assess_approval_risk("web_search"), {"query": "echo"})

    assert memory.refusal("web_search", assess_approval_risk("web_search"), {"query": "x"})
    assert memory.refusal("research_answer", assess_approval_risk("research_answer"), {}) is None


# ── host tool broker (OpenCode / Codex engines) ──────────────────────────


def _web_registry(calls: list[tuple[str, str]]) -> SkillRegistry:
    def fetch_url(url: str, extract: bool = False) -> dict[str, Any]:
        calls.append(("fetch_url", url))
        return {"url": url, "status_code": 200}

    def web_fetch(url: str, prompt: str = "") -> dict[str, Any]:
        calls.append(("web_fetch", url))
        return {"ok": True, "url": url, "content": "Example Domain"}

    def platform_read(url: str) -> dict[str, Any]:
        calls.append(("platform_read", url))
        return {"url": url, "status_code": 200}

    def exec_shell(command: str) -> dict[str, Any]:
        calls.append(("exec_shell", command))
        return {"exit_code": 0, "stdout": "HTTP/1.1 200 OK"}

    registry = SkillRegistry()
    for handler in (fetch_url, web_fetch, platform_read, exec_shell):
        registry.register(
            Skill(
                name=handler.__name__,
                description=f"{handler.__name__} reads a web page",
                affinity=["shell", "exec"] if handler is exec_shell else ["web"],
                trusted_source=f"builtin://{handler.__name__}",
                handler=handler,
            ),
            verify_tests=False,
        )
    return registry


def _broker(tmp_path, provider: ApprovalProvider, *, permission_mode: str, calls: list) -> Any:
    workspace = tmp_path / "work"
    workspace.mkdir(exist_ok=True)
    registry = _web_registry(calls)
    agent = SimpleNamespace(
        agent_id="eve",
        arms=[
            SimpleNamespace(
                arm_id="web",
                allowed_skills=["fetch_url", "web_fetch", "platform_read", "exec_shell"],
            )
        ],
        extra_skills=[],
    )
    session = Session(
        actor="actor-a",
        agent=agent,
        thread_id="thread-a",
        turn_id="turn-a",
        metadata={
            "tenant_id": "tenant-a",
            "workspace_path": str(workspace),
            "permission_mode": permission_mode,
        },
    )
    stack = SimpleNamespace(
        executor=ToolExecutor(
            registry=registry,
            immunity=TrustEngine(trusted_sources=["builtin://*"]),
            journal=InMemoryJournal(),
        )
    )
    broker = HostToolBroker(
        stack,
        agent,
        context={**session.metadata, "caller_session": session},
        goal="请运行命令 curl -sI https://example.com 并告诉我 HTTP 状态码。",
        outer_thread_id="thread-a",
        outer_turn_id="turn-a",
        workspace=str(workspace),
        tenant_id="tenant-a",
        principal_id="actor-a",
        approval_provider=provider,
        is_interrupted=lambda: False,
    )
    broker.bind_inner_scope(thread_id="inner-thread", turn_id="inner-turn")
    assert set(broker.catalog.names) == {"fetch_url", "web_fetch", "platform_read", "exec_shell"}
    return broker


def _text(result: dict[str, Any]) -> str:
    return " ".join(item.get("text", "") for item in result["contentItems"])


@pytest.mark.asyncio
async def test_broker_replays_ai18_and_keeps_the_refusal(tmp_path) -> None:
    """The exact walkthrough sequence: refuse fetch_url, then try the others."""

    calls: list[tuple[str, str]] = []
    human = _Human(approve=False)
    broker = _broker(tmp_path, human, permission_mode="default", calls=calls)

    first = await broker.invoke(
        "fetch_url", {"url": "https://example.com", "extract": False}, call_id="c1"
    )
    assert first["success"] is False
    assert len(human.requests) == 1
    assert "do not retry" in _text(first)

    for call_id, tool, arguments in [
        ("c2", "fetch_url", {"url": "https://example.com", "extract": False}),
        ("c3", "web_fetch", {"url": "https://example.com", "prompt": "Return the status line"}),
        ("c4", "web_fetch", {"url": "https://example.com", "prompt": "Extract the status code"}),
        ("c5", "platform_read", {"url": "https://example.com"}),
    ]:
        result = await broker.invoke(tool, arguments, call_id=call_id)
        assert result["success"] is False, (tool, result)
        assert "refused earlier in this turn" in _text(result)

    # Nothing reached the network, and the user was asked exactly once.
    assert calls == []
    assert len(human.requests) == 1

    # A different site is a new question in ask mode — asked, not auto-run.
    other = await broker.invoke("web_fetch", {"url": "https://docs.python.org"}, call_id="c6")
    assert other["success"] is False
    assert [req.tool_name for req in human.requests] == ["fetch_url", "web_fetch"]
    assert calls == []


@pytest.mark.asyncio
async def test_broker_keeps_a_refused_shell_curl_off_the_web_tools(tmp_path) -> None:
    """Live rerun of AI-18: refuse ``curl`` in the shell, then the web read."""

    calls: list[tuple[str, str]] = []
    human = _Human(approve=False)
    broker = _broker(tmp_path, human, permission_mode="default", calls=calls)

    shell = await broker.invoke(
        "exec_shell", {"command": '["curl", "-sI", "https://example.com"]'}, call_id="c1"
    )
    fetch = await broker.invoke("fetch_url", {"url": "https://example.com"}, call_id="c2")

    assert shell["success"] is False and fetch["success"] is False
    assert [req.tool_name for req in human.requests] == ["exec_shell"]
    assert "refused earlier in this turn" in _text(fetch)
    assert calls == []


@pytest.mark.asyncio
async def test_broker_runs_a_network_read_only_after_approval_in_ask_mode(tmp_path) -> None:
    calls: list[tuple[str, str]] = []
    human = _Human(approve=True)
    broker = _broker(tmp_path, human, permission_mode="default", calls=calls)

    result = await broker.invoke("platform_read", {"url": "https://example.com"}, call_id="c1")

    assert result["success"] is True, result
    assert [req.tool_name for req in human.requests] == ["platform_read"]
    assert calls == [("platform_read", "https://example.com")]


@pytest.mark.asyncio
async def test_broker_sends_auto_review_network_calls_to_the_reviewer(tmp_path) -> None:
    """自动审批: every network read is reviewed, and a refused host stays refused."""

    calls: list[tuple[str, str]] = []
    reviewer = _Human(answers=[False, True])
    broker = _broker(tmp_path, reviewer, permission_mode="acceptEdits", calls=calls)

    refused = await broker.invoke(
        "fetch_url", {"url": "https://example.com", "extract": False}, call_id="c1"
    )
    same_host = await broker.invoke("web_fetch", {"url": "https://example.com"}, call_id="c2")
    other_host = await broker.invoke("web_fetch", {"url": "https://example.org"}, call_id="c3")

    assert refused["success"] is False and same_host["success"] is False
    assert other_host["success"] is True, other_host
    # The refused host was not reviewed again; the other site was reviewed
    # (and approved) before it ran.
    assert [req.tool_name for req in reviewer.requests] == ["fetch_url", "web_fetch"]
    assert calls == [("web_fetch", "https://example.org")]


# ── ReAct loop (Echo engine) ─────────────────────────────────────────────


_AI18_SCRIPT = [
    'Thought: fetch it\nAction: fetch_url({"url": "https://example.com", "extract": false})\n',
    'Thought: try web_fetch\nAction: web_fetch({"url": "https://example.com", "prompt": "status"})\n',
    'Thought: try platform_read\nAction: platform_read({"url": "https://example.com"})\n',
    "Final Answer: 无法访问 example.com：网络访问被拒绝。",
]


def _react_stack(script: list[str], reviewer: Any, calls: list) -> _Stack:
    stack = _Stack(_ScriptedRouter(script), reviewer, [])
    web = _web_registry(calls)
    for name in ("fetch_url", "web_fetch", "platform_read"):
        stack.executor.registry.register(web.get(name), verify_tests=False)
    return stack


def _intent(permission_mode: str) -> ParsedIntent:
    return ParsedIntent(
        raw="告诉我 example.com 的 HTTP 状态码",
        intent_type="task",
        normalized_goal="告诉我 example.com 的 HTTP 状态码",
        user_context={"permission_mode": permission_mode},
    )


def test_react_loop_replays_ai18_and_keeps_the_refusal() -> None:
    calls: list[tuple[str, str]] = []
    human = _Human(approve=False)
    stack = _react_stack(list(_AI18_SCRIPT), _SequenceReviewer([]), calls)

    result = run_react_loop(
        stack,
        _intent("default"),
        None,
        max_iterations=6,
        thread_id="th-ai18",
        approval_provider=human,
    )

    assert result is not None
    assert [req.tool_name for req in human.requests] == ["fetch_url"]
    assert calls == []
    observations = " ".join(str(step.observation or "") for step in result.steps)
    assert "用户拒绝了这次网络访问" in observations
    assert observations.count("refused earlier in this turn") == 2


def test_react_loop_declined_network_escalation_refuses_the_host() -> None:
    """Declining "rerun with network" refuses the command's host for the turn."""

    calls: list[tuple[str, str]] = []
    human = _Human(approve=False)
    script = [
        'Thought: lint\nAction: lint({"command": "curl -sI https://example.com"})\n',
        'Thought: read it instead\nAction: fetch_url({"url": "https://example.com"})\n',
        "Final Answer: 无法访问 example.com。",
    ]
    stack = _react_stack(script, _SequenceReviewer([]), calls)

    def lint(command: str = "", **_kw: Any) -> dict[str, Any]:
        calls.append(("lint", command))
        return {"error": "sandbox_violation: network access denied", "argv": [command]}

    stack.executor.registry.register(
        Skill(
            name="lint",
            description="lint the workspace",
            affinity=["lint", "verify"],
            trusted_source="builtin://lint",
            handler=lint,
        ),
        verify_tests=False,
    )

    run_react_loop(
        stack,
        _intent("default"),
        None,
        max_iterations=5,
        thread_id="th-esc",
        approval_provider=human,
    )

    # The only question was the escalation; the web read was refused unasked.
    assert [req.tool_name for req in human.requests] == ["lint"]
    assert calls == [("lint", "curl -sI https://example.com")]


def test_react_loop_asks_before_a_web_read_in_ask_mode() -> None:
    calls: list[tuple[str, str]] = []
    human = _Human(approve=True)
    script = [
        'Thought: read it\nAction: web_fetch({"url": "https://example.com"})\n',
        "Final Answer: done",
    ]
    stack = _react_stack(script, _SequenceReviewer([]), calls)

    run_react_loop(
        stack,
        _intent("default"),
        None,
        max_iterations=4,
        thread_id="th-ask",
        approval_provider=human,
    )

    assert [req.tool_name for req in human.requests] == ["web_fetch"]
    assert calls == [("web_fetch", "https://example.com")]


def test_react_loop_remembers_an_automatic_review_refusal() -> None:
    calls: list[tuple[str, str]] = []
    reviewer = _SequenceReviewer(["deny"], default="allow")
    stack = _react_stack(list(_AI18_SCRIPT), reviewer, calls)

    run_react_loop(stack, _intent("acceptEdits"), None, max_iterations=6, thread_id="th-review")

    # fetch_url went to the reviewer and was refused; the reads of the same
    # host never ran and were not reviewed again.
    assert len(reviewer.requests) == 1
    assert calls == []
