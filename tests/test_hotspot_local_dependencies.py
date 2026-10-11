"""The main app's local settings controls must not require an A2A server install."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def test_local_control_imports_do_not_load_optional_a2a_server() -> None:
    source = """
import importlib.abc
import sys
class NoA2AServer(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == "a2a" or fullname.startswith("a2a.") or fullname == "sse_starlette":
            raise ModuleNotFoundError("optional A2A server intentionally unavailable: " + fullname)
sys.meta_path.insert(0, NoA2AServer())
from runtime.sensing.gateway.hotspot_local import bounded_body, owner_token
from runtime.sensing.gateway.hotspot_control import require_local_owner
from runtime.sensing.gateway.team_control import mount_team_control
from runtime.sensing.gateway.team_gateway import create_team_gateway
assert "runtime.sensing.gateway.workbuddy_bridge" not in sys.modules
assert "runtime.sensing.gateway.codex_hotspot" not in sys.modules
print("local control imports work without optional A2A server")
"""
    result = subprocess.run(
        [sys.executable, "-c", source],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "local control imports work" in result.stdout
