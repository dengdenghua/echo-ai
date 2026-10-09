"""Thread CRUD, search, feedback, and history endpoints for the thread router.

Pure structural split of ``thread_state_router.create_thread_state_router`` —
no logic changes. Each ``_register_*`` function attaches its endpoints to the
injected router, reading shared state from the ``ThreadStateDeps`` bundle;
the factory still owns the registration order.
"""

from __future__ import annotations

import logging
from typing import Any

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

from ._thread_state_deps import ThreadStateDeps
from ._thread_state_search_projection import project_visible_search_page, search_select_fields
from .thread_workspace import strip_client_workspace_metadata

# Keep the original logger name so log routing and filters are unchanged.
_logger = logging.getLogger("runtime.sensing.gateway.thread_state_router")


def _register_create_and_search(router: APIRouter, d: ThreadStateDeps) -> None:
    """Create a thread; list search, error diagnostics, and full-text search."""
    store = d.store
    _auth = d.auth
    _tenant = d.tenant
    _require_store = d.require_store
    managed_workspace_required = d.managed_workspace_required
    _assign_managed_workspace = d.assign_managed_workspace
    _can_read = d.can_read
    _is_archived = d.is_archived
    _visible_thread = d.visible_thread

    @router.post("/api/threads")
    def create_thread(request: Request, body: dict[str, Any] | None = None) -> dict[str, Any]:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        payload = body or {}
        raw_metadata = payload.get("metadata")
        metadata = raw_metadata if isinstance(raw_metadata, dict) else {}
        metadata = dict(metadata)
        if actor_id is not None:
            # The body may carry presentation metadata, but ownership is
            # server-derived and cannot be assigned to another actor.
            metadata["owner_actor_id"] = actor_id
            metadata["tenant_id"] = tenant_id or ""
        if managed_workspace_required:
            # A shared-mode client may describe presentation state, but it can
            # never choose a host filesystem root or forge the server marker.
            metadata = strip_client_workspace_metadata(metadata)
        raw_values = payload.get("values")
        values = raw_values if isinstance(raw_values, dict) else {}
        created = store.create(metadata=metadata, values=values)
        if managed_workspace_required:
            # ``_auth`` is fail-closed above, so these values are guaranteed in
            # authenticated mode. Keep the guard explicit for type safety and
            # for custom identity-store adapters.
            if not actor_id:
                raise HTTPException(401, "authentication required")
            return _assign_managed_workspace(
                created,
                actor_id=actor_id,
                tenant_id=tenant_id or f"legacy:{actor_id}",
            )
        return created

    @router.get("/api/threads/search")
    def search_threads_get(
        request: Request,
        q: str = "",
        limit: int = Query(20, ge=1, le=200),  # type: ignore[misc]
    ) -> dict[str, Any]:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        needle = (q or "").strip().lower()
        results: list[dict[str, Any]] = []
        for thread in store.search(limit=500, offset=0):
            if not _can_read(thread, actor_id, tenant_id):
                continue
            thread_id = thread.get("thread_id")
            if isinstance(thread_id, str) and _is_archived(thread_id):
                continue
            values = thread.get("values") or {}
            title = str(values.get("title") or "")
            raw_messages = values.get("messages")
            messages = raw_messages if isinstance(raw_messages, list) else []
            haystack_parts = [title]
            for message in messages:
                if isinstance(message, dict):
                    haystack_parts.append(str(message.get("content") or ""))
            haystack = "\n".join(haystack_parts).lower()
            if needle and needle not in haystack:
                continue
            snippet = ""
            for part in haystack_parts:
                if needle and needle in part.lower():
                    snippet = part
                    break
            results.append(
                {
                    "thread_id": thread.get("thread_id"),
                    "title": title or "New chat",
                    "snippet": snippet[:240],
                    "created_at": thread.get("created_at"),
                    "updated_at": thread.get("updated_at"),
                    "message_count": len(messages),
                    "values": values,
                    "metadata": thread.get("metadata") or {},
                }
            )
            if len(results) >= limit:
                break
        return {"threads": results}

    @router.get("/api/threads/diagnostics/errors")
    def conversation_error_diagnostics(
        request: Request,
        thread_limit: int = Query(100, ge=1, le=500),  # type: ignore[misc]
        message_limit: int = Query(500, ge=1, le=5_000),  # type: ignore[misc]
        sample_limit: int = Query(20, ge=0, le=100),  # type: ignore[misc]
    ) -> dict[str, Any]:
        """Return an owner-filtered, privacy-bounded conversation error summary."""

        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        visible: list[dict[str, Any]] = []
        # Apply the public limit after ACL filtering. Limiting the global store
        # first lets another tenant's newer threads crowd the caller's rows out
        # of a small diagnostic request.
        for thread in store.search(
            limit=500,
            offset=0,
            sort_by="updated_at",
            sort_order="desc",
        ):
            if not _can_read(thread, actor_id, tenant_id):
                continue
            thread_id = thread.get("thread_id")
            if isinstance(thread_id, str) and _is_archived(thread_id):
                continue
            visible.append(thread)
            if len(visible) >= thread_limit:
                break

        from ._conversation_error_diagnostics import build_conversation_error_diagnostics

        report = build_conversation_error_diagnostics(
            visible,
            message_limit=message_limit,
            sample_limit=sample_limit,
        )
        report["bounds"]["thread_limit"] = thread_limit
        return report

    # Echo Native Session API v2: full-text search endpoint
    @router.get("/api/threads/fts")
    def full_text_search(
        request: Request,
        q: str = "",
        agent_id: str | None = None,
        team_id: str | None = None,
        after: str | None = None,
        before: str | None = None,
        limit: int = Query(20, ge=1, le=100),  # type: ignore[misc]
    ) -> dict[str, Any]:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        if not hasattr(store, "search_threads"):
            raise HTTPException(501, "full-text search not enabled")
        if not getattr(store, "search_enabled", True):
            raise HTTPException(501, "full-text search not enabled")
        query = (q or "").strip()
        if not query:
            raise HTTPException(400, "query parameter 'q' is required")
        try:
            results = store.search_threads(
                query,
                agent_id=agent_id,
                team_id=team_id,
                after=after,
                before=before,
                limit=limit,
            )
        except Exception as exc:
            _logger.exception("search failed")
            raise HTTPException(500, f"search failed: {exc}") from exc
        # Filter results by ownership
        filtered = [
            {
                "thread_id": r.thread_id,
                "title": r.title,
                "snippet": r.snippet,
                "rank": r.rank,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
            }
            for r in results
            if _can_read(_visible_thread(r.thread_id), actor_id, tenant_id)
        ]
        return {"results": filtered, "count": len(filtered)}


