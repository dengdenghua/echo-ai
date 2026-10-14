"""Opaque development ownership endpoint, loaded only by explicit local launchers."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any


def _canonical(path: Path) -> str:
    value = str(path.expanduser().resolve()).replace("\\", "/").rstrip("/")
    return value.lower() if os.name == "nt" else value


def development_identity() -> dict[str, str]:
    import runtime
    from runtime.platform.process.paths import app_paths

    project = _canonical(Path(runtime.__file__).parent.parent)
    data = _canonical(app_paths().data_dir)
    return {
        "schema": "echo.dev-instance.v1",
        "projectId": hashlib.sha256(project.encode()).hexdigest(),
        "instanceId": hashlib.sha256((project + "\0" + data).encode()).hexdigest(),
    }


def register_app(app: Any, context: Any) -> None:
    if os.environ.get("ECHO_DEV_INSTANCE") != "1":
        return
    identity = development_identity()

    @app.get("/api/dev/instance", include_in_schema=False)
    def dev_instance() -> dict[str, str]:
        return identity.copy()
