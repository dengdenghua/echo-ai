"""Resolve a mounted workspace on the executing Echo runtime, never the UI host.

A remote file API is not a process working directory. Native tools need an OS
mount visible to the runtime (CD2/FUSE/SMB/NFS or another mounted filesystem).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .model import Workspace


def execution_directory(workspace: Workspace) -> dict[str, Any]:
    raw = workspace.mount_options.get("filesystem_path")
    if not raw and workspace.mount_type == "local":
        raw = workspace.mount_target
    if not raw and workspace.mount_type == "nfs":
        raw = workspace.mount_options.get("mount_point")
        if not raw and "://" not in workspace.mount_target:
            raw = workspace.mount_target
    result: dict[str, Any] = {
        "workspace_id": workspace.id,
        "runtime": "current_backend",
        "requires_runtime_online": True,
        "filesystem_path": None,
        "ready": False,
        "status": "mount_required",
    }
    if not isinstance(raw, str) or not raw.strip():
        result["detail"] = (
            "Mount the shared directory on the executing Echo runtime before using native tools."
        )
        return result
    path = Path(raw).expanduser()
    if not path.is_absolute():
        result.update(
            status="invalid_path",
            detail="The executing runtime requires an absolute filesystem path.",
        )
        return result
    try:
        path = path.resolve(strict=True)
        if not path.is_dir():
            raise NotADirectoryError
        # Actually enumerate a directory entry; existence alone does not prove access.
        import os

        with os.scandir(path) as entries:
            next(entries, None)
    except (OSError, RuntimeError):
        result.update(
            status="unavailable",
            detail="The mounted directory is missing or inaccessible on this runtime.",
        )
        return result
    result.update(
        ready=True,
        status="accessible",
        filesystem_path=str(path),
        detail="Directory is accessible on this runtime. This does not start or migrate a task.",
    )
    return result
