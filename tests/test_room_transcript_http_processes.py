"""Canonical Room recovery and receipts through two independently served workers."""

import json
import sqlite3
from uuid import uuid4

import httpx
import pytest
from websockets.sync.client import connect

from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.room_messages import RoomMessageStore
from tests import test_shared_collaboration_pubsub as shared

real_redis = shared.real_redis
_frame = shared._frame
_workers = shared._workers


@pytest.mark.integration
def test_two_workers_share_import_cursor_retry_identity_and_actual_receipts(real_redis, tmp_path):
    headers = {"Authorization": "Bearer key-alice"}
    with (
        _workers(tmp_path, real_redis, uuid4().hex, canonical=True) as ports,
        httpx.Client(base_url=f"http://127.0.0.1:{ports[0]}", headers=headers) as first_api,
        httpx.Client(base_url=f"http://127.0.0.1:{ports[1]}", headers=headers) as second_api,
    ):
        response = first_api.post(
            "/api/teams", json={"name": "Canonical", "members": [{"name": "agent"}]}
        )
        assert response.status_code == 200, response.text
        room = response.json()
        room_id = room["id"]
        owner = next(p for p in room["participants"] if p["id"] == "owner-alice")
        legacy = RoomMessageStore(tmp_path / "teamroom")
        legacy.append(
            room_id,
            text="original",
            message_id="original-id",
            participant_id=owner["id"],
            display_name=owner["display_name"],
            client_message_id="old-client",
        )
        canonical = CollaborationStore(tmp_path / "canonical")
        canonical.append_message_for_room(
            room_id, text="canonical new", metadata={"message_id": "canonical-new"}
        )
        first = first_api.get(f"/api/teams/{room_id}/messages").json()
        assert [m["text"] for m in first["messages"]] == ["original", "canonical new"]
        second = second_api.get(
            f"/api/teams/{room_id}/messages",
            params={"after_seq": 1, "cursor_epoch": first["cursor_epoch"]},
        ).json()
        assert [m["seq"] for m in second["messages"]] == [2] and not second["cursor_reset"]
        with pytest.raises(sqlite3.IntegrityError):
            legacy.append(room_id, text="stale writer")
        endpoint = f"/api/teams/{room_id}/ws?participant_id=owner-alice"
        with (
            connect(f"ws://127.0.0.1:{ports[0]}{endpoint}", additional_headers=headers) as one,
            connect(f"ws://127.0.0.1:{ports[1]}{endpoint}", additional_headers=headers) as two,
        ):
            ready_one, _ = _frame(one, lambda e: e.get("type") == "ready")
            ready_two, _ = _frame(two, lambda e: e.get("type") == "ready")
            assert ready_one["cursor_epoch"] == ready_two["cursor_epoch"] == first["cursor_epoch"]
            for socket in (one, two):
                socket.send(
                    json.dumps(
                        {
                            "type": "message",
                            "text": "original",
                            "client_message_id": "old-client",
                        }
                    )
                )
                acknowledged, _ = _frame(socket, lambda e: e.get("type") == "message")
                assert acknowledged["message_id"] == "original-id" and acknowledged["seq"] == 1
            two.send(json.dumps({"type": "message:read", "message_id": "original-id", "seq": 999}))
            receipt, _ = _frame(one, lambda e: e.get("type") == "message:receipt")
            assert receipt["seq"] == 1 and receipt["status"] == "read"
            restored = first_api.get(f"/api/teams/{room_id}/messages").json()
            assert len(restored["messages"]) == 2
            assert restored["messages"][0]["receipts"][0]["seq"] == 1
        with _workers(tmp_path, real_redis, uuid4().hex, canonical=True) as restarted_ports:
            restored = httpx.get(
                f"http://127.0.0.1:{restarted_ports[0]}/api/teams/{room_id}/messages",
                headers=headers,
            ).json()
            assert restored["cursor_epoch"] == first["cursor_epoch"]
            assert [m["text"] for m in restored["messages"]] == ["original", "canonical new"]
