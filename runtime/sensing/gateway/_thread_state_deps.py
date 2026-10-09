"""Shared state and access helpers for the thread-state router.

Pure structural split of ``thread_state_router.create_thread_state_router`` —
no logic changes. ``build_thread_state_deps`` builds, once per router, the
auth / ACL / workspace closures the factory used to keep in its own scope and
returns them as one ``ThreadStateDeps`` bundle for the ``_register_*`` groups.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from fastapi import HTTPException

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover
    FASTAPI_AVAILABLE = False
    HTTPException = None  # type: ignore[assignment, misc]
from .thread_workspace import (
    _create_workspace_directory,
    _remove_workspace_directory_if_unchanged,
    managed_workspace_metadata,
    verified_managed_workspace,
)

# Keep the original logger name so log routing and filters are unchanged.
_logger = logging.getLogger("runtime.sensing.gateway.thread_state_router")


@dataclass(frozen=True)
class ThreadStateDeps:
    """Per-router stores, flags, and closures shared by the endpoint groups."""

    store: Any
    logs_root: Path | str | None
    require_auth: bool
    managed_workspace_required: bool
    workspace_root: Path | str | None
    group_store: Any
    share_store: Any
    share_relay: Any
    auth: Callable[[Any], str | None]
    tenant: Callable[[Any], str | None]
    require_store: Callable[[], None]
    project_store_for_delete: Callable[[], Any]
    assign_managed_workspace: Callable[..., dict[str, Any]]
    title_service: Callable[[], Any]
    require_thread_id: Callable[[str], str]
    can_manage: Callable[..., bool]
    can_read: Callable[..., bool]
    visible_thread: Callable[[str], dict[str, Any] | None]
    get_owned_thread: Callable[..., dict[str, Any] | None]
    get_accessible_thread: Callable[..., dict[str, Any] | None]
    is_archived: Callable[[str], bool]


def _make_assign_managed_workspace(
    *, store: Any, workspace_root: Path | str | None
) -> Callable[..., dict[str, Any]]:
    def _assign_managed_workspace(
        thread: dict[str, Any],
        *,
        actor_id: str,
        tenant_id: str,
    ) -> dict[str, Any]:
        """Allocate and persist the authenticated thread's server-owned root."""
        if workspace_root is None:
            raise HTTPException(503, "managed thread workspace unavailable")
        thread_id = thread.get("thread_id")
        if not isinstance(thread_id, str) or not thread_id:
            raise HTTPException(503, "thread store returned an invalid thread id")
        try:
            allocation = managed_workspace_metadata(
                workspace_root,
                tenant_id=tenant_id,
                actor_id=actor_id,
                thread_id=thread_id,
            )
            workspace = Path(allocation["workspace_path"])
            directory_identity = _create_workspace_directory(workspace)
        except FileExistsError:
            # A prior/concurrent request is successful only when the store has
            # the exact server-derived allocation for this principal.
            current = store.get(thread_id) if hasattr(store, "get") else None
            raw_metadata = current.get("metadata") if isinstance(current, dict) else None
            current_metadata = raw_metadata if isinstance(raw_metadata, dict) else {}
            verified = verified_managed_workspace(
                workspace_root,
                thread_id=thread_id,
                metadata=current_metadata,
            )
            if (
                isinstance(current, dict)
                and verified is not None
                and current_metadata.get("owner_actor_id") == actor_id
                and current_metadata.get("tenant_id") == tenant_id
            ):
                return current
            raise HTTPException(409, "managed thread workspace already exists") from None
        except (OSError, RuntimeError, TypeError, ValueError) as exc:
            _logger.error("managed workspace allocation failed for %s: %s", thread_id, exc)
            raise HTTPException(503, "managed thread workspace unavailable") from exc

        def _recover_committed() -> dict[str, Any] | None:
            try:
                current = store.get(thread_id) if hasattr(store, "get") else None
                raw_metadata = current.get("metadata") if isinstance(current, dict) else None
                current_metadata = raw_metadata if isinstance(raw_metadata, dict) else {}
                verified = verified_managed_workspace(
                    workspace_root,
                    thread_id=thread_id,
                    metadata=current_metadata,
                )
            except (OSError, RuntimeError, TypeError, ValueError):
                return None
            if (
                isinstance(current, dict)
                and verified is not None
                and current_metadata.get("owner_actor_id") == actor_id
                and current_metadata.get("tenant_id") == tenant_id
            ):
                return current
            return None

        def _rollback_uncommitted() -> None:
            # ``thread`` was created/forked by this request. Compare-and-delete
            # under the store lock; if anything changed, assume another request
            # took it over and leave both state and directory untouched.
            delete_if_unchanged = getattr(store, "delete_if_unchanged", None)
            if not callable(delete_if_unchanged):
                return
            try:
                deleted = bool(delete_if_unchanged(thread_id, thread))
            except (OSError, RuntimeError, TypeError, ValueError):
                return
            if deleted:
                _remove_workspace_directory_if_unchanged(workspace, directory_identity)

        try:
            if not hasattr(store, "update_state"):
                raise RuntimeError("thread store cannot persist managed workspace metadata")
            store.update_state(thread_id, metadata=allocation)
            updated = store.get(thread_id) if hasattr(store, "get") else None
        except Exception as exc:  # noqa: BLE001 - compensate every ordinary adapter failure
            recovered = _recover_committed()
            if recovered is not None:
                return recovered
            _rollback_uncommitted()
            _logger.error("managed workspace allocation failed for %s: %s", thread_id, exc)
            raise HTTPException(503, "managed thread workspace unavailable") from exc
        raw_updated_metadata = updated.get("metadata") if isinstance(updated, dict) else None
        updated_metadata = raw_updated_metadata if isinstance(raw_updated_metadata, dict) else {}
        verified = verified_managed_workspace(
            workspace_root,
            thread_id=thread_id,
            metadata=updated_metadata,
        )
        if (
            not isinstance(updated, dict)
            or verified is None
            or updated_metadata.get("owner_actor_id") != actor_id
            or updated_metadata.get("tenant_id") != tenant_id
        ):
            recovered = _recover_committed()
            if recovered is not None:
                return recovered
            _rollback_uncommitted()
            raise HTTPException(503, "managed thread workspace persistence failed")
        return updated

    return _assign_managed_workspace


