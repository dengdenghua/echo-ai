from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from io import BytesIO
from pathlib import Path
from threading import Event, Lock
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from runtime.sensing.gateway.workspaces_router import create_workspaces_router


def _client(root: Path) -> TestClient:
    app = FastAPI()
    app.include_router(create_workspaces_router(workspace_root=root))
    return TestClient(app)


def test_workspace_info_creates_standard_layout(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.get("/api/workspaces/th-1")

    assert response.status_code == 200
    data = response.json()
    root = Path(data["root"])
    assert root == tmp_path.resolve() / "th-1"
    assert data["manifest"]["schema"] == "echo.workspace.v1"
    assert data["manifest"]["thread_id"] == "th-1"
    assert {entry["key"] for entry in data["dirs"]} == {
        "upload",
        "output",
        "stages",
        "final",
        "deploy",
        "skills",
    }
    assert all(entry["exists"] for entry in data["dirs"])
    assert (root / "output" / "stages").is_dir()
    assert (root / "workspace.json").is_file()


def test_thread_workspace_alias_matches_primary_route(tmp_path: Path) -> None:
    client = _client(tmp_path)

    primary = client.get("/api/workspaces/th-alias").json()
    alias = client.get("/api/threads/th-alias/workspace").json()

    assert alias["root"] == primary["root"]
    assert alias["paths"] == primary["paths"]
    assert alias["manifest"]["schema"] == "echo.workspace.v1"


def test_workspace_outputs_list_and_serve_final_files(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client.get("/api/workspaces/th-out")
    final = tmp_path.resolve() / "th-out" / "output" / "final" / "report.md"
    final.write_bytes(b"# report\n")

    listing = client.get("/api/workspaces/th-out/outputs?area=final")

    assert listing.status_code == 200
    data = listing.json()
    assert data["area"] == "final"
    assert data["count"] == 1
    assert data["files"][0]["relative_path"] == "report.md"
    assert data["files"][0]["download_url"] == (
        "/api/workspaces/th-out/outputs/report.md?area=final"
    )

    content = client.get("/api/workspaces/th-out/outputs/report.md?area=final")
    assert content.status_code == 200
    assert content.content == b"# report\n"


def test_workspace_outputs_reject_path_traversal(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.get("/api/workspaces/th-out/outputs/%2E%2E%2Fworkspace.json")

    assert response.status_code == 400


def test_thread_outputs_alias_serves_deploy_area(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client.get("/api/workspaces/th-deploy")
    deploy = tmp_path.resolve() / "th-deploy" / "deploy" / "index.html"
    deploy.write_text("<h1>ok</h1>", encoding="utf-8")

    listing = client.get("/api/threads/th-deploy/outputs?area=deploy")
    content = client.get("/api/threads/th-deploy/outputs/index.html?area=deploy")

    assert listing.status_code == 200
    assert listing.json()["files"][0]["relative_path"] == "index.html"
    assert content.status_code == 200
    assert content.text == "<h1>ok</h1>"


def test_thread_outputs_alias_renders_office_preview(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client.get("/api/workspaces/th-office")
    deck = tmp_path.resolve() / "th-office" / "output" / "final" / "deck.pptx"
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "ppt/slides/slide1.xml",
            '<p:sld xmlns:p="urn:p" xmlns:a="urn:a">'
            "<a:t>Strategy</a:t><a:t>Evidence first</a:t></p:sld>",
        )
    deck.write_bytes(buffer.getvalue())

    response = client.get("/api/threads/th-office/outputs/deck.pptx?area=final&office_preview=true")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == "no-store"
    assert "script-src 'nonce-" in response.headers["content-security-policy"]
    assert "Strategy" in response.text
    assert 'class="slide"' in response.text


def test_thread_outputs_alias_prefers_high_fidelity_office_pdf(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    client = _client(tmp_path)
    client.get("/api/workspaces/th-office-pdf")
    deck = tmp_path.resolve() / "th-office-pdf" / "output" / "final" / "deck.pptx"
    deck.write_bytes(b"pptx")
    monkeypatch.setattr(
        "runtime.sensing.gateway.workspaces_router.render_office_fidelity_preview",
        lambda _target: "<html><body>faithful pages</body></html>",
    )

    response = client.get(
        "/api/threads/th-office-pdf/outputs/deck.pptx"
        "?area=final&office_preview=true&office_fidelity_preview=true"
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-echo-office-preview"] == "fidelity"
    assert "object-src 'none'" in response.headers["content-security-policy"]
    assert "faithful pages" in response.text


def test_visual_html_edit_writes_atomically_with_optimistic_lock(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client.get("/api/workspaces/th-html-edit")
    target = tmp_path.resolve() / "th-html-edit" / "output" / "final" / "site.html"
    original = "<!doctype html><html><body><h1>Old</h1></body></html>"
    updated = "<!doctype html><html><body><h1>New</h1></body></html>"
    target.write_text(original, encoding="utf-8")

    response = client.put(
        "/api/threads/th-html-edit/outputs/site.html?area=final",
        json={
            "content": updated,
            "expected_sha256": hashlib.sha256(original.encode()).hexdigest(),
        },
    )

    assert response.status_code == 200
    assert response.json()["sha256"] == hashlib.sha256(updated.encode()).hexdigest()
    revision_id = response.json()["revision_id"]
    assert revision_id
    revision = (
        tmp_path.resolve()
        / "th-html-edit"
        / ".artifact-revisions"
        / "final"
        / "site.html"
        / revision_id
    )
    assert revision.read_text(encoding="utf-8") == original
    assert target.read_text(encoding="utf-8") == updated

    restored = client.post(
        "/api/threads/th-html-edit/output-revisions/site.html?area=final",
        json={
            "revision_id": revision_id,
            "expected_sha256": hashlib.sha256(updated.encode()).hexdigest(),
        },
    )

    assert restored.status_code == 200
    assert restored.json()["sha256"] == hashlib.sha256(original.encode()).hexdigest()
    assert restored.json()["revision_id"]
    assert target.read_text(encoding="utf-8") == original


def test_visual_html_edit_rejects_stale_and_non_html_outputs(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client.get("/api/workspaces/th-html-conflict")
    root = tmp_path.resolve() / "th-html-conflict" / "output" / "final"
    html = root / "site.html"
    html.write_text("<h1>Agent version</h1>", encoding="utf-8")
    markdown = root / "report.md"
    markdown.write_text("# report", encoding="utf-8")

    conflict = client.put(
        "/api/threads/th-html-conflict/outputs/site.html?area=final",
        json={
            "content": "<h1>Human version</h1>",
            "expected_sha256": hashlib.sha256(b"older version").hexdigest(),
        },
    )
    unsupported = client.put(
        "/api/threads/th-html-conflict/outputs/report.md?area=final",
        json={"content": "changed"},
    )
    unlocked = client.put(
        "/api/threads/th-html-conflict/outputs/site.html?area=final",
        json={"content": "<h1>Unlocked</h1>"},
    )

    assert conflict.status_code == 409
    assert conflict.json()["detail"]["error"] == "file_changed"
    assert html.read_text(encoding="utf-8") == "<h1>Agent version</h1>"
    assert unsupported.status_code == 415
    assert unlocked.status_code == 400

    invalid_restore = client.post(
        "/api/threads/th-html-conflict/output-revisions/site.html?area=final",
        json={
            "revision_id": "../escape",
            "expected_sha256": hashlib.sha256(b"<h1>Agent version</h1>").hexdigest(),
        },
    )
    assert invalid_restore.status_code == 400


@pytest.mark.parametrize("restore_first", [False, True])
def test_concurrent_output_edits_share_lock_across_routers_and_area_aliases(
    tmp_path: Path, monkeypatch: MonkeyPatch, restore_first: bool,
) -> None:
    from runtime.sensing.gateway import workspaces_router as module

    first_client, second_client = _client(tmp_path), _client(tmp_path)
    first_client.get("/api/workspaces/concurrent")
    target = tmp_path / "concurrent/output/final/site.html"
    target.write_bytes(b"original")
    initial = first_client.put(
        "/api/workspaces/concurrent/outputs/site.html?area=final",
        json={"content": "current", "expected_sha256": hashlib.sha256(b"original").hexdigest()},
    )
    assert initial.status_code == 200
    digest = hashlib.sha256(b"current").hexdigest()
    replacing, second_lock_attempt, release = Event(), Event(), Event()
    guard = Lock()
    lock_count = 0
    real_lock, real_replace = module._cross_process_lock, module.os.replace

    @contextmanager
    def observed_lock(path, **kwargs):
        nonlocal lock_count
        with guard:
            lock_count += 1
            if lock_count == 2:
                second_lock_attempt.set()
        with real_lock(path, **kwargs):
            yield

    def paused_replace(source, destination):
        if Path(destination) == target:
            replacing.set()
            assert release.wait(5), "test did not release the first writer"
        return real_replace(source, destination)

    monkeypatch.setattr(module, "_cross_process_lock", observed_lock)
    monkeypatch.setattr(module.os, "replace", paused_replace)
    with ThreadPoolExecutor(max_workers=2) as pool:
        if restore_first:
            first = pool.submit(
                first_client.post,
                "/api/threads/concurrent/output-revisions/site.html?area=final",
                json={"revision_id": initial.json()["revision_id"], "expected_sha256": digest},
            )
        else:
            first = pool.submit(
                first_client.put, "/api/workspaces/concurrent/outputs/site.html?area=final",
                json={"content": "winner", "expected_sha256": digest},
            )
        try:
            assert replacing.wait(5)
            second = pool.submit(
                second_client.put, "/api/threads/concurrent/outputs/final/site.html?area=output",
                json={"content": "loser", "expected_sha256": digest},
            )
            assert second_lock_attempt.wait(5)
        finally:
            release.set()
        assert first.result().status_code == 200
        conflict = second.result()
        assert conflict.status_code == 409
        assert conflict.json()["detail"]["error"] == "file_changed"
    assert target.read_bytes() == (b"original" if restore_first else b"winner")
    snapshots = list((tmp_path / "concurrent/.artifact-revisions").rglob("*.bak"))
    assert sorted(path.read_bytes() for path in snapshots) == [b"current", b"original"]
    assert not list(target.parent.glob("*.tmp"))


@pytest.mark.parametrize("hidden_dir", [".artifact-revisions", ".artifact-locks"])
def test_output_edits_reject_hidden_storage_symlink_escape(
    tmp_path: Path, hidden_dir: str,
) -> None:
    client = _client(tmp_path)
    client.get("/api/workspaces/escape")
    outside = tmp_path / "outside"
    outside.mkdir()
    try:
        (tmp_path / "escape" / hidden_dir).symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("directory symlinks unavailable")
    target = tmp_path / "escape/output/final/site.html"
    target.write_bytes(b"original")
    response = client.put(
        "/api/workspaces/escape/outputs/site.html?area=final",
        json={"content": "changed", "expected_sha256": hashlib.sha256(b"original").hexdigest()},
    )
    assert response.status_code == 400
    assert target.read_bytes() == b"original"
    assert not list(outside.iterdir())


def test_output_lock_failure_preserves_file_and_creates_no_revision(
    tmp_path: Path, monkeypatch: MonkeyPatch,
) -> None:
    from runtime.sensing.gateway import workspaces_router as module

    client = _client(tmp_path)
    client.get("/api/workspaces/unavailable")
    target = tmp_path / "unavailable/output/final/site.html"
    target.write_bytes(b"original")

    @contextmanager
    def unavailable_lock(*args, **kwargs):
        raise module.AtomicWriteError("private host lock failure")
        yield  # pragma: no cover

    monkeypatch.setattr(module, "_cross_process_lock", unavailable_lock)
    response = client.put(
        "/api/workspaces/unavailable/outputs/site.html?area=final",
        json={"content": "changed", "expected_sha256": hashlib.sha256(b"original").hexdigest()},
    )
    assert response.status_code == 503
    assert "private host" not in response.text
    assert target.read_bytes() == b"original"
    assert not (tmp_path / "unavailable/.artifact-revisions").exists()
