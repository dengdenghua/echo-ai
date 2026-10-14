from __future__ import annotations

import asyncio
import json
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from runtime.platform.process.thread_turn_claim import acquire_thread_turn_claim
from runtime.platform.process.thread_turn_queue import ThreadTurnQueue
from runtime.protocol import JsonRpcErrorCode, Turn, TurnStatus
from runtime.sensing.gateway import realtime_turn_queue as module
from runtime.sensing.gateway.realtime_gateway import RealtimeGateway, _RpcError
from runtime.sensing.gateway.realtime_turn_queue import _owned_store_call, wait_for_turn_claim


class Connection:
    actor_id = None
    tenant_id = None
    _closed = False
    last_resumed_thread_id = None

    def __init__(self):
        self.watched_threads = set()

    async def notify(self, *_args):
        pass


class Runtime:
    def __init__(self, root: Path):
        self._logs_root = root
        self.started: list[str] = []
        self.params_seen: list[dict[str, Any]] = []

    async def start_turn(self, params: dict[str, Any], _emitter) -> Turn:
        self.started.append(params["input"][0]["text"])
        self.params_seen.append(params)
        return Turn(threadId=params["threadId"], status=TurnStatus.COMPLETED)


async def queued_count(root: Path, count: int) -> None:
    path = ThreadTurnQueue(root).path
    async with asyncio.timeout(5):
        while not path.exists() or len(json.loads(path.read_text())["tickets"]) != count:
            await asyncio.sleep(0.01)


def test_gateway_runs_live_waiters_in_order_without_start_side_effects(tmp_path: Path) -> None:
    async def run():
        owner = acquire_thread_turn_claim(tmp_path, "shared")
        runtimes = [Runtime(tmp_path), Runtime(tmp_path)]
        gateways = [RealtimeGateway(runtime=runtime) for runtime in runtimes]
        connections = [Connection(), Connection()]
        tasks = []
        try:
            for i in range(2):
                tasks.append(
                    asyncio.create_task(
                        gateways[i]._invoke_turn_start(
                            {
                                "threadId": "shared",
                                "queueIfBusy": True,
                                "input": [{"type": "text", "text": f"input-{i}"}],
                            },
                            connections[i],
                        )
                    )
                )
                await queued_count(tmp_path, i + 1)
            assert all(not runtime.started for runtime in runtimes)
            assert all(not conn.watched_threads for conn in connections)
            owner.release()
            await asyncio.wait_for(asyncio.gather(*tasks), 5)
            assert [runtime.started for runtime in runtimes] == [["input-0"], ["input-1"]]
            await queued_count(tmp_path, 0)
        finally:
            owner.release()
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    asyncio.run(run())


@pytest.mark.parametrize("cancel", [True, False])
def test_disconnect_or_cancel_withdraws_waiting_request(tmp_path: Path, cancel: bool) -> None:
    async def run():
        owner = acquire_thread_turn_claim(tmp_path, "shared")
        conn, runtime = Connection(), Runtime(tmp_path)
        task = asyncio.create_task(
            RealtimeGateway(runtime=runtime)._invoke_turn_start(
                {"threadId": "shared", "queueIfBusy": True, "input": []}, conn
            )
        )
        try:
            await queued_count(tmp_path, 1)
            if cancel:
                task.cancel()
            else:
                conn._closed = True
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(task, 5)
            await queued_count(tmp_path, 0)
            assert not runtime.started
        finally:
            owner.release()

    asyncio.run(run())


def test_queued_permission_is_rechecked_before_execution(tmp_path: Path, monkeypatch) -> None:
    async def run():
        owner = acquire_thread_turn_claim(tmp_path, "shared")
        runtime = Runtime(tmp_path)
        gateway = RealtimeGateway(runtime=runtime)
        task = asyncio.create_task(
            gateway._invoke_turn_start(
                {"threadId": "shared", "queueIfBusy": True, "input": []}, Connection()
            )
        )
        try:
            await queued_count(tmp_path, 1)

            def deny(*_args, **_kwargs):
                raise _RpcError(JsonRpcErrorCode.UNAUTHORIZED, "membership revoked")

            monkeypatch.setattr(gateway, "_require_realtime_thread_access", deny)
            owner.release()
            with pytest.raises(_RpcError) as caught:
                await task
            assert caught.value.code == JsonRpcErrorCode.UNAUTHORIZED
            assert not runtime.started
            claim = acquire_thread_turn_claim(tmp_path, "shared")
            claim.release()
        finally:
            owner.release()

    asyncio.run(run())


