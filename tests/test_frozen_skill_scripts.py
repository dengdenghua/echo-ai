"""Frozen skills must retain helpers that their instructions execute as files."""

import runpy
from pathlib import Path
from unittest.mock import Mock

import pytest


def test_skill_helpers_are_distributed_as_executable_source(monkeypatch):
    hooks = pytest.importorskip("PyInstaller.utils.hooks")
    root = Path(__file__).resolve().parents[1]
    monkeypatch.setattr(hooks, "collect_submodules", lambda *_: [])
    monkeypatch.setattr(hooks, "collect_dynamic_libs", lambda *_: [])
    analysis = Mock(return_value=Mock(pure=[], scripts=[], binaries=[], datas=[]))
    scope = runpy.run_path(
        str(root / "packaging/windows/echo-backend.spec"),
        init_globals={
            "SPECPATH": str(root / "packaging/windows"),
            "Analysis": analysis,
            "PYZ": Mock(),
            "EXE": Mock(),
            "COLLECT": Mock(),
        },
    )
    packaged = {
        (Path(dest) / Path(source).name).as_posix(): Path(source) for source, dest in scope["datas"]
    }
    for folder in (
        "runtime/execution/all_skills",
        "runtime/sensing/gateway/agent_market_sources",
    ):
        for script in (root / folder).rglob("*.py"):
            relative = script.relative_to(root).as_posix()
            assert packaged.get(relative) == script
    assert "runtime/safety/sandboxing/execution_mode.py" not in packaged
