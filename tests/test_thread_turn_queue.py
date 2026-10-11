from __future__ import annotations

import json
import multiprocessing
import time
from pathlib import Path

import pytest

from runtime.platform.process import thread_turn_queue as module
from runtime.platform.process.thread_turn_claim import (
    ThreadTurnClaimConflict,
    acquire_thread_turn_claim,
)
from runtime.platform.process.thread_turn_queue import (
    ThreadTurnQueue,
    ThreadTurnQueueExpired,
    ThreadTurnQueueFull,
    ThreadTurnQueueUnavailable,
)


def test_fifo_admission_keeps_os_claim_and_independent_threads(tmp_path: Path) -> None:
    owner = acquire_thread_turn_claim(tmp_path, "shared")
    first, second = ThreadTurnQueue(tmp_path), ThreadTurnQueue(tmp_path)
    first.join("first", "shared")
    second.join("second", "shared")
    second.join("other", "independent")
    try:
        assert first.try_claim("first", "shared") is None
        assert second.try_claim("second", "shared") is None
        other = second.try_claim("other", "independent")
        assert other is not None
        other.release()
    finally:
        owner.release()
    assert second.try_claim("second", "shared") is None
    claim = first.try_claim("first", "shared")
    assert claim is not None
    with pytest.raises(ThreadTurnClaimConflict):
        acquire_thread_turn_claim(tmp_path, "shared")
    assert second.try_claim("second", "shared") is None
    claim.release()
    next_claim = second.try_claim("second", "shared")
    assert next_claim is not None
    next_claim.release()
    assert json.loads(first.path.read_text())["tickets"] == []


def test_cancelled_head_is_removed_without_changing_other_waiters(tmp_path: Path) -> None:
    queue = ThreadTurnQueue(tmp_path)
    queue.join("first", "shared")
    queue.join("second", "shared")
    queue.leave("first")
    claim = queue.try_claim("second", "shared")
    assert claim is not None
    claim.release()
    with pytest.raises(ThreadTurnQueueExpired):
        queue.try_claim("first", "shared")


def test_crashed_ticket_expires_without_taking_a_running_claim(tmp_path: Path, monkeypatch) -> None:
    queue = ThreadTurnQueue(tmp_path)
    start = time.time()
    monkeypatch.setattr(module.time, "time", lambda: start)
    owner = acquire_thread_turn_claim(tmp_path, "shared")
    queue.join("crashed", "shared")
    monkeypatch.setattr(module.time, "time", lambda: start + module.LEASE_SECONDS + 1)
    queue.join("live", "shared")
    try:
        with pytest.raises(ThreadTurnQueueExpired):
            queue.try_claim("crashed", "shared")
        assert queue.try_claim("live", "shared") is None
        assert not owner.released
    finally:
        owner.release()
    claim = queue.try_claim("live", "shared")
    assert claim is not None
    claim.release()


def test_capacity_is_bounded_per_thread_and_globally(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(module, "MAX_THREAD_WAITERS", 2)
    monkeypatch.setattr(module, "MAX_WAITERS", 3)
    queue = ThreadTurnQueue(tmp_path)
    queue.join("one", "shared")
    queue.join("two", "shared")
    with pytest.raises(ThreadTurnQueueFull):
        queue.join("three", "shared")
    queue.join("other", "independent")
    with pytest.raises(ThreadTurnQueueFull):
        queue.join("four", "another")
    assert len(json.loads(queue.path.read_text())["tickets"]) == 3


@pytest.mark.parametrize(
    "payload",
    [
        "broken",
        '{"version":2,"tickets":[]}',
        '{"version":1,"tickets":[{"ticket":"x","thread":"t","expires":NaN}]}',
    ],
)
def test_corrupt_queue_fails_closed(tmp_path: Path, payload: str) -> None:
    queue = ThreadTurnQueue(tmp_path)
    queue.path.parent.mkdir(parents=True)
    queue.path.write_text(payload)
    with pytest.raises(ThreadTurnQueueUnavailable):
        queue.join("new", "thread")
    assert queue.path.read_text() == payload


def test_failed_queue_commit_releases_acquired_fd(tmp_path: Path, monkeypatch) -> None:
    queue = ThreadTurnQueue(tmp_path)
    queue.join("first", "shared")

    def fail(_rows):
        raise OSError("disk unavailable")

    monkeypatch.setattr(queue, "_write", fail)
    with pytest.raises(ThreadTurnQueueUnavailable):
        queue.try_claim("first", "shared")
    claim = acquire_thread_turn_claim(tmp_path, "shared")
    claim.release()


def _process_waiter(root: str, ticket: str, joined, acquired, finish, outcomes) -> None:
    queue = ThreadTurnQueue(Path(root))
    queue.join(ticket, "shared")
    joined.set()
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        claim = queue.try_claim(ticket, "shared")
        if claim is not None:
            try:
                outcomes.put(ticket)
                acquired.set()
                if not finish.wait(10):
                    raise RuntimeError("test owner release timed out")
            finally:
                claim.release()
            return
        time.sleep(0.02)
    raise RuntimeError("test admission timed out")


def test_fifo_across_real_processes(tmp_path: Path) -> None:
    ctx = multiprocessing.get_context("spawn")
    owner = acquire_thread_turn_claim(tmp_path, "shared")
    outcomes = ctx.Queue()
    joined = [ctx.Event(), ctx.Event()]
    acquired = [ctx.Event(), ctx.Event()]
    finish = [ctx.Event(), ctx.Event()]
    processes = [
        ctx.Process(
            target=_process_waiter,
            args=(str(tmp_path), f"waiter-{i}", joined[i], acquired[i], finish[i], outcomes),
        )
        for i in range(2)
    ]
    try:
        for i, process in enumerate(processes):
            process.start()
            assert joined[i].wait(10)
        assert not any(event.is_set() for event in acquired)
        owner.release()
        assert acquired[0].wait(10)
        assert outcomes.get(timeout=3) == "waiter-0"
        assert not acquired[1].is_set()
        finish[0].set()
        assert acquired[1].wait(10)
        assert outcomes.get(timeout=3) == "waiter-1"
    finally:
        owner.release()
        for event in finish:
            event.set()
        for process in processes:
            if process.pid is not None:
                process.join(10)
                if process.is_alive():
                    process.terminate()
                    process.join(3)
    assert all(process.exitcode == 0 for process in processes)
