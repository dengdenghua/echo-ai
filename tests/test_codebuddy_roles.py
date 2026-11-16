"""External members inherit host authority without loading a native planner."""

import asyncio
import contextlib
import time
from dataclasses import replace
from types import SimpleNamespace

import pytest

from runtime.execution import codebuddy_roles as roles
from runtime.execution.request import (
    ExecutionRequest,
    ExecutionResources,
    ExecutionTask,
)
from runtime.platform.process.scope import ExecutionScope
from runtime.platform.process.session import Session


@pytest.fixture
def host(tmp_path, monkeypatch):
    agent = SimpleNamespace(
        agent_id="member",
        soul="A helpful member",
        arms=[],
        extra_skills=[],
        capabilities={"execution_backend": "codebuddy_cli"},
    )
    task = ExecutionTask(
        task_id="parent-turn",
        thread_id="parent-thread",
        actor_id="alice",
        tenant_id="acme",
        goal="Original request",
        authorization_intent="Original human authorization",
        permissions=ExecutionScope(
            mode="ask",
            requested_mode="ask",
            readable_roots=(tmp_path,),
            writable_roots=(),
            network_policy="deny",
            shell_policy="deny",
        ),
        resources=ExecutionResources(1000, 1.0, time.monotonic() + 30),
        execution_engine="codebuddy",
        approval_provider=object(),
    )
    request = ExecutionRequest(task, task.goal)
    session = Session(
        actor="alice",
        agent=agent,
        thread_id=task.thread_id,
        turn_id=task.task_id,
        metadata={"tenant_id": "acme", "workspace_path": str(tmp_path)},
    )
    return SimpleNamespace(
        agent=agent,
        request=request,
        session=session,
        stack=SimpleNamespace(executor=SimpleNamespace(registry=None)),
    )


def test_sync_member_emits_write_receipts_for_subagent_tracking(host, monkeypatch):
    from runtime.execution.request import execution_request_scope
    from runtime.platform.process.session import session_scope

    async def stream(*args, **kwargs):
        yield {
            "type": "tool_start",
            "tool_name": "write_text_file",
            "tool_call_id": "write-a",
            "input_preview": {"path": "output/final/a.md"},
        }
        yield {
            "type": "tool_end",
            "tool_name": "write_text_file",
            "tool_call_id": "write-a",
            "success": True,
        }
        yield {"type": "text_delta", "delta": "verified"}
        yield {"type": "react_completed", "success": True}

    monkeypatch.setattr(roles, "stream_role", stream)
    events = []
    with execution_request_scope(host.request), session_scope(host.session):
        assert (
            roles.run_role_sync(
                host.stack,
                host.agent,
                "Write",
                context={"event_emitter": events.append},
                interrupted=lambda: False,
            )
            == "verified"
        )
    assert events[-1]["type"] == "sub_tool_end"
    assert events[-1]["status"] == "success"
    assert events[-1]["args"]["path"] == "output/final/a.md"


@pytest.mark.parametrize("tenant_id", [None, "acme"])
def test_tool_bridge_preserves_identity_for_local_and_tenant_delegation(
    host, monkeypatch, tmp_path, tenant_id
):
    from runtime.execution.subagents.execution_context import child_execution_scope
    from runtime.execution.suckers.registry import SkillRegistry
    from runtime.execution.tool_engine.host_mcp import HostMCPBridge

    host.stack.executor.registry = SkillRegistry()
    actor_id = "alice" if tenant_id else None
    request = replace(
        host.request, task=replace(host.request.task, tenant_id=tenant_id, actor_id=actor_id)
    )
    session = replace(
        host.session, actor=actor_id, metadata={**host.session.metadata, "tenant_id": tenant_id}
    )
    monkeypatch.setattr(roles.backend, "inspect_readiness", lambda scope: {"available": True})

    class VerifiedBoundary(Exception):
        pass

    @contextlib.asynccontextmanager
    async def inspect_bridge(bridge):
        active = bridge.broker._execution_session(auto_approve=False)
        assert active.actor == request.task.actor_id
        assert active.metadata["tenant_id"] == request.task.tenant_id
        child = replace(active, metadata=dict(active.metadata))
        with child_execution_scope(
            active, child, child_id="child", instruction="17 * 23"
        ) as child_request:
            assert child_request.task.actor_id == child.actor
            assert child_request.task.tenant_id == child.metadata.get("tenant_id")
            assert child_request.task.resources is request.task.resources
        raise VerifiedBoundary
        yield  # pragma: no cover

    monkeypatch.setattr(HostMCPBridge, "serve", inspect_bridge)

    async def run():
        return [
            event
            async for event in roles.stream_role(
                host.stack,
                host.agent,
                request=request,
                session=session,
                context={"tenant_id": "forged"},
                model="big-pickle",
                text="Delegate",
                interrupted=lambda: False,
            )
        ]

    with pytest.raises(VerifiedBoundary):
        asyncio.run(run())
