"""Opt-in Windows Codex -> Echo broker -> real process regression."""

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from runtime.execution.codex_backend.backend import CodexExecutionRequest, CodexExecutionSession
from runtime.execution.codex_backend.dynamic_tools import CodexDynamicToolBroker
from runtime.execution.codex_backend.security import CodexSecurityPolicy, CodexSidecarSecurity
from runtime.execution.suckers._write_skills_exec import _exec_shell
from runtime.execution.suckers.registry import Skill, SkillRegistry
from runtime.execution.tool_engine import ToolExecutor
from runtime.memory.journal import InMemoryJournal
from runtime.safety.approval.approval_gate import AutoDenyProvider
from runtime.safety.auth import TrustEngine

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        os.name != "nt" or os.environ.get("ECHO_RUN_CODEX_LIVE_SMOKE") != "1",
        reason="Windows authenticated Codex smoke is opt-in",
    ),
]


@pytest.mark.asyncio
async def test_real_codex_host_command_failure_recovery_and_resume(tmp_path):
    binary = Path(os.environ["ECHO_CODEX_LIVE_BINARY"])
    source_home = Path(os.environ.get("ECHO_CODEX_LIVE_SOURCE_HOME", str(Path.home() / ".codex")))
    assert binary.is_file() and (source_home / "auth.json").is_file()
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    await asyncio.to_thread(
        subprocess.run, ["git", "init", str(workspace)], check=True, capture_output=True
    )
    (workspace / "echo-probe.txt").write_text("fixture\n", encoding="utf-8")
    observed = []

    def execute(command: str | list[str], cwd: str | None = None):
        result = _exec_shell(command=command, cwd=cwd or str(workspace), timeout_s=15)
        observed.append(result)
        return result

    registry = SkillRegistry()
    registry.register(
        Skill(
            name="exec_shell",
            description="Execute a command in the test workspace; prefer argv arrays.",
            affinity=["shell", "execute"],
            trusted_source="skill://public/exec_shell",
            handler=execute,
        ),
        verify_tests=False,
    )
    executor = ToolExecutor(
        registry=registry,
        immunity=TrustEngine(trusted_sources=["skill://public/*"]),
        journal=InMemoryJournal(),
    )
    agent = SimpleNamespace(
        agent_id="coder",
        arms=[SimpleNamespace(arm_id="code", allowed_skills=["exec_shell"])],
        extra_skills=[],
    )
    security = CodexSidecarSecurity(
        CodexSecurityPolicy(
            state_root=tmp_path / "state",
            allowed_workspace_roots=(workspace,),
            deployment_mode="local",
        )
    )
    python = json.dumps(sys.executable)
    prompts = [
        f"Use the advertised exec_shell tool for each step: run git status --short in {workspace}; "
        f'then run argv [{python}, "-c", "import sys; sys.exit(7)"]; '
        f'that failure is intentional, continue with argv [{python}, "-c", '
        "\"print('ECHO_RECOVERED_7')\"]. Report the actual results.",
        f"Continue: run git status --short again in {workspace} using exec_shell. "
        "The prior exit 7 was a program failure, not a permission denial.",
    ]
    inner_id = None
    for index, prompt in enumerate(prompts):
        broker = CodexDynamicToolBroker(
            SimpleNamespace(executor=executor),
            agent,
            context={"mode": "code", "workspace_path": str(workspace)},
            goal=prompt,
            outer_thread_id="host-smoke",
            outer_turn_id=f"host-turn-{index}",
            workspace=str(workspace),
            tenant_id="local",
            principal_id="local",
            approval_provider=AutoDenyProvider(),
            is_interrupted=lambda: False,
            server_auto_approve=True,
        )
        assert "exec_shell" in broker.catalog.names
        request = CodexExecutionRequest(
            outer_thread_id="host-smoke",
            outer_turn_id=f"host-turn-{index}",
            workspace=workspace,
            realm_id="host-smoke",
            tenant_id="local",
            principal_id="local",
            prompt=prompt,
            command=(str(binary), "app-server", "--listen", "stdio://"),
            source_codex_home=source_home,
            model="gpt-5.6-sol",
            effort="low",
            sandbox_mode="danger-full-access",
            approval_policy="never",
            host_env=os.environ,
            host_tools_only=True,
            dynamic_tools=broker.catalog.specs,
            dynamic_tool_handler=broker,
            developer_instructions="Use only the advertised Echo dynamic tools. "
            "Native exec_command and apply_patch are unavailable. A failed process does not "
            "mean terminal permissions were denied. Continue the requested recovery steps.",
        )
        session = CodexExecutionSession(
            request,
            security=security,
            approval_provider=AutoDenyProvider(),
            is_interrupted=lambda: False,
        )
        before = len(observed)
        try:
            async with asyncio.timeout(120):
                await session.start()
                if index:
                    assert session.resumed and session.inner_thread_id == inner_id
                inner_id = session.inner_thread_id
                async for notification in session.notifications():
                    if notification.method == "turn/completed":
                        assert notification.params["turn"]["status"] == "completed"
                        break
            assert len(observed) > before, "Codex answered without invoking the host tool"
            assert any(
                "echo-probe.txt" in str(result.get("stdout")) for result in observed[before:]
            )
        finally:
            await session.close()
            broker.close()
    assert any(result.get("exit_code") == 7 for result in observed)
    assert any(result.get("stdout", "").strip() == "ECHO_RECOVERED_7" for result in observed)
    assert all("error" not in result for result in observed)
