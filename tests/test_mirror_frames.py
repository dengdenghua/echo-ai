import asyncio
from types import SimpleNamespace

import pytest

from runtime.tentacle.mirror_frames import MirrorFrames


@pytest.mark.asyncio
async def test_shared_frames_coalesce_and_reconnected_socket_never_reuses_frame():
    cache = MirrorFrames()
    socket = object()
    calls = 0

    async def capture():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.02)
        return SimpleNamespace(success=True, data=str(calls))

    first, second = await asyncio.gather(
        cache.capture("phone", socket, {}, capture), cache.capture("phone", socket, {}, capture)
    )
    assert first is second
    assert calls == 1
    assert await cache.capture("phone", socket, {}, capture) is first
    await cache.capture("phone", object(), {}, capture)
    assert calls == 2


@pytest.mark.asyncio
async def test_failed_capture_is_not_cached_as_success():
    cache = MirrorFrames()
    socket = object()
    calls = 0

    async def capture():
        nonlocal calls
        calls += 1
        return SimpleNamespace(success=calls > 1)

    assert not (await cache.capture("phone", socket, {}, capture)).success
    assert (await cache.capture("phone", socket, {}, capture)).success
    assert calls == 2
