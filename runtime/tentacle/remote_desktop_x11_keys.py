"""X11 text fallback with stable Unicode keycodes and no clipboard access."""

from __future__ import annotations

import contextlib
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


def type_with_display(display, value, emit, sleep=time.sleep):
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
                # The destination must consume the key events before restoring
                # the mapping. libxdo reuses one code while clients still read it.
                sleep(0.15)
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
            )
        finally:
            display.close()
