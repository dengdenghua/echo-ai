"""
Thread uploads / artifacts router.

Extracted from ``runtime/platform/ui/app.py`` as part of the
app.py-split campaign. Owns the 4 endpoints the UI's message
composer + artifact viewer use:

    POST   /api/threads/{tid}/uploads                     · multipart upload
    GET    /api/threads/{tid}/uploads/list                · list stored files
    DELETE /api/threads/{tid}/uploads/{filename}          · remove one
    GET    /api/threads/{tid}/artifacts/{artifact:path}   · serve content

The router accepts a ``thread_store`` + ``upload_root`` at
construction. Both can be ``None`` · in that case every endpoint
returns 503 rather than AttributeError, matching the pre-split
"demo app without a full stack still boots" contract.

Filename sanitization
---------------------

Uploaded filenames are reduced to their basename before being
joined to the thread's upload dir · otherwise a client could
send ``../../etc/passwd`` and land a file outside their sandbox.
Covered by ``test_filename_path_traversal_stripped``.
"""

from __future__ import annotations

import asyncio
import secrets
import tempfile
from pathlib import Path
from typing import Any

try:
    from fastapi import APIRouter, File, HTTPException, Request, UploadFile
    from fastapi.responses import HTMLResponse
    from pydantic import BaseModel

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover
    FASTAPI_AVAILABLE = False
    APIRouter = None  # type: ignore[assignment, misc]
    File = None  # type: ignore[assignment, misc]
    HTTPException = None  # type: ignore[assignment, misc]
    Request = None  # type: ignore[assignment, misc]
    UploadFile = None  # type: ignore[assignment, misc]
    HTMLResponse = None  # type: ignore[assignment, misc]
    BaseModel = object  # type: ignore[assignment, misc]

from runtime.execution.misc.document_text_extractor import extract_text_from_upload
from runtime.execution.misc.office_fidelity_preview import render_office_fidelity_preview
from runtime.execution.misc.office_preview import render_office_preview
from runtime.sensing._fastapi_guard import require_fastapi
from runtime.sensing.gateway._untrusted_content import untrusted_file_response

MAX_UPLOAD_FILES = 20
MAX_UPLOAD_FILE_BYTES = 50 * 1024 * 1024
_UPLOAD_READ_CHUNK_BYTES = 1024 * 1024

# ═══════════════════════════════════════════════════════════
# Response models
# ═══════════════════════════════════════════════════════════


if FASTAPI_AVAILABLE:

    class UploadFileMetadata(BaseModel):
        filename: str
        size: int
        path: str
        virtual_path: str
        artifact_url: str
        extension: str | None = None
        modified: int
        extracted_text: str | None = None

    class UploadPostResponse(BaseModel):
        success: bool
        files: list[UploadFileMetadata]
        message: str

    class UploadsListResponse(BaseModel):
        files: list[UploadFileMetadata]
        count: int

    class UploadDeleteResponse(BaseModel):
        success: bool
        message: str


# ═══════════════════════════════════════════════════════════
# Factory
# ═══════════════════════════════════════════════════════════


