from types import SimpleNamespace

import pytest

from runtime.tentacle import remote_desktop_x11_keys as subject


class Display:
    def __init__(self, mask=0):
        self.display = SimpleNamespace(info=SimpleNamespace(min_keycode=8, max_keycode=12))
        self.mapping = {8: [0xFFE1, 0xFFE1], 9: [97, 65], 10: [32, 32], 11: [0, 0], 12: [0, 0]}
        self.mask = mask
        self.changes = []

    def get_keyboard_mapping(self, first, count):
        return [self.mapping[code][:] for code in range(first, first + count)]

    def screen(self):
        return SimpleNamespace(
            root=SimpleNamespace(query_pointer=lambda: SimpleNamespace(mask=self.mask))
        )

    def change_keyboard_mapping(self, code, values):
        self.changes.append(code)
        self.mapping[code] = list(values[0])

    def sync(self):
        pass


def test_unicode_batches_keep_codes_stable_and_restore_original_mapping():
    display = Display()
    original = {key: value[:] for key, value in display.mapping.items()}
    received, down = [], set()

    def emit(code, pressed):
        if pressed:
            down.add(code)
            received.append(display.mapping[code][0])
        else:
            down.discard(code)

    value = "中文你好a🌏"
    subject.type_with_display(display, value, emit, sleep=lambda _: None)
    assert received == [ord(char) | (0x1000000 if ord(char) > 255 else 0) for char in value]
    assert display.mapping == original
    assert not down


def test_failed_injection_restores_mapping_and_releases_keys_without_replay():
    display = Display()
    original = {key: value[:] for key, value in display.mapping.items()}
    released, attempts = [], []

    def emit(code, pressed):
        if pressed:
            attempts.append(code)
            raise OSError("native driver rejected input")
        released.append(code)

    with pytest.raises(OSError):
        subject.type_with_display(display, "中文", emit, sleep=lambda _: None)
    assert len(attempts) == 1
    assert released == attempts
    assert display.mapping == original


def test_held_modifier_rejects_text_before_any_keyboard_changes():
    display = Display(mask=4)
    with pytest.raises(OSError):
        subject.type_with_display(display, "中文", lambda *_: pytest.fail("Unexpected event"))
    assert not display.changes


def test_fcitx_active_state_is_restored_even_after_failure(monkeypatch):
    calls = []
    monkeypatch.setattr(subject.Path, "is_file", lambda _: True)

    def run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(stdout=b"2\n")

    monkeypatch.setattr(subject.subprocess, "run", run)
    with pytest.raises(OSError), subject.paused_fcitx():
        raise OSError("failed")
    assert [args[1:] for args in calls] == [[], ["-c"], ["-o"]]
