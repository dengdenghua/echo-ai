import pytest

from runtime.platform.process.scope import resolve_execution_scope
from runtime.platform.process.session import Session, session_scope
from runtime.protocol.items import TurnParams
from runtime.safety.sandboxing import sandbox
from runtime.safety.sandboxing.sandbox import SandboxPolicy, SandboxViolation
from runtime.safety.sandboxing.windows_mxc import WindowsMXCBackend
from runtime.sensing.gateway.realtime_cerebrum import _build_intent


@pytest.mark.parametrize("operator_allows", [True, False])
def test_automatic_execution_stays_bounded_and_requires_operator_opt_in(operator_allows):
    params = TurnParams.model_validate(
        {
            "threadId": "test",
            "input": [
                {
                    "type": "text",
                    "text": "test",
                    "metadata": {
                        "context": {
                            "permission_mode": "autoSandbox",
                            "execution_environment": "local",
                            "sandbox_mode": "full",
                        }
                    },
                }
            ],
            "approvalPolicy": "never",
            "sandboxPolicy": {"type": "dangerFullAccess", "networkAccess": False},
        }
    )
    context = _build_intent("test", params, allow_client_auto_approve=operator_allows).user_context
    assert context["permission_mode"] == ("autoSandbox" if operator_allows else "default")
    assert context["approval_policy"] == ("never" if operator_allows else "on-request")
    assert context["auto_approve"] is operator_allows
    assert context["sandbox_policy"]["type"] == "workspaceWrite"
    assert context["sandbox_mode"] == "sandbox"


def test_auto_mode_never_selects_unconfined_fallback(tmp_path, monkeypatch):
    from runtime.safety.sandboxing.execution_mode import (
        command_process_backend,
        command_sandbox_required,
    )

    monkeypatch.setenv("ECHO_PROCESS_SANDBOX", "off")
    session = Session(metadata={"permission_mode": "autoSandbox"})
    with session_scope(session):
        assert command_sandbox_required()
        assert sandbox.effective_process_sandbox_mode() == "off"
        monkeypatch.setattr(
            sandbox,
            "resolve_process_backend",
            lambda mode: (_ for _ in ()).throw(SandboxViolation(mode)),
        )
        with pytest.raises(SandboxViolation, match="strict"):
            command_process_backend()


def test_auto_mode_does_not_grant_drive_roots(tmp_path):
    session = Session(
        metadata={
            "mode": "code",
            "workspace_path": str(tmp_path),
            "permission_mode": "autoSandbox",
            "approval_policy": "never",
            "execution_environment": "sandbox",
            "sandbox_mode": "sandbox",
        }
    )
    scope = resolve_execution_scope(session)
    assert scope.approval_policy == "never"
    assert not scope.allows_write(tmp_path.parent / "outside.txt")


def test_mxc_rejects_drive_root_before_launcher(tmp_path, monkeypatch):
    from runtime.safety.sandboxing import windows_mxc

    monkeypatch.setattr(windows_mxc, "mxc_executable", lambda: "codex.exe")
    root = type(tmp_path)(tmp_path.anchor)
    with pytest.raises(SandboxViolation, match="task workspace"):
        WindowsMXCBackend().transform(["cmd.exe"], {}, root, SandboxPolicy(workspace=root))


def test_auto_mode_writes_only_the_server_granted_workspace(tmp_path):
    session = Session(
        metadata={
            "mode": "react",
            "permission_mode": "autoSandbox",
            "approval_policy": "never",
            "execution_environment": "sandbox",
            "sandbox_mode": "sandbox",
            "_host_workspace_read_root": tmp_path,
        }
    )
    scope = resolve_execution_scope(session)
    assert scope.primary_write == tmp_path
    assert scope.allows_write(tmp_path / "output/final/result.txt")
    assert not scope.allows_write(tmp_path.parent / "private.txt")


def test_codex_auto_approval_preserves_workspace_isolation():
    from runtime.execution.codex_backend.role_runner import _sandbox_for_approval

    context = {"permission_mode": "autoSandbox", "sandbox_policy": {"type": "workspaceWrite"}}
    assert _sandbox_for_approval(context, None, True) == "workspace-write"
