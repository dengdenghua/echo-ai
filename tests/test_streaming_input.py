"""stdin backpressure must not disable process deadlines or cancellation."""

import sys
import threading
import time

import pytest

from runtime.platform.process.streaming import stream_run
from runtime.platform.process.tool_output_sink import push_sink
from runtime.safety.approval.cancellation import CancellationSource, scoped_cancellation


@pytest.mark.parametrize("cancel", [False, True])
def test_blocked_stdin_obeys_timeout_and_cancel(cancel):
    source = CancellationSource()
    before = set(threading.enumerate())

    def sink(kind, text):
        if cancel and "ready" in text:
            source.cancel(reason="test stop")

    started = time.monotonic()
    with scoped_cancellation(source.token), push_sink(sink):
        result = stream_run(
            [sys.executable, "-c", "import time; print('ready', flush=True); time.sleep(6)"],
            input_data="x" * 2_000_000,
            timeout=None if cancel else 0.3,
        )
    assert time.monotonic() - started < 4, result
    assert result["cancelled"] is cancel
    assert result["timed_out"] is not cancel
    assert result["killed"] is True
    assert result["exit_code"] is None
    assert not [t for t in set(threading.enumerate()) - before if t.name == "process-stdin"]


@pytest.mark.parametrize("payload", ["", "hello\n" * 100_000], ids=["empty", "large"])
def test_stdin_is_delivered_completely_and_closed(payload):
    result = stream_run(
        [sys.executable, "-c", "import sys; print(len(sys.stdin.read()))"],
        input_data=payload,
        timeout=10,
    )
    assert result["exit_code"] == 0, result
    assert result["stdout"].strip() == str(len(payload))
    assert not result["timed_out"]