def _register_export_and_feedback(router: APIRouter, d: ThreadStateDeps) -> None:
    """Markdown export and message feedback (declared before ``{thread_id}``)."""
    store = d.store
    _auth = d.auth
    _tenant = d.tenant
    _require_store = d.require_store
    _require_thread_id = d.require_thread_id
    _is_archived = d.is_archived
    _get_accessible_thread = d.get_accessible_thread
    _get_owned_thread = d.get_owned_thread

    # Echo Native Session API v2: Markdown export (before {thread_id})
    @router.get("/api/threads/{thread_id}/export")
    def export_thread(
        request: Request,
        thread_id: str,
    ) -> Response:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        if _is_archived(thread_id):
            raise HTTPException(404, f"thread not found: {thread_id}")
        if _get_accessible_thread(thread_id, actor_id, tenant_id) is None:
            raise HTTPException(404, f"thread not found: {thread_id}")
        if not hasattr(store, "export_thread_markdown"):
            raise HTTPException(501, "markdown export not enabled")
        try:
            markdown = store.export_thread_markdown(thread_id)
        except Exception as exc:
            _logger.exception("export failed")
            raise HTTPException(500, f"export failed: {exc}") from exc
        if markdown is None:
            raise HTTPException(404, f"thread not found: {thread_id}")
        return Response(
            content=markdown,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{thread_id}.md"'},
        )

    # Echo Native Session API v2: feedback endpoints (before {thread_id})
    @router.post("/api/threads/{thread_id}/feedback")
    def add_feedback(
        request: Request,
        thread_id: str,
        body: dict[str, Any],
    ) -> dict[str, Any]:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        if _is_archived(thread_id):
            raise HTTPException(404, f"thread not found: {thread_id}")
        if _get_owned_thread(thread_id, actor_id, tenant_id) is None:
            raise HTTPException(404, f"thread not found: {thread_id}")
        if not hasattr(store, "add_message_feedback"):
            raise HTTPException(501, "feedback system not enabled")
        if not getattr(store, "feedback_enabled", True):
            raise HTTPException(501, "feedback system not enabled")
        message_index = body.get("message_index")
        feedback_type = body.get("feedback_type")
        tags = body.get("tags", [])
        comment = body.get("comment", "")
        if not isinstance(message_index, int) or message_index < 0:
            raise HTTPException(400, "message_index must be non-negative integer")
        if feedback_type not in ("thumbs_up", "thumbs_down"):
            raise HTTPException(400, "feedback_type must be 'thumbs_up' or 'thumbs_down'")
        if not isinstance(tags, list):
            raise HTTPException(400, "tags must be a list")
        try:
            feedback = store.add_message_feedback(
                thread_id,
                message_index,
                feedback_type,
                tags=tags,
                comment=comment,
                user_id=actor_id,
            )
        except Exception as exc:
            _logger.exception("add feedback failed")
            raise HTTPException(500, f"add feedback failed: {exc}") from exc
        if feedback is None:
            raise HTTPException(500, "failed to add feedback")
        return {
            "thread_id": feedback.thread_id,
            "message_index": feedback.message_index,
            "feedback_type": feedback.feedback_type,
            "tags": list(feedback.tags),
            "comment": feedback.comment,
            "timestamp": feedback.timestamp,
            "user_id": feedback.user_id,
        }

    @router.get("/api/threads/{thread_id}/feedback/stats")
    def get_feedback_stats(
        request: Request,
        thread_id: str,
    ) -> dict[str, Any]:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        if _is_archived(thread_id):
            raise HTTPException(404, f"thread not found: {thread_id}")
        if _get_accessible_thread(thread_id, actor_id, tenant_id) is None:
            raise HTTPException(404, f"thread not found: {thread_id}")
        if not hasattr(store, "get_feedback_stats"):
            raise HTTPException(501, "feedback system not enabled")
        if not getattr(store, "feedback_enabled", True):
            raise HTTPException(501, "feedback system not enabled")
        try:
            stats = store.get_feedback_stats(thread_id)
        except Exception as exc:
            _logger.exception("get feedback stats failed")
            raise HTTPException(500, f"get feedback stats failed: {exc}") from exc
        return stats

    @router.get("/api/threads/{thread_id}/feedback")
    def get_feedback(
        request: Request,
        thread_id: str,
        message_index: int | None = None,
    ) -> dict[str, Any]:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        if _is_archived(thread_id):
            raise HTTPException(404, f"thread not found: {thread_id}")
        if _get_accessible_thread(thread_id, actor_id, tenant_id) is None:
            raise HTTPException(404, f"thread not found: {thread_id}")
        if not hasattr(store, "get_message_feedback"):
            raise HTTPException(501, "feedback system not enabled")
        if not getattr(store, "feedback_enabled", True):
            raise HTTPException(501, "feedback system not enabled")
        try:
            feedbacks = store.get_message_feedback(thread_id, message_index)
        except Exception as exc:
            _logger.exception("get feedback failed")
            raise HTTPException(500, f"get feedback failed: {exc}") from exc
        return {
            "feedbacks": [
                {
                    "thread_id": f.thread_id,
                    "message_index": f.message_index,
                    "feedback_type": f.feedback_type,
                    "tags": list(f.tags),
                    "comment": f.comment,
                    "timestamp": f.timestamp,
                    "user_id": f.user_id,
                }
                for f in feedbacks
            ]
        }


