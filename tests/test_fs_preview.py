import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.sensing.gateway.fs_router import create_fs_router


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ECHO_FS_ALLOWED_ROOTS", str(tmp_path))
    app = FastAPI()
    app.include_router(create_fs_router())
    return TestClient(app)


def test_local_preview_keeps_scope_and_does_not_execute_markup(client, tmp_path):
    file = tmp_path / "sample.html"
    file.write_text("<script>alert(1)</script>")
    response = client.get("/api/fs/preview", params={"path": str(file)})
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["content-disposition"].startswith("attachment")
    assert response.headers["cache-control"] == "no-store"
    outside = tmp_path.parent / "outside-preview.txt"
    outside.write_text("private")
    try:
        assert client.get("/api/fs/preview", params={"path": str(outside)}).status_code == 403
    finally:
        outside.unlink()


def test_preview_missing_and_oversized_files(client, tmp_path):
    path = tmp_path / "missing.pdf"
    assert client.get("/api/fs/preview", params={"path": str(path)}).status_code == 404
    with path.open("wb") as f:
        f.truncate(25 * 1024 * 1024)
    assert client.get("/api/fs/preview", params={"path": str(path)}).status_code == 413


def test_raster_preview_has_passive_media_type(client, tmp_path):
    path = tmp_path / "sample.png"
    path.write_bytes(b"image-test")
    response = client.get("/api/fs/preview", params={"path": str(path)})
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
