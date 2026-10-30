"""Session-scoped speaker loopback. Never open a microphone or persist audio."""

from __future__ import annotations

import asyncio
import contextlib
import importlib.util
import queue
import shutil
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction


def system_audio_available():
    if sys.platform == "win32":
        return importlib.util.find_spec("pyaudiowpatch") is not None
    return sys.platform.startswith("linux") and shutil.which("parec") is not None


def _windows_com():
    import ctypes

    ole32 = ctypes.WinDLL("ole32")
    ole32.CoInitializeEx.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    ole32.CoInitializeEx.restype = ctypes.c_long
    ole32.CoUninitialize.argtypes = []
    ole32.CoUninitialize.restype = None
    result = ole32.CoInitializeEx(None, 2)
    if result in (0, 1):
        return ole32.CoUninitialize
    # An existing MTA belongs to its caller and must not be uninitialized here.
    if ctypes.c_uint32(result).value != 0x80010106:
        raise OSError("Windows audio thread initialization failed")
    return None


class SystemAudioCapture:
    """20ms signed little-endian PCM; at most three native chunks are retained."""

    def __init__(self, rate=48000, channels=2):
        self.rate, self.channels = rate, channels
        self.samples = rate // 50
        self.closed = False
        self.chunks = queue.Queue(maxsize=3)
        self.process = self.thread = self.audio = self.stream = None
        self.resampler = self.fifo = None
        self._release_com = None
        try:
            if sys.platform == "win32":
                self._windows()
            elif sys.platform.startswith("linux"):
                self._linux()
            else:
                raise OSError("System loopback unsupported")
        except Exception:
            self.close()
            raise

    def _push(self, data):
        if self.closed:
            return
        try:
            self.chunks.put_nowait(data)
        except queue.Full:
            with contextlib.suppress(queue.Empty):
                self.chunks.get_nowait()
            with contextlib.suppress(queue.Full):
                self.chunks.put_nowait(data)

    def _windows(self):
        import pyaudiowpatch as pa
        from av import AudioFifo, AudioResampler

        # PortAudio initialization is process-global. If another instance already
        # exists, it does not initialize COM on this session's capture worker.
        self._release_com = _windows_com()
        self.audio = pa.PyAudio()
        device = self.audio.get_default_wasapi_loopback()
        # Never substitute the default recording device (usually a microphone).
        if not device.get("isLoopbackDevice"):
            raise OSError("No speaker loopback")
        self.native_rate = int(device["defaultSampleRate"])
        self.native_channels = int(device["maxInputChannels"])
        self.native_layout = {1: "mono", 2: "stereo", 4: "quad", 6: "5.1", 8: "7.1"}.get(
            self.native_channels
        )
        if not self.native_layout:
            raise OSError("Unsupported speaker layout")
        self.resampler = AudioResampler(
            format="s16", layout="stereo" if self.channels == 2 else "mono", rate=self.rate
        )
        self.fifo = AudioFifo()

        def callback(data, count, timing, status):
            self._push(data)
            return None, pa.paComplete if self.closed else pa.paContinue

        self.stream = self.audio.open(
            format=pa.paInt16, channels=self.native_channels, rate=self.native_rate,
            input=True, input_device_index=device["index"],
            frames_per_buffer=self.native_rate // 50, stream_callback=callback,
        )

    def _linux(self):
        executable = shutil.which("parec")
        if not executable:
            raise OSError("Install pulseaudio-utils for speaker loopback")
        self.process = subprocess.Popen(
            [executable, "--device=@DEFAULT_MONITOR@", "--raw", "--format=s16le",
             f"--rate={self.rate}", f"--channels={self.channels}", "--latency-msec=20"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            bufsize=0,
        )

        def read_pipe():
            size = self.samples * self.channels * 2
            while not self.closed:
                data = bytearray()
                while len(data) < size and not self.closed:
                    chunk = self.process.stdout.read(size - len(data))
                    if not chunk:
                        return
                    data.extend(chunk)
                if len(data) == size:
                    self._push(bytes(data))

        self.thread = threading.Thread(target=read_pipe, name="remote-speakers", daemon=True)
        self.thread.start()

    def read(self):
        if self.closed:
            raise OSError("Loopback closed")
        if self.process and self.process.poll() is not None:
            raise OSError("Speaker monitor unavailable")
        if self.stream and not self.stream.is_active():
            raise OSError("Speaker loopback disconnected")
        silence = bytes(self.samples * self.channels * 2)
        if self.fifo and self.fifo.samples >= self.samples:
            return bytes(self.fifo.read(self.samples).planes[0])[:len(silence)]
        try:
            data = self.chunks.get(timeout=.02)
        except queue.Empty:
            return silence
        if self.resampler is None:
            return data
        from av import AudioFrame

        frame = AudioFrame(format="s16", layout=self.native_layout,
                           samples=len(data) // (2 * self.native_channels))
        frame.planes[0].update(data)
        frame.sample_rate = self.native_rate
        for converted in self.resampler.resample(frame):
            converted.pts = None
            self.fifo.write(converted)
        if self.fifo.samples >= self.samples:
            return bytes(self.fifo.read(self.samples).planes[0])[:len(silence)]
        return silence

    def close(self):
        if self.closed:
            return
        self.closed = True
        if self.process:
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=1)
            self.process.stdout.close()
        if self.thread:
            self.thread.join(timeout=1)
        if self.stream:
            with contextlib.suppress(Exception):
                self.stream.stop_stream()
            with contextlib.suppress(Exception):
                self.stream.close()
        if self.audio:
            with contextlib.suppress(Exception):
                self.audio.terminate()
        if self._release_com:
            release, self._release_com = self._release_com, None
            release()
        while not self.chunks.empty():
            with contextlib.suppress(queue.Empty):
                self.chunks.get_nowait()


class SessionAudio:
    def __init__(self, *, rate=48000, channels=2, capture_factory=SystemAudioCapture):
        self.rate, self.channels = rate, channels
        self.capture_factory = capture_factory
        self.enabled = False
        self.state = "off"
        self.on_status = None
        self.worker = self.capture = self.future = self.track = None
        self.closed = False

    def configure(self, enabled, on_status=None):
        self.enabled, self.on_status = enabled, on_status

    async def prepare(self):
        if not self.enabled:
            return False
        self.worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="remote-audio")
        loop = asyncio.get_running_loop()
        self.future = loop.run_in_executor(self.worker, self.capture_factory, self.rate, self.channels)
        try:
            self.capture = await asyncio.shield(self.future)
            self.state = "enabled"
            return True
        except asyncio.CancelledError:
            raise
        except Exception:
            self.state = "unavailable"
            return False

    async def read(self):
        if not self.closed and self.capture is not None and self.state == "enabled":
            try:
                return await asyncio.get_running_loop().run_in_executor(self.worker, self.capture.read)
            except Exception:
                self.state = "unavailable"
                await asyncio.get_running_loop().run_in_executor(self.worker, self.capture.close)
                self.capture = None
                if self.on_status:
                    await self.on_status(self.state)
        return bytes(self.rate // 50 * self.channels * 2)

    def create_track(self):
        from aiortc import AudioStreamTrack
        from av import AudioFrame

        audio = self
        loop = asyncio.get_running_loop()

        class Speakers(AudioStreamTrack):
            def __init__(self):
                super().__init__()
                self.started, self.index = loop.time(), 0

            async def recv(self):
                from aiortc.mediastreams import MediaStreamError

                await asyncio.sleep(max(0, self.started + self.index / 50 - loop.time()))
                if audio.closed:
                    raise MediaStreamError
                data = await audio.read()
                if audio.closed:
                    raise MediaStreamError
                frame = AudioFrame(format="s16", layout="stereo", samples=audio.rate // 50)
                frame.planes[0].update(data)
                frame.sample_rate = audio.rate
                frame.pts = self.index * (audio.rate // 50)
                frame.time_base = Fraction(1, audio.rate)
                self.index += 1
                return frame

        self.track = Speakers()
        return self.track

    async def close(self):
        if self.closed:
            return
        self.closed = True
        if self.track:
            self.track.stop()
        try:
            if self.capture is None and self.future is not None:
                with contextlib.suppress(Exception):
                    self.capture = await self.future
            if self.capture:
                await asyncio.get_running_loop().run_in_executor(self.worker, self.capture.close)
                self.capture = None
        finally:
            if self.worker:
                self.worker.shutdown(wait=False, cancel_futures=True)
