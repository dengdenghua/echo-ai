"""Observable sandbox contracts shared by source checkouts on each platform."""

import json
import os
import re
import sys
from pathlib import Path

import pytest

from runtime.platform.process.streaming import stream_run
from runtime.safety.sandboxing import sandbox as sandbox_module
from runtime.safety.sandboxing.sandbox import (
    DirectBackend,
    SandboxPolicy,
    SandboxRunner,
    SandboxViolation,
    SeatbeltBackend,
    _reset_process_backend_cache,
    probe_backend_runs,
)


def test_unicode_capture_preserves_utf8_byte_limit(tmp_path, monkeypatch):
    monkeypatch.setenv("PYTHONUTF8", "0")
    monkeypatch.setenv("PYTHONIOENCODING", "ascii")
    result = SandboxRunner(SandboxPolicy(workspace=tmp_path, max_output_bytes=5, timeout_s=10)).run(
        [sys.executable, "-c", "import sys; sys.stdout.write('界' * 10)"]
    )
    assert result.exit_code == 0
    assert result.truncated is True
    assert result.stdout == "界"
    assert len(result.stdout.encode("utf-8")) <= 5
    assert result.stderr == ""


def test_stream_capture_respects_explicit_child_encoding(tmp_path, monkeypatch):
    monkeypatch.setenv("PYTHONIOENCODING", "latin-1")
    result = stream_run(
        [sys.executable, "-c", "import sys; sys.stdout.write(chr(233))"],
        cwd=str(tmp_path),
        timeout=10,
    )
    assert result["exit_code"] == 0
    assert result["stdout"] == "é"
    assert result["stderr"] == ""


def test_direct_probe_uses_an_available_executable():
    _reset_process_backend_cache()
    try:
        assert probe_backend_runs(DirectBackend()) is True
    finally:
        _reset_process_backend_cache()


@pytest.fixture
def unavailable_hard_backends(monkeypatch):
    monkeypatch.setenv("ECHO_PROCESS_SANDBOX", "auto")
    monkeypatch.setenv("ECHO_DEPLOYMENT_MODE", "local")
    for backend in (
        sandbox_module.BubblewrapBackend,
        sandbox_module.LandlockBackend,
        sandbox_module.SeatbeltBackend,
    ):
        monkeypatch.setattr(backend, "available", staticmethod(lambda: False))
    _reset_process_backend_cache()
    yield
    _reset_process_backend_cache()


def test_auto_fallback_refuses_without_approval_broker(tmp_path, unavailable_hard_backends):
    marker = tmp_path / "must-not-exist"
    result = stream_run(
        [sys.executable, "-c", "from pathlib import Path; Path('must-not-exist').touch()"],
        sandbox_dir=str(tmp_path),
        timeout=10,
    )
    assert result["error"].startswith("sandbox_fallback_needs_approval:")
    assert result["execution_policy"]["result"]["status"] == "needs_approval"
    assert not marker.exists()


@pytest.mark.parametrize("approved", [False, True])
def test_auto_fallback_requires_broker_decision(tmp_path, unavailable_hard_backends, approved):
    from types import SimpleNamespace

    requests = []

    class Broker:
        def request(self, request, timeout):
            requests.append(request)
            return SimpleNamespace(approved=approved)

    marker = tmp_path / "approved-effect"
    result = stream_run(
        [sys.executable, "-c", "from pathlib import Path; Path('approved-effect').touch()"],
        sandbox_dir=str(tmp_path),
        timeout=10,
        approval_provider=Broker(),
    )
    assert len(requests) == 1
    assert requests[0].tool_name == "exec_shell"
    assert marker.exists() is approved
    if approved:
        assert result["exit_code"] == 0
        assert result["sandbox_hard"] is False
    else:
        assert result["error"].startswith("sandbox_fallback_denied:")


def test_additional_system_write_authority_is_rejected(tmp_path):
    system = Path(os.environ["SYSTEMROOT"]) if os.name == "nt" else Path("/usr")
    with pytest.raises(SandboxViolation, match="overlap a system directory"):
        SandboxPolicy(workspace=tmp_path, additional_write_roots=(system,))


def test_read_only_seatbelt_profile_grants_only_exact_private_root(tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    private = tmp_path / "private-state"
    workspace.mkdir()
    private.mkdir()
    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/sandbox-exec")
    command, _, _ = SeatbeltBackend().transform(
        ["tool"],
        {},
        workspace,
        SandboxPolicy(workspace=workspace, mode="read-only", additional_write_roots=(private,)),
    )
    paths = {json.loads(value) for value in re.findall(r'"(?:\\.|[^"\\])*"', command[2])}
    assert paths == {"/dev/null", str(private.resolve())}
    assert str(workspace.resolve()) not in paths
    assert "(deny network*)" in command[2]


@pytest.mark.parametrize(
    "options", [["-X", "utf8"], ["-Xutf8"], ["-E", "-X", "utf8"], ["-I", "-Xutf8"]]
)
def test_stream_capture_respects_python_utf8_flags(tmp_path, options):
    environment = {
        key: value
        for key, value in os.environ.items()
        if key not in {"PYTHONIOENCODING", "PYTHONUTF8"}
    }
    result = stream_run(
        [sys.executable, *options, "-c", "import sys; sys.stdout.write(chr(233))"],
        cwd=str(tmp_path),
        env=environment,
        timeout=10,
    )
    assert result["exit_code"] == 0
    assert result["stdout"] == "é"
    assert result["stderr"] == ""


def test_native_codec_ignores_python_environment(monkeypatch):
    from runtime.platform.process import streaming

    monkeypatch.setattr(streaming.locale, "getencoding", lambda: "ascii")
    assert (
        streaming._child_text_encoding(
            ["git", "--version"], {"PYTHONIOENCODING": "latin-1", "PYTHONUTF8": "1"}
        )
        == "ascii"
    )


def test_stream_explicit_codec_decodes_raw_child_bytes(tmp_path):
    result = stream_run(
        [sys.executable, "-c", "import os; os.write(1, bytes([195, 169]))"],
        cwd=str(tmp_path),
        env={**os.environ, "PYTHONIOENCODING": "latin-1"},
        encoding="utf-8",
        timeout=10,
    )
    assert result["exit_code"] == 0
    assert result["stdout"] == "é"
    assert result["stderr"] == ""


def test_macos_system_paths_cannot_gain_additional_write_authority(tmp_path, monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setattr(sandbox_module, "sys", SimpleNamespace(platform="darwin"))
    paths = sandbox_module._protected_system_paths()
    assert {Path("/System"), Path("/Library"), Path("/Applications")} <= set(paths)
    protected = tmp_path / "System"
    protected.mkdir()
    monkeypatch.setattr(sandbox_module, "_protected_system_paths", lambda: (protected,))
    with pytest.raises(SandboxViolation, match="overlap a system directory"):
        SandboxPolicy(workspace=tmp_path / "workspace", additional_write_roots=(protected,))
