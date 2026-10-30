"""Opt-in integration with a real virtual Windows render endpoint and WASAPI loopback."""

import asyncio
import math
import os
import struct
import sys
import threading

import pytest

from runtime.tentacle.remote_desktop_audio import SessionAudio, SystemAudioCapture

pytestmark = pytest.mark.skipif(
    sys.platform != "win32" or os.environ.get("ECHO_TEST_WINDOWS_AUDIO") != "1",
    reason="Requires explicit opt-in and a default VB-CABLE Windows output device",
)


@pytest.fixture
def windows_speakers():
    import pyaudiowpatch as pa

    output = pa.PyAudio()
    stream = worker = None
    stopped = threading.Event()
    started = threading.Event()
    errors = []
    control = {"frequencies": (437, 997), "enabled": True}
    try:
        host = output.get_host_api_info_by_type(pa.paWASAPI)
        device = output.get_device_info_by_index(host["defaultOutputDevice"])
        if "VB-Audio Virtual Cable" not in device["name"]:
            pytest.skip("The default render endpoint must be the dedicated virtual cable")
        rate = int(device["defaultSampleRate"])
        stream = output.open(
            format=pa.paInt16,
            channels=2,
            rate=rate,
            output=True,
            output_device_index=device["index"],
            frames_per_buffer=rate // 50,
        )

        def render():
            index = 0
            try:
                while not stopped.is_set():
                    a, b = control["frequencies"]
                    chunk = b"".join(
                        struct.pack(
                            "<hh",
                            int(4200 * math.sin(2 * math.pi * a * (index + i) / rate)),
                            int(4200 * math.sin(2 * math.pi * b * (index + i) / rate)),
                        )
                        for i in range(rate // 50)
                    ) if control["enabled"] else bytes(rate // 50 * 4)
                    stream.write(chunk)
                    index += rate // 50
                    started.set()
            except Exception as exc:
                errors.append(exc)
                started.set()

        worker = threading.Thread(target=render, daemon=True)
        worker.start()
        assert started.wait(5) and not errors
        yield control
    finally:
        stopped.set()
        if worker:
            worker.join(5)
            assert not worker.is_alive(), "Render worker did not release the endpoint"
        if stream:
            stream.stop_stream()
            stream.close()
        output.terminate()
        assert not errors


def observe(capture, *, discard=20, chunks=20):
    for _ in range(discard):
        capture.read()
    frames = [capture.read() for _ in range(chunks)]
    assert all(len(pcm) == capture.samples * capture.channels * 2 for pcm in frames)
    packets = []
    for pcm in frames:
        values = struct.unpack("<" + "h" * (len(pcm) // 2), pcm)
        packets.append([sum(values[i:i + capture.channels]) / capture.channels
                        for i in range(0, len(values), capture.channels)])
    mono = [sample for packet in packets for sample in packet]
    rms = math.sqrt(sum(x * x for x in mono) / len(mono))

    def amplitude(hz):
        # Queue overflow may intentionally skip old packets under CPU load.
        # Compare spectral magnitudes without assuming phase continuity across them.
        magnitudes = []
        for packet in packets:
            real = sum(x * math.cos(2 * math.pi * hz * i / capture.rate)
                       for i, x in enumerate(packet))
            imag = sum(x * math.sin(2 * math.pi * hz * i / capture.rate)
                       for i, x in enumerate(packet))
            magnitudes.append(2 * math.hypot(real, imag) / len(packet))
        return sum(magnitudes) / len(magnitudes)

    return rms, amplitude


@pytest.mark.parametrize("rate,channels", [(48000, 2), (24000, 1)])
def test_real_wasapi_loopback_formats_live_changes_and_silence(windows_speakers, rate, channels):
    capture = SystemAudioCapture(rate, channels)
    try:
        rms, amplitude = observe(capture)
        assert rms > 400 and amplitude(437) > 400 and amplitude(997) > 400
        windows_speakers["frequencies"] = (659, 1319)
        rms, amplitude = observe(capture, discard=35)
        assert rms > 400 and amplitude(659) > 400 and amplitude(1319) > 400
        assert amplitude(437) < amplitude(659) / 8
        windows_speakers["enabled"] = False
        rms, _ = observe(capture, discard=35)
        assert rms < 80
    finally:
        capture.close()
    with pytest.raises(OSError):
        capture.read()


@pytest.mark.asyncio
async def test_real_wasapi_session_release_and_reopen(windows_speakers):
    for _ in range(3):
        audio = SessionAudio()
        audio.configure(True)
        try:
            assert await audio.prepare(), repr(audio.future.exception())
            native = audio.capture
            pcm = b"".join([await audio.read() for _ in range(30)])
            values = struct.unpack("<" + "h" * (len(pcm) // 2), pcm)
            assert max(abs(value) for value in values) > 500
        finally:
            await asyncio.wait_for(audio.close(), 5)
        with pytest.raises(OSError):
            native.stream.is_active()


def test_real_wasapi_preserves_an_existing_mta(windows_speakers):
    import ctypes
    from concurrent.futures import ThreadPoolExecutor

    def capture_in_mta():
        ole32 = ctypes.WinDLL("ole32")
        assert ole32.CoInitializeEx(None, 0) == 0
        try:
            capture = SystemAudioCapture()
            try:
                rms, _ = observe(capture)
                assert rms > 400
            finally:
                capture.close()
            # The caller's original COM apartment must still exist after close.
            assert ole32.CoInitializeEx(None, 0) == 1
            ole32.CoUninitialize()
        finally:
            ole32.CoUninitialize()

    with ThreadPoolExecutor(max_workers=1) as worker:
        worker.submit(capture_in_mta).result(timeout=15)
