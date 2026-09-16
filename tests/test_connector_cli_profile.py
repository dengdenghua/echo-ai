from types import SimpleNamespace

from runtime.platform.capabilities import tenant_context
from runtime.platform.connectors.cli_profile import cli_profile_env, direct_cli_profile_env


def test_login_and_direct_execution_share_echo_profile(monkeypatch, tmp_path):
    monkeypatch.setattr("runtime.platform.process.paths.app_paths", lambda: SimpleNamespace(data_dir=tmp_path))
    monkeypatch.setattr(tenant_context, "current_capability_scope", lambda: None)
    env = cli_profile_env("dingtalk")
    assert env == direct_cli_profile_env(["C:\\tools\\dws.cmd", "auth", "status"])
    assert env == direct_cli_profile_env(["dws", "chat", "list"])
    assert env["HOME"] == str((tmp_path / "connector-profiles/dingtalk/home").resolve())
    assert env["HOME"] == env["USERPROFILE"]


def test_profiles_do_not_cross_accounts(monkeypatch, tmp_path):
    monkeypatch.setattr("runtime.platform.process.paths.app_paths", lambda: SimpleNamespace(data_dir=tmp_path))
    monkeypatch.setattr(tenant_context, "current_capability_scope", lambda: SimpleNamespace(tenant_id="tenant", actor_id="a"))
    first = cli_profile_env("dingtalk")
    monkeypatch.setattr(tenant_context, "current_capability_scope", lambda: SimpleNamespace(tenant_id="tenant", actor_id="b"))
    assert cli_profile_env("dingtalk")["HOME"] != first["HOME"]


def test_unrelated_commands_are_not_rehomed():
    assert direct_cli_profile_env(["git", "status"]) == {}
    assert direct_cli_profile_env(["powershell", "-Command", "dws auth status"]) == {}
    assert cli_profile_env("unknown") == {}
