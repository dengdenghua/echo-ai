"""Read-only Windows window previews. Never activate a window or fall back to the screen."""

from __future__ import annotations

import base64
import contextlib
import io
import logging
import sys
import threading
from pathlib import PureWindowsPath
from typing import Any

_capture_lock = threading.Lock()
logger = logging.getLogger(__name__)


def _capture_wgc(hwnd: int) -> Any:
    """One frame from Windows Graphics Capture for GPU-rendered windows."""
    from PIL import Image
    from windows_capture import WindowsCapture

    ready = threading.Event()
    frames: list[Any] = []
    capture = WindowsCapture(window_hwnd=hwnd, cursor_capture=False)

    @capture.event
    def on_frame_arrived(frame: Any, capture_control: Any) -> None:
        try:
            # Native frame memory dies when capture stops. Copy RGB now.
            image = Image.fromarray(frame.frame_buffer[:, :, [2, 1, 0]].copy())
            frames.append(image)
        finally:
            capture_control.stop()
            ready.set()

    @capture.event
    def on_closed() -> None:
        ready.set()

    control = capture.start_free_threaded()
    try:
        if not ready.wait(3) or not frames:
            raise RuntimeError("window capture timed out")
        return frames[0]
    finally:
        control.stop()


def _is_black_frame(image: Any) -> bool:
    return all(maximum == 0 for _, maximum in image.convert("RGB").getextrema())


def _png(image: Any) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _window_target(hwnd: int) -> dict[str, Any]:
    import win32gui
    import win32process

    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    title = win32gui.GetWindowText(hwnd)
    app_name = win32gui.GetClassName(hwnd)
    try:
        import win32api

        process = win32api.OpenProcess(0x0410, False, pid)
        try:
            app_name = PureWindowsPath(win32process.GetModuleFileNameEx(process, 0)).stem
        finally:
            process.Close()
    except Exception:
        logger.debug("Window executable unavailable; using window class", exc_info=True)
    # HWND + process ID prevents a closed window handle reused by another app
    # from silently changing the preview's identity.
    return {
        "kind": "desktop_window",
        "source": "computer",
        "id": f"win32:{hwnd}:{pid}",
        "title": title,
        "app_id": str(pid),
        "app_name": app_name,
        "frontmost": hwnd == win32gui.GetForegroundWindow(),
        "minimized": bool(win32gui.IsIconic(hwnd)),
    }


def _window_icon(hwnd: int) -> str | None:
    import win32con
    import win32gui
    import win32ui
    from PIL import Image

    # Bounded message: an unresponsive target must not stall the picker.
    icon = win32gui.SendMessageTimeout(
        hwnd,
        win32con.WM_GETICON,
        2,
        0,
        win32con.SMTO_ABORTIFHUNG,
        80,
    )
    if isinstance(icon, tuple):
        icon = icon[-1]
    icon = icon or win32gui.GetClassLong(hwnd, win32con.GCL_HICONSM)
    if not icon:
        return None
    screen_dc = win32gui.GetDC(0)
    source = win32ui.CreateDCFromHandle(screen_dc)
    dc = source.CreateCompatibleDC()
    bitmap = win32ui.CreateBitmap()
    try:
        bitmap.CreateCompatibleBitmap(source, 32, 32)
        old = dc.SelectObject(bitmap)
        dc.FillSolidRect((0, 0, 32, 32), 0xFFFFFF)
        win32gui.DrawIconEx(dc.GetSafeHdc(), 0, 0, icon, 32, 32, 0, None, win32con.DI_NORMAL)
        image = Image.frombuffer("RGB", (32, 32), bitmap.GetBitmapBits(True), "raw", "BGRX", 0, 1)
        dc.SelectObject(old)
        return _png(image)
    finally:
        win32gui.DeleteObject(bitmap.GetHandle())
        dc.DeleteDC()
        source.DeleteDC()
        win32gui.ReleaseDC(0, screen_dc)


def list_window_targets() -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    if sys.platform != "win32":
        return {
            "schema": "echo.automation_targets.v1",
            "targets": items,
            "count": 0,
            "backend": "unavailable",
        }
    try:
        import win32gui

        def collect(hwnd: int, _: Any) -> None:
            if not win32gui.IsWindowVisible(hwnd) or not win32gui.GetWindowText(hwnd):
                return
            try:
                item = _window_target(hwnd)
                with contextlib.suppress(Exception):
                    item["icon_url"] = _window_icon(hwnd)
                items.append(item)
            except Exception:
                logger.debug("Skipping window unavailable during enumeration", exc_info=True)

        win32gui.EnumWindows(collect, None)
        items.sort(key=lambda item: (not item["frontmost"], item["title"]))
        return {
            "schema": "echo.automation_targets.v1",
            "targets": items,
            "count": len(items),
            "backend": "win32",
        }
    except ImportError:
        return {
            "schema": "echo.automation_targets.v1",
            "targets": [],
            "count": 0,
            "backend": "unavailable",
        }


def foreground_window_target() -> dict[str, Any] | None:
    if sys.platform != "win32":
        return None
    try:
        import win32gui

        hwnd = win32gui.GetForegroundWindow()
        target = _window_target(hwnd)
        with contextlib.suppress(Exception):
            target["icon_url"] = _window_icon(hwnd)
        return target
    except Exception:
        return None


def capture_window_preview(target: dict[str, Any]) -> dict[str, Any]:
    if sys.platform != "win32":
        return {"ok": False, "error": "当前宿主不支持后台窗口预览，请使用桌面客户端。"}
    if not _capture_lock.acquire(blocking=False):
        return {"ok": False, "error": "画面正在刷新，请稍后重试。"}
    try:
        import win32gui
        from PIL import ImageGrab

        parts = str(target.get("id", "")).split(":")
        if len(parts) != 3 or parts[0] != "win32":
            return {"ok": False, "error": "请重新选择需要预览的应用窗口。"}
        hwnd, pid = int(parts[1]), int(parts[2])
        if not win32gui.IsWindow(hwnd):
            return {"ok": False, "error": "被控窗口已关闭，请重新选择。"}
        current = _window_target(hwnd)
        if current["app_id"] != str(pid):
            return {"ok": False, "error": "被控窗口已更换，请重新选择。"}
        if current["minimized"]:
            return {"ok": False, "error": "窗口已最小化，恢复窗口后可继续预览。"}
        # Pillow's Windows window capture uses PrintWindow, including occluded
        # windows, without bringing them to the foreground. No screenshot archive
        # or control events: watching must not mutate the automation session.
        image = ImageGrab.grab(window=hwnd)
        if _is_black_frame(image):
            try:
                image = _capture_wgc(hwnd)
            except ImportError:
                return {"ok": False, "error": "此窗口需要图形捕获组件，请安装电脑控制依赖后重试。"}
        if _is_black_frame(image):
            return {"ok": False, "error": "此窗口未提供可预览画面，可能受应用捕获限制。"}
        image.thumbnail((960, 540))
        return {"ok": True, "data_url": _png(image), "target": current, "matched": True}
    except Exception:
        return {"ok": False, "error": "无法捕获该窗口画面，请重新检查或选择其他窗口。"}
    finally:
        _capture_lock.release()
