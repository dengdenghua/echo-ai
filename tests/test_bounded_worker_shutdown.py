"""Blocked providers must not hold app shutdown or interpreter exit forever."""

import subprocess
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from runtime.adapters.channels.manager import ChannelManager, ChannelRoutingError
from runtime.adapters.channels.operations import ChannelOperationsStore
from runtime.platform.process.daemon_executor import DaemonThreadPoolExecutor


def test_daemon_pool_does_not_join_stuck_workers_at_interpreter_exit():
    script = """
import threading
from runtime.platform.process.daemon_executor import DaemonThreadPoolExecutor
started = threading.Event()
def stuck():
    started.set()
    threading.Event().wait()
pool = DaemonThreadPoolExecutor(max_workers=1)
pool.submit(stuck)
assert started.wait(2)
pool.shutdown(wait=False)
"""
    subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[1],
        check=True,
        timeout=5,
    )


def test_channel_shutdown_drains_before_stopping_transport(tmp_path):
    manager = ChannelManager(stack=None, agent_registry=None)
    calls = []
    manager._channels["test"] = SimpleNamespace(stop=lambda: calls.append("stop"))
    manager.send_to_channel = lambda *_: calls.append("sent")
    future = manager.send_async("test", None)
    manager.stop_all(timeout=1)
    assert future.result() is None
    assert calls == ["sent", "stop"]


def test_channel_shutdown_records_queued_cancellation_and_unknown_running_outcome(tmp_path):
    store = ChannelOperationsStore(tmp_path / "operations.json")
    manager = ChannelManager(stack=None, agent_registry=None, operations_store=store)
    manager._executor.shutdown()
    manager._executor = DaemonThreadPoolExecutor(max_workers=1)
    manager._channels["test"] = SimpleNamespace()
    started, release = threading.Event(), threading.Event()

    def send(*_):
        started.set()
        release.wait(3)

    manager.send_to_channel = send
    first = manager.send_async("test", None)
    assert started.wait(2)
    queued = manager.send_async("test", None)
    try:
        start = time.monotonic()
        manager.shutdown(timeout=0.02)
        assert time.monotonic() - start < 0.5
        assert queued.cancelled()
        assert not first.done()
        assert store.snapshot("test")["failure_count"] == 2
        assert (
            ChannelOperationsStore(tmp_path / "operations.json").snapshot("test")["failure_count"]
            == 2
        )
        with pytest.raises(ChannelRoutingError, match="shutting down"):
            manager.send_async("test", None)
    finally:
        release.set()
        first.result(timeout=2)
