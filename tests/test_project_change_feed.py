"""Local commit delivery and unavailable-broker behavior, without SDK imports."""

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from runtime.projectos.live_updates import ProjectChangeFeed


def test_bounded_subscribers_and_idempotent_unsubscribe():
    feed = ProjectChangeFeed(max_subscribers=1)
    received = threading.Event()
    remove = feed.subscribe(received.set)
    with pytest.raises(OverflowError):
        feed.subscribe(lambda: None)
    remove()
    remove()
    feed.subscribe(received.set)
    feed.notify()
    try:
        feed.start()
        feed.start()
        assert received.wait(2)
    finally:
        feed.close()
    with pytest.raises(RuntimeError):
        feed.subscribe(lambda: None)
    with pytest.raises(RuntimeError):
        feed.start()


def test_one_broken_consumer_does_not_prevent_local_wake_up(caplog):
    feed = ProjectChangeFeed()
    received = threading.Event()

    def fail():
        raise RuntimeError("private-resource-details")

    feed.subscribe(fail)
    feed.subscribe(received.set)
    try:
        feed.start()
        feed.notify()
        assert received.wait(2)
    finally:
        feed.close()
    assert "consumer unavailable" in caplog.text
    assert "private-resource-details" not in caplog.text


def test_stalled_broker_does_not_block_project_commit_and_pending_hint_is_coalesced(tmp_path):
    from runtime.projectos.model import Project
    from runtime.projectos.store import ProjectStore

    entered = threading.Event()
    release = threading.Event()

    class Bus:
        timeout = 0.1

        def __init__(self):
            self.frames = []
            self.removed = False

        def subscribe(self, kind, callback):
            def remove():
                self.removed = True

            return remove

        def publish(self, kind, payload):
            entered.set()
            assert release.wait(5), "test must release broker before joining delivery"
            self.frames.append((kind, payload))

    bus = Bus()
    feed = ProjectChangeFeed(bus)
    store = ProjectStore(tmp_path)
    unsubscribe = store.bind_commit_listener(feed.notify)
    try:
        feed.start()
        store.save_project(Project(id="first", name="First", goal="goal"))
        assert entered.wait(2)
        with ThreadPoolExecutor(max_workers=1) as pool:
            try:
                future = pool.submit(
                    store.save_project, Project(id="second", name="Second", goal="goal")
                )
                assert future.result(timeout=2).id == "second"
                assert store.get_project("second") is not None
                for _ in range(10000):
                    feed.notify()
            finally:
                release.set()
    finally:
        release.set()
        unsubscribe()
        feed.close()
    assert bus.removed
    assert 1 <= len(bus.frames) <= 2
    assert all(frame == ("project:changed", {}) for frame in bus.frames)
