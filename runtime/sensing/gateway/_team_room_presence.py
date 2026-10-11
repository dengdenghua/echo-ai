"""Worker-local heartbeat timestamps, separate from durable room membership."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from .team_rooms_models import TeamRoomWire


def room_presence_scope(room: TeamRoomWire) -> str:
    """Tenant-scoped cache keys even for independently served data homes."""
    raw = json.dumps([room.tenant_id, room.id], ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def overlay_room_presence(
    rooms: dict[str, TeamRoomWire],
    seen: dict[tuple[str, str], str],
    live: Any = None,
) -> dict[str, TeamRoomWire]:
    valid = {
        (room_id, participant.id)
        for room_id, room in rooms.items()
        for participant in room.participants
        if participant.status != "removed"
    }
    for key in set(seen).difference(valid):
        seen.pop(key, None)
    live_seen = {
        (room_id, participant_id): value["last_seen_at"]
        for room_id, room in rooms.items()
        for participant_id, value in (
            live.values("room", room_presence_scope(room)).items() if live is not None else []
        )
    }

    def epoch(value: str) -> float:
        stamp = datetime.fromisoformat(value)
        return (stamp if stamp.tzinfo else stamp.replace(tzinfo=UTC)).timestamp()

    combined = dict(live_seen)
    for key, value in seen.items():
        if key not in combined or epoch(value) > epoch(combined[key]):
            combined[key] = value
    return {
        room_id: room.model_copy(
            update={
                "participants": [
                    participant.model_copy(
                        update={"last_seen_at": combined[(room_id, participant.id)]}
                    )
                    if (room_id, participant.id) in combined
                    else participant
                    for participant in room.participants
                ]
            }
        )
        for room_id, room in rooms.items()
    }
