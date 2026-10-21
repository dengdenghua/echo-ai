"""Exercise verifier restrictions through the real mini-loop and nested dispatcher."""

import pytest

from runtime.execution.suckers import Skill, SkillRegistry
from runtime.execution.suckers.agent_meta_skills import register_agent_meta_skills
from runtime.execution.suckers.ephemeral_agents import BUILTIN_ROLES, EphemeralCall
from runtime.execution.suckers.ephemeral_runner import make_llm_ephemeral_runner
from runtime.platform.models import CostEntry
from runtime.platform.models.llm import ModelResponse, ToolCall
from runtime.platform.process.scope import ExecutionScope, execution_scope_ceiling
from runtime.platform.process.session import Session, session_scope


class ScriptedRouter:
    def __init__(self, tool):
        self.tool = tool
        self.requests = []

    def call(self, request):
        self.requests.append(request)
        return ModelResponse(
            text="done" if len(self.requests) > 1 else "",
            tool_calls=[self.tool] if len(self.requests) == 1 else [],
            input_tokens=1,
            output_tokens=1,
            cost=CostEntry(),
        )


def _run(registry, tool, *, read_only, allowed_tools):
    router = ScriptedRouter(tool)
    runner = make_llm_ephemeral_runner(router, registry=registry, default_model="mock")
    call = EphemeralCall(
        role=BUILTIN_ROLES["reviewer"],
        user_prompt="Review the supplied facts.",
        composed_system_prompt="Return a verdict.",
        caller_thread_id="audit-parent",
        caller_agent_id="reviewer",
        context={"tool_allowlist_read_only": read_only, "tool_allowlist": allowed_tools},
    )
    assert runner(call) == "done"
    return router.requests[1].messages[-1].content[0]["content"]


@pytest.mark.parametrize(
    "policy", [{"permission_mode": "bypassPermissions"}, {"auto_approve": True}]
)
def test_read_only_child_rejects_nested_mutator_but_writable_child_keeps_full_access(
    tmp_path, policy
):
    calls = []
    registry = SkillRegistry()
    registry.register(
        Skill(
            name="bb_write",
            affinity=["blackboard", "shared_state"],
            trusted_source="skill://public/bb_write",
            handler=lambda **args: calls.append(args) or {"ok": True},
        )
    )
    register_agent_meta_skills(registry)
    tool = ToolCall(id="nested", name="execute_skill", input={"name": "bb_write", "args": {}})
    session = Session(metadata=dict(policy))
    ceiling = ExecutionScope(
        mode="chat", requested_mode="chat", readable_roots=(tmp_path,), writable_roots=()
    )
    with session_scope(session):
        with execution_scope_ceiling(ceiling):
            output = _run(registry, tool, read_only=True, allowed_tools=["execute_skill"])
        assert "read_only" in output
        assert calls == []
        # A verifier's ambient restriction must not leak into the next writable call.
        output = _run(registry, tool, read_only=False, allowed_tools=["execute_skill"])
    assert '"ok": true' in output
    assert calls == [{}]


def test_read_only_child_can_dispatch_discovered_reader():
    registry = SkillRegistry()
    registry.register(
        Skill(
            name="hidden_reader",
            affinity=["read"],
            trusted_source="skill://public/hidden_reader",
            handler=lambda: {"value": "read-result"},
        )
    )
    register_agent_meta_skills(registry)
    output = _run(
        registry,
        ToolCall(id="read", name="execute_skill", input={"name": "hidden_reader"}),
        read_only=True,
        allowed_tools=["execute_skill"],
    )
    assert "read-result" in output


def test_model_cannot_invoke_a_tool_omitted_from_its_catalog():
    calls = []
    registry = SkillRegistry()
    registry.register(
        Skill(
            name="hidden_write",
            affinity=["write"],
            trusted_source="skill://public/hidden_write",
            handler=lambda: calls.append("write"),
        )
    )
    register_agent_meta_skills(registry)
    output = _run(
        registry,
        ToolCall(id="forged", name="hidden_write", input={}),
        read_only=False,
        allowed_tools=["query_skill"],
    )
    assert "outside the sub-agent tool catalog" in output
    assert calls == []
