"""Shared loopback hotspot token without optional A2A server imports."""

from __future__ import annotations

import os
import secrets
from pathlib import Path

ROOT = Path.home() / ".echo" / "codex-hotspot"


def owner_token(root: Path) -> str:
    root.mkdir(parents=True, exist_ok=True)
    path = root / "owner.token"
    if not path.exists():
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, "w") as file:
                file.write(secrets.token_urlsafe(48))
    return path.read_text().strip()
