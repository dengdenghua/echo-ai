"""Thread state HTTP router used by the realtime UI."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    from fastapi import APIRouter, HTTPException, Query, Request
    from fastapi.responses import Response

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover
    FASTAPI_AVAILABLE = False
    APIRouter = None  # type: ignore[assignment, misc]
    HTTPException = None  # type: ignore[assignment, misc]
    Query = None  # type: ignore[assignment, misc]
    Request = None  # type: ignore[assignment, misc]
    Response = None  # type: ignore[assignment, misc]

from runtime.sensing._fastapi_guard import require_fastapi

from ._thread_state_auto_title import build_auto_title_service
from ._thread_state_deps import ThreadStateDeps, build_thread_state_deps
from ._thread_state_endpoints import (
    _register_create_and_search,
    _register_export_and_feedback,
    _register_thread_mutations,
    _register_thread_reads,
)

_logger = logging.getLogger(__name__)
_PUBLIC_NO_STORE_HEADERS = {
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "Expires": "0",
}


def _positive_env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, str(default))))
    except (TypeError, ValueError):
        return default


def _canonical_public_share_url(token: str) -> str | None:
    base = str(os.environ.get("ECHO_PUBLIC_SHARE_BASE_URL") or "").strip().rstrip("/")
    if not base:
        return None
    parsed = urlparse(base)
    is_loopback_http = parsed.scheme == "http" and parsed.hostname in {
        "127.0.0.1",
        "localhost",
        "::1",
    }
    if (parsed.scheme != "https" and not is_loopback_http) or not parsed.netloc:
        _logger.warning("ignored invalid ECHO_PUBLIC_SHARE_BASE_URL")
        return None
    if parsed.query or parsed.fragment or parsed.username or parsed.password:
        _logger.warning("ignored unsafe ECHO_PUBLIC_SHARE_BASE_URL")
        return None
    return f"{base}/#/share/{token}"


def create_thread_state_router(
    *,
    store: Any,
    logs_root: Path | str | None = None,
    session_titles: Any = None,
    identity_store: Any = None,
    require_auth: bool = False,
    allow_local_workspace_access: bool = False,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
    workspace_root: Path | str | None = None,
    group_store: Any = None,
    collaboration_store: Any = None,
    team_rooms_router: Any = None,
    project_store: Any = None,
    workspace_store: Any = None,
    lease_store: Any = None,
) -> Any:
    require_fastapi(__name__)
    managed_workspace_required = require_auth and not allow_local_workspace_access

    router = APIRouter(tags=["threads"])

    from .thread_access import ThreadAccessResolver

    access_resolver = ThreadAccessResolver(
        thread_store=store,
        group_store=group_store,
        collaboration_store=collaboration_store,
        team_rooms_router=team_rooms_router,
        identity_store=identity_store,
    )
    share_store = None
    if logs_root is not None:
        from .thread_share_store import ThreadShareStore

        share_store = ThreadShareStore(
            Path(logs_root).parent / "thread-shares",
            ttl_seconds=_positive_env_int("ECHO_THREAD_SHARE_TTL_SECONDS", 30 * 86400),
            max_active_per_owner=_positive_env_int("ECHO_THREAD_SHARE_MAX_ACTIVE_PER_OWNER", 100),
            max_snapshot_bytes=_positive_env_int("ECHO_THREAD_SHARE_MAX_SNAPSHOT_BYTES", 1_200_000),
        )
    from .thread_share_relay import ThreadShareRelayClient

    # Optional managed-cloud relay. Explicit misconfiguration fails startup so
    # the UI never mints a link that looks public while the snapshot stayed local.
    share_relay = ThreadShareRelayClient.from_env()

    d = build_thread_state_deps(
        store=store,
        logs_root=logs_root,
        session_titles=session_titles,
        identity_store=identity_store,
        require_auth=require_auth,
        managed_workspace_required=managed_workspace_required,
        jwt_secret=jwt_secret,
        jwt_issuer=jwt_issuer,
        jwt_audience=jwt_audience,
        workspace_root=workspace_root,
        group_store=group_store,
        project_store=project_store,
        access_resolver=access_resolver,
        share_store=share_store,
        share_relay=share_relay,
    )

    # Registration order is FastAPI's path-matching priority — keep it.
    _register_create_and_search(router, d)
    _register_export_and_feedback(router, d)
    _register_thread_reads(router, d)
    _register_owner_shares(router, d)
    _register_public_shares(router, d)
    _register_shared_spaces(router, d, workspace_store=workspace_store, lease_store=lease_store)
    _register_thread_mutations(router, d)

    return router


def _register_owner_shares(router: APIRouter, d: ThreadStateDeps) -> None:
    """Owner-side share creation (local store or managed relay) and listing."""
    store = d.store
    _auth = d.auth
    _tenant = d.tenant
    _require_store = d.require_store
    share_store = d.share_store
    share_relay = d.share_relay
    _require_thread_id = d.require_thread_id
    _get_owned_thread = d.get_owned_thread
    _is_archived = d.is_archived

    @router.post("/api/threads/{thread_id}/shares", status_code=201)
    def create_thread_share(
        request: Request,
        thread_id: str,
    ) -> dict[str, Any]:
        """Capture a sanitised, immutable public snapshot of one thread."""
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        if share_store is None:
            raise HTTPException(503, "thread sharing unavailable")
        thread = _get_owned_thread(thread_id, actor_id, tenant_id)
        if thread is None or _is_archived(thread_id):
            raise HTTPException(404, f"thread not found: {thread_id}")
        state = store.get_state(thread_id)
        if not isinstance(state, dict):
            raise HTTPException(404, f"thread not found: {thread_id}")
        from .thread_share_store import build_public_thread_snapshot

        try:
            snapshot = build_public_thread_snapshot(thread, state)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        if share_relay is not None:
            from .thread_share_relay import ThreadShareRelayError

            try:
                return share_relay.create(
                    source_thread_id=thread_id,
                    snapshot=snapshot,
                    actor_id=actor_id or "",
                    tenant_id=tenant_id or "",
                )
            except ThreadShareRelayError as exc:
                raise HTTPException(502, str(exc)) from exc
        try:
            record = share_store.create(
                thread_id=thread_id,
                actor_id=actor_id or "",
                tenant_id=tenant_id or "",
                snapshot=snapshot,
            )
        except ValueError as exc:
            raise HTTPException(413, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(429, str(exc)) from exc
        token = str(record["token"])
        response = {
            "token": token,
            "share_id": record["share_id"],
            # Hash-only paths preserve either the Vite root shell or /ui/.
            "share_path": f"#/share/{token}",
            "created_at": record["created_at"],
            "expires_at": record["expires_at"],
        }
        share_url = _canonical_public_share_url(token)
        if share_url:
            response["share_url"] = share_url
        return response

    @router.get("/api/threads/{thread_id}/shares")
    def list_thread_shares(request: Request, thread_id: str) -> dict[str, Any]:
        """List owner-manageable share metadata without returning capabilities."""
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        if share_store is None:
            raise HTTPException(503, "thread sharing unavailable")
        if _get_owned_thread(thread_id, actor_id, tenant_id) is None or _is_archived(thread_id):
            raise HTTPException(404, f"thread not found: {thread_id}")
        if share_relay is not None:
            from .thread_share_relay import ThreadShareRelayError

            try:
                return {
                    "shares": share_relay.list_for_thread(
                        source_thread_id=thread_id,
                        actor_id=actor_id or "",
                        tenant_id=tenant_id or "",
                    )
                }
            except ThreadShareRelayError as exc:
                raise HTTPException(502, str(exc)) from exc
        return {
            "shares": share_store.list_for_thread(
                thread_id=thread_id,
                actor_id=actor_id or "",
                tenant_id=tenant_id or "",
            )
        }


def _register_public_shares(router: APIRouter, d: ThreadStateDeps) -> None:
    """Anonymous share resolution plus owner revocation by id or token."""
    _auth = d.auth
    _tenant = d.tenant
    share_store = d.share_store
    share_relay = d.share_relay

    @router.post("/api/public/thread-shares/resolve")
    def resolve_public_thread_share(body: dict[str, Any], response: Response) -> dict[str, Any]:
        """Resolve a capability from the request body so it never enters access logs."""
        if share_store is None:
            raise HTTPException(
                503,
                "thread sharing unavailable",
                headers=_PUBLIC_NO_STORE_HEADERS,
            )
        token = str(body.get("token") or "").strip()
        record = share_store.get(token)
        if record is None:
            raise HTTPException(
                404,
                "shared task not found, expired, or revoked",
                headers=_PUBLIC_NO_STORE_HEADERS,
            )
        response.headers.update(_PUBLIC_NO_STORE_HEADERS)
        return share_store.public_record(record)

    @router.get("/api/public/thread-shares/{token}")
    def get_public_thread_share(token: str, response: Response) -> dict[str, Any]:
        """Legacy anonymous read; new clients use the body-based resolve route."""
        if share_store is None:
            raise HTTPException(
                503,
                "thread sharing unavailable",
                headers=_PUBLIC_NO_STORE_HEADERS,
            )
        record = share_store.get(token)
        if record is None:
            raise HTTPException(
                404,
                "shared task not found or revoked",
                headers=_PUBLIC_NO_STORE_HEADERS,
            )
        response.headers.update(_PUBLIC_NO_STORE_HEADERS)
        response.headers["Deprecation"] = "true"
        return share_store.public_record(record)

    @router.delete(
        "/api/thread-shares/by-id/{share_id}",
        status_code=204,
        response_class=Response,
        response_model=None,
    )
    def revoke_thread_share_by_id(request: Request, share_id: str) -> Response:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        if share_store is None:
            raise HTTPException(503, "thread sharing unavailable")
        if share_relay is not None:
            from .thread_share_relay import ThreadShareRelayError

            try:
                share_relay.revoke(
                    share_id,
                    actor_id=actor_id or "",
                    tenant_id=tenant_id or "",
                )
            except ThreadShareRelayError as exc:
                raise HTTPException(502, str(exc)) from exc
            return Response(status_code=204)
        if not share_store.revoke_by_id(
            share_id,
            actor_id=actor_id or "",
            tenant_id=tenant_id or "",
        ):
            raise HTTPException(404, "shared task not found")
        return Response(status_code=204)

    @router.delete(
        "/api/thread-shares/{token}",
        status_code=204,
        response_class=Response,
        response_model=None,
    )
    def revoke_thread_share(request: Request, token: str) -> Response:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        if share_store is None:
            raise HTTPException(503, "thread sharing unavailable")
        if not share_store.revoke(
            token,
            actor_id=actor_id or "",
            tenant_id=tenant_id or "",
        ):
            raise HTTPException(404, "shared task not found")
        return Response(status_code=204)


def _register_shared_spaces(
    router: APIRouter,
    d: ThreadStateDeps,
    *,
    workspace_store: Any,
    lease_store: Any,
) -> None:
    """Mount the owner-authorized shared-spaces sub-router."""
    store = d.store
    managed_workspace_required = d.managed_workspace_required
    workspace_root = d.workspace_root
    _auth = d.auth
    _tenant = d.tenant
    _require_store = d.require_store
    _require_thread_id = d.require_thread_id
    _get_owned_thread = d.get_owned_thread
    _is_archived = d.is_archived

    def _authorize_shared_spaces(request: Request, thread_id: str) -> dict[str, Any]:
        actor_id = _auth(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        thread = _get_owned_thread(thread_id, actor_id, _tenant(request))
        if thread is None or _is_archived(thread_id):
            raise HTTPException(404, "thread not found")
        return thread

    from .thread_shared_spaces import shared_spaces_router

    router.include_router(
        shared_spaces_router(
            store=store,
            authorize=_authorize_shared_spaces,
            managed=managed_workspace_required,
            workspace_root=workspace_root,
            workspace_store=workspace_store,
            lease_store=lease_store,
        )
    )


__all__ = ["build_auto_title_service", "create_thread_state_router"]
