"""Cancellation must not race tunnel startup or abandon thread cleanup."""

from __future__ import annotations

import asyncio
import threading
from dataclasses import replace

import anyio
import pytest

from runtime.sensing.gateway._remote_backend_lifetime import realtime_backend_lifetime
from runtime.sensing.gateway.remote_transport import (
    RemoteBackend,
    SshTunnel,
    SshTunnelError,
    WslTarget,
)


def _backend():
    return RemoteBackend(
        id="private",
        name="Private",
        url="http://127.0.0.1:8000",
        ssh=SshTunnel(host="bastion.example.com"),
    )


class ControlledForwarder:
    def __init__(self, backend, *, block_start=False, block_close=False, start_error=None):
        self.backend = backend
        self.started = threading.Event()
        self.close_started = threading.Event()
        self.closed = threading.Event()
        self.start_release = threading.Event()
        self.close_release = threading.Event()
        if not block_start:
            self.start_release.set()
        if not block_close:
            self.close_release.set()
        self.start_error = start_error
        self.events = []
        self.active = False

    def start(self):
        self.active = True
        self.events.append("start")
        self.started.set()
        if not self.start_release.wait(5):
            raise AssertionError("test did not release startup")
        if self.start_error:
            raise self.start_error
        self.events.append("ready")
        return replace(self.backend, ssh=None, tunnel_active=True)

    def close(self):
        self.events.append("close-start")
        self.close_started.set()
        if not self.close_release.wait(5):
            raise AssertionError("test did not release cleanup")
        self.active = False
        self.events.append("closed")
        self.closed.set()


async def _wait(event):
    assert await asyncio.to_thread(event.wait, 3), "expected lifecycle event did not occur"


@pytest.mark.asyncio
async def test_normal_relay_owns_tunnel_until_exit():
    forwarder = ControlledForwarder(_backend())
    async with realtime_backend_lifetime(
        forwarder.backend, forwarder_factory=lambda _: forwarder
    ) as connected:
        assert connected.tunnel_active and forwarder.active
        assert forwarder.events == ["start", "ready"]
    assert not forwarder.active and forwarder.closed.is_set()
    assert forwarder.events == ["start", "ready", "close-start", "closed"]


@pytest.mark.asyncio
async def test_already_cancelled_scope_never_allocates_a_tunnel():
    allocated = False

    def factory(backend):
        nonlocal allocated
        allocated = True
        return ControlledForwarder(backend)

    with anyio.CancelScope() as scope:
        scope.cancel()
        async with realtime_backend_lifetime(_backend(), forwarder_factory=factory):
            pytest.fail("an already cancelled connection must not reach the relay")
    assert not allocated


@pytest.mark.asyncio
@pytest.mark.parametrize("error", [SshTunnelError("startup failed"), OSError("partial startup")])
async def test_partial_startup_failure_still_closes_once(error):
    forwarder = ControlledForwarder(_backend(), start_error=error)
    with pytest.raises(type(error), match=str(error)):
        async with realtime_backend_lifetime(
            forwarder.backend, forwarder_factory=lambda _: forwarder
        ):
            pytest.fail("failed startup must not reach the relay")
    assert forwarder.events == ["start", "close-start", "closed"]
    assert not forwarder.active


@pytest.mark.asyncio
async def test_task_cancel_during_startup_waits_before_cleanup_and_never_enters_relay():
    forwarder = ControlledForwarder(_backend(), block_start=True, block_close=True)

    async def connection():
        async with realtime_backend_lifetime(
            forwarder.backend, forwarder_factory=lambda _: forwarder
        ):
            pytest.fail("cancelled startup must not reach the relay")

    task = asyncio.create_task(connection())
    try:
        await _wait(forwarder.started)
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done() and not forwarder.close_started.is_set()
        forwarder.start_release.set()
        await _wait(forwarder.close_started)
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done() and forwarder.active
        forwarder.close_release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert forwarder.closed.is_set() and not forwarder.active
        assert forwarder.events == ["start", "ready", "close-start", "closed"]
    finally:
        forwarder.start_release.set()
        forwarder.close_release.set()
        if not task.done():
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task


@pytest.mark.asyncio
async def test_repeated_task_cancel_during_relay_cleanup_finishes_before_return():
    forwarder = ControlledForwarder(_backend(), block_close=True)
    relay = asyncio.Event()

    async def connection():
        async with realtime_backend_lifetime(
            forwarder.backend, forwarder_factory=lambda _: forwarder
        ):
            relay.set()
            await asyncio.Event().wait()

    task = asyncio.create_task(connection())
    try:
        await asyncio.wait_for(relay.wait(), 3)
        task.cancel()
        await _wait(forwarder.close_started)
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
        forwarder.close_release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert forwarder.closed.is_set()
    finally:
        forwarder.close_release.set()
        if not task.done():
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task


@pytest.mark.asyncio
async def test_anyio_scope_cancel_during_startup_closes_before_session_returns():
    forwarder = ControlledForwarder(_backend(), block_start=True, block_close=True)
    scope = anyio.CancelScope()
    finished = anyio.Event()

    async def connection():
        with scope:
            async with realtime_backend_lifetime(
                forwarder.backend, forwarder_factory=lambda _: forwarder
            ):
                pytest.fail("cancelled startup must not enter the relay")
        finished.set()

    try:
        async with anyio.create_task_group() as group:
            group.start_soon(connection)
            await _wait(forwarder.started)
            scope.cancel()
            forwarder.start_release.set()
            await _wait(forwarder.close_started)
            assert not finished.is_set()
            forwarder.close_release.set()
            with anyio.fail_after(3):
                await finished.wait()
        assert forwarder.closed.is_set() and not forwarder.active
    finally:
        forwarder.start_release.set()
        forwarder.close_release.set()


@pytest.mark.asyncio
async def test_relay_failure_preserves_error_and_closes():
    forwarder = ControlledForwarder(_backend())
    with pytest.raises(RuntimeError, match="relay failed"):
        async with realtime_backend_lifetime(
            forwarder.backend, forwarder_factory=lambda _: forwarder
        ):
            raise RuntimeError("relay failed")
    assert forwarder.closed.is_set() and not forwarder.active


@pytest.mark.asyncio
@pytest.mark.parametrize("wsl", [None, WslTarget(distro="Ubuntu")])
async def test_non_ssh_backend_does_not_create_a_forwarder(wsl):
    backend = RemoteBackend(id="direct", name="Direct", url="http://127.0.0.1:8000", wsl=wsl)

    def unexpected(_backend):
        pytest.fail("non-SSH backend must not allocate a tunnel")

    async with realtime_backend_lifetime(backend, forwarder_factory=unexpected) as connected:
        assert connected.url == backend.url
