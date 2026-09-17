from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.workspaces_router import create_workspaces_router


def _client(root: Path, *, authenticated: bool = False) -> TestClient:
    identities = IdentityStore()
    identities.add(Identity(actor_id="alice"), api_key_plaintext="alice-key")
    identities.add(Identity(actor_id="bob"), api_key_plaintext="bob-key")
    app = FastAPI()
    app.include_router(create_workspaces_router(
        workspace_root=root,
        identity_store=identities,
        require_auth=authenticated,
        thread_store=SimpleNamespace(get=lambda _: {"metadata": {"owner_actor_id": "alice"}}),
    ))
    return TestClient(app)


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def test_history_persists_pages_and_restores_across_area_aliases(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client.get("/api/workspaces/history")
    target = tmp_path / "history/output/final/site.html"
    target.write_text("version 0", encoding="utf-8")
    for index in range(23):
        response = client.put(
            "/api/workspaces/history/outputs/final/site.html?area=output",
            json={"content": f"version {index + 1}", "expected_sha256": _digest(f"version {index}")},
        )
        assert response.status_code == 200
    # A fresh router must see persisted history, not browser or process state.
    client = _client(tmp_path)
    url = "/api/threads/history/output-revisions/site.html?area=final"
    first = client.get(url + "&limit=20").json()
    second = client.get(url + "&before=" + first["next_cursor"]).json()
    assert len(first["revisions"]) == 20
    assert len(second["revisions"]) == 3
    assert second["next_cursor"] is None
    old_id = second["revisions"][-1]["revision_id"]
    content = client.get(url + "&revision_id=" + old_id)
    assert content.status_code == 200
    assert content.json()["content"] == "version 0"
    assert content.json()["sha256"] == _digest("version 0")
    assert target.read_text() == "version 23"  # Comparing never writes.
    restored = client.post(url, json={"revision_id": old_id, "expected_sha256": _digest("version 23")})
    assert restored.status_code == 200
    assert target.read_text() == "version 0"
    redo = client.post(url, json={"revision_id": restored.json()["revision_id"], "expected_sha256": _digest("version 0")})
    assert redo.status_code == 200
    assert target.read_text() == "version 23"


def test_legacy_alias_revision_and_tampering_are_handled(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client.get("/api/workspaces/history")
    target = tmp_path / "history/output/final/site.html"
    target.write_text("current", encoding="utf-8")
    revision_id = "1700000000000000000-" + _digest("legacy")[:12] + ".bak"
    legacy = tmp_path / "history/.artifact-revisions/output/final/site.html" / revision_id
    legacy.parent.mkdir(parents=True)
    legacy.write_text("legacy", encoding="utf-8")
    url = "/api/threads/history/output-revisions/site.html?area=final"
    assert client.get(url).json()["revisions"][0]["revision_id"] == revision_id
    assert client.get(url + "&revision_id=" + revision_id).json()["content"] == "legacy"
    legacy.write_text("tampered", encoding="utf-8")
    assert client.get(url + "&revision_id=" + revision_id).status_code == 409
    assert client.post(url, json={"revision_id": revision_id, "expected_sha256": _digest("current")}).status_code == 409
    assert target.read_text() == "current"
    assert client.get(url + "&revision_id=../secret").status_code == 400
    assert client.get(url + "&before=../secret").status_code == 400


def test_history_enforces_owner_on_list_read_and_restore(tmp_path: Path) -> None:
    client = _client(tmp_path, authenticated=True)
    alice, bob = {"Authorization": "Bearer alice-key"}, {"Authorization": "Bearer bob-key"}
    assert client.get("/api/workspaces/private", headers=alice).status_code == 200
    target = tmp_path / "private/output/final/site.html"
    target.write_text("private", encoding="utf-8")
    saved = client.put("/api/threads/private/outputs/site.html?area=final", headers=alice,
                       json={"content": "updated", "expected_sha256": _digest("private")})
    assert saved.status_code == 200
    revision_id = saved.json()["revision_id"]
    url = "/api/threads/private/output-revisions/site.html?area=final"
    for suffix in ("", "&revision_id=" + revision_id):
        assert client.get(url + suffix).status_code == 401
        assert client.get(url + suffix, headers=bob).status_code == 404
        assert client.get(url + suffix, headers=alice).status_code == 200
    assert client.post(url, headers=bob, json={"revision_id": revision_id, "expected_sha256": _digest("updated")}).status_code == 404
    assert target.read_text() == "updated"
