"""Channel state belongs to the instance's data directory, not the cwd.

Regression: ``create_channels_router`` defaulted to the cwd-relative
``data/channel_state.json``. A fresh instance with its own ``ECHO_HOME``,
started from a source checkout, loaded that checkout's channel credentials
and began long-polling its WeChat bot.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from runtime.sensing.gateway._channels_persist import _default_channel_state_path


def _write_legacy(root: Path) -> Path:
    legacy = root / "data"
    legacy.mkdir(parents=True)
    (legacy / "channel_state.json").write_text(
        json.dumps({"version": 1, "assignments": {"slack": "coder"}}), encoding="utf-8"
    )
    (legacy / "channel_state.credentials.json").write_text("{}", encoding="utf-8")
    (legacy / ".credential_key").write_text("legacy-key", encoding="utf-8")
    return legacy


@pytest.fixture
def checkout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "checkout"
    _write_legacy(root)
    monkeypatch.chdir(root)
    monkeypatch.delenv("ECHO_HOME", raising=False)
    monkeypatch.delenv("ECHO_DATA_DIR", raising=False)
    return root


def test_separate_echo_home_starts_without_the_checkouts_channels(
    checkout: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "fresh-home"
    monkeypatch.setenv("ECHO_HOME", str(home))

    path = _default_channel_state_path()

    assert path == (home / "data" / "channel_state.json").resolve()
    assert not path.exists()
    assert not (path.parent / "channel_state.credentials.json").exists()


def test_instance_inside_the_checkout_adopts_legacy_state_once(
    checkout: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = checkout / ".codex-run" / "echo" / "data"
    monkeypatch.setenv("ECHO_DATA_DIR", str(data))

    path = _default_channel_state_path()

    assert path == (data / "channel_state.json").resolve()
    assert json.loads(path.read_text(encoding="utf-8"))["assignments"] == {"slack": "coder"}
    assert (data / ".credential_key").read_text(encoding="utf-8") == "legacy-key"
    # Later edits stay in the instance; the legacy copy is never re-read.
    path.write_text(json.dumps({"version": 1}), encoding="utf-8")
    _default_channel_state_path()
    assert json.loads(path.read_text(encoding="utf-8")) == {"version": 1}


def test_existing_key_is_never_replaced(checkout: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data = checkout / ".codex-run" / "echo" / "data"
    data.mkdir(parents=True)
    (data / ".credential_key").write_text("instance-key", encoding="utf-8")
    monkeypatch.setenv("ECHO_DATA_DIR", str(data))

    _default_channel_state_path()

    assert (data / ".credential_key").read_text(encoding="utf-8") == "instance-key"
    assert (data / "channel_state.json").exists()
    assert not (data / "channel_state.credentials.json").exists()


def test_without_overrides_the_checkout_data_dir_is_used(
    checkout: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import runtime.platform.process.paths as paths

    monkeypatch.setattr(paths, "project_root", lambda: checkout)

    assert _default_channel_state_path() == (checkout / "data" / "channel_state.json").resolve()
