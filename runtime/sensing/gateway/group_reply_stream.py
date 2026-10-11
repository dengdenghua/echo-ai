"""Deliver committed fan-out replies while the synchronous worker is still running."""

from __future__ import annotations

import asyncio
import contextlib
import threading
from collections.abc import Awaitable, Callable
from typing import Any

Reply = dict[str, Any]
MAX_PENDING_REPLIES = 512 * 3  # Existing full-roster cap times the three-round cap.


async def stream_worker_replies(
    worker: Callable[..., Reply],
    *args: Any,
    emit_reply: Callable[[Reply], Awaitable[None]],
    should_cancel: Callable[[], bool],
    max_pending: int = MAX_PENDING_REPLIES,
    **kwargs: Any,
) -> Reply:
    """Bridge worker callbacks onto the owner loop; never emit from provider threads.

    Cancellation closes the mailbox and also reaches the worker's cooperative
    stop check. A bounded mailbox overflow fails explicitly instead of silently
    losing results. The worker's final snapshot is still returned for tracing
    and idempotent replay of callers that do not provide incremental callbacks.
    """
    if not 1 <= max_pending <= MAX_PENDING_REPLIES:
        raise ValueError("fan-out reply mailbox limit is outside the supported capacity")
    loop = asyncio.get_running_loop()
    mailbox: asyncio.Queue[Reply] = asyncio.Queue(maxsize=max_pending)
    stopped = threading.Event()
    overflow: RuntimeError | None = None

    def publish(reply: Reply) -> None:
        if stopped.is_set():
            return

        def put() -> None:
            nonlocal overflow
            if stopped.is_set():
                return
            try:
                mailbox.put_nowait(dict(reply))
            except asyncio.QueueFull:
                overflow = RuntimeError("fan-out reply mailbox capacity exceeded")
                stopped.set()

        try:
            loop.call_soon_threadsafe(put)
        except RuntimeError:
            # The owner may close its loop between the stopped check and this
            # call. A cancelled provider callback must not outlive that owner.
            if not stopped.is_set():
                raise

    task = asyncio.create_task(
        asyncio.to_thread(
            worker,
            *args,
            on_reply=publish,
            should_cancel=lambda: stopped.is_set() or should_cancel(),
            **kwargs,
        ),
        name="group-reply-worker",
    )
    getter: asyncio.Task[Reply] | None = None
    try:
        while not task.done() or not mailbox.empty():
            if overflow:
                raise overflow
            getter = asyncio.create_task(mailbox.get())
            done, _ = await asyncio.wait((task, getter), return_when=asyncio.FIRST_COMPLETED)
            if getter in done:
                reply = getter.result()
                getter = None
                if not should_cancel():
                    await emit_reply(reply)
            else:
                getter.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await getter
                getter = None
        if overflow:
            raise overflow
        return await task
    finally:
        stopped.set()
        if getter is not None:
            getter.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await getter
        if not task.done():
            task.cancel()
        with contextlib.suppress(Exception, asyncio.CancelledError):
            await task


class FanoutReplyEmitter:
    """Emit member bubbles once in arrival order, then safely replay the final snapshot."""

    def __init__(
        self,
        emit: Callable[..., Awaitable[None]],
        *,
        mention_target: Callable[[str], str | None],
        friendly_error: Callable[[str], str],
        should_cancel: Callable[[], bool],
    ) -> None:
        self._emit = emit
        self._mention_target = mention_target
        self._friendly_error = friendly_error
        self._should_cancel = should_cancel
        self._seen: set[tuple[int, str]] = set()
        self._rounds: set[int] = set()
        self.spoke = 0

    async def reply(self, reply: Reply) -> None:
        if self._should_cancel() or reply.get("cancelled"):
            return
        body = str(reply.get("reply") or "").strip()
        round_no = int(reply.get("round") or 1)
        agent_id = str(reply.get("agent_id") or "")
        key = (round_no, str(reply.get("response_id") or agent_id))
        if key in self._seen:
            return
        if round_no > 1 and round_no not in self._rounds:
            await self._emit(
                f"⚔️ 第 {round_no} 轮 · 成员互见辩论 —— 大家看到彼此观点后点名回应：",
                display_name="主持人",
                agent_id="swarm-moderator",
                icon="⚔️",
            )
            self._rounds.add(round_no)
        if reply.get("ok") and body:
            await self._emit(
                body,
                display_name=str(reply.get("display_name") or ""),
                agent_id=agent_id,
                reply_to=self._mention_target(body),
            )
            self.spoke += 1
        elif not reply.get("ok"):
            await self._emit(
                "⚠️ "
                + str(reply.get("display_name") or agent_id or "成员")
                + " 未能回应 · "
                + self._friendly_error(str(reply.get("error") or "no reply")),
                display_name=str(reply.get("display_name") or ""),
                agent_id=agent_id,
            )
        self._seen.add(key)
