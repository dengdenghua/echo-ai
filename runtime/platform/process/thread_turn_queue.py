"""Bounded cross-process FIFO admission; the OS turn claim remains authority.

Tickets contain no prompts or execution policy. They represent live waiting
requests, not durable jobs: disconnect/cancellation removes a ticket, and a
crashed waiter expires. Expiry can never take a claim from a running turn.
"""

from __future__ import annotations

import json
import math
import time
from contextlib import suppress
from pathlib import Path
from uuid import uuid4

from runtime.platform.io.atomic import _cross_process_lock, atomic_write_json
from runtime.platform.process.thread_turn_claim import (
    ThreadTurnClaim,
    ThreadTurnClaimConflict,
    acquire_thread_turn_claim,
)

MAX_THREAD_WAITERS = 32
MAX_WAITERS = 256
LEASE_SECONDS = 15.0
RENEW_SECONDS = 2.0


class ThreadTurnQueueUnavailable(RuntimeError):
    """Admission state cannot safely be read or updated."""


class ThreadTurnQueueFull(RuntimeError):
    """The bounded waiting room is full."""


class ThreadTurnQueueExpired(RuntimeError):
    """This request lost its waiting ticket; never silently re-enqueue it."""


class ThreadTurnQueue:
    def __init__(self, logs_root: Path) -> None:
        self.logs_root = logs_root
        self.path = logs_root / ".thread-turn-locks" / "waiting.json"
        # atomic_write_json takes its own target lock. A separate admission
        # lock protects read-modify-write without recursively locking that fd.
        self._transaction_path = self.path.with_name("waiting-admission")

    def _read(self, now: float) -> tuple[list[dict], bool]:
        if not self.path.exists():
            return [], False
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or payload.get("version") != 1:
            raise ThreadTurnQueueUnavailable("unknown turn queue format")
        rows = payload.get("tickets")
        if not isinstance(rows, list) or len(rows) > MAX_WAITERS:
            raise ThreadTurnQueueUnavailable("invalid turn queue tickets")
        seen: set[str] = set()
        live = []
        for row in rows:
            if not isinstance(row, dict):
                raise ThreadTurnQueueUnavailable("invalid turn queue ticket")
            ticket, thread, expires = row.get("ticket"), row.get("thread"), row.get("expires")
            if (
                not isinstance(ticket, str)
                or not ticket
                or ticket in seen
                or not isinstance(thread, str)
                or not thread
                or type(expires) not in (int, float)
                or not math.isfinite(expires)
            ):
                raise ThreadTurnQueueUnavailable("invalid turn queue ticket fields")
            seen.add(ticket)
            if expires > now:
                live.append(row)
        return live, len(live) != len(rows)

    def _write(self, rows: list[dict]) -> None:
        atomic_write_json(
            self.path,
            {"version": 1, "tickets": rows},
            keep_backup=False,
            mode=0o600,
        )

    def join(self, ticket: str, thread_id: str) -> None:
        try:
            with _cross_process_lock(self._transaction_path, required=True, timeout_s=1.0):
                now = time.time()
                rows, _ = self._read(now)
                if (
                    len(rows) >= MAX_WAITERS
                    or sum(row["thread"] == thread_id for row in rows) >= MAX_THREAD_WAITERS
                ):
                    raise ThreadTurnQueueFull("turn waiting queue is full")
                if any(row["ticket"] == ticket for row in rows):
                    raise ThreadTurnQueueUnavailable("duplicate admission ticket")
                rows.append({"ticket": ticket, "thread": thread_id, "expires": now + LEASE_SECONDS})
                self._write(rows)
        except (OSError, ValueError) as exc:
            raise ThreadTurnQueueUnavailable("turn waiting queue is unavailable") from exc

    def try_claim(self, ticket: str, thread_id: str) -> ThreadTurnClaim | None:
        claim = None
        try:
            with _cross_process_lock(self._transaction_path, required=True, timeout_s=1.0):
                now = time.time()
                rows, changed = self._read(now)
                own = next(
                    (row for row in rows if row["ticket"] == ticket and row["thread"] == thread_id),
                    None,
                )
                if own is None:
                    raise ThreadTurnQueueExpired("turn waiting ticket expired")
                if own["expires"] - now <= LEASE_SECONDS - RENEW_SECONDS:
                    own["expires"] = now + LEASE_SECONDS
                    changed = True
                head = next(row for row in rows if row["thread"] == thread_id)
                if head is own:
                    with suppress(ThreadTurnClaimConflict):
                        claim = acquire_thread_turn_claim(self.logs_root, thread_id)
                    if claim is not None:
                        rows.remove(own)
                        changed = True
                if changed:
                    self._write(rows)
                return claim
        except BaseException as exc:
            if claim is not None:
                claim.release()
            if isinstance(exc, (OSError, ValueError)):
                raise ThreadTurnQueueUnavailable("turn waiting queue is unavailable") from exc
            raise

    def leave(self, ticket: str) -> None:
        try:
            with _cross_process_lock(self._transaction_path, required=True, timeout_s=1.0):
                rows, changed = self._read(time.time())
                remaining = [row for row in rows if row["ticket"] != ticket]
                if changed or len(remaining) != len(rows):
                    self._write(remaining)
        except (OSError, ValueError) as exc:
            raise ThreadTurnQueueUnavailable("turn waiting queue cleanup is unavailable") from exc

    @staticmethod
    def ticket() -> str:
        return uuid4().hex
