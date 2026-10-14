"""Owner-authorized shared-directory attachments and explicit sync actions."""

from __future__ import annotations

import threading
from collections.abc import Callable
from contextlib import ExitStack
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from runtime.platform.io.file_coordination import (
    FileCoordinationConflict,
    coordinate_file_mutations,
)
from runtime.platform.io.lease import LeaseConflictError, LeaseStore
from runtime.sensing.gateway.thread_workspace import verified_managed_workspace
from runtime.sensing.gateway.workspace_api_router import _require_flag
from runtime.workspace import WorkspaceStore
from runtime.workspace.directory_sync import apply_sync, plan_sync
from runtime.workspace.execution_directory import execution_directory


class SyncRequest(BaseModel):
    token: str | None = None


def shared_spaces_router(
    *,
    store: Any,
    authorize: Callable,
    managed: bool,
    workspace_root: Any,
    workspace_store: WorkspaceStore | None = None,
    lease_store: LeaseStore | None = None,
) -> APIRouter:
    router = APIRouter()
    # Serialize this runtime's sync/attachment mutations. File digests also
    # reject stale previews and edits made outside this runtime.
    lock = threading.Lock()

    def context(request: Request, thread_id: str):
        _require_flag()
        thread = authorize(request, thread_id)
        principal = getattr(request.state, "thread_principal", None)
        return thread, principal, workspace_store or WorkspaceStore()

    def resolve(registry, workspace_id, principal):
        ws = registry.get_workspace(workspace_id)
        if ws is None:
            raise HTTPException(404, "Shared workspace not found")
        if principal is not None:
            operator = bool(principal.roles.intersection({"admin", "operator"}))
            if ws.tenant_id != principal.tenant_id and not operator:
                raise HTTPException(404, "Shared workspace not found")
            role = registry.get_member_role(workspace_id, principal.actor_id)
            if role is None:
                raise HTTPException(404, "Shared workspace not found")
            if role not in {"owner", "editor"} and not operator:
                raise HTTPException(403, "Shared workspace write membership required")
        return ws

    def directory(ws):
        result = execution_directory(ws)
        if not result["ready"]:
            raise HTTPException(409, result["detail"])
        return Path(result["filesystem_path"])

    @router.get("/api/threads/{thread_id}/shared-spaces")
    def list_spaces(request: Request, thread_id: str):
        thread, principal, registry = context(request, thread_id)
        spaces = []
        for workspace_id in thread.get("metadata", {}).get("shared_workspace_ids", []):
            try:
                ws = resolve(registry, workspace_id, principal)
                probe = execution_directory(ws)
                spaces.append(
                    {
                        "id": ws.id,
                        "name": ws.name,
                        "ready": probe["ready"],
                        "path": probe["filesystem_path"],
                        "detail": probe["detail"],
                    }
                )
            except HTTPException:
                spaces.append(
                    {
                        "id": workspace_id,
                        "name": "Unavailable",
                        "ready": False,
                        "path": None,
                        "detail": "Workspace removed or access revoked",
                    }
                )
        return {"spaces": spaces}

    @router.put("/api/threads/{thread_id}/shared-spaces/{workspace_id}")
    def attach(request: Request, thread_id: str, workspace_id: str):
        with lock:
            thread, principal, registry = context(request, thread_id)
            ws = resolve(registry, workspace_id, principal)
            directory(ws)
            ids = list(thread.get("metadata", {}).get("shared_workspace_ids", []))
            if workspace_id not in ids:
                if len(ids) >= 16:
                    raise HTTPException(400, "At most 16 shared spaces per task")
                ids.append(workspace_id)
            store.update_state(thread_id, metadata={"shared_workspace_ids": ids})
            return {"attached": True}

    @router.delete("/api/threads/{thread_id}/shared-spaces/{workspace_id}")
    def detach(request: Request, thread_id: str, workspace_id: str):
        with lock:
            thread, _, _ = context(request, thread_id)
            meta = thread.get("metadata", {})
            ids = [i for i in meta.get("shared_workspace_ids", []) if i != workspace_id]
            baselines = dict(meta.get("shared_sync_baselines", {}))
            baselines.pop(workspace_id, None)
            store.update_state(
                thread_id,
                metadata={"shared_workspace_ids": ids, "shared_sync_baselines": baselines},
            )
            return {"detached": True}

    @router.post("/api/threads/{thread_id}/shared-spaces/{workspace_id}/sync")
    def sync(request: Request, thread_id: str, workspace_id: str, body: SyncRequest):
        with lock:
            thread, principal, registry = context(request, thread_id)
            meta = thread.get("metadata", {})
            if workspace_id not in meta.get("shared_workspace_ids", []):
                raise HTTPException(409, "Attach this shared workspace first")
            shared = directory(resolve(registry, workspace_id, principal))
            if managed:
                local = verified_managed_workspace(
                    workspace_root, thread_id=thread_id, metadata=meta
                )
            else:
                raw = meta.get("workspace_path")
                local = Path(raw).expanduser() if isinstance(raw, str) and raw.strip() else None
            if local is None or not local.is_absolute() or not local.is_dir():
                raise HTTPException(409, "Task has no accessible project directory")
            local = local.resolve(strict=True)
            baselines = dict(meta.get("shared_sync_baselines", {}))
            try:
                plan = plan_sync(local, shared, baselines.get(workspace_id, {}))
                applied = body.token is not None
                if applied:
                    if body.token != plan["token"]:
                        raise HTTPException(409, "Files changed since preview; preview again")
                    paths = [
                        root / item["path"] for item in plan["actions"] for root in (local, shared)
                    ]
                    with coordinate_file_mutations(paths), ExitStack() as release:
                        leases = lease_store or LeaseStore()
                        holder = principal.actor_id if principal else f"sync:{thread_id}"
                        for item in plan["actions"]:
                            previous = leases.get_by_path(workspace_id, item["path"])
                            acquired = leases.acquire(workspace_id, item["path"], holder)
                            if previous is None or previous.lease_id != acquired.lease_id:
                                release.callback(leases.release, acquired.lease_id)
                        baselines[workspace_id] = apply_sync(local, shared, plan)
                    store.update_state(thread_id, metadata={"shared_sync_baselines": baselines})
                return {
                    key: value
                    for key, value in {**plan, "applied": applied}.items()
                    if key != "baseline"
                }
            except (ValueError, OSError, LeaseConflictError, FileCoordinationConflict) as exc:
                raise HTTPException(409, str(exc)) from exc

    return router
