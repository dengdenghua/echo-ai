"""Local listener controls without importing the optional A2A server."""

from __future__ import annotations

import json
import os
import secrets
from pathlib import Path

from fastapi import HTTPException, Request

ROOT = Path.home() / ".echo" / "codex-hotspot"
MAX_BODY = 2 * 1024 * 1024


def owner_token(root: Path) -> str:
    root.mkdir(parents=True, exist_ok=True)
    path = root / "owner.token"
    if not path.exists():
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except (
            FileExistsError
        ):  # intentional: Another process created the token; read that file below.
            pass
        else:
            with os.fdopen(fd, "w") as file:
                file.write(secrets.token_urlsafe(48))
    return path.read_text().strip()


async def bounded_body(request: Request):
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        if len(chunks) > MAX_BODY:
            raise HTTPException(413, "请求过大")
    try:
        request._body = bytes(chunks)
        value = json.loads(chunks)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "请求必须是 JSON") from None
    if not isinstance(value, dict):
        raise HTTPException(400, "请求必须是 JSON 对象")
    return value
