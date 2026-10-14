"""Compose the Room transcript authority and its HTTP/WebSocket consumers."""

import logging
from pathlib import Path
from typing import Any

from fastapi import WebSocket

from runtime.memory.cowork.room_transcript import RoomTranscript
from runtime.sensing.gateway._team_room_messages import register_room_message_reader
from runtime.sensing.gateway.team_rooms_ws import team_room_ws


def register_team_transcript(
    router: Any,
    ctx: Any,
    *,
    state_path: Path | None,
    canonical_store: Any,
    legacy_store: Any,
    provider: Any,
    message_projection: Any,
    receipt_projection: Any,
    require_member: Any,
) -> None:
    source = [legacy_store]

    def legacy():
        if source[0] is None:
            from runtime.memory.cowork.room_messages import RoomMessageStore

            source[0] = RoomMessageStore(state_path.parent / "teamroom" if state_path else None)
        return source[0]

    authority = None
    if canonical_store is not None:

        def restore(room_id):
            snapshot = router.team_snapshot(room_id)
            if snapshot is None:
                raise RuntimeError("durable Room is missing")
            canonical_store.upsert_room_by_id(snapshot)

        authority = RoomTranscript(canonical_store, legacy, restore_room=restore)
        for room_id in list(ctx.teams):
            try:
                restore(room_id)
                authority.ensure(room_id)
            except Exception:  # noqa: BLE001 - one failed migration remains unavailable and retryable
                logging.getLogger(__name__).warning(
                    "Room transcript adoption failed for %s", room_id, exc_info=True
                )
        ctx.transcript = authority
    else:
        ctx.message_store = legacy()
        ctx.message_projection = message_projection
        ctx.receipt_projection = receipt_projection
    router.room_transcript = authority
    router.legacy_room_messages = legacy
    register_room_message_reader(
        router,
        require_member=require_member,
        provider=provider,
        legacy_store=source[0],
        transcript=authority,
    )

    @router.websocket("/api/teams/{team_id}/ws")
    async def socket(ws: WebSocket, team_id: str) -> None:
        await team_room_ws(ctx, ws, team_id)
