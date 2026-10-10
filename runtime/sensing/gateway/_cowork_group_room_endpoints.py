"""Linked-room endpoints for the cowork router: social, room link, messages.

Pure structural split of ``cowork_group_router.create_cowork_group_router`` —
no logic changes. Each ``_register_*`` function attaches its endpoints to the
injected router, reading shared state from the ``CoworkGroupDeps`` bundle.
"""

from __future__ import annotations

import asyncio
import hashlib
from contextlib import suppress
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request

from runtime.memory.cowork.group import sender_identity

from ._cowork_group_deps import CoworkGroupDeps, _maybe_await
from ._cowork_group_models import (
    AnnotationBody,
    AnnotationReplyBody,
    AnnotationResolvedBody,
    CollabTaskBody,
    EnsureRoomBody,
    LinkRoomBody,
    MessageProjectActionBody,
    PinMessageBody,
    ReactionBody,
    RoomMessageBody,
)


def _register_room_social(router: APIRouter, d: CoworkGroupDeps) -> None:
    """Message reactions, pinned messages, and threaded annotations."""
    group_store = d.group_store
    _collaboration_store = d.collaboration_store
    _require_room_member = d.require_room_member
    _can_moderate = d.access.can_moderate
    _actor = d.actor
    _auth_dep = d.auth_dep
    _broadcast_social_change = d.broadcast_social_change

    def _annotation_author(
        request: Request,
        *,
        display_name: str,
        avatar_color: str,
    ) -> tuple[str, dict[str, str]]:
        actor_id = str(_actor(request) or "anonymous").strip() or "anonymous"
        name = display_name.strip() or actor_id
        color = avatar_color.strip()
        if not color.startswith("#") or len(color) not in {4, 7, 9}:
            # A deterministic, safe fallback makes server-rendered history
            # look stable even when a client has no avatar profile.
            color = f"#{hashlib.sha256(actor_id.encode()).hexdigest()[:6]}"
        return actor_id, {"display_name": name[:160], "avatar_color": color}

    def _annotation_room_id(thread_id: str, request: Request) -> str:
        room_id = str(getattr(group_store.state(thread_id), "room_id", None) or "").strip()
        if not room_id:
            raise HTTPException(409, "no room linked to this session")
        _require_room_member(room_id, request)
        return room_id

    @router.get("/api/collab/{thread_id}/reactions")
    def list_message_reactions(thread_id: str, request: Request) -> dict[str, Any]:
        room_id = _annotation_room_id(thread_id, request)
        return {
            "thread_id": thread_id,
            "room_id": room_id,
            "reactions": _collaboration_store().reactions_for_session(thread_id),
        }

    @router.post("/api/collab/{thread_id}/reactions", dependencies=[Depends(_auth_dep)])
    def toggle_message_reaction(
        thread_id: str,
        body: ReactionBody,
        request: Request,
        background_tasks: BackgroundTasks,
    ) -> dict[str, Any]:
        room_id = _annotation_room_id(thread_id, request)
        participant_id = str(_actor(request) or "anonymous").strip() or "anonymous"
        reaction = _collaboration_store().toggle_message_reaction(
            thread_id,
            room_id=room_id,
            message_id=body.message_id,
            participant_id=participant_id,
            emoji=body.emoji,
        )
        background_tasks.add_task(_broadcast_social_change, room_id, thread_id, "reaction")
        return {"ok": True, "reaction": reaction}

    @router.get("/api/collab/{thread_id}/pinned-messages")
    def list_pinned_messages(thread_id: str, request: Request) -> dict[str, Any]:
        room_id = _annotation_room_id(thread_id, request)
        return {
            "thread_id": thread_id,
            "room_id": room_id,
            "pinned_messages": _collaboration_store().pinned_messages_for_session(thread_id),
        }

    @router.post("/api/collab/{thread_id}/pinned-messages", dependencies=[Depends(_auth_dep)])
    def toggle_pinned_message(
        thread_id: str,
        body: PinMessageBody,
        request: Request,
        background_tasks: BackgroundTasks,
    ) -> dict[str, Any]:
        room_id = _annotation_room_id(thread_id, request)
        participant_id = str(_actor(request) or "anonymous").strip() or "anonymous"
        pin = _collaboration_store().toggle_pinned_message(
            thread_id,
            room_id=room_id,
            message_id=body.message_id,
            participant_id=participant_id,
        )
        background_tasks.add_task(_broadcast_social_change, room_id, thread_id, "pin")
        return {"ok": True, "pin": pin}

    @router.get("/api/collab/{thread_id}/annotations")
    def list_annotations(thread_id: str, request: Request) -> dict[str, Any]:
        room_id = _annotation_room_id(thread_id, request)
        return {
            "thread_id": thread_id,
            "room_id": room_id,
            "annotations": _collaboration_store().annotations_for_session(thread_id),
        }

    @router.post("/api/collab/{thread_id}/annotations", dependencies=[Depends(_auth_dep)])
    def create_annotation(
        thread_id: str,
        body: AnnotationBody,
        request: Request,
        background_tasks: BackgroundTasks,
    ) -> dict[str, Any]:
        room_id = _annotation_room_id(thread_id, request)
        author_id, author = _annotation_author(
            request,
            display_name=body.display_name,
            avatar_color=body.avatar_color,
        )
        annotation = _collaboration_store().add_annotation(
            thread_id,
            room_id=room_id,
            message_id=body.message_id,
            author_id=author_id,
            author=author,
            body=body.body,
        )
        background_tasks.add_task(_broadcast_social_change, room_id, thread_id, "annotation")
        return {"ok": True, "annotation": annotation}

    @router.patch(
        "/api/collab/{thread_id}/annotations/{annotation_id}",
        dependencies=[Depends(_auth_dep)],
    )
    def update_annotation(
        thread_id: str,
        annotation_id: str,
        body: AnnotationResolvedBody,
        request: Request,
        background_tasks: BackgroundTasks,
    ) -> dict[str, Any]:
        room_id = _annotation_room_id(thread_id, request)
        annotation = _collaboration_store().set_annotation_resolved(
            thread_id,
            annotation_id,
            resolved=body.resolved,
        )
        if annotation is None:
            raise HTTPException(404, "annotation not found")
        background_tasks.add_task(_broadcast_social_change, room_id, thread_id, "annotation")
        return {"ok": True, "annotation": annotation}

    @router.delete(
        "/api/collab/{thread_id}/annotations/{annotation_id}",
        dependencies=[Depends(_auth_dep)],
    )
    def delete_annotation(
        thread_id: str,
        annotation_id: str,
        request: Request,
        background_tasks: BackgroundTasks,
    ) -> dict[str, Any]:
        room_id = _annotation_room_id(thread_id, request)
        store = _collaboration_store()
        author_id = store.annotation_author_id(thread_id, annotation_id)
        if author_id is None:
            raise HTTPException(404, "annotation not found")
        # Only the author, or whoever moderates the thread (thread owner or
        # linked-room owner/admin), may delete an annotation and its replies.
        actor_id = str(_actor(request) or "anonymous").strip() or "anonymous"
        if author_id != actor_id and not _can_moderate(thread_id, request):
            raise HTTPException(403, "only the author or a room admin can delete this annotation")
        if not store.delete_annotation(thread_id, annotation_id):
            raise HTTPException(404, "annotation not found")
        background_tasks.add_task(_broadcast_social_change, room_id, thread_id, "annotation")
        return {"ok": True}

    @router.post(
        "/api/collab/{thread_id}/annotations/{annotation_id}/replies",
        dependencies=[Depends(_auth_dep)],
    )
    def create_annotation_reply(
        thread_id: str,
        annotation_id: str,
        body: AnnotationReplyBody,
        request: Request,
        background_tasks: BackgroundTasks,
    ) -> dict[str, Any]:
        room_id = _annotation_room_id(thread_id, request)
        author_id, author = _annotation_author(
            request,
            display_name=body.display_name,
            avatar_color=body.avatar_color,
        )
        reply = _collaboration_store().add_annotation_reply(
            thread_id,
            annotation_id,
            author_id=author_id,
            author=author,
            body=body.body,
        )
        if reply is None:
            raise HTTPException(404, "annotation not found")
        background_tasks.add_task(_broadcast_social_change, room_id, thread_id, "annotation")
        return {"ok": True, "reply": reply}