def create_uploads_router(
    *,
    thread_store: Any,
    workspace_root: Path | None = None,
    legacy_upload_root: Path | None = None,
    upload_root: Path | None = None,
    identity_store: Any = None,
    require_auth: bool = False,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
) -> Any:
    """Build the FastAPI router.

    Parameters
    ----------
    thread_store :
        ThreadStateStore (for ``ensure_thread``). When ``None``,
        all endpoints return 503 — lets minimal demo apps boot
        without a full stack.
    upload_root :
        Directory under which ``<thread_id>/`` subdirs hold
        uploads. Defaults to ``app_paths().data_dir/thread_uploads`` when
        ``None``. The factory
        captures this value · passing a different path later
        requires a fresh router.
    """
    require_fastapi(__name__)

    router = APIRouter(tags=["uploads"])
    from ._upload_storage import UploadStorage

    storage = UploadStorage(workspace_root, legacy_upload_root or upload_root)

    async def _read_upload_limited(upload: UploadFile) -> bytes:
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = await upload.read(_UPLOAD_READ_CHUNK_BYTES)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_UPLOAD_FILE_BYTES:
                raise HTTPException(413, "upload file too large")
            chunks.append(chunk)
        return b"".join(chunks)

    def _require_store() -> None:
        if thread_store is None:
            raise HTTPException(503, "thread uploads unavailable")

    def _auth(request: Request) -> str | None:
        if require_auth and identity_store is None:
            raise HTTPException(401, "auth required")
        from runtime.safety.auth.principal import resolve_principal

        principal = resolve_principal(
            request,
            identity_store,
            require_auth,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )
        if principal is not None:
            request.state.upload_principal = principal
        return principal.actor_id if principal is not None else None

    def _tenant(request: Request) -> str | None:
        principal = getattr(getattr(request, "state", None), "upload_principal", None)
        return getattr(principal, "tenant_id", None)

    def _require_thread_access(
        request: Request,
        thread_id: str,
        *,
        allow_create: bool = False,
    ) -> str | None:
        actor = _auth(request)
        tenant = _tenant(request)
        if thread_store is None or not hasattr(thread_store, "get"):
            return actor
        thread = thread_store.get(thread_id)
        if thread is None:
            if allow_create and hasattr(thread_store, "ensure_thread"):
                metadata = (
                    {"owner_actor_id": actor, "tenant_id": tenant or ""}
                    if actor is not None
                    else None
                )
                thread_store.ensure_thread(thread_id, metadata=metadata)
                return actor
            if actor is not None:
                raise HTTPException(404, f"thread not found: {thread_id}")
            return actor
        metadata = thread.get("metadata") if isinstance(thread.get("metadata"), dict) else {}
        owner = metadata.get("owner_actor_id") or metadata.get("actor_id")
        if actor is not None:
            # Legacy threads without an owner cannot be safely attributed to
            # a tenant.  Do not let the first authenticated caller claim or
            # read them; they need an explicit migration/admin path.
            stored_tenant = str(metadata.get("tenant_id") or "").strip()
            if tenant and not tenant.startswith("legacy:") and stored_tenant != tenant:
                raise HTTPException(404, f"thread not found: {thread_id}")
            if tenant and stored_tenant and stored_tenant != tenant:
                raise HTTPException(404, f"thread not found: {thread_id}")
            if not owner or owner != actor:
                raise HTTPException(404, f"thread not found: {thread_id}")
        return actor

    @router.post(
        "/api/threads/{thread_id}/uploads",
        response_model=UploadPostResponse,
    )
    async def api_thread_uploads(
        request: Request,
        thread_id: str,
        files: list[UploadFile] = File(...),  # noqa: B008 — FastAPI dependency pattern
    ) -> dict[str, Any]:
        _require_store()
        _require_thread_access(request, thread_id, allow_create=True)
        upload_dir = storage._upload_dir(thread_id)
        if not files or len(files) > MAX_UPLOAD_FILES:
            raise HTTPException(413, f"upload file count must be 1-{MAX_UPLOAD_FILES}")
        uploaded: list[dict[str, Any]] = []
        for upload in files:
            # Sanitize: strip any path traversal segments. Relying
            # on Path(...).name gives us the basename only · a
            # malicious "../../evil" collapses to "evil".
            safe_name = storage._safe_upload_filename(upload.filename)
            data = await _read_upload_limited(upload)
            # mkdir is exclusive, so concurrent same-name uploads cannot
            # overwrite each other or a previously returned artifact URL.
            instance_dir = Path(tempfile.mkdtemp(prefix="upload-", dir=upload_dir))
            target = instance_dir / safe_name
            await asyncio.to_thread(storage._write_upload_bytes, target, data)
            ext = target.suffix.lstrip(".") or None
            # OOXML/PDF parsing is CPU/file-format work. Keep it off FastAPI's
            # event loop so one large deck does not stall realtime traffic.
            extracted = await asyncio.to_thread(extract_text_from_upload, data, ext)
            uploaded.append(storage._metadata(thread_id, target, extracted_text=extracted))
        return {
            "success": True,
            "files": uploaded,
            "message": f"Uploaded {len(uploaded)} file(s)",
        }

    @router.get(
        "/api/threads/{thread_id}/uploads/list",
        response_model=UploadsListResponse,
    )
    def api_thread_uploads_list(request: Request, thread_id: str) -> dict[str, Any]:
        _require_store()
        _require_thread_access(request, thread_id)
        files: list[dict[str, Any]] = []
        seen: set[str] = set()
        for upload_dir in storage._upload_dirs_for_read(thread_id):
            if not upload_dir.exists() or not upload_dir.is_dir():
                continue
            for path in storage._stored_files(upload_dir):
                reference = path.relative_to(upload_dir).as_posix()
                if reference in seen:
                    continue
                seen.add(reference)
                files.append(storage._metadata(thread_id, path))
        return {"files": files, "count": len(files)}

    @router.delete(
        "/api/threads/{thread_id}/uploads/{filename:path}",
        response_model=UploadDeleteResponse,
    )
    def api_thread_uploads_delete(
        request: Request,
        thread_id: str,
        filename: str,
    ) -> dict[str, Any]:
        _require_store()
        _require_thread_access(request, thread_id)
        target = storage._find_upload(thread_id, filename)
        if target is None:
            raise HTTPException(404, f"upload not found: {filename}")
        try:
            target.unlink()
        except OSError as exc:
            raise HTTPException(
                500,
                f"failed to delete upload: {exc}",
            ) from exc
        return {"success": True, "message": f"Deleted {target.name}"}

    @router.get(
        "/api/threads/{thread_id}/artifacts/{artifact_path:path}",
        # response_model omitted · FileResponse doesn't play with
        # pydantic response models · skip the type mismatch.
    )
    def api_thread_artifact(
        request: Request,
        thread_id: str,
        artifact_path: str,
        download: bool = False,
        office_preview: bool = False,
        office_fidelity_preview: bool = False,
    ) -> Any:
        _require_store()
        _require_thread_access(request, thread_id)
        target = storage._find_upload(thread_id, artifact_path)
        if target is None:
            raise HTTPException(
                404,
                f"artifact not found: {artifact_path}",
            )
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
        # Uploads/artifacts are user- or agent-authored and served from the
        # API origin: sandbox them so HTML/SVG cannot run as the app.
        # HTML previews keep script (opaque origin) for interactive reports.
        return untrusted_file_response(
            str(target),
            filename=target.name if download else None,
            download=download,
            allow_scripts=True,
        )

    return router


__all__ = ["create_uploads_router"]