def build_thread_state_deps(
    *,
    store: Any,
    logs_root: Path | str | None,
    session_titles: Any,
    identity_store: Any,
    require_auth: bool,
    managed_workspace_required: bool,
    jwt_secret: str | None,
    jwt_issuer: str | None,
    jwt_audience: str | None,
    workspace_root: Path | str | None,
    group_store: Any,
    project_store: Any,
    access_resolver: Any,
    share_store: Any,
    share_relay: Any,
) -> ThreadStateDeps:
    """Build the closures exactly as the factory used to define them."""

    def _auth(request: Any) -> str | None:
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
            request.state.thread_principal = principal
        return principal.actor_id if principal is not None else None

    def _tenant(request: Any) -> str | None:
        principal = getattr(getattr(request, "state", None), "thread_principal", None)
        return getattr(principal, "tenant_id", None)

    def _require_store() -> None:
        if store is None:
            raise HTTPException(503, "thread state unavailable")

    def _project_store_for_delete() -> Any:
        if project_store is None:
            return None
        resolved = project_store() if callable(project_store) else project_store
        if resolved is None:
            raise HTTPException(503, "thread project deletion fence unavailable")
        return resolved

    _assign_managed_workspace = _make_assign_managed_workspace(
        store=store, workspace_root=workspace_root
    )

    def _title_service() -> Any:
        if store is None:
            raise HTTPException(503, "thread state unavailable")
        if session_titles is not None:
            return session_titles
        from runtime.memory.threads.session_title import SessionTitleService

        return SessionTitleService(store)

    def _require_thread_id(thread_id: str) -> str:
        from runtime.memory.threads.event_log import validate_thread_id

        try:
            return validate_thread_id(thread_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    def _can_manage(
        thread: dict[str, Any] | None,
        actor_id: str | None,
        tenant_id: str | None = None,
    ) -> bool:
        if thread is None:
            return False
        if require_auth:
            # Authenticated decisions share the resolver's fail-closed rules:
            # an ownerless tenantless legacy row is admin/operator-only, never
            # manageable by every ``legacy:<actor>`` login.
            thread_id = thread.get("thread_id")
            if not isinstance(thread_id, str) or not thread_id:
                return False
            return access_resolver.resolve(thread_id, actor_id, tenant_id).can_manage
        raw_metadata = thread.get("metadata")
        metadata = raw_metadata if isinstance(raw_metadata, dict) else {}
        stored_tenant = str(metadata.get("tenant_id") or "").strip()
        if tenant_id and not tenant_id.startswith("legacy:") and stored_tenant != tenant_id:
            return False
        if tenant_id and stored_tenant and stored_tenant != tenant_id:
            return False
        owner = metadata.get("owner_actor_id") or metadata.get("actor_id")
        return not isinstance(owner, str) or not owner.strip() or owner.strip() == actor_id

    def _can_read(
        thread: dict[str, Any] | None,
        actor_id: str | None,
        tenant_id: str | None = None,
    ) -> bool:
        if _can_manage(thread, actor_id, tenant_id):
            return True
        if not require_auth or not isinstance(thread, dict):
            return False
        thread_id = thread.get("thread_id")
        if not isinstance(thread_id, str) or not thread_id:
            return False
        return access_resolver.resolve(thread_id, actor_id, tenant_id).can_read

    def _visible_thread(thread_id: str) -> dict[str, Any] | None:
        from runtime.memory.threads import ThreadPermanentlyDeletedError

        try:
            return store.get(thread_id)
        except ThreadPermanentlyDeletedError:
            return None

    def _get_owned_thread(
        thread_id: str,
        actor_id: str | None,
        tenant_id: str | None = None,
    ) -> dict[str, Any] | None:
        thread = _visible_thread(thread_id)
        if not _can_manage(thread, actor_id, tenant_id):
            return None
        return thread

    def _get_accessible_thread(
        thread_id: str,
        actor_id: str | None,
        tenant_id: str | None = None,
    ) -> dict[str, Any] | None:
        thread = _visible_thread(thread_id)
        if not _can_read(thread, actor_id, tenant_id):
            return None
        return thread

    def _is_archived(thread_id: str) -> bool:
        if logs_root is None:
            return False
        from runtime.memory.threads.event_log import EventLog, thread_log_path

        try:
            summary = EventLog(thread_log_path(logs_root, thread_id)).summary()
        except OSError as exc:
            # On Windows an active realtime writer can briefly hold an
            # exclusive handle on the JSONL log. Search should remain usable
            # during that short window; a failed archive probe must not turn
            # the whole thread list into a 500 response.
            _logger.warning(
                "thread archive probe temporarily unavailable thread_id=%s: %s",
                thread_id,
                exc,
            )
            return False
        return bool(summary and summary.archived)

    return ThreadStateDeps(
        store=store,
        logs_root=logs_root,
        require_auth=require_auth,
        managed_workspace_required=managed_workspace_required,
        workspace_root=workspace_root,
        group_store=group_store,
        share_store=share_store,
        share_relay=share_relay,
        auth=_auth,
        tenant=_tenant,
        require_store=_require_store,
        project_store_for_delete=_project_store_for_delete,
        assign_managed_workspace=_assign_managed_workspace,
        title_service=_title_service,
        require_thread_id=_require_thread_id,
        can_manage=_can_manage,
        can_read=_can_read,
        visible_thread=_visible_thread,
        get_owned_thread=_get_owned_thread,
        get_accessible_thread=_get_accessible_thread,
        is_archived=_is_archived,
    )
