from threading import Event, Thread

import pytest

from runtime.execution.claim_guard import ExecutionClaimGuard
from runtime.safety.approval.cancellation import (
    CancellationSource,
    OperationCancelled,
    current_cancellation_token,
    scoped_cancellation,
)


def test_guard_inherits_cancellation_and_restores_parent():
    parent = CancellationSource()
    with scoped_cancellation(parent.token):
        guard = ExecutionClaimGuard(lambda: True, interval_s=0.01)
        with guard.scope():
            assert current_cancellation_token() is guard.token
            parent.cancel(reason="stopped")
            with pytest.raises(OperationCancelled, match="stopped"):
                guard.checkpoint()
        assert current_cancellation_token() is parent.token
    assert parent._callbacks == []


def test_parent_cancellation_is_visible_while_an_earlier_listener_blocks():
    parent = CancellationSource()
    listener_entered = Event()
    release_listener = Event()

    def slow_persistence(_reason):
        listener_entered.set()
        assert release_listener.wait(3)

    parent.token.on_cancelled(slow_persistence)
    with scoped_cancellation(parent.token):
        guard = ExecutionClaimGuard(lambda: True, interval_s=1)
        with guard.scope():
            worker = Thread(target=lambda: parent.cancel(reason="concurrent stop"))
            worker.start()
            try:
                assert listener_entered.wait(3)
                # A second caller must see the stop before callback I/O finishes.
                assert not parent.cancel()
                assert current_cancellation_token().is_cancelled
                with pytest.raises(OperationCancelled, match="concurrent stop"):
                    current_cancellation_token().throw_if_cancelled()
            finally:
                release_listener.set()
                worker.join(timeout=3)


@pytest.mark.parametrize("raises", [False, True])
def test_guard_fails_closed_and_never_revives(raises):
    cancelled = Event()
    calls = []

    def renew():
        calls.append(True)
        if raises:
            raise OSError("unavailable")
        return False

    guard = ExecutionClaimGuard(renew, interval_s=0.01)
    with guard.scope():
        guard.token.on_cancelled(lambda _: cancelled.set())
        assert cancelled.wait(2)
        assert guard.claim_lost
        assert not guard.verify()
        assert len(calls) == 1
