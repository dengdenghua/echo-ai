"""Async ownership and cancellation boundary for explicit queued turn/start."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from runtime.platform.process.thread_turn_claim import ThreadTurnClaim
from runtime.platform.process.thread_turn_queue import (
    ThreadTurnQueue,
    ThreadTurnQueueExpired,
    ThreadTurnQueueFull,
    ThreadTurnQueueUnavailable,
)
from runtime.protocol import JsonRpcErrorCode
from runtime.sensing.gateway._realtime_gateway_types import _RpcError

_logger = logging.getLogger(__name__)
MAX_WAIT_SECONDS = 1800.0
POLL_SECONDS = 0.25


async def _owned_store_call(operation: Callable[..., Any], *args: Any) -> Any:
    """Finish bounded store operations on cancellation; don't orphan a returned fd."""
    task = asyncio.create_task(asyncio.to_thread(operation, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        try:
            while not task.done():
                try:
                    await asyncio.shield(task)
                except asyncio.CancelledError:
                    continue
            result = task.result()
            if isinstance(result, ThreadTurnClaim):
                result.release()
        finally:
            raise


async def wait_for_turn_claim(
    logs_root: Path,
    thread_id: str,
    *,
    is_connected: Callable[[], bool],
) -> ThreadTurnClaim:
    queue = ThreadTurnQueue(logs_root)
    ticket = queue.ticket()
    deadline = time.monotonic() + MAX_WAIT_SECONDS
    claim = None
    try:
        await _owned_store_call(queue.join, ticket, thread_id)
        while is_connected():
            if time.monotonic() >= deadline:
                raise _RpcError(
                    JsonRpcErrorCode.SERVER_BUSY,
                    "turn waiting queue timed out; retry explicitly",
                    data={"reason": "turn_queue_timeout", "threadId": thread_id, "retryable": True},
                )
            claim = await _owned_store_call(queue.try_claim, ticket, thread_id)
            if claim is not None:
                if not is_connected():
                    claim.release()
                    raise asyncio.CancelledError
                break
            await asyncio.sleep(POLL_SECONDS)
        else:
            raise asyncio.CancelledError
    except ThreadTurnQueueFull as exc:
        raise _RpcError(
            JsonRpcErrorCode.SERVER_BUSY,
            str(exc),
            data={"reason": "turn_queue_full", "threadId": thread_id, "retryable": True},
        ) from exc
    except (ThreadTurnQueueExpired, ThreadTurnQueueUnavailable) as exc:
        raise _RpcError(
            JsonRpcErrorCode.INTERNAL_ERROR,
            "turn waiting queue unavailable; refusing to start",
            data={"reason": "turn_queue_unavailable", "threadId": thread_id, "retryable": False},
        ) from exc
    finally:
        try:
            await _owned_store_call(queue.leave, ticket)
        except asyncio.CancelledError:
            if claim is not None:
                claim.release()
            raise
        except Exception:
            # A failed cleanup is bounded by the waiting lease. No ticket is
            # permission to execute and no waiter ever steals a running claim.
            _logger.exception("turn waiting ticket cleanup failed")
    assert claim is not None
    return claim
