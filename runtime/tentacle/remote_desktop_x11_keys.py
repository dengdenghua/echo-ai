"""X11 text fallback with stable Unicode keycodes and no clipboard access."""

from __future__ import annotations

import contextlib
import json
import subprocess
import threading
import time
from pathlib import Path

_LOCK = threading.RLock()


def key_batches(value, lookup, capacity):
    batches, chars, missing = [], [], set()
    for char in value:
        if ord(char) < 32 and char not in "\n\r\t":
            raise ValueError("Unsupported text control character")
        symbol = {"\n": 0xFF0D, "\r": 0xFF0D, "\t": 0xFF09}.get(char, ord(char))
        if symbol > 255 and char not in "\n\r\t":
            symbol |= 0x1000000
        if symbol not in lookup and symbol not in missing:
            if not capacity:
                raise OSError("No unused X11 keycodes")
            if len(missing) == capacity:
                batches.append((chars, missing))
                chars, missing = [], set()
            missing.add(symbol)
        chars.append(symbol)
    if chars:
        batches.append((chars, missing))
    return batches


def focused_text_state():
    result = subprocess.run(
        [
            "/usr/bin/python3",
            str(Path(__file__).with_name("remote_desktop_x11_text.py")),
            "--snapshot",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=2,
        check=False,
    )
    if result.returncode == 69:
        return None
    if result.returncode:
        raise OSError("Focused editor observation failed")
    return json.loads(result.stdout)


def type_with_display(display, value, emit, sleep=time.sleep, observe=None):
    first = display.display.info.min_keycode
    count = display.display.info.max_keycode - first + 1
    original = display.get_keyboard_mapping(first, count)
    free = [first + i for i, symbols in enumerate(original) if not any(symbols)]
    lookup = {}
    for index, symbols in enumerate(original):
        for shifted, symbol in enumerate(symbols[:2]):
            if symbol:
                lookup.setdefault(symbol, (first + index, shifted))
    batches = key_batches(value, lookup, len(free))
    mask = display.screen().root.query_pointer().mask
    if mask & (1 | 4 | 8 | 64 | 128):  # Shift, Control, Alt, Super, AltGr
        raise OSError("Release held keyboard modifiers before text input")
    shift = lookup[0xFFE1][0]
    pressed = set()
    deadline = time.monotonic() + 15
    try:
        for symbols, missing in batches:
            changed = {}
            try:
                before = observe() if observe else None
                mapped = dict(lookup)
                for symbol, code in zip(sorted(missing), free, strict=False):
                    changed[code] = original[code - first]
                    display.change_keyboard_mapping(code, [[symbol] * len(changed[code])])
                    mapped[symbol] = (code, False)
                display.sync()
                if changed:
                    sleep(0.15)
                for symbol in symbols:
                    if time.monotonic() > deadline:
                        raise TimeoutError("X11 text input deadline exceeded")
                    code, shifted = mapped[symbol]
                    if mask & 2 and (65 <= symbol <= 90 or 97 <= symbol <= 122):
                        shifted = not shifted
                    if shifted:
                        pressed.add(shift)
                        emit(shift, True)
                    pressed.add(code)
                    emit(code, True)
                    emit(code, False)
                    pressed.discard(code)
                    if shifted:
                        emit(shift, False)
                        pressed.discard(shift)
                    display.sync()
                    sleep(0.001)
                if before is not None:
                    base = before["count"] - before["selected"]
                    codepoints = len(symbols)
                    utf16 = sum(2 if symbol > 0x100FFFF else 1 for symbol in symbols)
                    expected = base + (utf16 if before["units"] == "utf16" else codepoints)
                    while True:
                        after = observe()
                        if after is None or after["target"] != before["target"]:
                            raise OSError("Focused editor changed during input")
                        if after["count"] == expected:
                            break
                        if after["count"] > expected or time.monotonic() > deadline:
                            raise OSError("Focused editor did not confirm the entire text")
                        sleep(0.03)
                else:
                    # Password and terminal widgets expose no readable editor.
                    sleep(0.3)
            finally:
                for code, mapping in changed.items():
                    display.change_keyboard_mapping(code, [mapping])
                display.sync()
    finally:
        for code in pressed:
            with contextlib.suppress(Exception):
                emit(code, False)
        display.sync()


@contextlib.contextmanager
def paused_fcitx():
    command = Path("/usr/bin/fcitx5-remote")
    active = False
    if command.is_file():
        state = subprocess.run([str(command)], capture_output=True, check=True, timeout=2)
        active = state.stdout.strip() == b"2"
    try:
        if active:
            subprocess.run([str(command), "-c"], capture_output=True, check=True, timeout=2)
        yield
    finally:
        if active:
            subprocess.run([str(command), "-o"], capture_output=True, check=True, timeout=2)


def type_x11_text(value):
    from Xlib import X
    from Xlib.display import Display
    from Xlib.ext import xtest

    with _LOCK, paused_fcitx():
        display = Display()
        try:
            type_with_display(
                display,
                value,
                lambda code, down: xtest.fake_input(
                    display, X.KeyPress if down else X.KeyRelease, code
                ),
                observe=focused_text_state,
            )
        finally:
            display.close()
