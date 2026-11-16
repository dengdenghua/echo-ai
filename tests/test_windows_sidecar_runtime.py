import os
import tomllib
from pathlib import Path

import pytest
from runtime.execution.codex_backend import security


@pytest.mark.skipif(os.name != "nt", reason="Windows runtime directory contract")
@pytest.mark.parametrize("supported", [False, True])
def test_mxc_preserves_scoped_filesystem_and_approval_policy(tmp_path, monkeypatch, supported):
    monkeypatch.setattr(security, "supported_codex_features", lambda _: {"prefer_mxc"} if supported else set())
    workspace=tmp_path / "workspace"
    workspace.mkdir()
    manager=security.CodexSidecarSecurity(security.CodexSecurityPolicy(state_root=tmp_path / "private", allowed_workspace_roots=(workspace,)))
    context=manager.prepare(realm_id="test", tenant_id="test", thread_id="test", task_id="test", workspace=workspace,
                            host_env={"SYSTEMROOT": os.environ["SYSTEMROOT"], "LOCALAPPDATA": "C:/host-secret", "API_KEY": "never-inherit"})
    config=tomllib.loads(context.config_path.read_text(encoding="utf-8"))
    context.validate_effective_config(config)
    assert config["features"].get("prefer_mxc", False) is supported
    assert config["approval_policy"] == "on-request"
    profile=config["permissions"][security.PERMISSION_PROFILE]
    assert profile["network"]["enabled"] is False
    assert profile["filesystem"][str(context.state_root)] == "deny"
    assert profile["filesystem"][str(workspace.resolve())] == "write"
    for env in (context.launch_env(), config["shell_environment_policy"]["set"]):
        assert env["SYSTEMDRIVE"] == os.path.splitdrive(os.environ["SYSTEMROOT"])[0]
        assert "API_KEY" not in env
        assert env["LOCALAPPDATA"] != "C:/host-secret"
        assert Path(env["LOCALAPPDATA"]).is_dir()
    config["features"]["prefer_mxc"] = not supported
    with pytest.raises(security.CodexSecurityError):
        context.validate_effective_config(config)
