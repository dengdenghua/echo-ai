"""Local Git worktree task entry points, sharing the filesystem boundary."""

from __future__ import annotations

import subprocess
import threading
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, Query, Request
from pydantic import BaseModel, Field

from runtime.execution.subagents.worktree_loop import _GIT_HARDENING
from runtime.platform.process.paths import app_paths

from ._fs_router_helpers import _FsContext
from ._fs_router_paths import _assert_within_allowed_roots

_CREATION_LOCK = threading.Lock()


class WorktreeCreateRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    revision: str = Field(default="HEAD", min_length=1, max_length=200)


def _git(root: Path, *args: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), *_GIT_HARDENING, *args],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except FileNotFoundError as exc:
        raise HTTPException(503, "Git is not installed on this computer") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "Git operation timed out") from exc
    if result.returncode:
        raise HTTPException(400, result.stderr.strip()[:600] or "Git operation failed")
    return result.stdout


def _repository(ctx: _FsContext, path: str) -> Path:
    # A shared server's owned thread allocation cannot grant access to sibling
    # worktrees. Keep that mode closed until it has an allocation contract.
    if ctx.require_auth and not ctx.allow_local_workspace_access:
        raise HTTPException(403, "Worktree tasks require a local or dedicated Echo service")
    candidate = _assert_within_allowed_roots(Path(path).expanduser())
    if not candidate.is_dir():
        raise HTTPException(404, "Project directory does not exist")
    root = Path(_git(candidate, "rev-parse", "--show-toplevel").strip())
    return _assert_within_allowed_roots(root)


def _worktrees(root: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    current: dict[str, Any] = {}
    for field in _git(root, "worktree", "list", "--porcelain", "-z").split("\0"):
        if not field:
            if current:
                rows.append(current)
                current = {}
            continue
        key, _, value = field.partition(" ")
        if key == "worktree":
            current = {"path": value, "branch": "", "commit": "", "locked": False}
        elif key == "HEAD":
            current["commit"] = value
        elif key == "branch":
            current["branch"] = value.removeprefix("refs/heads/")
        elif key == "locked":
            current["locked"] = True
    if current:
        rows.append(current)
    visible = []
    for row in rows:
        try:
            path = _assert_within_allowed_roots(Path(row["path"]))
        except HTTPException:
            continue
        if path.is_dir():
            visible.append({**row, "path": str(path), "current": path == root})
    return visible


def register_git_worktree_endpoints(router: Any, ctx: _FsContext) -> None:
    @router.get("/api/git/worktrees")
    def list_worktrees(path: str = Query(min_length=1, max_length=4096)) -> dict[str, Any]:
        root = _repository(ctx, path)
        branches = _git(
            root, "for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"
        ).splitlines()
        return {"root": str(root), "branches": branches, "worktrees": _worktrees(root)}

    @router.post("/api/git/worktrees", status_code=201)
    def create_worktree(request: Request, body: WorktreeCreateRequest) -> dict[str, Any]:
        root = _repository(ctx, body.path)
        revision = body.revision.strip()
        if not revision or revision.startswith("-"):
            raise HTTPException(400, "Choose a valid starting branch or commit")
        # Resolve before creation. No shell interpolation or git option injection.
        commit = _git(root, "rev-parse", "--verify", "--end-of-options", f"{revision}^{{commit}}")
        commit = commit.strip()
        managed_root = _assert_within_allowed_roots(app_paths().data_dir / "worktrees")
        with _CREATION_LOCK:
            managed_root.mkdir(parents=True, exist_ok=True)
            token = uuid4().hex[:16]
            destination = managed_root / token
            branch = f"echo/task-{token}"
            _git(root, "worktree", "add", "-b", branch, str(destination), commit)
        return {
            "path": str(destination),
            "branch": branch,
            "commit": commit,
            "source": str(root),
        }
