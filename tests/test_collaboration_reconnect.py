import asyncio
from threading import Lock
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.memory.cowork.group_store import GroupStore
from runtime.memory.cowork.session import link_room
from runtime.sensing.gateway.cowork_group_router import create_cowork_group_router
from runtime.sensing.gateway.team_rooms_router import (
    TeamParticipantWire,
    TeamRoomWire,
    create_team_rooms_router,
)
from runtime.sensing.gateway.team_rooms_ws import broadcast_authorized_team_sockets


def test_closing_replaced_socket_keeps_current_connection_online(tmp_path):
    app = FastAPI()
    app.include_router(create_team_rooms_router(state_path=tmp_path / "rooms.json"))
    with TestClient(app) as client:
        room = client.post(
            "/api/teams",
            json={
                "id": "reconnect",
                "name": "Reconnect",
                "members": [{"name": "general"}],
                "leaderId": "general",
            },
        ).json()
        path = f"/api/teams/{room['id']}/ws?participant_id=alice&thread_id=t"
        old_context = client.websocket_connect(path, subprotocols=["bearer.b64", "dGVzdC10b2tlbg"])
        old = old_context.__enter__()
        assert old.accepted_subprotocol == "bearer.b64"
        assert old.receive_json()["type"] == "ready"
        old.receive_json()
        try:
            with client.websocket_connect(path) as replacement:
                assert replacement.receive_json()["type"] == "ready"
                replacement.receive_json()
                old_context.__exit__(None, None, None)
                old_context = None
                current = client.get(f"/api/teams/{room['id']}").json()
                alice = next(p for p in current["participants"] if p["id"] == "alice")
                assert alice["status"] == "active"
        finally:
            if old_context is not None:
                old_context.__exit__(None, None, None)


def test_failed_old_broadcast_does_not_evict_replacement_socket():
    async def scenario():
        replacement = SimpleNamespace(send_json=AsyncMock())
        live = {"room": {}}
        loops = {"room": {"alice": asyncio.get_running_loop()}}

        async def fail_after_reconnect(_payload):
            live["room"]["alice"] = replacement
            raise OSError("old connection disconnected")

        old = SimpleNamespace(send_json=fail_after_reconnect)
        live["room"]["alice"] = old
        rooms = {
            "room": TeamRoomWire(
                id="room",
                name="Room",
                members=[],
                leaderId=None,
                created_at="2026-09-26T00:00:00Z",
                updated_at="2026-09-26T00:00:00Z",
                participants=[
                    TeamParticipantWire(
                        id="alice",
                        display_name="Alice",
                        role="member",
                        joined_at="2026-09-26T00:00:00Z",
                    )
                ],
            )
        }
        await broadcast_authorized_team_sockets(
            team_id="room",
            payload={"type": "test"},
            teams=rooms,
            lock=Lock(),
            live_sockets=live,
            socket_loops=loops,
            refresh=lambda: None,
        )
        assert live["room"]["alice"] is replacement
        assert loops["room"]["alice"] is asyncio.get_running_loop()

    asyncio.run(scenario())


def test_social_writes_notify_peers_without_a_sender_websocket(tmp_path):
    groups = GroupStore(base_dir=tmp_path)
    link_room(groups, "thread", "room")
    broadcast = AsyncMock()
    app = FastAPI()
    app.include_router(
        create_cowork_group_router(
            store=groups,
            team_rooms_router=SimpleNamespace(broadcast=broadcast),
        )
    )
    with TestClient(app) as client:
        for path, body, reason in [
            ("reactions", {"message_id": "message", "emoji": "👍"}, "reaction"),
            ("pinned-messages", {"message_id": "message"}, "pin"),
            ("annotations", {"message_id": "message", "body": "review"}, "annotation"),
        ]:
            response = client.post(f"/api/collab/thread/{path}", json=body)
            assert response.status_code == 200, response.text
            broadcast.assert_awaited_with(
                "room",
                {
                    "type": "thread:update",
                    "thread_id": "thread",
                    "reason": reason,
                    "participant_id": "",
                },
            )
        broadcast.side_effect = OSError("peer disconnected")
        response = client.post(
            "/api/collab/thread/reactions", json={"message_id": "message", "emoji": "👍"}
        )
        assert response.status_code == 200
        assert response.json()["reaction"]["count"] == 0
