"""Codex host-only execution keeps dynamic tools across new/resumed turns."""

import os
from dataclasses import replace
from types import SimpleNamespace

import pytest


@pytest.mark.asyncio
@pytest.mark.parametrize("resumed", [False, True])
async def test_host_tools_disable_native_environments_without_revoking_catalog(tmp_path, resumed):
    from tests.test_codex_execution_backend import _binding, _make_session

    session, _, _, _, client = _make_session(
        tmp_path, binding=_binding() if resumed else None, approval_policy="never"
    )
    spec = {
        "type": "function",
        "name": "exec_shell",
        "description": "Run an authorized workspace command",
        "inputSchema": {"type": "object", "properties": {"command": {"type": "string"}}},
    }
    session.request = replace(
        session.request,
        host_tools_only=True,
        dynamic_tools=(spec,),
        dynamic_tool_handler=lambda request: {"success": True, "contentItems": []},
    )
    await session.start()
    try:
        if resumed:
            thread = next(value for name, value in client.calls if name == "thread/resume")[1]
        else:
            thread = next(value for name, value in client.calls if name == "thread/start")
        assert thread["extra_params"]["environments"] == []
        assert thread["extra_params"]["dynamicTools"] == [spec]
        assert thread["approval_policy"] == "never"
        turn = next(value for name, value in client.calls if name == "turn/start")
        assert turn[2]["extra_params"]["environments"] == []
        assert session.request.tool_free is False
    finally:
        await session.close()


@pytest.mark.parametrize("value", ["yes", 1, None])
def test_host_tools_only_requires_boolean(tmp_path, value):
    from tests.test_codex_execution_backend import _make_session

    session, *_ = _make_session(tmp_path)
    with pytest.raises(ValueError, match="host_tools_only"):
        replace(session.request, host_tools_only=value)


@pytest.mark.parametrize("has_tools", [False, True])
def test_windows_role_uses_host_authority_even_for_empty_catalog(tmp_path, monkeypatch, has_tools):
    from runtime.execution.codex_backend import role_runner
    from runtime.execution.codex_backend.model_profile import CodexModelPreference
    from runtime.execution.suckers.registry import Skill, SkillRegistry

    registry = SkillRegistry()
    if has_tools:
        registry.register(
            Skill(
                name="read_file",
                description="Read",
                handler=lambda path: path,
                trusted_source="skill://public/read_file",
            ),
            verify_tests=False,
        )
    agent = SimpleNamespace(
        agent_id="coder",
        capabilities={},
        extra_skills=[],
        arms=[SimpleNamespace(arm_id="code", allowed_skills=["read_file"])],
    )
    monkeypatch.setattr(role_runner, "require_codex_backend_enabled", lambda: None)
    monkeypatch.setattr(role_runner, "deployment_mode", lambda: "local")
    monkeypatch.setattr(
        role_runner, "state_root_for_workspace", lambda workspace: tmp_path / "state"
    )
    monkeypatch.setattr(
        role_runner, "codex_app_server_command", lambda agent: ("codex", "app-server")
    )
    monkeypatch.setattr(
        role_runner.CodexModelPreferenceStore,
        "read",
        lambda self, scope: CodexModelPreference(mode="chatgpt"),
    )
    monkeypatch.setattr(role_runner, "compose_codex_role_instructions", lambda *a, **kw: "Role")
    monkeypatch.setattr(
        role_runner,
        "_execution_profile",
        lambda *a, **kw: SimpleNamespace(
            proxy_required=True,
            effective_model="gpt-test",
            reasoning_effort="low",
            provider_profile=None,
        ),
    )
    request, broker, _ = role_runner.build_codex_role_request(
        SimpleNamespace(executor=SimpleNamespace(registry=registry)),
        agent,
        "read file",
        context={"workspace_path": str(tmp_path), "permission_mode": "acceptEdits"},
        server_auto_approve=True,
    )
    assert request.host_tools_only == (os.name == "nt")
    assert request.dynamic_tool_handler is broker
    assert bool(request.dynamic_tools) is has_tools
    if os.name == "nt":
        assert "exec_shell" in request.developer_instructions
        assert "Honor current Echo tool denials" in request.developer_instructions
