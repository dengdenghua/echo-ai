"""Independent interactive-app metadata, without a plugin manifest or Python entrypoint."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

SCHEMA = "echo.app.v1"
APP_PERMISSIONS = frozenset({"app.storage", "task.request"})


def read_personal_app(source: Path) -> dict[str, Any] | None:
    path = source / "app.json"
    if not path.exists():
        return None
    if path.is_symlink() or path.stat().st_size > 64 * 1024:
        raise ValueError("app.json must be a regular file below 64 KiB")
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("schema") != SCHEMA:
        # Ordinary websites may carry an unrelated framework's app.json.
        return None
    app_id = raw.get("id")
    if not isinstance(app_id, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", app_id):
        raise ValueError("app id must be a lowercase slug")
    name = raw.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 120:
        raise ValueError("app name is required (max 120 characters)")
    if raw.get("entry") != "index.html":
        raise ValueError("personal app entry must be index.html")
    if (source / "index.html").is_symlink():
        raise ValueError("personal app entry cannot be a symlink")
    # Only narrowly scoped bridge capabilities. No raw backend/tool authority.
    permissions = raw.get("permissions", [])
    if not isinstance(permissions, list) or any(
        not isinstance(item, str) or item not in APP_PERMISSIONS for item in permissions
    ):
        raise ValueError("supported app permissions: app.storage, task.request")
    description = raw.get("description", "")
    version = raw.get("version", "0.1.0")
    if not isinstance(description, str) or len(description) > 1000:
        raise ValueError("app description must be text (max 1000 characters)")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("app version must have major.minor.patch format")
    return {
        "schema": SCHEMA,
        "id": app_id,
        "name": name.strip(),
        "description": description,
        "version": version,
        "entry": "index.html",
        "permissions": list(dict.fromkeys(permissions)),
    }
