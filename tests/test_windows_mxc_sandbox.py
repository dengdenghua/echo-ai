from __future__ import annotations

import json
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest

from runtime.safety.sandboxing.sandbox import SandboxPolicy, SandboxViolation
from runtime.safety.sandboxing.windows_mxc import WindowsMXCBackend


def test_mxc_profile_is_minimal_and_does_not_inherit_user_home(tmp_path, monkeypatch):
    from runtime.safety.sandboxing import windows_mxc as module

    monkeypatch.setenv("ECHO_DATA_DIR", str(tmp_path / "state"))
    monkeypatch.setattr(module, "mxc_executable", lambda: str(tmp_path / "engine/bin/codex.exe"))
    workspace = tmp_path / "work"
    workspace.mkdir()
    policy = SandboxPolicy(workspace=workspace)
    args, env, cwd = WindowsMXCBackend().transform(["cmd.exe"], policy.env_for(), workspace, policy)
    overrides = [args[index + 1] for index, value in enumerate(args) if value == "-c"]
    config = tomllib.loads("\n".join(overrides))
    profile = config["permissions"][args[args.index("--permission-profile") + 1]]
    assert config["windows"]["sandbox"] == "mxc"
    assert profile["network"] == {"enabled": False}
    assert profile["filesystem"][":minimal"] == "read"
    assert ":root" not in profile["filesystem"]
    assert profile["filesystem"][str(workspace)] == "write"
    assert profile["filesystem"][env["CODEX_HOME"]] == "deny"
    assert cwd == workspace
    with pytest.raises(SandboxViolation):
        WindowsMXCBackend().transform(["cmd.exe"], env, tmp_path, policy)


def test_windows_runtime_environment_keeps_font_directory_without_secrets(tmp_path, monkeypatch):
    monkeypatch.setenv("WINDIR", "C:\\Windows")
    monkeypatch.setenv("EXAMPLE_API_KEY", "private-test-value")
    env = SandboxPolicy(workspace=tmp_path).env_for()
    assert env["WINDIR"] == "C:\\Windows"
    assert "EXAMPLE_API_KEY" not in env


@pytest.mark.skipif(sys.platform != "win32", reason="real Windows kernel isolation test")
@pytest.mark.parametrize("mode", ["workspace-write", "read-only"])
def test_real_mxc_denies_outside_reads_writes_and_network(tmp_path, mode):
    if not WindowsMXCBackend.available():
        pytest.skip("Echo Codex engine not installed")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    sentinel = tmp_path / "private.txt"
    sentinel.write_text("private")
    code = """import json,socket
from pathlib import Path
results={}
for name,path,write in [('inside','allowed.txt',True),('outside_write',OUTSIDE+'new.txt',True),('outside_read',OUTSIDE,False)]:
 try:
  p=Path(path)
  p.write_text('test') if write else p.read_text()
  results[name]='allowed'
 except PermissionError: results[name]='denied'
try:
 s=socket.create_connection(('1.1.1.1',443),timeout=2);s.close();results['network']='allowed'
except PermissionError: results['network']='denied'
print(json.dumps(results))
""".replace("OUTSIDE", repr(str(sentinel)))
    policy = SandboxPolicy(workspace=workspace, mode=mode)
    args, env, cwd = WindowsMXCBackend().transform(
        [sys.executable, "-c", code], policy.env_for(), workspace, policy
    )
    result = subprocess.run(args, env=env, cwd=cwd, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")
    data = json.loads(result.stdout)
    assert data == {
        "inside": "allowed" if mode == "workspace-write" else "denied",
        "outside_write": "denied",
        "outside_read": "denied",
        "network": "denied",
    }
    assert not Path(str(sentinel) + "new.txt").exists()
