"""Local socket delivery plus tenant-fenced cross-worker room wake-ups."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Any

from runtime.memory.cowork.transient_presence import TransientPresence
from runtime.platform.process.shared_pubsub import RedisPubSub, SharedPubSubUnavailable

from ._team_room_presence import room_presence_scope
from .team_rooms_ws import broadcast_authorized_team_sockets
from .team_speaker_policy import _normalize_speaker_policy, _now, _resolve_moderator

_LOG = logging.getLogger(__name__)


class TeamRoomBroadcast:
    def __init__(
        self,
        *,
        teams,
        lock,
        sockets,
        loops,
        refresh,
        room_payload,
        seen: dict[tuple[str, str], str],
        live: TransientPresence,
        bus: RedisPubSub | None,
    ) -> None:
        self.teams, self.lock, self.sockets, self.loops = teams, lock, sockets, loops
        self.refresh, self.room_payload, self.seen = refresh, room_payload, seen
        self.live, self.bus = live, bus
        self._socket_tenants: dict[str, str] = {}
        if bus is not None:
            bus.subscribe("room:frame", self._receive)

    async def local(self, team_id, payload, *, exclude=None, include=None) -> None:
        await broadcast_authorized_team_sockets(
            team_id=team_id,
            payload=payload,
            teams=self.teams,
            lock=self.lock,
            live_sockets=self.sockets,
            socket_loops=self.loops,
            refresh=self.refresh,
            exclude=exclude,
            include=include,
        )

    async def broadcast(
        self,
        team_id: str,
        payload: dict[str, Any] | Callable[[], dict[str, Any]],
        *,
        exclude: str | None = None,
        include: str | None = None,
    ) -> None:
        await self.local(team_id, payload, exclude=exclude, include=include)
        if self.bus is None:
            return
        with self.lock:
            team = self.teams.get(team_id)
            if team is None:
                return
            message = payload() if callable(payload) else payload
            if message.get("type") in {"ready", "pong"}:
                return
            envelope = {
                "room_id": team_id,
                "tenant_id": team.tenant_id,
                "message": message,
                "exclude": exclude,
                "include": include,
            }
        try:
            await asyncio.to_thread(self.bus.publish, "room:frame", envelope)
        except (SharedPubSubUnavailable, ValueError):
            _LOG.warning("shared room wake-up unavailable; durable catch-up required")

    def _presence_payload(self, team_id: str) -> dict[str, Any]:
        team = self.teams.get(team_id)
        participants = team.participants if team is not None else []
        recorded = self.live.values("room", room_presence_scope(team)) if team is not None else {}
        online = {key for key, value in recorded.items() if value["online"]}
        visible = [p.model_dump() for p in participants if p.status != "removed" and p.id in online]
        for participant in visible:
            participant["last_seen_at"] = recorded[participant["id"]]["last_seen_at"]
            participant["status"] = "active"
        return {
            "type": "presence",
            "team_id": team_id,
            "participants": visible,
            "count": len(visible),
            "server_time": _now(),
        }

    async def presence(self, team_id: str) -> None:
        with self.lock:
            team = self.teams.get(team_id)
            if team is None:
                return
            if self.sockets.get(team_id):
                self._socket_tenants[team_id] = team.tenant_id
            else:
                self._socket_tenants.pop(team_id, None)
            entries = [
                {
                    "member_id": participant,
                    "last_seen_at": self.seen.get((team_id, participant), _now()),
                    "online": True,
                }
                for participant in self.sockets.get(team_id, {})
            ]
            prepared = self.live.prepare("room", room_presence_scope(team), entries)
        try:
            await asyncio.to_thread(self.live.publish_prepared, prepared)
        except SharedPubSubUnavailable:
            _LOG.warning("shared room presence unavailable")
        await self.broadcast(team_id, lambda: self._presence_payload(team_id))

    async def team_update(self, team_id: str, team) -> None:
        await self.broadcast(
            team_id,
            {
                "type": "team:update",
                "team_id": team_id,
                "team": self.room_payload(team),
                "server_time": _now(),
            },
        )

    def _floor_payload(self, team_id, team) -> dict[str, Any]:
        return {
            "type": "floor",
            "team_id": team_id,
            "speaker_policy": _normalize_speaker_policy(team.speaker_policy),
            "current_speaker_id": team.current_speaker_id,
            "moderator_id": _resolve_moderator(team),
            "floor_requests": list(team.floor_requests or []),
            "server_time": _now(),
        }

    async def floor(self, team_id: str, team) -> None:
        await self.broadcast(team_id, self._floor_payload(team_id, team))

    def deleted(self, team_id: str, tenant_id: str) -> None:
        """A committed deletion invalidates sockets, never recreates a room."""
        with self.lock:
            self._socket_tenants.pop(team_id, None)

        async def close_local() -> None:
            await asyncio.wait_for(self.local(team_id, {"type": "team:deleted"}), timeout=2.0)

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            try:
                asyncio.run(close_local())
            except (ConnectionError, TimeoutError, OSError, RuntimeError):
                _LOG.warning("deleted room socket cleanup incomplete")
        else:
            task = loop.create_task(close_local())

            def finished(result) -> None:
                if not result.cancelled() and result.exception() is not None:
                    _LOG.warning("deleted room socket cleanup incomplete")

            task.add_done_callback(finished)
        if self.bus is not None:
            try:
                self.bus.publish(
                    "room:frame",
                    {
                        "room_id": team_id,
                        "tenant_id": tenant_id,
                        "message": {"type": "team:deleted"},
                    },
                )
            except (SharedPubSubUnavailable, ValueError):
                _LOG.warning("shared deletion wake-up unavailable; canonical deletion retained")

    def _receive(self, event: dict[str, Any]) -> None:
        data = event["payload"]
        room_id, tenant_id = data.get("room_id"), data.get("tenant_id")
        message = data.get("message")
        if (
            not isinstance(room_id, str)
            or not isinstance(tenant_id, str)
            or not isinstance(message, dict)
        ):
            return
        if not all(
            data.get(key) is None or isinstance(data[key], str) for key in ("exclude", "include")
        ):
            return
        self.refresh()
        with self.lock:
            team = self.teams.get(room_id)
            if team is None:
                if (
                    message.get("type") != "team:deleted"
                    or self._socket_tenants.get(room_id) != tenant_id
                ):
                    return
                self._socket_tenants.pop(room_id, None)
            elif team.tenant_id != tenant_id or message.get("type") == "team:deleted":
                return
            kind = message.get("type")
            if kind in {"ready", "pong"}:
                return
            if kind == "presence":
                message = self._presence_payload(room_id)
            elif kind == "team:update" and team is not None:
                message = {**message, "team": self.room_payload(team)}
            elif kind == "floor" and team is not None:
                message = self._floor_payload(room_id, team)

        async def deliver() -> None:
            await asyncio.wait_for(
                self.local(
                    room_id, message, exclude=data.get("exclude"), include=data.get("include")
                ),
                timeout=2.0,
            )

        asyncio.run(deliver())
