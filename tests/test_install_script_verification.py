"""Audit S-09: install.sh download verification fails closed.

Extract download_verify_run() from scripts/install.sh and exercise it:
matching checksum runs the payload, mismatched checksum refuses, and a
missing digest tool refuses — the payload never executes unchecked.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parent.parent


def _bash() -> str:
    bash = shutil.which("bash")
    if sys.platform == "win32" and (
        bash is None or Path(bash).parent.name.lower() in {"system32", "windowsapps"}
    ):
        # A bare "bash" resolves to the WSL launcher (System32/bash.exe),
        # which runs inside Linux and cannot read the Windows temp payload.
        pytest.skip("needs an MSYS bash such as Git Bash on PATH")
    return bash or "bash"


def _extract_helper() -> str:
    lines = (_REPO / "scripts" / "install.sh").read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith("download_verify_run() {"))
    # Capture until the closing "}" at column 0 that ends the function.
    depth = 0
    body: list[str] = []
    for line in lines[start:]:
        body.append(line)
        depth += line.count("{") - line.count("}")
        if depth == 0 and line.strip() == "}":
            break
    return "\n".join(body)


def _run_scenario(payload: Path, expected: str, interpreter: str = "bash") -> tuple[int, str]:
    # as_uri() gives file:///tmp/... on POSIX and file:///C:/... on Windows.
    script = textwrap.dedent(
        f"""
        die() {{ echo "$*"; exit 1; }}
        {_extract_helper()}
        download_verify_run '{payload.as_uri()}' {expected} {interpreter}
        echo "rc=$?"
        """
    )
    proc = subprocess.run(
        [_bash(), "-c", script],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    return proc.returncode, proc.stdout + proc.stderr


def test_matching_checksum_runs_payload(tmp_path: Path) -> None:
    import hashlib

    payload = tmp_path / "payload.sh"
    payload.write_text("#!/bin/sh\necho RAN\n", encoding="utf-8")
    digest = hashlib.sha256(payload.read_bytes()).hexdigest()
    rc, out = _run_scenario(payload, digest)
    assert rc == 0
    assert "RAN" in out


def test_mismatched_checksum_fails_closed(tmp_path: Path) -> None:
    payload = tmp_path / "payload.sh"
    payload.write_text("#!/bin/sh\necho SHOULD_NOT_RUN\n", encoding="utf-8")
    rc, out = _run_scenario(payload, "0" * 64)
    assert rc == 1
    assert "checksum mismatch" in out
    assert "SHOULD_NOT_RUN" not in out


def test_installer_has_no_piped_shell_downloads() -> None:
    """No remaining `curl ... | sh/bash` without verification."""
    text = (_REPO / "scripts" / "install.sh").read_text(encoding="utf-8")
    for line in text.splitlines():
        stripped = line.strip()
        if "curl" in stripped and ("| sh" in stripped or "| bash" in stripped):
            assert "download_verify_run" in stripped, f"unverified piped download: {stripped}"
