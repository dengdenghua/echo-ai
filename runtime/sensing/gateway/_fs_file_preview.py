"""Passive, scoped file previews for conversation references."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException, Request
from starlette.responses import FileResponse

from ._fs_reference_resolution import resolve_conversation_file
from ._fs_router_helpers import _assert_local_request_scope, _FsContext


def register_file_preview_endpoint(router: Any, ctx: _FsContext) -> None:
    @router.get("/api/fs/preview")
    async def api_fs_preview(
        request: Request,
        path: str,
        thread_id: str | None = None,
        reference: str | None = None,
    ) -> FileResponse:
        _assert_local_request_scope(ctx, request, thread_id=thread_id, workspace_path=None)
        file_path = await asyncio.to_thread(
            resolve_conversation_file,
            ctx,
            Path(path),
            thread_id=thread_id,
            reference=reference,
        )
        if file_path.stat().st_size > 24 * 1024 * 1024:
            raise HTTPException(413, "file exceeds the 24 MB preview limit")
        # Active documents are downloaded, never executed in the app origin.
        media_types = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".pdf": "application/pdf",
        }
        media_type = media_types.get(file_path.suffix.lower(), "application/octet-stream")
        return FileResponse(
            file_path,
            media_type=media_type,
            filename=file_path.name,
            content_disposition_type="inline"
            if media_type != "application/octet-stream"
            else "attachment",
            headers={
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "X-Echo-File-Path": quote(str(file_path), safe=""),
            },
        )
