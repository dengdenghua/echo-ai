"""Realtime compatibility for ownerless threads in local auth-off mode."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from runtime.memory.cowork.group_store import GroupStore
from runtime.memory.cowork.session import link_room
from runtime.memory.threads.event_log import EventLog, thread_log_path
from runtime.memory.threads.store import ThreadStateStore
from runtime.protocol import (
    JsonRpcRequest,
    JsonRpcResponse,
    Notification,
    decode_message,
    encode_message,
)
from runtime.sensing.gateway.realtime_echo import EchoRuntime
from runtime.sensing.gateway.realtime_gateway import RealtimeGateway
from runtime.sensing.gateway.thread_access import ThreadAccessResolver


def _ownerless_local_client(
    tmp_path: Path,
    *,
    thread_id: str,
) -> tuple[TestClient, Path]:
    logs_root = tmp_path / "threads"
    threads = ThreadStateStore()
    threads.ensure_thread(thread_id, metadata={"mode": "code"})
    log_path = thread_log_path(logs_root, thread_id)
    EventLog(log_path).thread_started(thread_id)

    resolver = ThreadAccessResolver(
        thread_store=threads,
        allow_anonymous_ownerless=True,
    )
    runtime = EchoRuntime(logs_root=logs_root)
    runtime._thread_access_resolver = resolver
    gateway = RealtimeGateway(
        runtime=runtime,
        require_auth=False,
        thread_access_resolver=resolver,
        allow_client_approval_bypass=True,
    )
    app = FastAPI()
    app.include_router(gateway.router)
    return TestClient(app), log_path


def _receive_response(
    ws: Any, request_id: int, *, approve_commands: bool = False
) -> JsonRpcResponse:
    while True:
        message = decode_message(ws.receive_text())
        if isinstance(message, JsonRpcResponse) and message.id == request_id:
            return message
        if approve_commands and isinstance(message, JsonRpcRequest):
            assert message.method == "item/commandExecution/requestApproval"
            ws.send_text(encode_message(JsonRpcResponse(id=message.id, result={"action": "accept"})))
            continue
        assert isinstance(message, Notification)


def test_auth_off_ownerless_thread_can_resume(tmp_path: Path) -> None:
    thread_id = "eval-ownerless-resume"
    client, _log_path = _ownerless_local_client(tmp_path, thread_id=thread_id)

    with client, client.websocket_connect("/api/realtime") as ws:
        ws.send_text(
            encode_message(
                JsonRpcRequest(
                    id=1,
                    method="thread/resume",
                    params={"threadId": thread_id},
                )
            )
        )
        response = _receive_response(ws, 1)

    assert response.error is None
    assert response.result["thread"]["id"] == thread_id


def test_auth_off_ownerless_thread_can_start_followup(tmp_path: Path) -> None:
    thread_id = "eval-ownerless-followup"
    client, log_path = _ownerless_local_client(tmp_path, thread_id=thread_id)

    with client, client.websocket_connect("/api/realtime") as ws:
        ws.send_text(
            encode_message(
                JsonRpcRequest(
                    id=2,
                    method="turn/start",
                    params={
                        "threadId": thread_id,
                        "input": [{"type": "text", "text": "continue"}],
                        "approvalPolicy": "never",
                    },
                )
            )
        )
        response = _receive_response(ws, 2)

    assert response.error is None
    assert response.result["turn"]["threadId"] == thread_id
    assert response.result["turn"]["status"] == "completed"
    assert '"event":"turn_started"' in log_path.read_text(encoding="utf-8")


def test_ownerless_compat_is_opt_in_and_does_not_cover_linked_rooms(tmp_path: Path) -> None:
    thread_id = "ownerless-linked"
    threads = ThreadStateStore()
    threads.ensure_thread(thread_id)

    strict = ThreadAccessResolver(thread_store=threads).resolve(thread_id, None)
    assert strict.thread is not None
    assert not strict.can_read
    assert not strict.can_write
    assert not strict.can_manage

    groups = GroupStore(base_dir=tmp_path / "cowork")
    link_room(groups, thread_id, "room-a", actor="local")
    linked = ThreadAccessResolver(
        thread_store=threads,
        group_store=groups,
        allow_anonymous_ownerless=True,
    ).resolve(thread_id, None)

    assert linked.room_id == "room-a"
    assert not linked.can_read
    assert not linked.can_write
    assert not linked.can_manage


@pytest.mark.parametrize(
    ("metadata", "allowed"),
    [
        ({}, True),
        ({"owner_actor_id": "local", "tenant_id": "legacy:local"}, True),
        ({"owner_actor_id": "alice", "tenant_id": "legacy:alice"}, False),
        ({"owner_actor_id": "local", "tenant_id": "another-tenant"}, False),
    ],
)
def test_explicit_desktop_operator_resumes_only_its_local_threads(
    tmp_path: Path, metadata: dict[str, Any], allowed: bool
) -> None:
    thread_id = "local-linked-conversation"
    threads = ThreadStateStore()
    threads.ensure_thread(thread_id, metadata=metadata)
    groups = GroupStore(base_dir=tmp_path / "cowork")
    link_room(groups, thread_id, "local-room", actor="local")
    logs_root = tmp_path / "threads"
    EventLog(thread_log_path(logs_root, thread_id)).thread_started(thread_id)
    resolver = ThreadAccessResolver(
        thread_store=threads, group_store=groups, local_actor_id="local"
    )
    runtime = EchoRuntime(logs_root=logs_root)
    runtime._thread_access_resolver = resolver
    gateway = RealtimeGateway(
        runtime=runtime,
        require_auth=False,
        local_actor_id="local",
        thread_access_resolver=resolver,
    )
    app = FastAPI()
    app.include_router(gateway.router)
    with TestClient(app) as client, client.websocket_connect("/api/realtime") as ws:
        ws.send_text(
            encode_message(
                JsonRpcRequest(id=1, method="thread/resume", params={"threadId": thread_id})
            )
        )
        response = _receive_response(ws, 1)
        assert (response.error is None) is allowed
        if allowed:
            assert response.result["thread"]["id"] == thread_id
            ws.send_text(
                encode_message(
                    JsonRpcRequest(
                        id=2,
                        method="turn/start",
                        params={
                            "threadId": thread_id,
                            "input": [{"type": "text", "text": "continue"}],
                        },
                    )
                )
            )
            followup = _receive_response(ws, 2, approve_commands=True)
            assert followup.error is None
            assert followup.result["turn"]["status"] == "completed"


def test_desktop_operator_does_not_replace_required_authentication(tmp_path: Path) -> None:
    app = FastAPI()
    app.include_router(
        RealtimeGateway(
            runtime=EchoRuntime(logs_root=tmp_path / "threads"),
            require_auth=True,
            local_actor_id="local",
        ).router
    )
    with (
        TestClient(app) as client,
        pytest.raises(WebSocketDisconnect) as error,
        client.websocket_connect("/api/realtime"),
    ):
        pass
    assert error.value.code == 4401
