"""Incremental delivery must not wait for the slowest member or leak late replies."""

from __future__ import annotations

import asyncio
import threading
from typing import Any

import pytest

from runtime.sensing.gateway.group_reply_stream import FanoutReplyEmitter, stream_worker_replies


def _reply(agent: str, *, round_no: int = 1) -> dict[str, Any]:
    return {
        "agent_id": agent,
        "display_name": agent.title(),
        "response_id": f"r:{round_no}:{agent}",
        "reply": f"result from {agent}",
        "ok": True,
        "round": round_no,
    }


def test_reply_is_delivered_before_worker_finishes_and_final_replay_does_not_duplicate() -> None:
    async def scenario() -> None:
        release = threading.Event()
        first = asyncio.Event()
        emitted = []

        async def emit(body: str, **metadata: Any) -> None:
            emitted.append((body, metadata))
            first.set()

        sink = FanoutReplyEmitter(
            emit,
            mention_target=lambda _: "Other",
            friendly_error=lambda _: "failed",
            should_cancel=lambda: False,
        )

        def worker(*, on_reply, should_cancel):
            on_reply(_reply("fast"))
            assert release.wait(2)
            on_reply(_reply("slow"))
            return {"replies": [_reply("fast"), _reply("slow")]}

        task = asyncio.create_task(
            stream_worker_replies(worker, emit_reply=sink.reply, should_cancel=lambda: False)
        )
        try:
            await asyncio.wait_for(first.wait(), 1)
            assert not task.done()
            assert [row[0] for row in emitted] == ["result from fast"]
        finally:
            release.set()
        result = await task
        for row in result["replies"]:
            await sink.reply(row)
        assert sink.spoke == 2
        assert [row[0] for row in emitted] == ["result from fast", "result from slow"]
        assert emitted[0][1] == {"display_name": "Fast", "agent_id": "fast", "reply_to": "Other"}

    asyncio.run(scenario())


def test_cancellation_stops_worker_and_discards_its_late_callback() -> None:
    async def scenario() -> None:
        first = asyncio.Event()
        finished = threading.Event()
        emitted = []

        async def emit(reply) -> None:
            emitted.append(reply)
            first.set()

        def worker(*, on_reply, should_cancel):
            on_reply(_reply("fast"))
            while not should_cancel():
                finished.wait(0.005)
            on_reply(_reply("late"))
            finished.set()
            return {"replies": []}

        task = asyncio.create_task(
            stream_worker_replies(worker, emit_reply=emit, should_cancel=lambda: False)
        )
        await asyncio.wait_for(first.wait(), 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert await asyncio.to_thread(finished.wait, 1)
        await asyncio.sleep(0)
        assert [row["agent_id"] for row in emitted] == ["fast"]

    asyncio.run(scenario())


def test_emit_failure_also_closes_mailbox_and_worker() -> None:
    async def scenario() -> None:
        finished = threading.Event()

        async def emit(_reply) -> None:
            raise RuntimeError("delivery failure")

        def worker(*, on_reply, should_cancel):
            on_reply(_reply("fast"))
            while not should_cancel():
                finished.wait(0.005)
            finished.set()
            return {}

        with pytest.raises(RuntimeError, match="delivery failure"):
            await stream_worker_replies(worker, emit_reply=emit, should_cancel=lambda: False)
        assert await asyncio.to_thread(finished.wait, 1)

    asyncio.run(scenario())


def test_mailbox_overflow_is_explicit_without_unhandled_event_loop_errors() -> None:
    async def scenario() -> None:
        loop_errors = []
        release_emit = asyncio.Event()
        posted = threading.Event()
        asyncio.get_running_loop().set_exception_handler(
            lambda _loop, error: loop_errors.append(error)
        )

        async def emit(_reply) -> None:
            await release_emit.wait()

        def worker(*, on_reply, should_cancel):
            for index in range(3):
                on_reply(_reply(str(index)))
            posted.set()
            return {}

        task = asyncio.create_task(
            stream_worker_replies(
                worker, emit_reply=emit, should_cancel=lambda: False, max_pending=1
            )
        )
        assert await asyncio.to_thread(posted.wait, 1)
        release_emit.set()
        with pytest.raises(RuntimeError, match="mailbox capacity"):
            await task
        await asyncio.sleep(0)
        assert loop_errors == []

    asyncio.run(scenario())


def test_round_headers_failures_and_cancelled_members_remain_once_only() -> None:
    async def scenario() -> None:
        emitted = []

        async def emit(body: str, **metadata: Any) -> None:
            emitted.append((body, metadata))

        sink = FanoutReplyEmitter(
            emit,
            mention_target=lambda _: None,
            friendly_error=lambda _: "safe error",
            should_cancel=lambda: False,
        )
        rows = [
            _reply("a", round_no=2),
            _reply("b", round_no=2),
            {**_reply("failed"), "ok": False, "error": "sensitive traceback"},
            {**_reply("cancelled"), "cancelled": True},
        ]
        for row in [*rows, *rows]:
            await sink.reply(row)
        assert sink.spoke == 2
        assert len(emitted) == 4
        assert emitted[0][1]["agent_id"] == "swarm-moderator"
        assert emitted[-1][0] == "⚠️ Failed 未能回应 · safe error"
        assert "sensitive traceback" not in str(emitted)

    asyncio.run(scenario())
