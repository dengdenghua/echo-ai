"""The runtime's installed echo CLI must never shadow a sandbox probe."""

import os

from runtime.safety.sandboxing.sandbox import (
    DirectBackend,
    _reset_process_backend_cache,
    probe_backend_runs,
)


def test_direct_probe_ignores_an_echo_console_script_on_path(tmp_path, monkeypatch):
    shadow = tmp_path / ("echo.cmd" if os.name == "nt" else "echo")
    shadow.write_bytes(b"@exit /b 23\r\n" if os.name == "nt" else b"#!/bin/sh\nexit 23\n")
    shadow.chmod(0o700)
    monkeypatch.setenv("PATH", str(tmp_path))
    _reset_process_backend_cache()
    try:
        assert probe_backend_runs(DirectBackend()) is True
    finally:
        _reset_process_backend_cache()
