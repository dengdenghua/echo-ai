"""Read the chosen room transcript without switching sources on empty pages."""

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException, Request


def register_room_message_reader(
    router: APIRouter,
    *,
    require_member: Callable[[Request, str], Any],
    provider: Callable[[str, int, int, str], list[dict[str, Any]] | None] | None,
    legacy_store: Any,
    transcript: Any = None,
) -> None:
    @router.get("/api/teams/{team_id}/messages")
    def get_room_messages(
        request: Request,
        team_id: str,
        limit: int = 200,
        after_seq: int = 0,
        q: str = "",
        cursor_epoch: str = "",
    ) -> dict[str, Any]:
        """Durable room transcript — reconnect catch-up (``after_seq``) and
        search (``q``). Closes the gap where room chat was live-only / a 20-line
        in-memory ring."""
        require_member(request, team_id)
        if transcript is not None:
            try:
                return transcript.page(
                    team_id, limit=limit, after_seq=after_seq, query=q, cursor_epoch=cursor_epoch
                )
            except Exception as exc:  # noqa: BLE001 - no alternate source on migration/read failure
                raise HTTPException(503, "Room messages are temporarily unavailable") from exc
        messages: list[dict[str, Any]] | None = None
        if provider is not None:
            try:
                messages = provider(team_id, limit, after_seq, q)
            except Exception as exc:  # noqa: BLE001 - sanitize source failure
                raise HTTPException(503, "Room messages are temporarily unavailable") from exc
        if messages is None:
            if q.strip():
                messages = legacy_store.search(team_id, q, limit=limit)
            else:
                messages = legacy_store.history(team_id, limit=limit, after_seq=after_seq)
        return {"team_id": team_id, "messages": messages}
