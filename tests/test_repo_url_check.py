"""Repository URL scans must respect Git's tracked files in linked worktrees."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from tools.lint import repo_url_check


@pytest.mark.parametrize("linked_worktree", [False, True])
def test_scan_excludes_untracked_dependencies(tmp_path: Path, monkeypatch, linked_worktree):
    git = shutil.which("git")
    if git is None:
        pytest.skip("Git is required to exercise repository discovery")
    repo = tmp_path / "repo"
    repo.mkdir()

    def run_git(*args: str) -> None:
        subprocess.run([git, "-C", str(repo), *args], check=True, capture_output=True)

    run_git("init")
    (repo / "tracked.txt").write_text("project source", encoding="utf-8")
    (repo / ".gitignore").write_text("node_modules/\n", encoding="utf-8")
    run_git("add", "tracked.txt", ".gitignore")
    run_git(
        "-c",
        "user.name=URL scan test",
        "-c",
        "user.email=url-scan@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        "test fixture",
    )
    checkout = repo
    if linked_worktree:
        checkout = tmp_path / "linked"
        run_git("worktree", "add", "--detach", str(checkout), "HEAD")
        assert (checkout / ".git").is_file()

    dependencies = checkout / "node_modules"
    dependencies.mkdir()
    (dependencies / "third-party.txt").write_text("ignored dependency", encoding="utf-8")
    (checkout / "untracked.txt").write_text("local scratch", encoding="utf-8")
    monkeypatch.setattr(repo_url_check, "REPO_ROOT", checkout)

    assert {
        path.relative_to(checkout).as_posix() for path in repo_url_check._iter_text_files()
    } == {
        ".gitignore",
        "tracked.txt",
    }
