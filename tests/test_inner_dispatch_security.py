"""Meta-skill inner dispatch must run the executor's pre-execution pipeline.

``use_capability`` and ``execute_skill`` call an inner skill's handler
directly instead of going through ``ToolExecutor.execute_step``. These tests
pin that the inner call still gets: action allow-listing (only the
capability's own registered actions), model-override stripping, scope /
``sandbox_dir`` injection, host ``allowed_tools`` and audit read-only
enforcement, and the approval hold for risky inner actions.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from runtime.execution.suckers.agent_meta_skills import register_agent_meta_skills
from runtime.execution.suckers.registry import Skill, SkillRegistry
from runtime.platform.process.session import Session, session_scope


@pytest.fixture
def code_session(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ECHO_DATA_DIR", str(tmp_path / "data"))
    project = tmp_path / "project"
    project.mkdir()

    def _make(**extra: Any) -> tuple[Session, Path]:
        meta: dict[str, Any] = {"mode": "code", "workspace_path": str(project), **extra}
        return Session(actor="u-test", thread_id="t-inner", metadata=meta), project

    return _make


def _registry_with(*skills: Skill) -> SkillRegistry:
    registry = SkillRegistry()
    for skill in skills:
        registry.register(skill)
    register_agent_meta_skills(registry)
    return registry


# ── Finding 1: use_capability action allow-list ─────────────────────


def test_use_capability_rejects_action_outside_capability_registered_actions() -> None:
    """``action`` used to fall back to ANY registry skill, so every existing
    capability id was a generic dispatcher for exec_shell / write_text_file."""
    ran = {"shell": False}

    def _shell(**_kw: Any) -> dict[str, Any]:
        ran["shell"] = True
        return {"exit_code": 0}

    registry = _registry_with(
        Skill(
            name="demo-plugin__hello",
            summary="hello",
            affinity=["plugin", "plugin:demo-plugin"],
            trusted_source="plugin://demo-plugin/hello",
            handler=lambda **_: {"ok": True},
        ),
        Skill(
            name="exec_shell",
            summary="run a shell command",
            affinity=["shell", "exec", "dangerous"],
            trusted_source="skill://public/exec_shell",
            handler=_shell,
        ),
    )

    for action in ("exec_shell", "write_text_file", "use_capability"):
        result = registry.get("use_capability").handler(
            capability_id="demo-plugin",
            action=action,
            args={"command": "touch pwned"},
        )
        assert result["ok"] is False
        assert "not a registered action" in result["error"]
        assert result["registered_actions"] == ["demo-plugin__hello"]
    assert ran["shell"] is False

    ok = registry.get("use_capability").handler(capability_id="demo-plugin", action="hello")
    assert ok["ok"] is True
    assert ok["action"] == "demo-plugin__hello"


def test_use_capability_holds_side_effecting_plugin_action_by_affinity() -> None:
    """A plugin action whose NAME carries no risk prefix but whose affinity
    says it writes must still be held for approval."""
    ran = {"write": False}

    def _write(**_kw: Any) -> dict[str, Any]:
        ran["write"] = True
        return {"ok": True}

    registry = _registry_with(
        Skill(
            name="fspack__save",
            summary="save a file",
            affinity=["plugin", "file", "write"],
            trusted_source="plugin://fspack/save",
            handler=_write,
        )
    )
    result = registry.get("use_capability").handler(
        capability_id="fspack",
        action="save",
        args={"path": "notes.txt", "content": "x"},
    )
    assert result["ok"] is False
    assert "approval_required" in result["error"]
    assert ran["write"] is False


def test_use_capability_injects_scope_and_strips_overrides(code_session) -> None:
    seen: dict[str, Any] = {}

    def _scan(
        root: str = ".",
        *,
        sandbox_dir: str | None = None,
        allow_sensitive: bool = False,
        **_kw: Any,
    ) -> dict[str, Any]:
        seen.update(root=root, sandbox_dir=sandbox_dir, allow_sensitive=allow_sensitive)
        return {"ok": True}

    registry = _registry_with(
        Skill(
            name="scanpack__scan",
            summary="scan files",
            affinity=["plugin", "file", "read", "search"],
            trusted_source="plugin://scanpack/scan",
            handler=_scan,
        )
    )
    session, project = code_session()
    with session_scope(session):
        result = registry.get("use_capability").handler(
            capability_id="scanpack",
            action="scan",
            args={"allow_sensitive": True},
        )
    assert result["ok"] is True, result
    assert result["stripped_overrides"] == ["allow_sensitive"]
    assert seen["allow_sensitive"] is False
    assert Path(seen["sandbox_dir"]).resolve() == project.resolve()
    assert Path(seen["root"]).resolve() == project.resolve()


def test_use_capability_rejects_sandbox_dir_outside_scope(code_session, tmp_path: Path) -> None:
    ran = {"scan": False}

    def _scan(root: str = ".", *, sandbox_dir: str | None = None, **_kw: Any) -> dict:
        ran["scan"] = True
        return {"ok": True}

    registry = _registry_with(
        Skill(
            name="scanpack__scan",
            summary="scan files",
            affinity=["plugin", "file", "read", "search"],
            trusted_source="plugin://scanpack/scan",
            handler=_scan,
        )
    )
    outside = tmp_path / "outside"
    outside.mkdir()
    session, _project = code_session()
    with session_scope(session):
        result = registry.get("use_capability").handler(
            capability_id="scanpack",
            action="scan",
            args={"sandbox_dir": str(outside)},
        )
    assert result["ok"] is False
    assert result["error"].startswith("scope:")
    assert ran["scan"] is False


# ── Finding 2: execute_skill scope + host contract + read-only ──────


def _grep_skill(seen: dict[str, Any]) -> Skill:
    def _grep_text(
        pattern: str = "",
        root: str = ".",
        *,
        sandbox_dir: str | None = None,
        allow_sensitive: bool = False,
        **_kw: Any,
    ) -> dict[str, Any]:
        seen.update(root=root, sandbox_dir=sandbox_dir, allow_sensitive=allow_sensitive)
        return {"ok": True, "matches": []}

    return Skill(
        name="grep_text",
        summary="grep",
        affinity=["file", "search", "read"],
        trusted_source="skill://public/grep_text",
        handler=_grep_text,
    )


def test_execute_skill_injects_workspace_sandbox_for_read_skill(code_session) -> None:
    seen: dict[str, Any] = {}
    registry = _registry_with(_grep_skill(seen))
    session, project = code_session()
    with session_scope(session):
        result = registry.get("execute_skill").handler(
            name="grep_text",
            args={"pattern": "TODO", "allow_sensitive": True},
        )
    assert result["ok"] is True, result
    assert Path(seen["sandbox_dir"]).resolve() == project.resolve()
    assert seen["allow_sensitive"] is False
    assert result["stripped_overrides"] == ["allow_sensitive"]


def test_execute_skill_rejects_read_outside_workspace(code_session, tmp_path: Path) -> None:
    seen: dict[str, Any] = {}
    registry = _registry_with(_grep_skill(seen))
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    session, _project = code_session()
    with session_scope(session):
        result = registry.get("execute_skill").handler(
            name="grep_text",
            args={"pattern": "x", "sandbox_dir": str(outside)},
        )
    assert result["ok"] is False
    assert result["error"].startswith("scope:")
    assert seen == {}


def test_execute_skill_enforces_host_allowed_tools() -> None:
    from runtime.execution import request as request_mod

    seen: dict[str, Any] = {}
    registry = _registry_with(_grep_skill(seen))
    fake_request = SimpleNamespace(
        task=SimpleNamespace(allowed_tools=frozenset({"execute_skill", "read_file"}))
    )
    token = request_mod._CURRENT_REQUEST.set(fake_request)  # type: ignore[arg-type]
    try:
        result = registry.get("execute_skill").handler(name="grep_text", args={"pattern": "x"})
    finally:
        request_mod._CURRENT_REQUEST.reset(token)
    assert result["ok"] is False
    assert result["error"].startswith("host_contract:")
    assert seen == {}


def test_execute_skill_enforces_audit_read_only_mode() -> None:
    ran = {"lint": False}

    def _lint(command: str = "", fix: bool = False, **_kw: Any) -> dict[str, Any]:
        ran["lint"] = True
        return {"ok": True}

    registry = _registry_with(
        Skill(
            name="lint_check",
            summary="lint",
            affinity=["lint", "verify"],
            trusted_source="skill://public/lint_check",
            handler=_lint,
        )
    )
    with session_scope(Session(metadata={"_read_only_turn_enforced": True})):
        result = registry.get("execute_skill").handler(name="lint_check", args={"fix": True})
    assert result["ok"] is False
    assert result["error"].startswith("read_only:")
    assert ran["lint"] is False
