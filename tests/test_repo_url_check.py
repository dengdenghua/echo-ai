from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.lint import repo_url_check as checker


@pytest.mark.parametrize("worktree", [False, True])
def test_git_checkouts_ignore_untracked_dependency_urls(tmp_path, monkeypatch, worktree):
    marker = tmp_path / ".git"
    if worktree:
        marker.write_text("gitdir: another-checkout/.git/worktrees/test\n", encoding="utf-8")
    else:
        marker.mkdir()
    (tmp_path / "README.md").write_text("Project documentation", encoding="utf-8")
    dependency = tmp_path / "node_modules" / "external"
    dependency.mkdir(parents=True)
    invalid_repo_url = "https://github.com/" + "echo-ai/echo"
    (dependency / "README.md").write_text(invalid_repo_url, encoding="utf-8")

    def tracked_files(command, **kwargs):
        assert command == ["git", "ls-files", "-z"]
        assert kwargs["cwd"] == tmp_path
        return SimpleNamespace(stdout=b"README.md\0")

    monkeypatch.setattr(checker, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(
        checker, "_load_canonical", lambda: "https://github.com/dengdenghua/echo-ai"
    )
    monkeypatch.setattr("subprocess.run", tracked_files)
    _, offenders = checker._scan()
    assert offenders == []
