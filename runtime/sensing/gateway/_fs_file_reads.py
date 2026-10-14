"""Filesystem read endpoints, retaining canonical workspace and local ACLs."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Query, Request

from ._fs_router_helpers import (
    _assert_in_scope,
    _assert_local_request_scope,
    _check_acl,
    _dir_entry_to_tree,
    _FsContext,
    _is_ignored_remote_dir,
    _parse_workspace_path,
    _remote_backend_for,
    _resolve_remote_workspace,
    _tree_depth_of,
    _walk_tree,
    _workspace_relative_path,
)
from ._fs_router_models import FsReadResponse, FsTreeResponse


def register_file_read_endpoints(router: Any, ctx: _FsContext) -> None:
    @router.get("/api/fs/tree", response_model=FsTreeResponse)
    async def api_fs_tree(
        request: Request,
        path: str,
        depth: int = Query(default=2, ge=0, le=6),
        thread_id: str | None = None,
        workspace_path: str | None = None,
        include_ignored: bool = Query(default=False),
    ) -> dict[str, Any]:
        # Remote-workspace routing: if ``path`` carries a ``workspace_id:``
        # prefix and the workspace exists, list_dir via the MountBackend.
        workspace_id, rel_path = _parse_workspace_path(path)
        ws = _resolve_remote_workspace(ctx, workspace_id)
        if ws is not None:
            rel_path = _workspace_relative_path(rel_path)
            _check_acl(ctx, request, ws.id, write=False)
            backend = _remote_backend_for(ctx, ws)
            if backend is None:
                raise HTTPException(
                    500,
                    {
                        "error": "mount_backend_unavailable",
                        "workspace_id": ws.id,
                        "mount_type": ws.mount_type,
                    },
                )
            try:
                entries = await backend.list_dir(rel_path, depth)
            except FileNotFoundError as exc:
                raise HTTPException(404, str(exc)) from exc
            except NotADirectoryError as exc:
                raise HTTPException(404, str(exc)) from exc
            except Exception as exc:  # noqa: BLE001 — backend error
                raise HTTPException(500, f"backend list_dir failed: {exc}") from exc
            tree = [
                _dir_entry_to_tree(e, depth=_tree_depth_of(e.path, rel_path))
                for e in entries
                if not _is_ignored_remote_dir(e)
            ]
            return {"entries": tree}
        # Local-path fallback (existing behaviour).
        _assert_local_request_scope(
            ctx,
            request,
            thread_id=thread_id,
            workspace_path=workspace_path,
        )
        root = _assert_in_scope(
            ctx,
            Path(path),
            thread_id=thread_id,
            workspace_path=workspace_path,
        )
        return {
            "entries": await asyncio.to_thread(
                _walk_tree,
                root,
                max_depth=depth,
                include_ignored=include_ignored,
            ),
        }

    @router.get("/api/fs/read", response_model=FsReadResponse)
    async def api_fs_read(
        request: Request,
        path: str,
        max_lines: int = Query(default=500, ge=1, le=5000),
        thread_id: str | None = None,
        workspace_path: str | None = None,
    ) -> dict[str, Any]:
        # Remote-workspace routing: if ``path`` carries a ``workspace_id:``
        # prefix and the workspace exists, read_file via the MountBackend.
        workspace_id, rel_path = _parse_workspace_path(path)
        ws = _resolve_remote_workspace(ctx, workspace_id)
        if ws is not None:
            rel_path = _workspace_relative_path(rel_path)
            _check_acl(ctx, request, ws.id, write=False)
            backend = _remote_backend_for(ctx, ws)
            if backend is None:
                raise HTTPException(
                    500,
                    {
                        "error": "mount_backend_unavailable",
                        "workspace_id": ws.id,
                        "mount_type": ws.mount_type,
                    },
                )
            try:
                raw = await backend.read_file(rel_path)
            except FileNotFoundError as exc:
                raise HTTPException(404, str(exc)) from exc
            except Exception as exc:  # noqa: BLE001 — backend error
                raise HTTPException(500, f"backend read_file failed: {exc}") from exc
            if isinstance(raw, (bytes, bytearray)):
                content = raw.decode("utf-8", errors="replace")
            else:
                content = str(raw)
            lines = content.splitlines()
            return {
                "path": f"{ws.id}:{rel_path}",
                "content": "\n".join(lines[:max_lines]),
                "lines": lines[:max_lines],
                "truncated": len(lines) > max_lines,
            }
        # Local-path fallback (existing behaviour).
        _assert_local_request_scope(
            ctx,
            request,
            thread_id=thread_id,
            workspace_path=workspace_path,
        )
        file_path = _assert_in_scope(
            ctx,
            Path(path),
            thread_id=thread_id,
            workspace_path=workspace_path,
        )
        if not file_path.exists() or not file_path.is_file():
            raise HTTPException(404, f"file not found: {file_path}")
        try:
            content = await asyncio.to_thread(
                file_path.read_text,
                encoding="utf-8",
                errors="replace",
            )
        except OSError as exc:
            raise HTTPException(
                500,
                f"failed to read file: {exc}",
            ) from exc
        lines = content.splitlines()
        return {
            "path": str(file_path),
            "content": "\n".join(lines[:max_lines]),
            "lines": lines[:max_lines],
            "truncated": len(lines) > max_lines,
        }