def test_waiting_input_uses_current_server_owner_scope(tmp_path: Path, monkeypatch) -> None:
    async def run():
        owner = acquire_thread_turn_claim(tmp_path, "shared")
        runtime, conn = Runtime(tmp_path), Connection()
        conn.actor_id, conn.tenant_id = "member", "trusted-tenant"
        gateway = RealtimeGateway(runtime=runtime)
        scope = {"owner": "original-owner"}
        monkeypatch.setattr(
            gateway,
            "_require_realtime_thread_access",
            lambda *_args, **_kwargs: SimpleNamespace(
                owner_actor_id=scope["owner"], tenant_id="trusted-tenant"
            ),
        )
        task = asyncio.create_task(
            gateway._invoke_turn_start(
                {
                    "threadId": "shared",
                    "queueIfBusy": True,
                    "input": [
                        {"type": "text", "text": "input", "metadata": {"owner_actor_id": "forged"}}
                    ],
                },
                conn,
            )
        )
        try:
            await queued_count(tmp_path, 1)
            scope["owner"] = "current-owner"
            owner.release()
            await task
            context = runtime.params_seen[0]["input"][0]["metadata"]["context"]
            assert context == {
                "actor_id": "member",
                "owner_actor_id": "current-owner",
                "tenant_id": "trusted-tenant",
            }
        finally:
            owner.release()

    asyncio.run(run())


def test_timeout_is_explicit_and_cleans_ticket(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(module, "MAX_WAIT_SECONDS", 0)

    async def run():
        with pytest.raises(_RpcError) as caught:
            await wait_for_turn_claim(tmp_path, "shared", is_connected=lambda: True)
        assert caught.value.data["reason"] == "turn_queue_timeout"
        await queued_count(tmp_path, 0)

    asyncio.run(run())


@pytest.mark.parametrize("repeat_cancel", [False, True])
def test_cancellation_during_fd_acquisition_releases_ownership(
    tmp_path: Path, repeat_cancel: bool
) -> None:
    async def run():
        acquired, finish = threading.Event(), threading.Event()

        def acquire():
            claim = acquire_thread_turn_claim(tmp_path, "shared")
            acquired.set()
            if not finish.wait(5):
                claim.release()
                raise RuntimeError("fixture timed out")
            return claim

        task = asyncio.create_task(_owned_store_call(acquire))
        try:
            assert await asyncio.to_thread(acquired.wait, 5)
            task.cancel()
            if repeat_cancel:
                await asyncio.sleep(0)
                task.cancel()
            finish.set()
            with pytest.raises(asyncio.CancelledError):
                await task
            claim = acquire_thread_turn_claim(tmp_path, "shared")
            claim.release()
        finally:
            finish.set()

    asyncio.run(run())


@pytest.mark.parametrize("value", ["true", 1, None])
def test_queue_policy_rejects_coerced_values_before_state(tmp_path: Path, value) -> None:
    runtime = Runtime(tmp_path)
    with pytest.raises(_RpcError) as caught:
        asyncio.run(
            RealtimeGateway(runtime=runtime)._invoke_turn_start(
                {"threadId": "shared", "queueIfBusy": value, "input": []}, Connection()
            )
        )
    assert caught.value.code == JsonRpcErrorCode.INVALID_PARAMS
    assert not runtime.started
    assert not ThreadTurnQueue(tmp_path).path.exists()


def test_public_websocket_queues_peer_message_until_owner_finishes(tmp_path: Path) -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    class HeldRuntime(Runtime):
        def __init__(self, root):
            super().__init__(root)
            self.release = threading.Event()

        async def start_turn(self, params, emitter):
            if params["input"][0]["text"] == "first":
                await emitter.notify(
                    "turn/started",
                    {
                        "threadId": "shared",
                        "turn": {
                            "id": "first-turn",
                            "threadId": "shared",
                            "status": "inProgress",
                            "items": [],
                        },
                    },
                )
                assert await asyncio.to_thread(self.release.wait, 10)
            return await super().start_turn(params, emitter)

    runtime = HeldRuntime(tmp_path)
    app = FastAPI()
    app.include_router(RealtimeGateway(runtime=runtime).router)
    try:
        with TestClient(app) as client, client.websocket_connect("/api/realtime") as first:
            first.send_json(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "turn/start",
                    "params": {
                        "threadId": "shared",
                        "input": [{"type": "text", "text": "first"}],
                    },
                }
            )
            assert first.receive_json()["method"] == "turn/started"
            with client.websocket_connect("/api/realtime") as second:
                second.send_json(
                    {
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": "turn/start",
                        "params": {
                            "threadId": "shared",
                            "queueIfBusy": True,
                            "input": [{"type": "text", "text": "second"}],
                        },
                    }
                )
                deadline = time.monotonic() + 5
                while not ThreadTurnQueue(tmp_path).path.exists():
                    assert time.monotonic() < deadline
                    time.sleep(0.01)
                assert runtime.started == []
                runtime.release.set()
                for _ in range(10):
                    response = second.receive_json()
                    if response.get("id") == 2:
                        break
                assert "error" not in response
                assert response["result"]["turn"]["status"] == "completed"
                assert runtime.started == ["first", "second"]
    finally:
        runtime.release.set()
