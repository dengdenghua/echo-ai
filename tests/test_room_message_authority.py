"""An empty/failed canonical source never becomes a different room log."""

from functools import partial
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.room_messages import RoomMessageStore
from runtime.platform.ui._app_agents import _collaboration_room_messages
from runtime.sensing.gateway._cowork_group_session import CoworkGroupSessionView
from runtime.sensing.gateway.team_rooms_router import create_team_rooms_router


@pytest.fixture
def linked_room(tmp_path):
    canonical = CollaborationStore(tmp_path / "canonical")
    legacy = RoomMessageStore(tmp_path / "legacy")
    app = FastAPI()
    app.state.collaboration_store = canonical

    def write(room_id, message):
        return canonical.append_message_for_room(room_id, **message)

    app.include_router(
        create_team_rooms_router(
            state_path=tmp_path / "rooms.json",
            room_message_store=legacy,
            room_projection=canonical.upsert_room_by_id,
            room_message_projection=write,
            room_message_provider=partial(_collaboration_room_messages, app),
        )
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/teams",
            json={
                "name": "Source",
                "thread_id": "thread-source",
                "members": [{"name": "general", "display_name": "General"}],
                "leaderId": "general",
            },
        )
        assert response.status_code == 200, response.text
        yield client, canonical, legacy, response.json()["id"]


@pytest.mark.parametrize("params", [{"after_seq": 1}, {"q": "obsolete"}])
def test_empty_canonical_http_result_does_not_resurrect_shadow(linked_room, params):
    client, canonical, legacy, room_id = linked_room
    canonical.append_message_for_room(room_id, text="current", participant_id="owner-local")
    legacy.append(room_id, text="obsolete shadow", participant_id="old")
    response = client.get(f"/api/teams/{room_id}/messages", params=params)
    assert response.status_code == 200
    assert response.json()["messages"] == []
    assert legacy.history(room_id)[0]["text"] == "obsolete shadow"


def test_canonical_read_error_is_retryable_without_shadow_or_error_leak(linked_room, monkeypatch):
    client, canonical, legacy, room_id = linked_room
    legacy.append(room_id, text="obsolete shadow")

    def failed(*args, **kwargs):
        raise RuntimeError("private-storage-path")

    monkeypatch.setattr(canonical, "messages_for_room", failed)
    response = client.get(f"/api/teams/{room_id}/messages")
    assert response.status_code == 503
    assert response.json() == {"detail": "Room messages are temporarily unavailable"}
    assert "private-storage-path" not in response.text and "obsolete" not in response.text


def test_canonical_write_failure_never_acknowledges_legacy_and_same_retry_is_once(
    linked_room, monkeypatch
):
    client, canonical, legacy, room_id = linked_room
    append = canonical.append_message_for_room

    def failed(*args, **kwargs):
        raise RuntimeError("private-storage-path")

    monkeypatch.setattr(canonical, "append_message_for_room", failed)
    with client.websocket_connect(
        f"/api/teams/{room_id}/ws?participant_id=owner-local&display_name=Owner"
    ) as socket:
        assert socket.receive_json()["type"] == "ready"
        assert socket.receive_json()["type"] == "presence"
        message = {"type": "message", "text": "durable retry", "client_message_id": "client-one"}
        socket.send_json(message)
        error = socket.receive_json()
        assert error["type"] == "message:error" and error["retryable"]
        assert error["code"] == "message_persistence_failed"
        assert "private-storage-path" not in str(error)
        assert canonical.messages_for_room(room_id) == legacy.history(room_id) == []
        monkeypatch.setattr(canonical, "append_message_for_room", append)
        message_ids = []
        for _ in range(2):
            socket.send_json(message)
            acknowledgement = socket.receive_json()
            assert acknowledgement["type"] == "message"
            assert acknowledgement["delivery_status"] == "sent"
            assert acknowledgement["seq"] == 1
            message_ids.append(acknowledgement["message_id"])
        assert message_ids[0] == message_ids[1]
    assert [message["text"] for message in canonical.messages_for_room(room_id)] == [
        "durable retry"
    ]


def test_explicit_no_canonical_source_retains_standalone_history(tmp_path):
    legacy = RoomMessageStore(tmp_path / "legacy")
    legacy.append("standalone", text="original line")
    app = FastAPI()
    app.include_router(
        create_team_rooms_router(
            state_path=tmp_path / "rooms.json",
            room_message_store=legacy,
            room_message_provider=lambda *_: None,
        )
    )
    with TestClient(app) as client:
        response = client.get("/api/teams/standalone/messages")
        assert response.status_code == 200
        assert response.json()["messages"][0]["text"] == "original line"


def test_empty_linked_session_search_keeps_canonical_source(tmp_path):
    canonical = CollaborationStore(tmp_path / "canonical")
    canonical.upsert_room("thread-source", {"id": "room-source", "name": "Source"})
    canonical.append_message_for_room("room-source", text="current")
    legacy = RoomMessageStore(tmp_path / "legacy")
    legacy.append("room-source", text="obsolete shadow")
    view = CoworkGroupSessionView(
        group_store=SimpleNamespace(),
        collaboration_store=lambda: canonical,
        async_store=lambda: None,
        presence_store=lambda: None,
        room_message_store=lambda: legacy,
        team_rooms_state_path=tmp_path / "missing-rooms.json",
        team_tasks_state_path=tmp_path / "tasks.json",
    )
    assert view.room_messages("thread-source", "room-source")[0]["text"] == "current"
    assert view.message_search("thread-source").search("room-source", "obsolete") == []


def test_provider_explicit_empty_source_never_reads_legacy(tmp_path):
    legacy = RoomMessageStore(tmp_path / "legacy")
    legacy.append("room-empty", text="obsolete shadow")
    app = FastAPI()
    app.include_router(
        create_team_rooms_router(
            state_path=tmp_path / "rooms.json",
            room_message_store=legacy,
            room_message_provider=lambda *_: [],
        )
    )
    with TestClient(app) as client:
        response = client.get("/api/teams/room-empty/messages")
        assert response.status_code == 200
        assert response.json()["messages"] == []
