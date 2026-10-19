from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.testclient import TestClient

from runtime.execution import codebuddy_account as account
from runtime.execution.codebuddy_events import CodeBuddyError
from runtime.sensing.gateway import _config_endpoints_codebuddy as endpoints


def test_login_launch_uses_official_environment_and_no_shell_credentials(tmp_path, monkeypatch):
    monkeypatch.setattr(account, "inspect_readiness", lambda: {"available": True})
    monkeypatch.setattr(account, "login_launch_supported", lambda: True)
    monkeypatch.setattr(account.shutil, "which", lambda _: "powershell.exe")
    monkeypatch.setattr(account, "executable", lambda: "codebuddy.cmd")
    monkeypatch.setattr(
        account, "command", lambda _: ["C:/Program Files/node.exe", "C:/a'b/cli.js"]
    )
    monkeypatch.setattr(account, "app_paths", lambda: SimpleNamespace(data_dir=tmp_path))
    monkeypatch.setenv("CODEBUDDY_API_KEY", "test-secret")
    monkeypatch.setenv("CODEBUDDY_BASE_URL", "https://third-party.example")
    run = Mock()
    monkeypatch.setattr(account.subprocess, "run", run)
    assert account.launch_login() == {"launched": True, "flow": "official_cli"}
    args, kwargs = run.call_args
    assert "test-secret" not in str(args)
    assert "third-party.example" not in str(args)
    assert "--setting-sources local" in args[0][-1]
    assert "-WindowStyle Normal" in args[0][-1]
    assert "CODEBUDDY_API_KEY" not in kwargs["env"]
    assert kwargs["env"]["CODEBUDDY_INTERNET_ENVIRONMENT"] == "internal"
    assert kwargs["cwd"] == tmp_path / "execution/codebuddy-login"


def test_hosted_deployments_cannot_launch_the_machine_login(monkeypatch):
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", "cloud")
    run = Mock()
    monkeypatch.setattr(account.subprocess, "run", run)
    with pytest.raises(CodeBuddyError, match="本机模式"):
        account.launch_login()
    run.assert_not_called()


def test_login_endpoint_requires_admin_and_does_not_return_credentials(monkeypatch):
    launch = Mock(return_value={"launched": True, "flow": "official_cli"})
    monkeypatch.setattr(endpoints, "launch_login", launch)
    allowed = False

    def require_admin(request):
        if not allowed:
            raise HTTPException(403, "administrator required")

    app = FastAPI()
    router = APIRouter()
    endpoints._register_codebuddy(router, SimpleNamespace(require_admin=require_admin))
    app.include_router(router)
    with TestClient(app) as client:
        assert client.post("/api/config/codebuddy/login").status_code == 403
        launch.assert_not_called()
        allowed = True
        assert client.post("/api/config/codebuddy/login").json() == {
            "launched": True,
            "flow": "official_cli",
        }