def _register_room_link(router: APIRouter, d: CoworkGroupDeps) -> None:
    """Create / link the session room and its heavyweight tasks."""
    group_store = d.group_store
    team_rooms_router = d.team_rooms_router
    team_tasks_router = d.team_tasks_router
    _collaboration_store = d.collaboration_store
    _require_room_member = d.require_room_member
    _room_snapshot = d.room_snapshot
    _room_tasks = d.room_tasks
    _session_payload = d.session_payload
    _ensure_room = d.ensure_room
    _actor = d.actor
    _owner_dep = d.owner_dep
    _auth_dep = d.auth_dep

    @router.post("/api/collab/{thread_id}/room", dependencies=[Depends(_owner_dep)])
    async def ensure_session_room(
        thread_id: str,
        body: EnsureRoomBody,
        request: Request,
    ) -> dict[str, Any]:
        """Create/link the session's persistent room.

        This is the canonical replacement for "go create a Team elsewhere":
        the user stays in one collaboration thread, and persistence/invites/tasks
        become properties of that same session.
        """
        room, created = await _ensure_room(thread_id, body, request)
        return {
            "ok": True,
            "created": created,
            "room": room,
            "session": await asyncio.to_thread(_session_payload, thread_id),
        }

    @router.get("/api/collab/{thread_id}/tasks")
    def list_session_tasks(thread_id: str, request: Request) -> dict[str, Any]:
        """List heavyweight room tasks through the canonical session path."""
        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if room_id:
            _require_room_member(room_id, request)
        tasks = _collaboration_store().tasks_for_session(thread_id)
        if not tasks and room_id:
            tasks = _room_tasks(room_id)
        return {
            "thread_id": thread_id,
            "room_id": room_id,
            "tasks": tasks,
            "count": len(tasks),
        }

    @router.post("/api/collab/{thread_id}/tasks", dependencies=[Depends(_auth_dep)])
    async def create_session_task(
        thread_id: str,
        body: CollabTaskBody,
        request: Request,
    ) -> dict[str, Any]:
        """Create a heavyweight task through the collaboration session.

        The underlying TeamTask store is still reused for compatibility, but the
        caller no longer has to choose a separate Team surface first.
        """
        creator = getattr(team_tasks_router, "create_task_from_payload", None)
        if not callable(creator):
            raise HTTPException(501, "collab task creation is not wired")
        room_body = body.room or EnsureRoomBody()
        room, _created = await _ensure_room(thread_id, room_body, request)
        room_id = str(room.get("id") or getattr(group_store.state(thread_id), "room_id", "") or "")
        if not room_id:
            raise HTTPException(409, "collab session has no linked room")
        metadata = {
            **body.metadata,
            "collab_session_id": thread_id,
            "source": "collab_session",
        }
        task = await _maybe_await(
            creator(
                request,
                {
                    "room_id": room_id,
                    "title": body.title,
                    "description": body.description,
                    "sop_template": body.sop_template,
                    "assignees": body.assignees,
                    "metadata": metadata,
                },
            )
        )
        if body.run:
            runner = getattr(team_tasks_router, "run_task_from_request", None)
            if callable(runner):
                task = await _maybe_await(runner(request, task["id"]))
        task = await asyncio.to_thread(_collaboration_store().upsert_task, thread_id, dict(task))
        return {
            "ok": True,
            "room_id": room_id,
            "task": task,
            "session": await asyncio.to_thread(_session_payload, thread_id),
        }

    @router.post("/api/collab/{thread_id}/link-room", dependencies=[Depends(_owner_dep)])
    async def link_session_room(
        thread_id: str,
        body: LinkRoomBody,
        request: Request,
    ) -> dict[str, Any]:
        """Link a Team Room to this session (event-sourced) so the two surfaces
        stop drifting as separate sources of truth."""
        from runtime.sensing.gateway._cowork_group_room_link import (
            link_session_room_fail_safe,
        )

        _require_room_member(body.room_id, request)
        current_state = group_store.state(thread_id)
        if current_state.room_id and current_state.room_id != body.room_id:
            current_room = _room_snapshot(current_state.room_id)
            current_room_thread = str((current_room or {}).get("thread_id") or "").strip()
            if current_room_thread == thread_id:
                raise HTTPException(409, "collaboration thread is already linked to another room")

        collaboration = _collaboration_store()
        prior_room = _room_snapshot(body.room_id)
        prior_thread_id = str((prior_room or {}).get("thread_id") or "").strip()
        if prior_thread_id and prior_thread_id != thread_id:
            raise HTTPException(409, "team room is already bound to another thread")
        state = await link_session_room_fail_safe(
            thread_id=thread_id,
            room_id=body.room_id,
            request=request,
            actor=_actor(request),
            prior_room=prior_room,
            room_snapshot=_room_snapshot,
            group_store=group_store,
            collaboration=collaboration,
            team_rooms_router=team_rooms_router,
        )
        return {
            "ok": True,
            "state": state.to_dict(),
            "session": await asyncio.to_thread(_session_payload, thread_id),
        }


