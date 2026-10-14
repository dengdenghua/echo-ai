"""Self-scoped cowork writes are bound to the login, not to the request body.

Room messages, read markers and presence heartbeats name a member; in shared
(authenticated) mode that member must be the caller. Annotation deletion is
limited to the author or a thread/room admin and never crosses threads. Local
no-auth mode keeps its single-user, self-named contract.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.group import MemberEvent
from runtime.memory.cowork.group_store import GroupStore
from runtime.memory.cowork.room_messages import RoomMessageStore
from runtime.memory.cowork.session import link_room
from runtime.memory.threads.store import ThreadStateStore
from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.cowork_group_router import create_cowork_group_router

THREAD = "project-thread"
ROOM = "room-a"


class _Rooms:
    """Role-aware stand-in for the Team Room router's participant resolver."""

    roles = {
        "alice": "owner",  # also the thread owner
        "erin": "admin",  # room admin, not the thread owner
        "bob": "member",
        "dan": "member",
        "worker": "member",  # a person whose actor id collides with an agent
    }

    def get_room_participant(
        self,
        room_id: str,
        actor_id: str,
        tenant_id: str | None = None,
    ) -> dict[str, Any] | None:
        role = self.roles.get(actor_id)
        if room_id != ROOM or tenant_id != "tenant-a" or role is None:
            return None
        return {
            "id": f"actor-{actor_id}",
            "actor_id": actor_id,
            "display_name": actor_id.title(),
            "role": role,
            "status": "active",
        }


def _headers(actor: str) -> dict[str, str]:
    return {"Authorization": f"Bearer sk-{actor}"}


def _shared_client(tmp_path: Path) -> tuple[TestClient, GroupStore, CollaborationStore]:
    identities = IdentityStore()
    for actor in _Rooms.roles:
        identities.add(
            Identity(actor_id=actor, metadata={"tenant_id": "tenant-a"}),
            api_key_plaintext=f"sk-{actor}",
        )
    threads = ThreadStateStore()
    threads.ensure_thread(
        THREAD,
        metadata={"owner_actor_id": "alice", "tenant_id": "tenant-a"},
        values={"title": "Shared launch"},
    )
    groups = GroupStore(base_dir=tmp_path / "cowork")
    link_room(groups, THREAD, ROOM, actor="alice")
    for target_id, kind in (("alice", "human"), ("planner", "agent"), ("worker", "agent")):
        groups.append(
            THREAD,
            MemberEvent(action="invite", actor="alice", target_id=target_id, target_kind=kind),
        )
    collaboration = CollaborationStore(base_dir=tmp_path / "cowork")
    collaboration.upsert_room(THREAD, {"id": ROOM, "name": "Launch", "tenant_id": "tenant-a"})
    app = FastAPI()
    app.include_router(
        create_cowork_group_router(
            store=groups,
            collaboration_store=collaboration,
            room_message_store=RoomMessageStore(base_dir=tmp_path / "rooms"),
            team_rooms_router=_Rooms(),
            runtime=SimpleNamespace(thread_store=threads),
            identity_store=identities,
            require_auth=True,
        )
    )
    return TestClient(app), groups, collaboration


def _post(client: TestClient, actor: str, **body: Any):
    return client.post(
        f"/api/collab/{THREAD}/room-message",
        headers=_headers(actor),
        json={"text": "hello", **body},
    )


