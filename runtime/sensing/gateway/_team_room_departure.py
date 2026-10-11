"""Scoped socket departure and floor maintenance, separate from WS framing."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from ._team_room_presence import room_presence_scope
from .team_speaker_policy import _TURN_POLICIES, _next_speaker, _normalize_speaker_policy, _now

if TYPE_CHECKING:
    from .team_rooms_models import TeamRoomWire


def disconnect_room(ctx: Any, ws: Any, team_id: str, participant_id: str) -> TeamRoomWire | None:
    ctx.refresh()
    floor_broadcast: TeamRoomWire | None = None
    with ctx.lock:
        room = ctx.live_sockets.get(team_id)
        owns_presence = bool(room and room.get(participant_id) is ws)
        if owns_presence and room is not None:
            room.pop(participant_id, None)
            ctx.socket_loops.get(team_id, {}).pop(participant_id, None)
        current = ctx.teams.get(team_id)
        if current is not None and owns_presence:
            left_at = _now()
            ctx.presence_seen[(team_id, participant_id)] = left_at
            peer_online = False
            if ctx.live_presence is not None:
                ctx.live_presence.prepare(
                    "room",
                    room_presence_scope(current),
                    [{"member_id": participant_id, "last_seen_at": left_at, "online": False}],
                    complete=False,
                )
                peer_online = bool(
                    ctx.live_presence.values("room", room_presence_scope(current))
                    .get(participant_id, {})
                    .get("online")
                )
            participants = [
                p.model_copy(
                    update={
                        "last_seen_at": left_at,
                        "status": "active" if peer_online else "offline",
                    }
                )
                if p.id == participant_id and p.status != "removed"
                else p
                for p in current.participants
            ]
            updates: dict[str, Any] = {
                "participants": participants,
                "updated_at": left_at,
            }
            # Keep turn-based rooms live if the floor holder drops:
            # round_robin advances past them, roll_call/moderated
            # re-open the floor. Also drop them from the hand queue.
            policy_now = _normalize_speaker_policy(current.speaker_policy)
            if (
                not peer_online
                and policy_now in _TURN_POLICIES
                and current.current_speaker_id == participant_id
            ):
                rebuilt = current.model_copy(update={"participants": participants})
                updates["current_speaker_id"] = (
                    _next_speaker(rebuilt, participant_id) if policy_now == "round_robin" else None
                )
            if not peer_online and participant_id in (current.floor_requests or []):
                updates["floor_requests"] = [
                    q for q in current.floor_requests if q != participant_id
                ]
            new_team = current.model_copy(update=updates)
            ctx.teams[team_id] = new_team
            ctx.save()
            if "current_speaker_id" in updates or "floor_requests" in updates:
                floor_broadcast = new_team
    return floor_broadcast