def _register_room_messages(router: APIRouter, d: CoworkGroupDeps) -> None:
    """Post into the linked room transcript and promote messages to Project OS."""
    group_store = d.group_store
    team_rooms_router = d.team_rooms_router
    _collaboration_store = d.collaboration_store
    _project_store = d.project_store
    _room_message_store = d.room_message_store
    _require_room_member = d.require_room_member
    _bind_caller_member = d.access.bind_caller_member
    _actor = d.actor
    _broadcast_social_change = d.broadcast_social_change
    _owner_dep = d.owner_dep
    _auth_dep = d.auth_dep

    @router.post("/api/collab/{thread_id}/room-message", dependencies=[Depends(_auth_dep)])
    def post_room_message(
        thread_id: str,
        body: RoomMessageBody,
        request: Request,
        background_tasks: BackgroundTasks,
    ) -> dict[str, Any]:
        """Write a line into the session's linked Team Room transcript.

        The write side of the unified session: where ``get_session`` /search read
        the linked room transcript, this lets the cowork thread *post* into it
        through the same session — so an agent or summary in the group lands in
        the room surface instead of a separate write path. 409 if no room is
        linked (link it first via ``/link-room``)."""
        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if not room_id:
            raise HTTPException(409, "no room linked to this session — link one first")
        _require_room_member(room_id, request)
        metadata = dict(body.metadata)
        if body.reply_to is not None:
            metadata["reply_to"] = body.reply_to
        if body.source_message_id:
            metadata["source_message_id"] = body.source_message_id
        if body.message_type:
            metadata["message_type"] = body.message_type
        if body.entity_refs:
            metadata["entity_refs"] = body.entity_refs
        if body.system_card is not None:
            metadata["system_card"] = body.system_card
        # Who is speaking comes from the login, not the body: in shared mode
        # ``participant_id`` must be one of the caller's own ids and the display
        # name is the server-owned seat name (local no-auth mode keeps the
        # body as its only identity source).
        participant_id, server_display_name = _bind_caller_member(
            request, body.participant_id, room_id=str(room_id)
        )
        display_name = body.display_name if server_display_name is None else server_display_name
        # Sender attribution is resolved HERE, from the roster — never taken
        # from the request body. An AI must not be able to label its own output
        # as human work by posting a metadata field. A sender that is not on the
        # roster records as ("unknown", "unknown"): unattributable beats a
        # fabricated "agent".
        sender_kind, sender_driver = sender_identity(group_store.state(thread_id), participant_id)
        if server_display_name is not None and sender_driver == "ai":
            # The reverse forgery: an authenticated person must not mint an
            # AI-attributed line. AI-side output reaches the room only through
            # server-internal writers (Team Room socket projection, realtime
            # turn persistence, Project OS system cards), never this endpoint.
            raise HTTPException(403, "an authenticated caller cannot post as an AI member")
        metadata["sender_kind"] = sender_kind
        metadata["sender_driver"] = sender_driver
        try:
            canonical_store = _collaboration_store()
            source_message_id = str(metadata.get("source_message_id") or "")
            existing_source = (
                canonical_store.message_by_source_id(thread_id, source_message_id)
                if source_message_id
                else None
            )
            seq = canonical_store.append_message(
                thread_id,
                room_id=room_id,
                text=body.text,
                participant_id=participant_id,
                display_name=display_name,
                metadata=metadata,
            )
            message = canonical_store.message_for_session(thread_id, seq)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if existing_source is None:
            with suppress(Exception):  # legacy transcript projection is best-effort
                _room_message_store().append(
                    room_id,
                    text=body.text,
                    participant_id=participant_id,
                    display_name=display_name,
                    sender_kind=sender_kind,
                    sender_driver=sender_driver,
                )
        background_tasks.add_task(_broadcast_social_change, room_id, thread_id, "message")
        return {"ok": True, "room_id": room_id, "seq": seq, "message": message}

    @router.post(
        "/api/collab/{thread_id}/room-messages/{message_seq}/project-actions",
        dependencies=[Depends(_owner_dep)],
    )
    async def message_project_action(
        thread_id: str,
        message_seq: int,
        body: MessageProjectActionBody,
        request: Request,
    ) -> dict[str, Any]:
        """Promote a room message into Project OS without a second task truth.

        Supported actions are ``link_milestone``, ``create_item``,
        ``record_decision``, and ``publish_artifact``.  The source message is
        enriched with entity references and an idempotent system-card message
        is appended to the room.  ``create_item`` writes Project OS first and
        only then projects the task into collaboration storage.
        """

        room_id = getattr(group_store.state(thread_id), "room_id", None)
        if not room_id:
            raise HTTPException(409, "no room linked to this session — link one first")
        _require_room_member(room_id, request)
        canonical_store = _collaboration_store()
        try:
            message = canonical_store.message_for_session(thread_id, message_seq)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if message is None or str(message.get("room_id") or "") != str(room_id):
            raise HTTPException(404, "room message not found in the linked room")
        from runtime.projectos.message_actions import (
            MessageProjectActionError,
            apply_message_project_action,
        )

        try:
            result = await asyncio.to_thread(
                apply_message_project_action,
                _project_store(),
                canonical_store,
                thread_id=thread_id,
                room_id=str(room_id),
                message=message,
                body=body.model_dump(),
                actor=_actor(request),
            )
        except MessageProjectActionError as exc:
            raise HTTPException(exc.status_code, exc.detail) from exc
        except PermissionError as exc:
            raise HTTPException(404, "project not found") from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        card = result.get("system_card_message")
        broadcaster = getattr(team_rooms_router, "broadcast", None)
        if callable(broadcaster) and isinstance(card, dict) and not result.get("replayed"):
            with suppress(Exception):  # persistence succeeded; live fan-out is best-effort
                await _maybe_await(
                    broadcaster(
                        str(room_id),
                        {
                            "type": "message",
                            "team_id": str(room_id),
                            "thread_id": thread_id,
                            "message_id": str(
                                (card.get("metadata") or {}).get("source_message_id")
                                if isinstance(card.get("metadata"), dict)
                                else f"room-msg-{card.get('seq')}"
                            ),
                            "participant_id": card.get("participant_id") or "project-os",
                            "display_name": card.get("display_name") or "Project OS",
                            "text": card.get("text") or "",
                            "created_at": card.get("ts"),
                            "metadata": card.get("metadata") or {},
                        },
                    )
                )
        return result
