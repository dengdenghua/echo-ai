"""Best-effort wake-up hints after authoritative collaboration writes."""

from __future__ import annotations

import logging
from typing import Any

_logger = logging.getLogger(__name__)


async def broadcast_thread_update(
    router: Any, *, room_id: str, thread_id: str, reason: str
) -> None:
    broadcast = getattr(router, "broadcast", None)
    if not room_id or not callable(broadcast):
        return
    try:
        await broadcast(
            room_id,
            {
                "type": "thread:update",
                "thread_id": thread_id,
                "reason": reason,
                "participant_id": "",
            },
        )
    except Exception:  # noqa: BLE001 — a notification cannot undo a committed write
        _logger.warning("collaboration notification failed for %s", thread_id, exc_info=True)
