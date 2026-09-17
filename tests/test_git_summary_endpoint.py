"""Contract tests for ``GET /api/git/summary``.

The endpoint exists so the workspace note badge can answer "how much changed,
and where does the branch stand?" in a single cheap poll instead of shelling
out three times. These tests pin the payload shape (branch / upstream / ahead /
behind / changed_files / untracked_files / added / removed) and the two graceful
degradations that matter in practice: a directory that is not a git repository,
and a repository whose ``HEAD`` does not exist yet.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from runtime.platform.ui.app import create_app


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    # Keep every runtime-state write (data/, threads/, logs/) out of the
    # directory the endpoint is asked to inspect, otherwise create_app()'s
    # startup writes would show up as workspace changes.
    runtime_state = tmp_path.parent / f"{tmp_path.name}.runtime"
    runtime_state.mkdir(exist_ok=True)
    monkeypatch.setenv("ECHO_HOME", str(runtime_state))
    monkeypatch.chdir(tmp_path)
    return TestClient(create_app())


def _git(repo: Path, *args: str) -> str:
    proc = subprocess.run(
        [
            "git",
            "-c",
            "user.name=Echo Test",
            "-c",
            "user.email=echo@example.invalid",
            "-c",
            "commit.gpgsign=false",
            *args,
        ],
        cwd=str(repo),
        check=True,
        capture_output=True,
        text=True,
    )
    return proc.stdout


def _init_repo(repo: Path) -> str:
    repo.mkdir(parents=True, exist_ok=True)
    _git(repo, "init")
    (repo / "a.txt").write_text("one\ntwo\n", encoding="utf-8")
    _git(repo, "add", "a.txt")
    _git(repo, "commit", "-m", "init")
    return _git(repo, "rev-parse", "--abbrev-ref", "HEAD").strip()


def _summary(client: TestClient, repo: Path) -> dict[str, object]:
    response = client.get("/api/git/summary", params={"path": str(repo)})
    assert response.status_code == 200, response.text
    return response.json()


class TestGitSummary:
    def test_clean_repo_reports_branch_and_zero_counts(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        repo = tmp_path / "clean"
        branch = _init_repo(repo)

        payload = _summary(client, repo)

        assert payload["branch"] == branch
        assert payload["changed_files"] == 0
        assert payload["untracked_files"] == 0
        assert payload["added"] == 0
        assert payload["removed"] == 0
        assert payload["error"] is None

    def test_dirty_repo_counts_files_and_line_totals(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        repo = tmp_path / "dirty"
        branch = _init_repo(repo)
        # Tracked edit: one line removed, three lines added.
        (repo / "a.txt").write_text("one\nthree\nfour\nfive\n", encoding="utf-8")
        # Untracked file: counts as a file, but ``git diff`` cannot see its
        # lines. That asymmetry must surface as ``untracked_files``, and it
        # must NOT be mistaken for a diff failure.
        (repo / "b.txt").write_text("untracked\n", encoding="utf-8")

        payload = _summary(client, repo)

        assert payload["branch"] == branch
        assert payload["changed_files"] == 2
        assert payload["untracked_files"] == 1
        assert payload["added"] == 3
        assert payload["removed"] == 1
        assert payload["error"] is None
        assert payload["diff_error"] is None

    def test_untracked_only_changes_explain_the_missing_line_totals(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        """A brand-new untracked file is the case a bare zero would mislead.

        ``git diff`` succeeds and prints nothing, so ``added`` / ``removed``
        are correctly ``0`` — but the tree is emphatically not clean. The
        badge needs ``untracked_files`` to say so, which is why this asserts
        the counter *and* that the diff itself is not blamed.
        """
        repo = tmp_path / "untracked-only"
        branch = _init_repo(repo)
        (repo / "brand-new.txt").write_text("brand\nnew\nlines\n", encoding="utf-8")

        payload = _summary(client, repo)

        assert payload["branch"] == branch
        assert payload["changed_files"] == 1
        assert payload["untracked_files"] == 1
        assert payload["added"] == 0
        assert payload["removed"] == 0
        assert payload["error"] is None
        assert payload["diff_error"] is None

    def test_upstream_tracking_is_parsed_from_status_header(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        origin = tmp_path / "origin.git"
        origin.mkdir()
        _git(origin, "init", "--bare")
        repo = tmp_path / "tracked"
        branch = _init_repo(repo)
        _git(repo, "remote", "add", "origin", str(origin))
        _git(repo, "push", "-u", "origin", branch)
        (repo / "a.txt").write_text("one\ntwo\nthree\n", encoding="utf-8")
        _git(repo, "commit", "-am", "second")

        payload = _summary(client, repo)

        assert payload["branch"] == branch
        assert payload["upstream"] == f"origin/{branch}"
        assert payload["ahead"] == 1
        assert payload["behind"] == 0

    def test_repo_without_commits_degrades_without_raising(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        repo = tmp_path / "unborn"
        repo.mkdir()
        _git(repo, "init")
        (repo / "a.txt").write_text("one\n", encoding="utf-8")
        _git(repo, "add", "a.txt")

        payload = _summary(client, repo)

        assert payload["error"] is None
        assert payload["changed_files"] == 1
        # ``git diff --numstat HEAD`` fails on an unborn HEAD; the fallback to
        # the index comparison must run instead of surfacing a raw error.
        assert payload["added"] == 0
        assert payload["removed"] == 0

    def test_plain_directory_reports_error_instead_of_crashing(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        plain = tmp_path / "plain"
        plain.mkdir()

        payload = _summary(client, plain)

        assert payload["branch"] == ""
        assert payload["changed_files"] == 0
        assert isinstance(payload["error"], str)
        assert payload["error"]

    def test_missing_directory_is_a_404(self, client: TestClient, tmp_path: Path) -> None:
        response = client.get("/api/git/summary", params={"path": str(tmp_path / "nope")})

        assert response.status_code == 404


class TestGitSummaryBranchLineParsing:
    """``## ...`` header shapes come straight from git and vary a lot."""

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("main...origin/main [ahead 9, behind 2]", ("main", "origin/main", 9, 2)),
            ("main...origin/main", ("main", "origin/main", 0, 0)),
            ("feature/x", ("feature/x", None, 0, 0)),
            ("No commits yet on main", ("main", None, 0, 0)),
            ("HEAD (no branch) [ahead 1]", ("HEAD (no branch)", None, 1, 0)),
        ],
    )
    def test_parses(
        self,
        raw: str,
        expected: tuple[str, str | None, int, int],
    ) -> None:
        from runtime.sensing.gateway._fs_router_endpoints import (
            _parse_git_branch_line,
        )

        assert _parse_git_branch_line(raw) == expected

    def test_git_failure_shape_is_zeroed(self) -> None:
        from runtime.sensing.gateway._fs_router_endpoints import _empty_git_summary

        payload = _empty_git_summary("git not found")

        assert payload["error"] == "git not found"
        assert payload["changed_files"] == 0
        assert payload["upstream"] is None