def test_member_cannot_post_room_message_as_another_member(tmp_path: Path) -> None:
    client, _groups, collaboration = _shared_client(tmp_path)

    # The audit PoC: bob claiming a human member and an AI member.
    assert _post(client, "bob", participant_id="alice", display_name="Alice").status_code == 403
    assert _post(client, "bob", participant_id="planner").status_code == 403
    assert collaboration.messages_for_session(THREAD) == []

    # With no id the server derives it from the login; the display name and
    # sender attribution are server-owned even if the body tries otherwise.
    own = _post(
        client,
        "bob",
        display_name="Alice",
        metadata={"sender_kind": "agent", "sender_driver": "ai"},
    )
    assert own.status_code == 200, own.text
    message = own.json()["message"]
    assert message["participant_id"] == "bob"
    assert message["display_name"] == "Bob"
    assert message["metadata"]["sender_kind"] == "unknown"
    assert message["metadata"]["sender_driver"] == "unknown"

    # The caller may still name ids it provably owns: its actor id (what the
    # web client sends) or its own room seat.
    for claimed in ("bob", "actor-bob"):
        response = _post(client, "bob", participant_id=claimed)
        assert response.status_code == 200, response.text
        assert response.json()["message"]["participant_id"] == claimed

    # A human roster member is attributed from the roster, not the body.
    alice = _post(client, "alice", participant_id="alice", display_name="Mallory")
    assert alice.status_code == 200, alice.text
    assert alice.json()["message"]["display_name"] == "Alice"
    assert alice.json()["message"]["metadata"]["sender_kind"] == "human"
    assert {m["participant_id"] for m in collaboration.messages_for_session(THREAD)} == {
        "bob",
        "actor-bob",
        "alice",
    }


def test_authenticated_caller_cannot_mint_an_ai_attributed_message(tmp_path: Path) -> None:
    client, _groups, collaboration = _shared_client(tmp_path)

    # Even its *own* id may not land as an AI line when the roster says that
    # id is an AI-driven member: AI output enters through server writers only.
    for claimed in ("", "worker"):
        assert _post(client, "worker", participant_id=claimed).status_code == 403
    assert collaboration.messages_for_session(THREAD) == []


def test_read_and_heartbeat_cannot_mark_another_member(tmp_path: Path) -> None:
    client, _groups, _collaboration = _shared_client(tmp_path)
    bob = _headers("bob")

    for member_id in ("alice", "planner", "actor-alice"):
        read = client.post(
            f"/api/cowork/{THREAD}/read",
            headers=bob,
            json={"member_id": member_id, "message_seq": 9},
        )
        assert read.status_code == 403
        beat = client.post(
            f"/api/cowork/{THREAD}/heartbeat",
            headers=bob,
            json={"member_id": member_id},
        )
        assert beat.status_code == 403

    presence = client.get(f"/api/cowork/{THREAD}/presence", headers=bob).json()["members"]
    alice = next(member for member in presence if member["member_id"] == "alice")
    assert alice["online"] is False
    assert alice["last_read_message_seq"] == 0

    # Own ids still work: the actor id and the caller's own room seat.
    for member_id in ("bob", "actor-bob"):
        beat = client.post(
            f"/api/cowork/{THREAD}/heartbeat",
            headers=bob,
            json={"member_id": member_id},
        )
        assert beat.status_code == 200, beat.text
        assert beat.json()["last_seen_at"]
        read = client.post(
            f"/api/cowork/{THREAD}/read",
            headers=bob,
            json={"member_id": member_id, "message_seq": 3},
        )
        assert read.status_code == 200, read.text
        assert read.json()["last_read_message_seq"] == 3


def _annotate(client: TestClient, actor: str) -> str:
    created = client.post(
        f"/api/collab/{THREAD}/annotations",
        headers=_headers(actor),
        json={"message_id": "thread:message-1", "body": f"note from {actor}"},
    )
    assert created.status_code == 200, created.text
    return created.json()["annotation"]["annotation_id"]


def _delete(client: TestClient, actor: str, annotation_id: str) -> int:
    return client.delete(
        f"/api/collab/{THREAD}/annotations/{annotation_id}",
        headers=_headers(actor),
    ).status_code


