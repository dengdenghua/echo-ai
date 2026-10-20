from types import SimpleNamespace
from urllib.parse import unquote

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.sensing.gateway.fs_router import create_fs_router


@pytest.fixture
def scoped(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    store = SimpleNamespace(
        get=lambda tid: {"metadata": {"workspace_path": str(root)}} if tid == "t" else None
    )
    app = FastAPI()
    app.include_router(create_fs_router(thread_store=store))
    return TestClient(app), root


@pytest.mark.parametrize("endpoint,filename", [("read", "probe.log"), ("preview", "六视图.png")])
def test_short_reference_resolves_unique_nested_file(scoped, endpoint, filename):
    client, root = scoped
    nested = root / "design" / "evidence" / filename
    nested.parent.mkdir(parents=True)
    nested.write_bytes(b"the actual file")
    response = client.get(
        f"/api/fs/{endpoint}",
        params={
            "path": str(root / filename),
            "reference": filename,
            "thread_id": "t",
        },
    )
    assert response.status_code == 200
    if endpoint == "read":
        assert response.json()["path"] == str(nested)
        assert response.json()["content"] == "the actual file"
    else:
        assert response.content == b"the actual file"
        assert unquote(response.headers["x-echo-file-path"]) == str(nested)


def test_exact_path_wins_and_missing_absolute_path_is_not_guessed(scoped):
    client, root = scoped
    (root / "a").mkdir()
    (root / "a" / "file.txt").write_text("nested")
    response = client.get("/api/fs/read", params={"path": str(root / "file.txt"), "thread_id": "t"})
    assert response.status_code == 404
    (root / "file.txt").write_text("exact")
    response = client.get(
        "/api/fs/read",
        params={"path": str(root / "file.txt"), "reference": "file.txt", "thread_id": "t"},
    )
    assert response.json()["content"] == "exact"


def test_ambiguous_reference_requires_user_to_choose(scoped):
    client, root = scoped
    for folder in ("a", "b"):
        (root / folder).mkdir()
        (root / folder / "model.txt").write_text(folder)
    response = client.get(
        "/api/fs/read",
        params={"path": str(root / "model.txt"), "reference": "model.txt", "thread_id": "t"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["candidates"] == [
        str(root / f / "model.txt") for f in ("a", "b")
    ]
    response = client.get(
        "/api/fs/read",
        params={
            "path": str(root / "evidence" / "b" / "model.txt"),
            "reference": "b/model.txt",
            "thread_id": "t",
        },
    )
    assert response.json()["content"] == "b"


def test_no_search_outside_thread_or_through_symlink(scoped, tmp_path):
    client, root = scoped
    outside = tmp_path / "secret.txt"
    outside.write_text("secret")
    response = client.get(
        "/api/fs/read", params={"path": str(outside), "reference": "secret.txt", "thread_id": "t"}
    )
    assert response.status_code == 403
    response = client.get(
        "/api/fs/read",
        params={"path": str(root / "secret.txt"), "reference": "secret.txt", "thread_id": "t"},
    )
    assert response.status_code == 404
    try:
        (root / "link.txt").symlink_to(outside)
    except OSError:
        pytest.skip("symlink creation is unavailable")
    response = client.get(
        "/api/fs/read",
        params={
            "path": str(root / "missing" / "link.txt"),
            "reference": "link.txt",
            "thread_id": "t",
        },
    )
    assert response.status_code == 404


def test_incomplete_search_never_treats_partial_match_as_unique(scoped, monkeypatch):
    from runtime.sensing.gateway import _fs_reference_resolution as resolution

    client, root = scoped
    (root / "a").mkdir()
    (root / "a" / "model.txt").write_text("one")
    monkeypatch.setattr(resolution, "_MAX_ENTRIES", 0)
    response = client.get(
        "/api/fs/read",
        params={"path": str(root / "model.txt"), "reference": "model.txt", "thread_id": "t"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "file_search_incomplete"


@pytest.mark.parametrize("reference", ["../secret.txt", "/secret.txt", "C:/secret.txt"])
def test_traversal_and_absolute_reference_do_not_trigger_search(scoped, reference):
    client, root = scoped
    response = client.get(
        "/api/fs/read",
        params={"path": str(root / "secret.txt"), "reference": reference, "thread_id": "t"},
    )
    assert response.status_code == 404
