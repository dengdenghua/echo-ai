from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from runtime.platform.io import AtomicWriteError
from runtime.platform.personal_app_data import (
    MAX_DATA_BYTES,
    AppDataConflict,
    AppDataUnavailable,
    PersonalAppData,
)
from runtime.platform.runtime_policy.deployments import (
    deployment_dir,
    deployment_entries,
    deployment_visible,
    find_deployment,
    public_deployment,
)
from runtime.sensing.gateway._untrusted_content import untrusted_file_response


def _resolve_file(deployment_id: str, file_path: str) -> Path:
    root = deployment_dir(deployment_id)
    if root is None:
        raise HTTPException(404, "deployment not found")
    target = (root / (file_path or "index.html")).resolve()
    if root != target and root not in target.parents:
        raise HTTPException(404, "not found")
    if not target.is_file():
        raise HTTPException(404, "file not found")
    return target


def _serve(deployment_id: str, file_path: str) -> FileResponse:
    # Deployed sites are agent-built web apps served from the API origin. They
    # legitimately need JavaScript, so the CSP sandbox allows scripts but never
    # ``allow-same-origin``: the site runs in an opaque origin and cannot read
    # the app's token storage or call its APIs as the signed-in user.
    return untrusted_file_response(
        str(_resolve_file(deployment_id, file_path)),
        allow_scripts=True,
    )


def create_deployments_router(
    *,
    identity_store: Any = None,
    require_auth: bool = False,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
) -> APIRouter:
    router = APIRouter(tags=["deployments"])

    def _principal(request: Request) -> Any:
        if require_auth and identity_store is None:
            raise HTTPException(401, "auth required")
        from runtime.safety.auth.principal import resolve_principal

        return resolve_principal(
            request,
            identity_store,
            require_auth,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )

    def _visible(principal: Any, entry: dict[str, Any] | None) -> bool:
        if entry is None:
            return False
        return deployment_visible(
            entry,
            actor_id=getattr(principal, "actor_id", None),
            tenant_id=getattr(principal, "tenant_id", None),
            roles=getattr(principal, "roles", frozenset()),
        )

    def _require_visible(request: Request, deployment_id: str) -> dict[str, Any]:
        # A deployment the caller does not own is indistinguishable from a
        # missing one: the same 404 for both, so ids cannot be probed.
        entry = find_deployment(deployment_id)
        if not _visible(_principal(request), entry):
            raise HTTPException(404, "deployment not found")
        assert entry is not None
        return entry

    def _app_data(request: Request, deployment_id: str) -> PersonalAppData:
        entry = _require_visible(request, deployment_id)
        manifest = entry.get("app") or {}
        if manifest.get("schema") != "echo.app.v1":
            raise HTTPException(404, "app not found")
        if "app.storage" not in manifest.get("permissions", []):
            raise HTTPException(403, "app.storage permission required")
        return PersonalAppData(entry)

    @router.get("/api/personal-apps")
    def list_personal_apps(request: Request) -> dict[str, Any]:
        principal = _principal(request)
        return {
            "apps": [
                public_deployment(entry)
                for entry in deployment_entries()
                if (entry.get("app") or {}).get("schema") == "echo.app.v1"
                and _visible(principal, entry)
            ]
        }

    @router.get("/api/personal-apps/{deployment_id}/data/{key}")
    def read_app_data(request: Request, deployment_id: str, key: str) -> dict[str, Any]:
        store = _app_data(request, deployment_id)
        try:
            return store.read(key)
        except AppDataUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @router.put("/api/personal-apps/{deployment_id}/data/{key}")
    async def write_app_data(request: Request, deployment_id: str, key: str) -> dict[str, Any]:
        store = await run_in_threadpool(_app_data, request, deployment_id)
        # Non-simple authenticated request: sandboxed pages never call this
        # directly. The trusted parent attaches this header and the session.
        if request.headers.get("X-Echo-App-Bridge") != "1":
            raise HTTPException(403, "host app bridge required")
        chunks: list[bytes] = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_DATA_BYTES:
                raise HTTPException(413, "app data request exceeds 1 MiB limit")
            chunks.append(chunk)
        try:
            payload = json.loads(b"".join(chunks))
            if not isinstance(payload, dict):
                raise ValueError("expected a JSON object")
            revision = payload.get("expected_revision")
            if type(revision) is not int or revision < 0:
                raise ValueError("expected_revision must be a non-negative integer")
            delete = payload.get("delete", False)
            if type(delete) is not bool:
                raise ValueError("delete must be a boolean")
            return await run_in_threadpool(
                store.write, key, payload.get("value"), expected_revision=revision, delete=delete
            )
        except AppDataConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except AppDataUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc
        except (AtomicWriteError, OSError) as exc:
            raise HTTPException(503, "app data storage unavailable") from exc
        except (ValueError, UnicodeError) as exc:
            raise HTTPException(400, str(exc)) from exc

    @router.get("/api/deployments")
    def list_deployments(request: Request) -> dict[str, Any]:
        principal = _principal(request)
        return {
            "deployments": [
                public_deployment(entry)
                for entry in deployment_entries()
                if _visible(principal, entry)
            ]
        }

    @router.get("/api/deployments/{deployment_id}")
    def deployment_index(request: Request, deployment_id: str) -> FileResponse:
        _require_visible(request, deployment_id)
        return _serve(deployment_id, "index.html")

    @router.get("/api/deployments/{deployment_id}/{file_path:path}")
    def deployment_file(
        request: Request,
        deployment_id: str,
        file_path: str,
    ) -> FileResponse:
        _require_visible(request, deployment_id)
        return _serve(deployment_id, file_path)

    return router


__all__ = ["create_deployments_router"]
