from __future__ import annotations

import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.fs_router import create_fs_router


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


@pytest.fixture
def project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, Path]:
    monkeypatch.setenv("ECHO_HOME", str(tmp_path))
    repo = tmp_path / "project with spaces"
    repo.mkdir()
    git(repo, "init", "-b", "main")
    git(repo, "config", "user.email", "test@example.invalid")
    git(repo, "config", "user.name", "Test")
    (repo / "code.txt").write_text("committed\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "Initial code")
    app = FastAPI()
    app.include_router(create_fs_router())
    return TestClient(app), repo


def test_create_and_list_durable_worktree_without_copying_dirty_files(project):
    client, repo = project
    (repo / "code.txt").write_text("user's pending edit\n")
    (repo / "untracked.txt").write_text("pending new file\n")
    before = git(repo, "status", "--porcelain")
    response = client.post("/api/git/worktrees", json={"path": str(repo), "revision": "main"})
    assert response.status_code == 201, response.text
    created = response.json()
    worktree = Path(created["path"])
    assert worktree.is_dir()
    assert (worktree / "code.txt").read_text() == "committed\n"
    assert not (worktree / "untracked.txt").exists()
    assert git(repo, "status", "--porcelain") == before
    assert created["branch"].startswith("echo/task-")
    # A new router can discover the checkout without in-memory UI state.
    app = FastAPI()
    app.include_router(create_fs_router())
    listing = TestClient(app).get("/api/git/worktrees", params={"path": str(repo)}).json()
    assert listing["root"] == str(repo.resolve())
    assert "main" in listing["branches"]
    assert {row["path"] for row in listing["worktrees"]} == {str(repo.resolve()), str(worktree)}


def test_starting_branch_resolves_the_selected_commit(project):
    client, repo = project
    initial = git(repo, "rev-parse", "HEAD")
    git(repo, "branch", "starting-point")
    (repo / "code.txt").write_text("later commit\n")
    git(repo, "commit", "-am", "Later code")
    response = client.post(
        "/api/git/worktrees", json={"path": str(repo), "revision": "starting-point"}
    )
    assert response.status_code == 201
    assert response.json()["commit"] == initial
    assert (Path(response.json()["path"]) / "code.txt").read_text() == "committed\n"


@pytest.mark.parametrize("revision", ["--help", "missing-branch", "main; touch injected"])
def test_invalid_revision_does_not_create_a_checkout(project, revision):
    client, repo = project
    before = git(repo, "worktree", "list", "--porcelain")
    response = client.post("/api/git/worktrees", json={"path": str(repo), "revision": revision})
    assert response.status_code == 400
    assert git(repo, "worktree", "list", "--porcelain") == before
    assert not (repo / "injected").exists()


def test_parallel_creation_keeps_separate_directories(project):
    client, repo = project

    def create(_):
        return client.post("/api/git/worktrees", json={"path": str(repo)}).json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, range(2)))
    assert len({row["path"] for row in results}) == 2
    assert len({row["branch"] for row in results}) == 2
    assert git(repo, "status", "--porcelain") == ""


def test_repository_outside_allowed_roots_is_rejected(project, tmp_path):
    client, _ = project
    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir()
    response = client.get("/api/git/worktrees", params={"path": str(outside)})
    assert response.status_code == 403


def test_non_git_directory_has_actionable_failure(project, tmp_path):
    client, _ = project
    response = client.get("/api/git/worktrees", params={"path": str(tmp_path)})
    assert response.status_code == 400
    assert "not a git repository" in response.json()["detail"]


def test_auth_and_shared_server_boundary(project):
    _, repo = project
    identities = IdentityStore()
    identities.add(Identity(actor_id="alice"), api_key_plaintext="sk-test-worktree")
    app = FastAPI()
    app.include_router(create_fs_router(identity_store=identities, require_auth=True))
    client = TestClient(app)
    assert client.get("/api/git/worktrees", params={"path": str(repo)}).status_code == 401
    for method in ("get", "post"):
        response = getattr(client, method)(
            "/api/git/worktrees",
            headers={"Authorization": "Bearer sk-test-worktree"},
            **(
                {"params": {"path": str(repo)}}
                if method == "get"
                else {"json": {"path": str(repo)}}
            ),
        )
        assert response.status_code == 403
    assert len(git(repo, "worktree", "list").splitlines()) == 1


def test_authenticated_dedicated_service_can_create(project):
    _, repo = project
    identities = IdentityStore()
    identities.add(Identity(actor_id="alice"), api_key_plaintext="sk-test-worktree")
    app = FastAPI()
    app.include_router(
        create_fs_router(
            identity_store=identities, require_auth=True, allow_local_workspace_access=True
        )
    )
    response = TestClient(app).post(
        "/api/git/worktrees",
        json={"path": str(repo)},
        headers={"Authorization": "Bearer sk-test-worktree"},
    )
    assert response.status_code == 201
