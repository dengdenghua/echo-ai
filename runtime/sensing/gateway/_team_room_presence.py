"""Worker-local heartbeat timestamps, separate from durable room membership."""

from __future__ import annotations

from .team_rooms_models import TeamRoomWire


def overlay_room_presence(
    rooms: dict[str, TeamRoomWire],
    seen: dict[tuple[str, str], str],
) -> dict[str, TeamRoomWire]:
    valid = {
        (room_id, participant.id)
        for room_id, room in rooms.items()
        for participant in room.participants
        if participant.status != "removed"
    }
    for key in set(seen).difference(valid):
        seen.pop(key, None)
    return {
        room_id: room.model_copy(
            update={
                "participants": [
                    participant.model_copy(update={"last_seen_at": seen[(room_id, participant.id)]})
                    if (room_id, participant.id) in seen
                    else participant
                    for participant in room.participants
                ]
            }
        )
        for room_id, room in rooms.items()
    }
