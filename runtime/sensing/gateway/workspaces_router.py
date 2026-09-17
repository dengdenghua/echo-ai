"""Workspace manifest API.

This router exposes the per-thread workspace contract used by realtime
code/agent turns. The layout itself lives in ``runtime.platform.runtime_policy.workspaces``;
the API is deliberately read-light and creates the standard directory
structure on first access.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Literal

try:
    from fastapi import APIRouter, HTTPException, Query, Request
    from fastapi.responses import FileResponse, HTMLResponse
    from pydantic import BaseModel

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover
    FASTAPI_AVAILABLE = False
    APIRouter = None  # type: ignore[assignment, misc]
    HTTPException = None  # type: ignore[assignment, misc]
    Query = None  # type: ignore[assignment, misc]
    Request = None  # type: ignore[assignment, misc]
    FileResponse = None  # type: ignore[assignment, misc]
    HTMLResponse = None  # type: ignore[assignment, misc]
    BaseModel = object  # type: ignore[assignment, misc]

from runtime.execution.misc.office_fidelity_preview import render_office_fidelity_preview
from runtime.execution.misc.office_preview import render_office_preview
from runtime.platform.io.atomic import AtomicWriteError, _cross_process_lock
from runtime.platform.runtime_policy.workspaces import WorkspaceManager
from runtime.sensing._fastapi_guard import require_fastapi

if FASTAPI_AVAILABLE:

    class WorkspaceDirEntry(BaseModel):
        key: str
        path: str
        exists: bool

    class WorkspaceInfoResponse(BaseModel):
        thread_id: str
        root: str
        paths: dict[str, str]
        dirs: list[WorkspaceDirEntry]
        manifest: dict[str, Any]

    class WorkspaceOutputEntry(BaseModel):
        name: str
        area: str
        relative_path: str
        path: str
        size: int
        modified: int
        download_url: str

    class WorkspaceOutputsResponse(BaseModel):
        thread_id: str
        area: str
        files: list[WorkspaceOutputEntry]
        count: int

    class WorkspaceOutputWriteRequest(BaseModel):
        content: str
        expected_sha256: str | None = None

    class WorkspaceOutputRestoreRequest(BaseModel):
        revision_id: str
        expected_sha256: str

    class WorkspaceOutputWriteResponse(BaseModel):
        success: bool
        path: str
        bytes: int
        sha256: str
        revision_id: str | None = None

    class WorkspaceOutputProposalRequest(BaseModel):
        action: Literal["create", "accept", "reject"] = "create"
        proposal_id: str | None = None
        expected_sha256: str | None = None
        reviewed_sha256: str | None = None


def create_workspaces_router(
    *,
    workspace_root: Path | str,
    thread_store: Any = None,
    identity_store: Any = None,
    require_auth: bool = False,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
) -> Any:
    require_fastapi(__name__)

    manager = WorkspaceManager(Path(workspace_root))
    router = APIRouter(tags=["workspaces"])

    def _auth(request: Request) -> str | None:
        if require_auth and identity_store is None:
            raise HTTPException(401, "auth required")
        from runtime.sensing.gateway.openai_gateway_router import _resolve_actor

        return _resolve_actor(
            request,
            identity_store,
            require_auth,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )

    def _require_thread_access(request: Request, thread_id: str) -> str | None:
        actor = _auth(request)
        if thread_store is None or not hasattr(thread_store, "get"):
            return actor
        thread = thread_store.get(thread_id)
        if thread is None:
            if actor is not None:
                raise HTTPException(404, f"thread not found: {thread_id}")
            return actor
        metadata = thread.get("metadata") or {}
        owner = metadata.get("owner_actor_id")
        if actor is not None and owner and owner != actor:
            raise HTTPException(404, f"thread not found: {thread_id}")
        return actor

    def _info(thread_id: str) -> dict[str, Any]:
        if not thread_id.strip():
            raise HTTPException(400, "thread_id is required")
        layout = manager.layout(thread_id)
        paths = layout.as_dict()
        dir_keys = ("upload", "output", "stages", "final", "deploy", "skills")
        return {
            "thread_id": thread_id,
            "root": str(layout.root),
            "paths": paths,
            "dirs": [
                {
                    "key": key,
                    "path": paths[key],
                    "exists": Path(paths[key]).is_dir(),
                }
                for key in dir_keys
            ],
            "manifest": manager.manifest(thread_id),
        }

    def _area_root(thread_id: str, area: str) -> tuple[str, Path]:
        layout = manager.layout(thread_id)
        normalized = (area or "output").strip().lower()
        roots = {
            "output": layout.output,
            "stages": layout.stages,
            "final": layout.final,
            "deploy": layout.deploy,
            "upload": layout.upload,
        }
        if normalized not in roots:
            raise HTTPException(
                400,
                "area must be one of: output, stages, final, deploy, upload",
            )
        return normalized, roots[normalized]

    def _safe_child(root: Path, rel_path: str) -> Path:
        raw = Path(rel_path)
        if raw.is_absolute() or any(part in {"", ".", ".."} for part in raw.parts):
            raise HTTPException(400, "invalid relative path")
        try:
            target = (root / raw).resolve()
            target.relative_to(root.resolve())
        except (OSError, RuntimeError, ValueError) as exc:
            raise HTTPException(400, "invalid relative path") from exc
        return target

    def _revision_dir(thread_id: str, area: str, artifact_path: str) -> Path:
        area_key, _ = _area_root(thread_id, area)
        root = _safe_child(manager.layout(thread_id).root, f".artifact-revisions/{area_key}")
        return _safe_child(root, artifact_path)

    def _revision_locations(thread_id: str, target: Path) -> list[Path]:
        # Read legacy area aliases too; new revisions use the most specific area.
        locations: list[Path] = []
        for area in ("final", "stages", "deploy", "upload", "output"):
            _, root = _area_root(thread_id, area)
            try:
                relative = target.relative_to(root.resolve())
            except ValueError:
                continue
            locations.append(_revision_dir(thread_id, area, relative.as_posix()))
        return locations

    def _find_revision(thread_id: str, target: Path, revision_id: str) -> Path:
        if not re.fullmatch(r"\d+-[0-9a-f]{12}\.bak", revision_id):
            raise HTTPException(400, "invalid revision_id")
        for directory in _revision_locations(thread_id, target):
            revision = _safe_child(directory, revision_id)
            if revision.is_file():
                return revision
        raise HTTPException(404, "output revision not found")

    def _read_revision(revision: Path) -> bytes:
        try:
            if revision.stat().st_size > 8 * 1024 * 1024:
                raise HTTPException(413, "HTML revision exceeds the 8 MB visual-edit limit")
            content = revision.read_bytes()
        except OSError as exc:
            raise HTTPException(500, "failed to read output revision") from exc
        expected = revision.name.split("-")[1].removesuffix(".bak")
        if not hmac.compare_digest(hashlib.sha256(content).hexdigest()[:12], expected):
            raise HTTPException(409, "output revision has changed; cannot restore it")
        return content

    @contextmanager
    def _output_edit_lock(thread_id: str, target: Path):
        # Area and route aliases must share one lock, including across workers.
        workspace = manager.layout(thread_id).root
        try:
            target.relative_to(workspace.resolve())
        except ValueError as exc:
            raise HTTPException(400, "output path escapes workspace") from exc
        canonical = os.path.normcase(str(target.resolve()))
        key = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        lock_target = _safe_child(workspace, f".artifact-locks/{key}")
        _safe_child(workspace, f".artifact-locks/{key}.lock")
        try:
            with _cross_process_lock(lock_target, required=True, timeout_s=5):
                yield
        except AtomicWriteError as exc:
            raise HTTPException(503, "产物正在保存或暂时无法锁定，请稍后重试。") from exc

    def _store_revision(
        thread_id: str,
        area: str,
        artifact_path: str,
        content: bytes,
    ) -> str:
        _, root = _area_root(thread_id, area)
        revision_dir = _revision_locations(thread_id, _safe_child(root, artifact_path))[0]
        revision_dir.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(content).hexdigest()
        revision_id = f"{time.time_ns()}-{digest[:12]}.bak"
        revision = _safe_child(revision_dir, revision_id)
        try:
            revision.write_bytes(content)
            os.chmod(revision, 0o600)
        except OSError as exc:
            revision.unlink(missing_ok=True)
            raise HTTPException(500, f"failed to preserve output revision: {exc}") from exc
        # Revisions are user recovery data. Do not silently evict old versions.
        return revision_id

    def _expected_digest(current: bytes, expected_sha256: str | None) -> str:
        if expected_sha256 is None:
            raise HTTPException(400, "expected_sha256 is required for visual editing")
        expected = expected_sha256.strip().lower()
        if len(expected) != 64 or any(char not in "0123456789abcdef" for char in expected):
            raise HTTPException(400, "expected_sha256 must be a 64-character hex digest")
        observed = hashlib.sha256(current).hexdigest()
        if not hmac.compare_digest(observed, expected):
            raise HTTPException(
                409,
                {
                    "error": "file_changed",
                    "message": "文件已被 Agent 或其他编辑更新，请重新加载后再保存。",
                    "observed_sha256": observed,
                },
            )
        return observed

    def _output_entries(thread_id: str, area: str, limit: int) -> dict[str, Any]:
        area_key, root = _area_root(thread_id, area)
        files: list[dict[str, Any]] = []
        if root.exists():
            for path in sorted(root.rglob("*"), key=lambda p: str(p).lower()):
                if len(files) >= limit:
                    break
                if not path.is_file():
                    continue
                rel = path.relative_to(root).as_posix()
                suffix = "" if area_key == "output" else f"?area={area_key}"
                files.append(
                    {
                        "name": path.name,
                        "area": area_key,
                        "relative_path": rel,
                        "path": str(path),
                        "size": path.stat().st_size,
                        "modified": int(path.stat().st_mtime),
                        "download_url": (f"/api/workspaces/{thread_id}/outputs/{rel}{suffix}"),
                    }
                )
        return {
            "thread_id": thread_id,
            "area": area_key,
            "files": files,
            "count": len(files),
        }

    @router.get(
        "/api/workspaces/{thread_id}",
        response_model=WorkspaceInfoResponse,
    )
    def api_workspace_info(request: Request, thread_id: str) -> dict[str, Any]:
        _require_thread_access(request, thread_id)
        return _info(thread_id)

    @router.get(
        "/api/threads/{thread_id}/workspace",
        response_model=WorkspaceInfoResponse,
    )
    def api_thread_workspace_info(request: Request, thread_id: str) -> dict[str, Any]:
        _require_thread_access(request, thread_id)
        return _info(thread_id)

    @router.get(
        "/api/workspaces/{thread_id}/outputs",
        response_model=WorkspaceOutputsResponse,
    )
    def api_workspace_outputs(
        request: Request,
        thread_id: str,
        area: str = "output",
        limit: int = Query(500, ge=1, le=2000),  # noqa: B008
    ) -> dict[str, Any]:
        _require_thread_access(request, thread_id)
        return _output_entries(thread_id, area, limit)

    @router.get(
        "/api/threads/{thread_id}/outputs",
        response_model=WorkspaceOutputsResponse,
    )
    def api_thread_workspace_outputs(
        request: Request,
        thread_id: str,
        area: str = "output",
        limit: int = Query(500, ge=1, le=2000),  # noqa: B008
    ) -> dict[str, Any]:
        _require_thread_access(request, thread_id)
        return _output_entries(thread_id, area, limit)

    @router.get("/api/workspaces/{thread_id}/outputs/{artifact_path:path}")
    def api_workspace_output_file(
        request: Request,
        thread_id: str,
        artifact_path: str,
        area: str = "output",
        download: bool = False,
        office_preview: bool = False,
        office_fidelity_preview: bool = False,
    ) -> Any:
        _require_thread_access(request, thread_id)
        _, root = _area_root(thread_id, area)
        target = _safe_child(root, artifact_path)
        if not target.is_file():
            raise HTTPException(404, f"output not found: {artifact_path}")
        if office_fidelity_preview:
            fidelity_html = render_office_fidelity_preview(target)
            if fidelity_html is not None:
                return HTMLResponse(
                    fidelity_html,
                    headers={
                        "Cache-Control": "no-store",
                        "Content-Security-Policy": (
                            "default-src 'none'; style-src 'unsafe-inline'; "
                            "img-src data:; object-src 'none'; base-uri 'none'; "
                            "form-action 'none'"
                        ),
                        "X-Echo-Office-Preview": "fidelity",
                        "X-Content-Type-Options": "nosniff",
                    },
                )
        preview_nonce = secrets.token_urlsafe(18) if office_preview else None
        preview_html = (
            render_office_preview(target, script_nonce=preview_nonce) if office_preview else None
        )
        if preview_html is not None and preview_nonce is not None:
            return HTMLResponse(
                preview_html,
                headers={
                    "Cache-Control": "no-store",
                    "Content-Security-Policy": (
                        "default-src 'none'; style-src 'unsafe-inline'; "
                        f"script-src 'nonce-{preview_nonce}'; "
                        "img-src data:; base-uri 'none'; form-action 'none'"
                    ),
                    "X-Content-Type-Options": "nosniff",
                },
            )
        return FileResponse(str(target), filename=target.name if download else None)

    @router.get("/api/threads/{thread_id}/outputs/{artifact_path:path}")
    def api_thread_workspace_output_file(
        request: Request,
        thread_id: str,
        artifact_path: str,
        area: str = "output",
        download: bool = False,
        office_preview: bool = False,
        office_fidelity_preview: bool = False,
    ) -> Any:
        return api_workspace_output_file(
            request,
            thread_id,
            artifact_path,
            area=area,
            download=download,
            office_preview=office_preview,
            office_fidelity_preview=office_fidelity_preview,
        )

    def _write_output_file(
        request: Request,
        thread_id: str,
        artifact_path: str,
        body: WorkspaceOutputWriteRequest,
        *,
        area: str,
    ) -> dict[str, Any]:
        _require_thread_access(request, thread_id)
        _, root = _area_root(thread_id, area)
        target = _safe_child(root, artifact_path)
        if not target.is_file():
            raise HTTPException(404, f"output not found: {artifact_path}")
        if target.suffix.lower() not in {".html", ".htm"}:
            raise HTTPException(415, "visual editing currently supports HTML outputs only")
        payload = body.content.encode("utf-8")
        if len(payload) > 8 * 1024 * 1024:
            raise HTTPException(413, "HTML output exceeds the 8 MB visual-edit limit")
        with _output_edit_lock(thread_id, target):
            if _safe_child(root, artifact_path) != target:
                raise HTTPException(409, "output path changed; reload before editing")
            try:
                current = target.read_bytes()
            except OSError as exc:
                raise HTTPException(500, f"failed to read output: {exc}") from exc
            _expected_digest(current, body.expected_sha256)
            revision_id = _store_revision(thread_id, area, artifact_path, current)
            temporary = target.with_name(f".{target.name}.{secrets.token_hex(8)}.tmp")
            try:
                temporary.write_bytes(payload)
                os.chmod(temporary, target.stat().st_mode)
                os.replace(temporary, target)
            except OSError as exc:
                raise HTTPException(500, f"failed to write output: {exc}") from exc
            finally:
                temporary.unlink(missing_ok=True)
        return {
            "success": True,
            "path": str(target),
            "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "revision_id": revision_id,
        }

    def _restore_output_file(
        request: Request,
        thread_id: str,
        artifact_path: str,
        body: WorkspaceOutputRestoreRequest,
        *,
        area: str,
    ) -> dict[str, Any]:
        _require_thread_access(request, thread_id)
        _, root = _area_root(thread_id, area)
        target = _safe_child(root, artifact_path)
        if not target.is_file():
            raise HTTPException(404, f"output not found: {artifact_path}")
        if target.suffix.lower() not in {".html", ".htm"}:
            raise HTTPException(415, "visual editing currently supports HTML outputs only")
        if not re.fullmatch(r"\d+-[0-9a-f]{12}\.bak", body.revision_id):
            raise HTTPException(400, "invalid revision_id")
        with _output_edit_lock(thread_id, target):
            if _safe_child(root, artifact_path) != target:
                raise HTTPException(409, "output path changed; reload before editing")
            revision = _find_revision(thread_id, target, body.revision_id)
            try:
                current = target.read_bytes()
                restored = _read_revision(revision)
            except OSError as exc:
                raise HTTPException(500, f"failed to read output revision: {exc}") from exc
            _expected_digest(current, body.expected_sha256)
            redo_revision_id = _store_revision(thread_id, area, artifact_path, current)
            temporary = target.with_name(f".{target.name}.{secrets.token_hex(8)}.tmp")
            try:
                temporary.write_bytes(restored)
                os.chmod(temporary, target.stat().st_mode)
                os.replace(temporary, target)
            except OSError as exc:
                raise HTTPException(500, f"failed to restore output: {exc}") from exc
            finally:
                temporary.unlink(missing_ok=True)
        return {
            "success": True,
            "path": str(target),
            "bytes": len(restored),
            "sha256": hashlib.sha256(restored).hexdigest(),
            "revision_id": redo_revision_id,
        }

    @router.put(
        "/api/workspaces/{thread_id}/outputs/{artifact_path:path}",
        response_model=WorkspaceOutputWriteResponse,
    )
    def api_write_workspace_output_file(
        request: Request,
        thread_id: str,
        artifact_path: str,
        body: WorkspaceOutputWriteRequest,
        area: str = "output",
    ) -> dict[str, Any]:
        return _write_output_file(request, thread_id, artifact_path, body, area=area)

    @router.put(
        "/api/threads/{thread_id}/outputs/{artifact_path:path}",
        response_model=WorkspaceOutputWriteResponse,
    )
    def api_write_thread_workspace_output_file(
        request: Request,
        thread_id: str,
        artifact_path: str,
        body: WorkspaceOutputWriteRequest,
        area: str = "output",
    ) -> dict[str, Any]:
        return _write_output_file(request, thread_id, artifact_path, body, area=area)

    @router.post(
        "/api/threads/{thread_id}/output-revisions/{artifact_path:path}",
        response_model=WorkspaceOutputWriteResponse,
    )
    def api_restore_thread_workspace_output_file(
        request: Request,
        thread_id: str,
        artifact_path: str,
        body: WorkspaceOutputRestoreRequest,
        area: str = "output",
    ) -> dict[str, Any]:
        return _restore_output_file(request, thread_id, artifact_path, body, area=area)

    @router.get("/api/threads/{thread_id}/output-revisions/{artifact_path:path}")
    def api_output_revisions(
        request: Request,
        thread_id: str,
        artifact_path: str,
        area: str = "output",
        revision_id: str | None = None,
        before: str | None = None,
        limit: int = Query(50, ge=1, le=100),
    ) -> dict[str, Any]:
        _require_thread_access(request, thread_id)
        _, root = _area_root(thread_id, area)
        target = _safe_child(root, artifact_path)
        if not target.is_file():
            raise HTTPException(404, "output not found")
        if target.suffix.lower() not in {".html", ".htm"}:
            raise HTTPException(415, "revision history currently supports HTML outputs only")
        if before is not None and not re.fullmatch(r"\d+-[0-9a-f]{12}\.bak", before):
            raise HTTPException(400, "invalid revision cursor")
        with _output_edit_lock(thread_id, target):
            if _safe_child(root, artifact_path) != target:
                raise HTTPException(409, "output path changed; reload before editing")
            if revision_id is not None:
                content = _read_revision(_find_revision(thread_id, target, revision_id))
                try:
                    text = content.decode("utf-8")
                except UnicodeDecodeError as exc:
                    raise HTTPException(415, "revision is not UTF-8 HTML") from exc
                return {
                    "revision_id": revision_id,
                    "content": text,
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
            revisions: dict[str, Path] = {}
            for directory in _revision_locations(thread_id, target):
                if not directory.exists():
                    continue
                for entry in directory.iterdir():
                    if re.fullmatch(r"\d+-[0-9a-f]{12}\.bak", entry.name):
                        safe_entry = _safe_child(directory, entry.name)
                        if safe_entry.is_file() and (before is None or entry.name < before):
                            revisions.setdefault(entry.name, safe_entry)
            ordered = sorted(revisions, reverse=True)
            items = [
                {
                    "revision_id": key,
                    "created_at": int(key.split("-")[0]) / 1_000_000_000,
                    "bytes": revisions[key].stat().st_size,
                }
                for key in ordered[:limit]
            ]
            return {
                "revisions": items,
                "next_cursor": ordered[limit - 1] if len(ordered) > limit else None,
            }

    @contextmanager
    def _proposals(request: Request, thread_id: str, artifact_path: str, area: str):
        from runtime.sensing.gateway.artifact_proposals import ArtifactProposals

        _require_thread_access(request, thread_id)
        _, root = _area_root(thread_id, area)
        target = _safe_child(root, artifact_path)
        if not target.is_file():
            raise HTTPException(404, "output not found")
        if target.suffix.lower() not in {".html", ".htm"}:
            raise HTTPException(415, "edit proposals currently support HTML outputs only")
        try:
            with _output_edit_lock(thread_id, target):
                if _safe_child(root, artifact_path) != target:
                    raise HTTPException(409, "output path changed; reload before editing")
                yield ArtifactProposals(manager.layout(thread_id).root, target)
        except OSError as exc:
            raise HTTPException(503, "产物修改暂时无法读写，请重试。") from exc

    @router.get("/api/threads/{thread_id}/output-proposals/{artifact_path:path}")
    def api_output_proposals(
        request: Request,
        thread_id: str,
        artifact_path: str,
        area: str = "output",
        proposal_id: str | None = None,
    ) -> dict[str, Any]:
        with _proposals(request, thread_id, artifact_path, area) as proposals:
            return proposals.read(proposal_id) if proposal_id else {"proposals": proposals.list()}

    @router.post("/api/threads/{thread_id}/output-proposals/{artifact_path:path}")
    def api_decide_output_proposal(
        request: Request,
        thread_id: str,
        artifact_path: str,
        body: WorkspaceOutputProposalRequest,
        area: str = "output",
    ) -> dict[str, Any]:
        with _proposals(request, thread_id, artifact_path, area) as proposals:
            if body.action == "create":
                expected = _expected_digest(proposals.target.read_bytes(), body.expected_sha256)
                return proposals.create(expected)
            if not body.proposal_id:
                raise HTTPException(400, "proposal_id is required")
            result = proposals.decide(
                body.proposal_id,
                body.action,
                body.reviewed_sha256,
                lambda content: _store_revision(thread_id, area, artifact_path, content),
            )
            return {
                **result,
                "current_sha256": hashlib.sha256(proposals.target.read_bytes()).hexdigest(),
            }

    return router


__all__ = ["create_workspaces_router"]
