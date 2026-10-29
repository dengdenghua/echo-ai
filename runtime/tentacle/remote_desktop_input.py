"""Serialized remote input. Text is Unicode, never logged or replayed."""

from __future__ import annotations

import ctypes
import math
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


def unicode_units(text: str) -> list[int]:
    raw = text.encode("utf-16-le", errors="strict")
    return [int.from_bytes(raw[i : i + 2], "little") for i in range(0, len(raw), 2)]


def type_unicode(text: str) -> None:
    """Use native text events without replacing the user's clipboard."""
    units = unicode_units(text)
    if sys.platform == "win32":
        from ctypes import wintypes as w

        class Keyboard(ctypes.Structure):
            _fields_ = [
                ("vk", w.WORD),
                ("scan", w.WORD),
                ("flags", w.DWORD),
                ("time", w.DWORD),
                ("extra", ctypes.c_size_t),
            ]

        class Mouse(ctypes.Structure):
            _fields_ = [
                ("x", w.LONG),
                ("y", w.LONG),
                ("data", w.DWORD),
                ("flags", w.DWORD),
                ("time", w.DWORD),
                ("extra", ctypes.c_size_t),
            ]

        class Payload(ctypes.Union):
            _fields_ = [("keyboard", Keyboard), ("mouse", Mouse)]

        class Input(ctypes.Structure):
            _fields_ = [("type", w.DWORD), ("payload", Payload)]

        send = ctypes.WinDLL("user32", use_last_error=True).SendInput
        send.argtypes = [w.UINT, ctypes.POINTER(Input), ctypes.c_int]
        send.restype = w.UINT
        for start in range(0, len(units), 128):
            events = [
                Input(1, Payload(keyboard=Keyboard(0, unit, flags, 0, 0)))
                for unit in units[start : start + 128]
                for flags in (4, 6)
            ]
            array = (Input * len(events))(*events)
            if send(len(array), array, ctypes.sizeof(Input)) != len(array):
                raise OSError("Text input was rejected by the desktop")
    elif sys.platform == "darwin":
        cg = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
        cf = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
        cg.CGEventCreateKeyboardEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint16, ctypes.c_bool]
        cg.CGEventCreateKeyboardEvent.restype = ctypes.c_void_p
        cg.CGEventKeyboardSetUnicodeString.argtypes = [
            ctypes.c_void_p,
            ctypes.c_ulong,
            ctypes.POINTER(ctypes.c_uint16),
        ]
        cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
        cf.CFRelease.argtypes = [ctypes.c_void_p]
        for start in range(0, len(units), 20):
            chunk = units[start : start + 20]
            data = (ctypes.c_uint16 * len(chunk))(*chunk)
            for down in (True, False):
                event = cg.CGEventCreateKeyboardEvent(None, 0, down)
                if not event:
                    raise OSError("Keyboard permission is unavailable")
                try:
                    cg.CGEventKeyboardSetUnicodeString(event, len(chunk), data)
                    cg.CGEventPost(0, event)
                finally:
                    cf.CFRelease(event)
    elif sys.platform.startswith("linux"):
        if os.environ.get("XDG_SESSION_TYPE", "").lower() == "wayland":
            raise ValueError("Unicode input requires an X11 desktop")
        try:
            options = {
                "input": text.encode("utf-8"),
                "stdout": subprocess.DEVNULL,
                "stderr": subprocess.PIPE,
                "env": {**os.environ, "LC_ALL": "C.UTF-8"},
            }
            try:
                result = subprocess.run(
                    [
                        "/usr/bin/python3",
                        str(Path(__file__).with_name("remote_desktop_x11_text.py")),
                    ],
                    **options,
                    timeout=5,
                    check=False,
                )
                unavailable = result.returncode == 69
                if result.returncode and not unavailable:
                    raise OSError("Focused editor did not confirm text insertion")
            except FileNotFoundError:
                unavailable = True
            if unavailable:
                from runtime.tentacle.remote_desktop_x11_keys import type_x11_text

                type_x11_text(text)
        except (ImportError, OSError, subprocess.SubprocessError):
            raise OSError("Linux Unicode input failed; check the X11 session and xdotool") from None
    else:
        if not text.isascii():
            raise ValueError("Unicode input requires a Windows or macOS desktop")
        import pyautogui

        pyautogui.write(text, interval=0, _pause=False)


class DesktopInput:
    """One instance per session; call only on that session's single input worker."""

    def __init__(self, geometry: dict[str, int], driver: Any = None, text_writer: Any = None):
        if driver is None:
            import pyautogui as driver
        self.driver = driver
        self.geometry = geometry
        self.text_writer = text_writer or type_unicode
        self.buttons: set[str] = set()

    def apply(self, event: dict[str, Any]) -> None:
        action = event.get("action")
        if action == "release_all":
            self.release()
            return
        if action == "type":
            text = event.get("text")
            if not isinstance(text, str) or not text or len(text) > 4096 or "\0" in text:
                raise ValueError("Invalid text")
            unicode_units(text)
            self.text_writer(text)
        elif action == "key":
            key = event.get("text", "")
            if not isinstance(key, str) or len(key) > 64:
                raise ValueError("Invalid key")
            keys = key.lower().split("+")
            if not 1 <= len(keys) <= 4 or any(k not in self.driver.KEYBOARD_KEYS for k in keys):
                raise ValueError("Unsupported key")
            try:
                self.driver.hotkey(*keys, _pause=False)
            finally:
                # A failsafe/driver error midway through a shortcut must release modifiers.
                backend = getattr(self.driver, "platformModule", None)
                for pressed in reversed(keys):
                    if backend is not None:
                        backend._keyUp(pressed)
                    else:
                        self.driver.keyUp(pressed, _pause=False)
        elif action == "scroll":
            delta = self._number(event.get("delta", 0), -20, 20)
            self.driver.scroll(round(delta), _pause=False)
        elif action in {"tap", "rightclick", "move", "down", "up"}:
            x = self._number(event.get("x"), 0, 1)
            y = self._number(event.get("y"), 0, 1)
            g = self.geometry
            px = g["left"] + round(x * (g["width"] - 1))
            py = g["top"] + round(y * (g["height"] - 1))
            if action in {"tap", "rightclick"}:
                self.driver.click(
                    px, py, button="right" if action == "rightclick" else "left", _pause=False
                )
            elif action == "move":
                self.driver.moveTo(px, py, _pause=False)
            elif action == "down":
                self.buttons.add("left")
                self.driver.mouseDown(px, py, _pause=False)
            else:
                self.driver.mouseUp(px, py, _pause=False)
                self.buttons.discard("left")
        else:
            raise ValueError("Unsupported input")

    @staticmethod
    def _number(value: Any, low: float, high: float) -> float:
        if isinstance(value, bool) or not isinstance(value, (float, int)):
            raise ValueError("Invalid coordinate")
        if not math.isfinite(value) or not low <= value <= high:
            raise ValueError("Coordinate out of range")
        return float(value)

    def release(self) -> None:
        # Release through the native backend: a pointer at the failsafe corner must
        # not leave a remotely pressed button stuck. Do not disable the failsafe.
        for button in list(self.buttons):
            backend = getattr(self.driver, "platformModule", None)
            if backend is not None:
                x, y = self.driver.position()
                backend._mouseUp(x, y, button)
            else:
                self.driver.mouseUp(button=button, _pause=False)
            self.buttons.discard(button)
