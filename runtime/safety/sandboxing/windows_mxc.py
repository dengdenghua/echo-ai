"""Run local commands through Echo's pinned Windows MXC sandbox launcher.

No model session is started. Explicit MXC selection fails closed rather than
falling back to legacy tokens or host execution on an unsupported computer.
"""

from __future__ import annotations

import json
import os
import secrets
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from .sandbox_backends import SandboxViolation

if TYPE_CHECKING:
    from .sandbox import SandboxEnforcement, SandboxPolicy


def mxc_executable() -> str | None:
    from runtime.execution.engine_packages.store import engines_root, read_installed

    if sys.platform != "win32":
        return None
    roots = [engines_root()]
    appdata = os.environ.get("APPDATA")
    if appdata:
        roots.append(Path(appdata) / "echo-frontend" / "engines")
    for root in roots:
        installed = read_installed("codex", root=root)
        if installed is not None:
            return str(installed.executable)
    return None


def _toml_table(values: dict[str, str | bool]) -> str:
    return "{" + ",".join(json.dumps(k) + "=" + json.dumps(v) for k, v in values.items()) + "}"


@dataclass(frozen=True)
class WindowsMXCBackend:
    @staticmethod
    def available() -> bool:
        return mxc_executable() is not None

    def enforcement(self, policy: SandboxPolicy) -> SandboxEnforcement:
        return "full"

    def transform(
        self, argv: list[str], env: dict[str, str], cwd: Path, policy: SandboxPolicy
    ) -> tuple[list[str], dict[str, str], Path]:
        from runtime.platform.process.paths import app_paths

        executable = mxc_executable()
        if executable is None:
            raise SandboxViolation("Windows MXC needs Echo's verified Codex engine")
        workspace = policy.workspace.expanduser().resolve()
        run_cwd = cwd.expanduser().resolve()
        if not run_cwd.is_relative_to(workspace):
            raise SandboxViolation("Windows MXC cwd escapes the workspace")
        if policy.mode == "danger-full-access":
            raise SandboxViolation("Windows MXC cannot isolate full-access execution")
        home = app_paths().data_dir / "sandbox" / "windows-mxc"
        home.mkdir(parents=True, exist_ok=True)
        filesystem = self._filesystem(workspace, home, executable, policy)
        # A fresh name prevents workspace configuration from adding inherited
        # permissions to this launcher's profile before CLI overrides merge.
        profile = "echo_" + secrets.token_hex(16)
        overrides = (
            'windows.sandbox="mxc"',
            "analytics.enabled=false",
            f"permissions.{profile}.filesystem=" + _toml_table(filesystem),
            f"permissions.{profile}.workspace_roots=" + _toml_table({str(workspace): True}),
            f"permissions.{profile}.network=" + _toml_table({"enabled": policy.allow_network}),
        )
        wrapped = [executable]
        for value in overrides:
            wrapped.extend(("-c", value))
        wrapped.extend(
            ("sandbox", "--permission-profile", profile, "-C", str(run_cwd), "--", *argv)
        )
        launch_env = {**env, "CODEX_HOME": str(home.resolve())}
        # MXC's Windows App Runtime loader needs native known-folder values.
        # These are directory names, not credentials; access still follows
        # the kernel filesystem profile, not the environment's path strings.
        for key in (
            "APPDATA",
            "LOCALAPPDATA",
            "ProgramData",
            "ProgramFiles",
            "ProgramFiles(x86)",
            "ProgramW6432",
            "SystemDrive",
            "WINDIR",
            "SystemRoot",
        ):
            if key in os.environ:
                launch_env[key] = os.environ[key]
        return wrapped, launch_env, run_cwd

    @staticmethod
    def _filesystem(
        workspace: Path, home: Path, executable: str, policy: SandboxPolicy
    ) -> dict[str, str]:
        filesystem = {
            ":minimal": "read",
            str(workspace): "write" if policy.mode == "workspace-write" else "read",
            ":tmpdir": "deny",
            ":slash_tmp": "deny",
        }
        # Curated host Python runtimes only, never an arbitrary command's parent.
        for runtime in (sys.prefix, sys.base_prefix):
            directory = Path(runtime).resolve()
            if directory != workspace and not workspace.is_relative_to(directory):
                filesystem.setdefault(str(directory), "read")
        temporary = workspace / ".echo-tmp"
        if temporary.is_dir() and not temporary.is_symlink():
            filesystem[str(temporary)] = "write"
        for directory in policy.additional_write_roots:
            filesystem[str(directory)] = "write"
        filesystem[str(home.resolve())] = "deny"
        filesystem[str(Path(executable).resolve().parent.parent)] = "read"
        return filesystem
