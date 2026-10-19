"""Open the official CLI login without handling its account credentials."""

from __future__ import annotations

import os
import shutil
import subprocess

from runtime.execution.codebuddy_backend import (
    child_environment,
    command,
    executable,
    inspect_readiness,
)
from runtime.execution.codebuddy_events import CodeBuddyError
from runtime.platform.process.paths import app_paths


def login_launch_supported() -> bool:
    return os.name == "nt"


def _quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def launch_login() -> dict[str, object]:
    ready = inspect_readiness()
    if not ready["available"]:
        raise CodeBuddyError(ready["reason"])
    if not login_launch_supported() or not (shell := shutil.which("powershell.exe")):
        raise CodeBuddyError("请在本机终端运行官方 CodeBuddy CLI，输入 /login 并选择中国站登录。")
    root = app_paths().data_dir / "execution" / "codebuddy-login"
    root.mkdir(parents=True, exist_ok=True)
    # A fresh local-only working directory prevents user/project settings from
    # routing the login helper through a third-party API, hook or plugin.
    cli = "& " + " ".join(_quote(arg) for arg in command(executable()))
    interactive = (
        "$Host.UI.RawUI.WindowTitle='CodeBuddy official account'; "
        + cli
        + " --setting-sources local"
    )
    launcher = (
        "$ErrorActionPreference='Stop'; Start-Process -FilePath "
        + _quote(shell)
        + " -WindowStyle Normal -WorkingDirectory "
        + _quote(str(root))
        + " -ArgumentList @('-NoProfile','-NoExit','-Command',"
        + _quote(interactive)
        + ")"
    )
    try:
        subprocess.run(
            [shell, "-NoProfile", "-NonInteractive", "-Command", launcher],
            env=child_environment(),
            cwd=root,
            check=True,
            timeout=10,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}),
        )
    except (OSError, subprocess.SubprocessError):
        raise CodeBuddyError("无法打开 CodeBuddy 登录窗口，请在本机终端完成 /login。") from None
    return {"launched": True, "flow": "official_cli"}
