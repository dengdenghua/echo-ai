"""Real Windows model control plane and MXC-isolated host tool execution."""

import asyncio
import sys

import pytest

from runtime.execution.codex_backend.backend import CodexExecutionRequest, CodexExecutionSession
from runtime.execution.codex_backend.responses_proxy import (
    CodexResponsesScope,
    ScopedResponsesProxy,
)
from runtime.execution.codex_backend.security import CodexSecurityPolicy, CodexSidecarSecurity
from runtime.platform.models.llm import ModelResponse, ToolCall
from runtime.safety.approval.approval_gate import AutoDenyProvider
from runtime.safety.sandboxing.sandbox import BackendChoice
from runtime.safety.sandboxing.windows_mxc import WindowsMXCBackend, mxc_executable


class _Router:
    def __init__(self):
        self.calls = 0

    def call(self, request):
        self.calls += 1
        if self.calls == 1:
            return ModelResponse(
                text="", tool_calls=[ToolCall(id="probe-1", name="probe", input={})]
            )
        return ModelResponse(text="sandbox flow complete")


@pytest.mark.skipif(sys.platform != "win32", reason="Windows MXC integration")
@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["danger-full-access", "workspace-write", "read-only"])
async def test_real_windows_codex_completes_tool_turn_with_mxc_commands(tmp_path, mode):
    executable = mxc_executable()
    if executable is None:
        pytest.skip("verified Echo engine not installed")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    calls = []

    async def tool(request):
        import os
        from pathlib import Path

        from runtime.platform.process.streaming import stream_run

        result = await asyncio.to_thread(
            stream_run,
            [str(Path(os.environ["SYSTEMROOT"]) / "System32/cmd.exe"), "/d", "/c", "echo", "probe"],
            cwd=str(workspace),
            sandbox_dir=str(workspace),
            allow_network=False,
            timeout=10,
        )
        assert result["sandbox_backend"] == "windows-mxc" and result["sandbox_hard"] is True
        assert result["exit_code"] == 0
        calls.append(request)
        return {"contentItems": [{"type": "inputText", "text": "probe succeeded"}], "success": True}

    router = _Router()
    scope = CodexResponsesScope(
        tenant_id="test", principal_id="test", thread_id="test", turn_id="test", model="test"
    )
    async with ScopedResponsesProxy(router, scope=scope, trusted_session=None) as proxy:
        request = CodexExecutionRequest(
            outer_thread_id="test",
            outer_turn_id="test",
            realm_id="test",
            tenant_id="test",
            principal_id="test",
            workspace=workspace,
            prompt="Call probe, then answer.",
            command=(executable, "app-server", "--strict-config", "--listen", "stdio://"),
            model="test",
            provider_profile=proxy.provider_profile,
            sandbox_mode=mode,
            host_tools_only=True,
            dynamic_tool_handler=tool,
            dynamic_tools=(
                {
                    "type": "function",
                    "name": "probe",
                    "description": "Test probe",
                    "inputSchema": {"type": "object", "properties": {}},
                },
            ),
        )
        session = CodexExecutionSession(
            request,
            security=CodexSidecarSecurity(
                CodexSecurityPolicy(
                    state_root=tmp_path / "state", allowed_workspace_roots=(workspace,)
                )
            ),
            approval_provider=AutoDenyProvider(),
            is_interrupted=lambda: False,
            process_backend=BackendChoice(
                backend=WindowsMXCBackend(), name="windows-mxc", hard=True, strict=False
            ),
        )
        notifications = []
        try:
            async with asyncio.timeout(30):
                await session.start()
                assert session.outer_sandbox == "host_control_plane"
                while True:
                    event = await session.next_notification(timeout_s=10)
                    notifications.append(event)
                    if event.method == "turn/completed":
                        assert event.params["turn"]["status"] == "completed"
                        break
        finally:
            await session.close()
    assert len(calls) == 1
    assert router.calls == 2
    assert any(event.params.get("delta") == "sandbox flow complete" for event in notifications)
