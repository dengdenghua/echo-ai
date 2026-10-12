"""Room-scoped access to messages in the canonical collaboration log."""

from typing import Any

from runtime.memory.cowork.ids import require_cowork_id


def append_message_for_room(
    store: Any,
    room_id: str,
    *,
    text: str,
    participant_id: str = "",
    display_name: str = "",
    metadata: dict[str, Any] | None = None,
) -> int | None:
    room_id = require_cowork_id(room_id, label="room_id")
    session_id = store.session_id_for_room(room_id)
    if not session_id:
        return None
    return store.append_message(
        session_id,
        room_id=room_id,
        text=text,
        participant_id=participant_id,
        display_name=display_name,
        metadata=metadata,
    )
