"""Pre-authorized directories relax document writes, and nothing else."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from runtime.safety.approval.approval_gate import ApprovalRisk, assess_approval_risk
from runtime.safety.approval.preauthorized_writes import (
    PreauthorizedWriteGrant,
    relax_document_write,
    relaxed_risk,
)

_WRITE_RISK = ApprovalRisk(level="high", categories=("filesystem_write",), reason="writes files")


def _grant(*directories: Path) -> PreauthorizedWriteGrant:
    return PreauthorizedWriteGrant.of([str(d) for d in directories], granted_by="owner")


def _relax(target: Path, grant: PreauthorizedWriteGrant, tool: str = "write_text_file"):
    return relax_document_write(
        tool_name=tool,
        target=target,
        risk=_WRITE_RISK,
        grant=grant,
    )


def test_a_document_inside_the_granted_directory_is_relaxed(tmp_path: Path) -> None:
    outputs = tmp_path / "output"
    outputs.mkdir()

    decision = _relax(outputs / "报告.md", _grant(outputs))

    assert decision.relaxed
    assert decision.reason == "preauthorized_document_write"


def test_the_relaxed_risk_no_longer_requires_approval_but_keeps_the_trail() -> None:
    relaxed = relaxed_risk(_WRITE_RISK)

    assert not relaxed.requires_approval
    # The audit trail must still show what this was and why it proceeded.
    assert "filesystem_write" in relaxed.categories
    assert "preauthorized_directory" in relaxed.categories


def test_a_write_outside_the_directory_still_asks(tmp_path: Path) -> None:
    outputs = tmp_path / "output"
    outputs.mkdir()

    decision = _relax(tmp_path / "elsewhere.md", _grant(outputs))

    assert decision.still_needs_approval
    assert decision.reason == "outside_preauthorized_directories"


@pytest.mark.skipif(sys.platform == "win32", reason="symlink creation needs privileges on Windows")
def test_a_symlink_cannot_redirect_a_write_out_of_the_directory(tmp_path: Path) -> None:
    """A symlink planted inside a granted directory is an escape, not a write."""

    outputs = tmp_path / "output"
    outputs.mkdir()
    secrets_dir = tmp_path / "secrets"
    secrets_dir.mkdir()
    (outputs / "escape").symlink_to(secrets_dir, target_is_directory=True)

    decision = _relax(outputs / "escape" / "stolen.md", _grant(outputs))

    assert decision.still_needs_approval
    assert decision.reason == "outside_preauthorized_directories"


def test_executable_and_script_targets_are_never_relaxed(tmp_path: Path) -> None:
    """Otherwise "write my documents" becomes approved code execution."""

    outputs = tmp_path / "output"
    outputs.mkdir()
    grant = _grant(outputs)

    for name in ("deploy.sh", "task.ps1", "hook.py", "run.bat", "lib.so", "app.js"):
        decision = _relax(outputs / name, grant)
        assert decision.still_needs_approval, name
        assert decision.reason.startswith("executable_target:"), name


def test_dotfiles_and_vcs_paths_are_never_relaxed(tmp_path: Path) -> None:
    outputs = tmp_path / "output"
    (outputs / ".git").mkdir(parents=True)
    grant = _grant(outputs)

    # ``.env`` is caught by its own leading dot.
    assert _relax(outputs / ".env", grant).reason == "dotfile_target"
    # These two have ordinary file names; the ``.git`` path component is what
    # rejects them.
    assert _relax(outputs / ".git" / "config", grant).reason == "configuration_or_vcs_path"
    assert _relax(outputs / ".git" / "hooks.md", grant).reason == "configuration_or_vcs_path"


def test_only_write_tools_are_covered(tmp_path: Path) -> None:
    outputs = tmp_path / "output"
    outputs.mkdir()
    grant = _grant(outputs)

    for tool in ("exec_shell", "delete_file", "git_push", "edit_text_file"):
        decision = _relax(outputs / "报告.md", grant, tool=tool)
        assert decision.still_needs_approval, tool
        assert decision.reason == f"tool_not_covered:{tool}"


def test_no_grant_leaves_todays_behaviour_untouched(tmp_path: Path) -> None:
    assert _relax(tmp_path / "a.md", PreauthorizedWriteGrant.of([])).still_needs_approval
    assert relax_document_write(
        tool_name="write_text_file",
        target=tmp_path / "a.md",
        risk=_WRITE_RISK,
        grant=None,
    ).still_needs_approval


def test_injection_taint_defeats_the_grant(tmp_path: Path) -> None:
    outputs = tmp_path / "output"
    outputs.mkdir()

    tainted = relax_document_write(
        tool_name="write_text_file",
        target=outputs / "报告.md",
        risk=_WRITE_RISK,
        grant=_grant(outputs),
        injection_tainted=True,
    )
    assert tainted.still_needs_approval
    assert tainted.reason == "injection_tainted"

    via_category = relax_document_write(
        tool_name="write_text_file",
        target=outputs / "报告.md",
        risk=_WRITE_RISK.with_injection_taint(),
        grant=_grant(outputs),
    )
    assert via_category.still_needs_approval


def test_a_critical_classification_outranks_the_grant(tmp_path: Path) -> None:
    outputs = tmp_path / "output"
    outputs.mkdir()

    decision = relax_document_write(
        tool_name="write_text_file",
        target=outputs / "报告.md",
        risk=ApprovalRisk(level="critical", categories=("destructive_command",), reason="rm -rf"),
        grant=_grant(outputs),
    )

    assert decision.still_needs_approval
    assert decision.reason == "critical_risk"


def test_relative_directories_are_dropped_rather_than_resolved() -> None:
    """``Path.resolve()`` on a relative entry would prepend the process CWD."""

    grant = PreauthorizedWriteGrant.of(["output", "./docs", ""])

    assert grant.directories == ()
    assert not grant.covers(Path("output/a.md").absolute())


def test_the_real_write_tool_is_high_risk_without_a_grant() -> None:
    """Anchors why this layer exists: every document write asks by default."""

    assert assess_approval_risk("write_text_file", "output/报告.md").requires_approval
