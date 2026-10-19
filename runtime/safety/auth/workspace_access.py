"""Recognize the server-owned task directory inside desktop application state."""

import os
from pathlib import Path


def is_current_managed_workspace_path(path: str | Path) -> bool:
    from runtime.platform.process.paths import app_paths
    from runtime.platform.process.session import current_session

    session = current_session()
    root = session.metadata.get("_host_workspace_read_root") if session else None
    # JSON context cannot grant this: only the server can provide a Path.
    if not isinstance(root, Path) or not root.is_absolute():
        return False
    try:
        resolved_root = root.resolve(strict=False)
        managed = (app_paths().data_dir / "workspaces").resolve(strict=False)
        return (
            resolved_root == Path(os.path.abspath(root))
            and resolved_root != managed
            and resolved_root.is_relative_to(managed)
            and Path(path).resolve(strict=False).is_relative_to(resolved_root)
        )
    except (OSError, RuntimeError, ValueError):
        return False
