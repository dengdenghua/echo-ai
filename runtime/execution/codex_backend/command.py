"""Shared executable resolution for Codex control and execution planes."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from runtime.execution.agents.login_shell_path import login_shell_path

from .types import ConfigurationError


def _package_version(package_dir: Path) -> tuple[int, ...]:
    """``OpenAI.Codex_26.1002.7124.0_x64__<publisher>`` -> ``(26, 1002, 7124, 0)``."""
    parts = package_dir.name.split("_")
    try:
        return tuple(int(part) for part in parts[1].split("."))
    except (IndexError, ValueError):
        return ()


def _windows_codex_app_dirs() -> list[str]:
    """Resource folders of the Microsoft Store Codex app, newest first.

    Like ChatGPT.app on macOS, the Codex desktop app ships a runnable
    ``codex.exe`` that is not on PATH. The package folder name carries the
    version, so it changes on every update and cannot be configured once.
    """
    if os.name != "nt":
        return []
    program_files = os.environ.get("PROGRAMW6432") or os.environ.get("PROGRAMFILES")
    base = Path(program_files or r"C:\Program Files") / "WindowsApps"
    try:
        packages = [path for path in base.glob("OpenAI.Codex_*") if path.is_dir()]
    except OSError:
        # Listing WindowsApps can be denied; PATH and ECHO_CODEX_EXECUTABLE still work.
        return []
    packages.sort(key=_package_version, reverse=True)
    return [str(package / "app" / "resources") for package in packages]


def _resolve_codex_command(command: str) -> str | None:
    path = shutil.which(command)
    if path:
        return path
    if os.path.sep in command or (os.path.altsep and os.path.altsep in command):
        return None
    candidates: list[str] = []
    for raw in (os.environ.get("PATH", ""), login_shell_path()):
        candidates.extend(raw.split(os.pathsep))
    candidates.extend(
        (
            str(Path.home() / ".local" / "bin"),
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/Applications/ChatGPT.app/Contents/Resources",
        )
    )
    candidates.extend(_windows_codex_app_dirs())
    names = [command]
    if os.name == "nt" and not Path(command).suffix:
        # Prefer the .exe: the Codex app also ships an extensionless Linux ELF
        # build for its WSL sandbox in the same folder.
        names = [f"{command}.exe", command]
    for directory in dict.fromkeys(item.strip() for item in candidates if item.strip()):
        for name in names:
            candidate = Path(directory).expanduser() / name
            try:
                if candidate.is_file() and os.access(candidate, os.X_OK):
                    return str(candidate.resolve())
            except OSError:
                continue
    return None


def resolve_codex_app_server_command(executable: str | None = None) -> tuple[str, ...]:
    """Resolve one absolute Codex binary and pin the App Server argv.

    Packaged macOS builds often have no ``codex`` on the service PATH while
    ChatGPT ships it in ``/Applications/ChatGPT.app/Contents/Resources``.
    ``resolve_local_command`` already probes service PATH, login-shell PATH,
    common install bins, and that packaged resource directory. Both account
    login and real Coder turns call this function so they cannot drift to
    different Codex versions.
    """

    candidate = str(os.environ.get("ECHO_CODEX_EXECUTABLE") or executable or "codex").strip()
    if not candidate or "\x00" in candidate:
        raise ConfigurationError("Codex executable is invalid")
    expanded = Path(candidate).expanduser()
    resolved: str | None
    if (
        expanded.is_absolute()
        or os.path.sep in candidate
        or (os.path.altsep is not None and os.path.altsep in candidate)
    ):
        try:
            if not expanded.is_file() or not os.access(expanded, os.X_OK):
                resolved = None
            else:
                resolved = str(expanded.resolve(strict=True))
        except OSError:
            resolved = None
    else:
        resolved = _resolve_codex_command(candidate)
    if resolved is None:
        raise ConfigurationError("Codex executable is unavailable")
    return (resolved, "app-server", "--strict-config", "--listen", "stdio://")


__all__ = ["resolve_codex_app_server_command"]
