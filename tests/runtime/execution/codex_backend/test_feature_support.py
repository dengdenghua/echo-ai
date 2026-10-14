from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from runtime.execution.codex_backend import feature_support
from runtime.execution.codex_backend.feature_support import (
    clear_feature_support_cache,
    supported_codex_features,
)


@pytest.fixture(autouse=True)
def _fresh_cache() -> None:
    clear_feature_support_cache()


def _fake_run(stdout: str, returncode: int = 0, calls: list[list[str]] | None = None):
    def run(argv, **kwargs):
        if calls is not None:
            calls.append(argv)
            assert kwargs["env"]["CODEX_HOME"]  # never the user's own Codex home
        return subprocess.CompletedProcess(argv, returncode, stdout=stdout, stderr="")

    return run


def test_parses_feature_names_and_caches_per_executable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    exe = tmp_path / "codex.exe"
    exe.write_bytes(b"MZ")
    calls: list[list[str]] = []
    listing = (
        "apps                     stable  true\n"
        "api_key_model_discovery  stable  true\n"
        "hooks                    stable  false\n"
    )
    monkeypatch.setattr(feature_support.subprocess, "run", _fake_run(listing, calls=calls))

    first = supported_codex_features(str(exe))
    second = supported_codex_features(str(exe))

    assert first == frozenset({"apps", "api_key_model_discovery", "hooks"})
    assert second == first
    assert calls == [[str(exe), "features", "list"]]


@pytest.mark.parametrize("returncode, stdout", [(2, "apps stable true\n"), (0, "")])
def test_failed_or_empty_probe_is_unknown(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, returncode: int, stdout: str
) -> None:
    exe = tmp_path / "codex.exe"
    exe.write_bytes(b"MZ")
    monkeypatch.setattr(feature_support.subprocess, "run", _fake_run(stdout, returncode))

    assert supported_codex_features(str(exe)) is None


def test_missing_executable_or_launch_error_is_unknown(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert supported_codex_features(None) is None
    assert supported_codex_features(str(tmp_path / "missing.exe")) is None

    exe = tmp_path / "codex.exe"
    exe.write_bytes(b"MZ")

    def boom(*_args, **_kwargs):
        raise OSError("cannot execute")

    monkeypatch.setattr(feature_support.subprocess, "run", boom)
    assert supported_codex_features(str(exe)) is None