def _register_thread_reads(router: APIRouter, d: ThreadStateDeps) -> None:
    """Context breakdown, read / delete one thread, list visibility, search, state."""
    store = d.store
    _auth = d.auth
    _tenant = d.tenant
    _require_store = d.require_store
    logs_root = d.logs_root
    require_auth = d.require_auth
    managed_workspace_required = d.managed_workspace_required
    workspace_root = d.workspace_root
    group_store = d.group_store
    _project_store_for_delete = d.project_store_for_delete
    _require_thread_id = d.require_thread_id
    _can_manage = d.can_manage
    _can_read = d.can_read
    _visible_thread = d.visible_thread
    _get_accessible_thread = d.get_accessible_thread
    _is_archived = d.is_archived

    @router.get("/api/threads/{thread_id}/context-breakdown")
    def get_thread_context_breakdown(request: Request, thread_id: str) -> dict[str, Any]:
        """Claude-style context segments for the composer ring."""
        from .context_breakdown import handle_thread_context_breakdown

        return handle_thread_context_breakdown(
            request,
            thread_id,
            _auth,
            _tenant,
            _require_store,
            _require_thread_id,
            _get_accessible_thread,
        )

    @router.get("/api/threads/{thread_id}")
    def get_thread(request: Request, thread_id: str) -> dict[str, Any]:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        if _is_archived(thread_id):
            raise HTTPException(404, f"thread not found: {thread_id}")
        thread = _get_accessible_thread(thread_id, actor_id, tenant_id)
        if thread is None:
            raise HTTPException(404, f"thread not found: {thread_id}")
        return thread

    @router.delete(
        "/api/threads/{thread_id}", status_code=204, response_class=Response, response_model=None
    )
    def delete_thread(request: Request, thread_id: str):
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        existing = _visible_thread(thread_id)
        if existing is not None and not _can_manage(existing, actor_id, tenant_id):
            raise HTTPException(404, f"thread not found: {thread_id}")
        from ._thread_state_delete import delete_thread_state

        delete_thread_state(
            store=store,
            thread_id=thread_id,
            existing=existing,
            actor_id=actor_id,
            tenant_id=tenant_id,
            require_auth=managed_workspace_required,
            workspace_root=workspace_root,
            logs_root=logs_root,
            is_archived=_is_archived,
            project_store=_project_store_for_delete(),
            group_store=group_store,
            logger=_logger,
        )

    @router.put("/api/threads/{thread_id}/list-visibility")
    def set_thread_list_visibility(request: Request, thread_id: str, body: dict[str, Any]):
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        if _get_accessible_thread(thread_id, actor_id, tenant_id) is None or _is_archived(
            thread_id
        ):
            raise HTTPException(404, f"thread not found: {thread_id}")
        hidden = body.get("hidden")
        if not isinstance(hidden, bool):
            raise HTTPException(422, "hidden must be a boolean")
        # Any reader may change their own list. Never alter the room, owner,
        # project binding, execution or shared conversation snapshot.
        store.list_visibility.set_hidden(
            tenant_id or "local", actor_id or "local", thread_id, hidden
        )
        return {"thread_id": thread_id, "hidden": hidden}

    @router.post("/api/threads/search")
    def search_threads_post(
        request: Request,
        body: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        payload = body or {}
        hidden_ids = store.list_visibility.hidden_ids(tenant_id or "local", actor_id or "local")
        hidden_only = payload.get("hidden_only") is True
        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else None
        metadata = dict(metadata) if metadata is not None else None
        if actor_id is not None:
            metadata = metadata or {}
            metadata.pop("owner_actor_id", None)
            metadata.pop("actor_id", None)
            metadata["tenant_id"] = tenant_id or ""
        limit = int(payload.get("limit", 50) or 50)
        offset = int(payload.get("offset", 0) or 0)
        sort_by = str(payload.get("sortBy") or "updated_at")
        sort_order = str(payload.get("sortOrder") or "desc")
        select, internal_select = search_select_fields(payload)
        # A tenant can contain both owned and joined-room threads. Fetch a
        # bounded tenant slice first, apply the dynamic room ACL, then paginate
        # the visible result so same-tenant private threads cannot starve joined
        # conversations from the sidebar.
        needs_filter = require_auth or bool(hidden_ids) or hidden_only
        fetch_limit = max(500, min(2000, offset + limit * 5)) if needs_filter else limit
        results = store.search(
            limit=fetch_limit,
            offset=0 if needs_filter else offset,
            metadata=metadata,
            sort_by=sort_by,
            sort_order=sort_order,
            select=internal_select or None,
        )
        visible = [
            thread
            for thread in results
            if _can_read(thread, actor_id, tenant_id)
            if not (isinstance(thread.get("thread_id"), str) and _is_archived(thread["thread_id"]))
            if (thread.get("thread_id") in hidden_ids) == hidden_only
        ]
        return project_visible_search_page(
            visible, select=select, offset=offset, limit=limit, require_auth=needs_filter
        )

    @router.get("/api/threads/{thread_id}/state")
    def get_thread_state(request: Request, thread_id: str) -> dict[str, Any]:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        if _is_archived(thread_id):
            raise HTTPException(404, f"thread not found: {thread_id}")
        if _get_accessible_thread(thread_id, actor_id, tenant_id) is None:
            raise HTTPException(404, f"thread not found: {thread_id}")
        state = store.get_state(thread_id)
        if state is None:
            raise HTTPException(404, f"thread not found: {thread_id}")
        return state


def _register_thread_mutations(router: APIRouter, d: ThreadStateDeps) -> None:
    """Update state, read history, fork, and rename / refresh the title."""
    store = d.store
    _auth = d.auth
    _tenant = d.tenant
    _require_store = d.require_store
    logs_root = d.logs_root
    managed_workspace_required = d.managed_workspace_required
    _assign_managed_workspace = d.assign_managed_workspace
    _title_service = d.title_service
    _require_thread_id = d.require_thread_id
    _get_accessible_thread = d.get_accessible_thread
    _get_owned_thread = d.get_owned_thread
    _is_archived = d.is_archived

    @router.post("/api/threads/{thread_id}/state")
    def update_thread_state(
        request: Request,
        thread_id: str,
        body: dict[str, Any],
    ) -> dict[str, Any]:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        if _is_archived(thread_id):
            raise HTTPException(404, f"thread not found: {thread_id}")
        if _get_owned_thread(thread_id, actor_id, tenant_id) is None:
            raise HTTPException(404, f"thread not found: {thread_id}")
        try:
            metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else None
            metadata = dict(metadata) if metadata is not None else None
            if managed_workspace_required and metadata is not None:
                metadata = strip_client_workspace_metadata(metadata)
            if actor_id is not None:
                metadata = metadata or {}
                metadata["owner_actor_id"] = actor_id
                metadata["tenant_id"] = tenant_id or ""
            return store.update_state(
                thread_id,
                values=body.get("values") if isinstance(body.get("values"), dict) else None,
                metadata=metadata,
                status=body.get("status") if isinstance(body.get("status"), str) else None,
            )
        except KeyError as exc:
            raise HTTPException(404, f"thread not found: {thread_id}") from exc

    @router.post("/api/threads/{thread_id}/history")
    def get_thread_history(
        request: Request,
        thread_id: str,
        body: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        if _is_archived(thread_id):
            return []
        if _get_accessible_thread(thread_id, actor_id, tenant_id) is None:
            return []
        payload = body or {}
        limit = int(payload.get("limit", 50) or 50)
        return store.get_history(thread_id, limit=limit)

    @router.post("/api/threads/{thread_id}/fork")
    def fork_thread(
        request: Request,
        thread_id: str,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Fork a new thread from a completed-turn prefix (dsh sessions.fork).

        ``at_message_index`` anchors the cut at the first completed turn at
        or after it; omitted/out-of-range falls back to the last completed
        turn. Anchoring on an in-flight turn fails with 409
        ``fork-unavailable`` instead of clipping.
        """
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        if _is_archived(thread_id):
            raise HTTPException(404, f"thread not found: {thread_id}")
        if _get_owned_thread(thread_id, actor_id, tenant_id) is None:
            raise HTTPException(404, f"thread not found: {thread_id}")
        payload = body or {}
        at_index = payload.get("at_message_index") if isinstance(payload, dict) else None
        if at_index is not None and type(at_index) is not int:
            raise HTTPException(400, "at_message_index must be an integer")
        from runtime.memory.threads.store import ForkUnavailableError

        try:
            child = store.fork_thread(thread_id, at_message_index=at_index)
        except KeyError as exc:
            raise HTTPException(404, f"thread not found: {thread_id}") from exc
        except ForkUnavailableError as exc:
            raise HTTPException(409, "fork-unavailable") from exc
        from ._thread_history_fork import seed_history

        try:
            seed_history(logs_root, thread_id, child)
        except (ForkUnavailableError, OSError, ValueError):
            store.delete_if_unchanged(child["thread_id"], child)
            raise HTTPException(409, "fork-unavailable: history could not be verified") from None
        if managed_workspace_required:
            if not actor_id:
                raise HTTPException(401, "authentication required")
            try:
                child = _assign_managed_workspace(
                    child,
                    actor_id=actor_id,
                    tenant_id=tenant_id or f"legacy:{actor_id}",
                )
            except HTTPException:
                # Allocation performs a compare-and-delete of the unused child.
                # Only remove our seed if that rollback actually succeeded.
                if logs_root and store.get(child["thread_id"]) is None:
                    from runtime.memory.threads._event_log_helpers import thread_log_path

                    thread_log_path(logs_root, child["thread_id"]).unlink(missing_ok=True)
                raise
        values = child.get("values") if isinstance(child.get("values"), dict) else {}
        seeded = values.get("messages") or []
        return {
            "thread_id": child["thread_id"],
            "seeded_messages": len(seeded) if isinstance(seeded, list) else 0,
        }

    @router.post("/api/threads/{thread_id}/title/rename")
    def rename_thread_title(
        request: Request,
        thread_id: str,
        body: dict[str, Any],
    ) -> dict[str, Any]:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        if _is_archived(thread_id):
            raise HTTPException(404, f"thread not found: {thread_id}")
        if _get_owned_thread(thread_id, actor_id, tenant_id) is None:
            raise HTTPException(404, f"thread not found: {thread_id}")
        title = body.get("title") if isinstance(body, dict) else None
        if not isinstance(title, str):
            raise HTTPException(400, "title is required")
        try:
            snapshot = _title_service().rename(thread_id, title)
        except KeyError as exc:
            raise HTTPException(404, f"thread not found: {thread_id}") from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return snapshot.to_wire()

    @router.post("/api/threads/{thread_id}/title/refresh")
    def refresh_thread_title(
        request: Request,
        thread_id: str,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        actor_id = _auth(request)
        tenant_id = _tenant(request)
        _require_store()
        thread_id = _require_thread_id(thread_id)
        if _is_archived(thread_id):
            raise HTTPException(404, f"thread not found: {thread_id}")
        if _get_owned_thread(thread_id, actor_id, tenant_id) is None:
            raise HTTPException(404, f"thread not found: {thread_id}")
        payload = body or {}
        provider = payload.get("provider") if isinstance(payload, dict) else None
        force = bool(payload.get("force", False)) if isinstance(payload, dict) else False
        try:
            snapshot = _title_service().refresh(
                thread_id,
                provider=provider if isinstance(provider, str) else None,
                force=force,
            )
        except KeyError as exc:
            raise HTTPException(404, f"thread not found: {thread_id}") from exc
        return snapshot.to_wire()
