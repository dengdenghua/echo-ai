"""Host-owned environment requirements checked before an engine does work."""

from __future__ import annotations

import os
import shutil
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from runtime.platform.process.scope import ExecutionScope


class EnvironmentNotReady(RuntimeError):
    pass


def current_device_id() -> str:
    return os.environ.get("ECHO_NODE_ID", "").strip() or socket.gethostname()


@dataclass(frozen=True, slots=True)
class ExecutionEnvironment:
    workspace: Path | None = None
    device_id: str = "local"
    executables: tuple[str, ...] = ()
    required_files: tuple[str, ...] = ()

    def check(self, permissions: ExecutionScope) -> dict[str, object]:
        """Never creates directories or treats a missing mount as an empty project."""
        if self.device_id not in {"local", current_device_id()}:
            raise EnvironmentNotReady("Task belongs to another execution device")
        root = self.workspace
        if root is not None:
            if not root.is_absolute():
                raise EnvironmentNotReady("Execution workspace must be an absolute path")
            try:
                root = root.resolve(strict=True)
                if not root.is_dir():
                    raise NotADirectoryError
                if not permissions.allows_read(root):
                    raise PermissionError("Execution workspace exceeds the host permission scope")
                with os.scandir(root) as entries:
                    next(entries, None)
            except OSError as exc:
                raise EnvironmentNotReady("Execution workspace is missing or inaccessible") from exc
        for name in self.required_files:
            if root is None or Path(name).is_absolute() or ".." in Path(name).parts:
                raise EnvironmentNotReady("Required files must be relative to the workspace")
            path = (root / name).resolve()
            if not path.is_relative_to(root) or not permissions.allows_read(path):
                raise EnvironmentNotReady("Required file exceeds the execution workspace")
            if not path.is_file():
                raise EnvironmentNotReady(f"Required file is unavailable: {name}")
        missing = [name for name in self.executables if not shutil.which(name)]
        if missing:
            raise EnvironmentNotReady(f"Required executables are unavailable: {', '.join(missing)}")
        return {
            "ready": True,
            "device_id": current_device_id(),
            "workspace": str(root) if root else None,
            "executables": list(self.executables),
        }


def environment_for_workspace(path: object) -> ExecutionEnvironment | None:
    if isinstance(path, str) and path.strip():
        return ExecutionEnvironment(workspace=Path(path).expanduser())
    return None