def test_only_author_or_admin_can_delete_an_annotation(tmp_path: Path) -> None:
    client, _groups, collaboration = _shared_client(tmp_path)
    bobs = _annotate(client, "bob")
    reply = client.post(
        f"/api/collab/{THREAD}/annotations/{bobs}/replies",
        headers=_headers("dan"),
        json={"body": "replying"},
    )
    assert reply.status_code == 200

    # A fellow member (even one who replied) cannot delete it.
    assert _delete(client, "dan", bobs) == 403
    assert [a["annotation_id"] for a in collaboration.annotations_for_session(THREAD)] == [bobs]
    assert _delete(client, "bob", bobs) == 200
    assert collaboration.annotations_for_session(THREAD) == []

    # The thread owner and a room admin moderate others' annotations.
    for moderator in ("alice", "erin"):
        dans = _annotate(client, "dan")
        assert _delete(client, moderator, dans) == 200
    assert collaboration.annotations_for_session(THREAD) == []
    assert _delete(client, "bob", "annotation-missing") == 404


def test_annotation_delete_never_reaches_another_threads_replies(tmp_path: Path) -> None:
    store = CollaborationStore(base_dir=tmp_path / "cowork")
    annotation = store.add_annotation(
        "thread-a",
        room_id="room-a",
        message_id="thread:message-1",
        author_id="alice",
        author={"display_name": "Alice"},
        body="keep me",
    )
    annotation_id = annotation["annotation_id"]
    assert store.add_annotation_reply(
        "thread-a",
        annotation_id,
        author_id="bob",
        author={"display_name": "Bob"},
        body="and my reply",
    )

    # A caller with access to thread-b names thread-a's annotation id.
    assert store.delete_annotation("thread-b", annotation_id) is False
    [kept] = store.annotations_for_session("thread-a")
    assert [reply["body"] for reply in kept["replies"]] == ["and my reply"]

    assert store.annotation_author_id("thread-b", annotation_id) is None
    assert store.annotation_author_id("thread-a", annotation_id) == "alice"
    assert store.delete_annotation("thread-a", annotation_id) is True
    assert store.annotations_for_session("thread-a") == []


def test_local_no_auth_mode_keeps_the_self_named_single_user_flow(tmp_path: Path) -> None:
    group_store = GroupStore(base_dir=tmp_path / "cowork")
    collaboration = CollaborationStore(base_dir=tmp_path / "cowork")
    app = FastAPI()
    app.include_router(
        create_cowork_group_router(
            store=group_store,
            collaboration_store=collaboration,
            room_message_store=RoomMessageStore(base_dir=tmp_path / "rooms"),
        )
    )
    client = TestClient(app)
    thread = "local-thread"
    client.post(f"/api/cowork/{thread}/members", json={"target_id": "user", "kind": "human"})
    assert (
        client.post(f"/api/collab/{thread}/link-room", json={"room_id": "room-l"}).status_code
        == 200
    )

    posted = client.post(
        f"/api/collab/{thread}/room-message",
        json={"text": "local hello", "participant_id": "user", "display_name": "Me"},
    )
    assert posted.status_code == 200, posted.text
    message = posted.json()["message"]
    assert (message["participant_id"], message["display_name"]) == ("user", "Me")
    assert message["metadata"]["sender_kind"] == "human"

    assert (
        client.post(f"/api/cowork/{thread}/heartbeat", json={"member_id": "user"}).status_code
        == 200
    )
    read = client.post(
        f"/api/cowork/{thread}/read",
        json={"member_id": "user", "message_seq": posted.json()["seq"]},
    )
    assert read.status_code == 200
    presence = client.get(f"/api/cowork/{thread}/presence").json()["members"]
    user = next(member for member in presence if member["member_id"] == "user")
    assert user["online"] is True
    assert user["unread"] == 0

    created = client.post(
        f"/api/collab/{thread}/annotations",
        json={"message_id": "thread:message-1", "body": "local note"},
    )
    annotation_id = created.json()["annotation"]["annotation_id"]
    assert client.delete(f"/api/collab/{thread}/annotations/{annotation_id}").status_code == 200
    assert collaboration.annotations_for_session(thread) == []
