from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from runtime.sensing.gateway import computer_window_preview as preview


@pytest.fixture
def window(monkeypatch):
    monkeypatch.setattr(preview.sys, "platform", "win32")
    gui = SimpleNamespace(IsWindow=lambda hwnd: hwnd == 12)
    monkeypatch.setitem(preview.sys.modules, "win32gui", gui)
    monkeypatch.setattr(
        preview,
        "_window_target",
        lambda hwnd: {
            "app_id": "34",
            "minimized": False,
            "title": "Test app",
        },
    )
    from PIL import Image, ImageGrab

    capture = Mock(return_value=Image.new("RGB", (100, 100), "blue"))
    monkeypatch.setattr(ImageGrab, "grab", capture)
    return capture


def test_preview_captures_only_exact_window_in_memory(window):
    result = preview.capture_window_preview({"id": "win32:12:34"})
    assert result["ok"] and result["data_url"].startswith("data:image/png;base64,")
    assert "path" not in result
    window.assert_called_once_with(window=12)


@pytest.mark.parametrize("target", ["foreground", "win32:99:34", "win32:12:999", "win32:bad:34"])
def test_missing_or_reused_window_never_falls_back_to_desktop(window, target):
    assert preview.capture_window_preview({"id": target})["ok"] is False
    window.assert_not_called()


def test_minimized_window_is_not_activated(window, monkeypatch):
    monkeypatch.setattr(preview, "_window_target", lambda hwnd: {"app_id": "34", "minimized": True})
    result = preview.capture_window_preview({"id": "win32:12:34"})
    assert result["ok"] is False
    window.assert_not_called()


def test_capture_failure_and_busy_requests_are_retryable(window):
    window.side_effect = RuntimeError("capture unavailable")
    assert not preview.capture_window_preview({"id": "win32:12:34"})["ok"]
    assert not preview._capture_lock.locked()
    with preview._capture_lock:
        assert not preview.capture_window_preview({"id": "win32:12:34"})["ok"]


def test_gpu_black_frame_uses_exact_window_capture(window, monkeypatch):
    from PIL import Image

    window.return_value = Image.new("RGB", (100, 100), "black")
    fallback = Mock(return_value=Image.new("RGB", (100, 100), "blue"))
    monkeypatch.setattr(preview, "_capture_wgc", fallback)
    assert preview.capture_window_preview({"id": "win32:12:34"})["ok"]
    fallback.assert_called_once_with(12)
    fallback.return_value = Image.new("RGB", (100, 100), "black")
    assert not preview.capture_window_preview({"id": "win32:12:34"})["ok"]


def test_graphics_capture_stops_and_copies_native_frame(monkeypatch):
    import numpy as np

    pixels = np.full((2, 2, 4), 255, dtype=np.uint8)
    stop = Mock(side_effect=lambda: pixels.fill(0))

    class Capture:
        def __init__(self, **kwargs):
            assert kwargs["window_hwnd"] == 12

        def event(self, fn):
            setattr(self, fn.__name__, fn)
            return fn

        def start_free_threaded(self):
            self.on_frame_arrived(SimpleNamespace(frame_buffer=pixels), SimpleNamespace(stop=stop))
            return SimpleNamespace(stop=stop)

    monkeypatch.setitem(
        preview.sys.modules, "windows_capture", SimpleNamespace(WindowsCapture=Capture)
    )
    frame = preview._capture_wgc(12)
    assert frame.getpixel((0, 0)) == (255, 255, 255)
    assert stop.call_count == 2
