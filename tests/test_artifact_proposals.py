from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.artifact_proposals import ArtifactProposals
from runtime.sensing.gateway.workspaces_router import create_workspaces_router


def _digest(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


def _setup(tmp_path: Path) -> tuple[TestClient, Path, str]:
    identities = IdentityStore()
    identities.add(Identity(actor_id="alice"), api_key_plaintext="alice-key")
    identities.add(Identity(actor_id="bob"), api_key_plaintext="bob-key")
    app = FastAPI()
    app.include_router(create_workspaces_router(
        workspace_root=tmp_path, identity_store=identities, require_auth=True,
        thread_store=SimpleNamespace(get=lambda _: {"metadata": {"owner_actor_id": "alice"}}),
    ))
    client = TestClient(app, headers={"Authorization": "Bearer alice-key"})
    assert client.get("/api/workspaces/review").status_code == 200
    target = tmp_path / "review/output/final/site.html"
    target.write_text("<h1>Original</h1>", encoding="utf-8")
    return client, target, "/api/threads/review/output-proposals/site.html?area=final"


def _create(client: TestClient, url: str) -> dict:
    response = client.post(url, json={"action": "create", "expected_sha256": _digest("<h1>Original</h1>")})
    assert response.status_code == 200
    return response.json()


def test_proposal_accept_is_explicit_idempotent_and_reversible(tmp_path: Path) -> None:
    client, target, url = _setup(tmp_path)
    proposal = _create(client, url)
    pid = proposal["proposal_id"]
    candidate = Path(proposal["candidate_path"])
    candidate.write_text("<h1>Reviewed</h1>", encoding="utf-8")
    assert target.read_text() == "<h1>Original</h1>"
    alias = "/api/threads/review/output-proposals/final/site.html?area=output"
    assert client.get(alias).json()["proposals"][0]["proposal_id"] == pid
    read = client.get(alias + "&proposal_id=" + pid).json()
    assert read["changed"] is True and read["conflict"] is False
    assert read["base_content"] == target.read_text()
    body = {"action": "accept", "proposal_id": pid, "reviewed_sha256": read["candidate_sha256"]}
    accepted = client.post(alias, json=body)
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"
    assert target.read_text() == "<h1>Reviewed</h1>"
    # Later candidate writes cannot change the accepted snapshot or official file.
    candidate.write_text("<h1>Late tool write</h1>", encoding="utf-8")
    assert client.get(url + "&proposal_id=" + pid).json()["candidate_content"] == "<h1>Reviewed</h1>"
    assert client.post(url, json=body).json()["status"] == "accepted"
    assert len(list((tmp_path / "review/.artifact-revisions").rglob("*.bak"))) == 1
    restore = client.post("/api/threads/review/output-revisions/site.html?area=final",
                          json={"revision_id": accepted.json()["revision_id"], "expected_sha256": _digest("<h1>Reviewed</h1>")})
    assert restore.status_code == 200
    assert target.read_text() == "<h1>Original</h1>"
    # A network retry after undo must not silently reapply the proposal.
    assert client.post(url, json=body).status_code == 200
    assert target.read_text() == "<h1>Original</h1>"


@pytest.mark.parametrize("changed", ["official", "candidate", "unchanged"])
def test_accept_checks_both_reviewed_snapshot_and_original(tmp_path: Path, changed: str) -> None:
    client, target, url = _setup(tmp_path)
    proposal = _create(client, url)
    candidate = Path(proposal["candidate_path"])
    if changed != "unchanged":
        candidate.write_text("reviewed", encoding="utf-8")
    read = client.get(url + "&proposal_id=" + proposal["proposal_id"]).json()
    if changed == "official":
        target.write_text("other edit", encoding="utf-8")
    elif changed == "candidate":
        candidate.write_text("late edit", encoding="utf-8")
    before = target.read_bytes()
    result = client.post(url, json={"action": "accept", "proposal_id": proposal["proposal_id"], "reviewed_sha256": read["candidate_sha256"]})
    assert result.status_code == 409
    assert target.read_bytes() == before
    assert not (tmp_path / "review/.artifact-revisions").exists()


def test_rejection_persists_and_owner_cannot_be_spoofed(tmp_path: Path) -> None:
    client, target, url = _setup(tmp_path)
    proposal = _create(client, url)
    pid = proposal["proposal_id"]
    Path(proposal["candidate_path"]).write_text("proposed", encoding="utf-8")
    bob = {"Authorization": "Bearer bob-key"}
    for suffix in ("", "&proposal_id=" + pid):
        assert client.get(url + suffix, headers=bob).status_code == 404
    for action in ("create", "accept", "reject"):
        assert client.post(url, headers=bob, json={"action": action, "proposal_id": pid}).status_code == 404
    body = {"action": "reject", "proposal_id": pid}
    assert client.post(url, json=body).json()["status"] == "rejected"
    assert client.post(url, json=body).json()["status"] == "rejected"
    assert client.post(url, json={"action": "accept", "proposal_id": pid, "reviewed_sha256": _digest("proposed")}).status_code == 409
    assert target.read_text() == "<h1>Original</h1>"
    assert client.get(url + "&proposal_id=../../other").status_code == 400
    # Disk-backed state is visible to a newly constructed store.
    assert ArtifactProposals(tmp_path / "review", target).list()[0]["status"] == "rejected"


def test_competing_accept_and_reject_produce_one_decision(tmp_path: Path) -> None:
    client, target, url = _setup(tmp_path)
    proposal = _create(client, url)
    Path(proposal["candidate_path"]).write_text("proposed", encoding="utf-8")
    barrier = Barrier(2)

    def decide(action):
        barrier.wait()
        return client.post(url, json={"action": action, "proposal_id": proposal["proposal_id"], "reviewed_sha256": _digest("proposed")})

    with ThreadPoolExecutor(max_workers=2) as pool:
        accept, reject = pool.submit(decide, "accept"), pool.submit(decide, "reject")
        results = [accept.result(), reject.result()]
    assert sorted(result.status_code for result in results) == [200, 409]
    winner = next(result.json()["status"] for result in results if result.status_code == 200)
    assert target.read_text() == ("proposed" if winner == "accepted" else "<h1>Original</h1>")


def test_interrupted_acceptance_is_reconciled_without_replaying_write(tmp_path: Path, monkeypatch) -> None:
    client, target, url = _setup(tmp_path)
    proposal = _create(client, url)
    pid = proposal["proposal_id"]
    Path(proposal["candidate_path"]).write_text("proposed", encoding="utf-8")
    real_save = ArtifactProposals._save_state

    def fail_final_state(self, proposal_id, state):
        if state["status"] == "accepted":
            raise OSError("private host failure")
        real_save(self, proposal_id, state)

    monkeypatch.setattr(ArtifactProposals, "_save_state", fail_final_state)
    body = {"action": "accept", "proposal_id": pid, "reviewed_sha256": _digest("proposed")}
    response = client.post(url, json=body)
    assert response.status_code == 503
    assert "private host" not in response.text
    assert target.read_text() == "proposed"
    monkeypatch.setattr(ArtifactProposals, "_save_state", real_save)
    assert client.get(url + "&proposal_id=" + pid).json()["status"] == "accepted"
    assert client.post(url, json=body).status_code == 200
    assert len(list((tmp_path / "review/.artifact-revisions").rglob("*.bak"))) == 1
