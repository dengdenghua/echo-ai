"""Owner confirmation, plan freshness and replay tests on real project stores."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from multiprocessing import get_context
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.projectos.governance import phase_fingerprint
from runtime.projectos.model import Milestone, Project
from runtime.projectos.standing_authorization import GRANTED_KIND, grant_standing_authorization
from runtime.projectos.standing_review import (
    confirm_standing_authorization,
    review_standing_authorization,
    revoke_reviewed_authorization,
    standing_authorization_state,
)
from runtime.projectos.store import ProjectStore
from runtime.safety.auth import Identity, IdentityStore
from runtime.sensing.gateway.projects_router import create_projects_router

OWNER = {"actor_id": "alice", "tenant_id": "a"}
PATH = "/api/projects/P/standing-authorization"


def _process_confirm(base_dir, review_id, ready, start, results):
    store = ProjectStore(base_dir)
    ready.put(True)
    if not start.wait(10):
        raise RuntimeError("confirmation test did not start")
    results.put(confirm_standing_authorization(store, "P", **OWNER, review_id=review_id))


def _store(tmp_path: Path):
    store = ProjectStore(tmp_path)
    store.save_project(
        Project(
            id="P",
            name="project",
            goal="ship",
            owner_id="alice",
            tenant_id="a",
            milestone_ids=["M"],
            status="running",
        )
    )
    milestone = Milestone(
        id="M",
        name="phase",
        goal="bounded",
        spec={"ai_budget_usd": 5, "phase_agents": ["eve"]},
    )
    store.save_milestone("P", milestone)
    return store, milestone


def _review(store):
    return review_standing_authorization(store, "P", **OWNER, phase_ids=["M"], limit_usd=3.0)


def _confirm(store, review):
    return confirm_standing_authorization(store, "P", **OWNER, review_id=review["review_id"])


def _client(store):
    identities = IdentityStore()
    for actor, tenant, roles in (
        ("alice", "a", ()),
        ("bob", "b", ()),
        ("operator", "a", ("admin",)),
    ):
        identities.add(
            Identity(actor_id=actor, roles=roles, metadata={"tenant_id": tenant}),
            api_key_plaintext=f"sk-{actor}",
        )
    app = FastAPI()
    app.include_router(
        create_projects_router(store=store, identity_store=identities, require_auth=True)
    )
    return TestClient(app)


def test_real_http_review_requires_explicit_confirmation_and_does_not_execute(tmp_path):
    store, _ = _store(tmp_path)
    client = _client(store)
    headers = {"Authorization": "Bearer sk-alice"}
    reviewed = client.post(
        PATH + "/review", headers=headers, json={"phase_ids": ["M"], "limit_usd": 3}
    )
    assert reviewed.status_code == 200, reviewed.text
    review = reviewed.json()
    assert review["budget_basis"] == "cumulative_project_spend"
    assert client.get(PATH, headers=headers).json() == {"grant": None}
    for confirmation in ({}, {"confirmed": False}, {"confirmed": "true"}, {"confirmed": 1}):
        response = client.post(
            PATH + "/confirm",
            headers=headers,
            json={"review_id": review["review_id"], **confirmation},
        )
        assert response.status_code == 422
    confirmed = client.post(
        PATH + "/confirm",
        headers=headers,
        json={"review_id": review["review_id"], "confirmed": True},
    )
    assert confirmed.status_code == 200, confirmed.text
    grant = client.get(PATH, headers=headers).json()["grant"]
    assert grant["phase_ids"] == ["M"] and grant["owner_id"] == "alice"
    assert not store.tasks_for_milestone("M")
    assert not any(e["kind"].startswith("task.") for e in store.events_for_project("P"))
    assert client.delete(PATH, headers=headers).status_code == 200
    assert client.get(PATH, headers=headers).json() == {"grant": None}


@pytest.mark.parametrize("actor", [None, "bob", "operator"])
def test_http_nonowner_including_admin_cannot_read_review_confirm_or_revoke(tmp_path, actor):
    store, _ = _store(tmp_path)
    client = _client(store)
    headers = {"Authorization": f"Bearer sk-{actor}"} if actor else {}
    for method, path, body in (
        ("GET", PATH, None),
        ("DELETE", PATH, None),
        ("POST", PATH + "/review", {"phase_ids": ["M"], "limit_usd": 3}),
        ("POST", PATH + "/confirm", {"review_id": "x", "confirmed": True}),
    ):
        response = client.request(method, path, headers=headers, json=body)
        assert response.status_code in {401, 403, 404}, response.text
    assert not store.events_for_project("P")


def test_changed_plan_and_expired_review_cannot_grant(tmp_path, monkeypatch):
    store, milestone = _store(tmp_path)
    review = _review(store)
    milestone.goal = "a different plan"
    store.save_milestone("P", milestone)
    with pytest.raises(ValueError, match="plan changed"):
        _confirm(store, review)
    fresh = _review(store)
    monkeypatch.setattr(
        "runtime.projectos.standing_review.time.time", lambda: fresh["expires_at"] + 1
    )
    with pytest.raises(ValueError, match="expired"):
        _confirm(store, fresh)
    assert standing_authorization_state(store, "P", **OWNER) is None


@pytest.mark.parametrize("cap", [None, 0, -1, float("inf"), float("nan"), True])
def test_unbounded_phase_cannot_be_reviewed(tmp_path, cap):
    store, milestone = _store(tmp_path)
    milestone.spec["ai_budget_usd"] = cap
    store.save_milestone("P", milestone)
    with pytest.raises(ValueError, match="finite positive"):
        _review(store)
    assert not store.events_for_project("P")


def test_confirmation_is_atomic_across_stores_and_replay_cannot_undo_revoke(tmp_path):
    store, _ = _store(tmp_path)
    other = ProjectStore(tmp_path)
    review = _review(store)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda s: _confirm(s, review), [store, other]))
    assert results[0]["grant_id"] == results[1]["grant_id"]
    assert sorted(r["replayed"] for r in results) == [False, True]
    revoke_reviewed_authorization(store, "P", **OWNER)
    assert _confirm(other, review)["replayed"] is True
    assert standing_authorization_state(other, "P", **OWNER) is None
    assert len([e for e in store.events_for_project("P") if e["kind"] == GRANTED_KIND]) == 1


def test_confirmation_is_atomic_across_real_spawned_processes(tmp_path):
    store, _ = _store(tmp_path)
    review = _review(store)
    context = get_context("spawn")
    ready, results, start = context.Queue(), context.Queue(), context.Event()
    processes = [
        context.Process(
            target=_process_confirm,
            args=(str(tmp_path), review["review_id"], ready, start, results),
        )
        for _ in range(2)
    ]
    try:
        for process in processes:
            process.start()
        assert ready.get(timeout=15) is True and ready.get(timeout=15) is True
        start.set()
        for process in processes:
            process.join(15)
            assert process.exitcode == 0
        receipts = [results.get(timeout=2), results.get(timeout=2)]
        assert receipts[0]["grant_id"] == receipts[1]["grant_id"]
        assert sorted(receipt["replayed"] for receipt in receipts) == [False, True]
        assert len([e for e in store.events_for_project("P") if e["kind"] == GRANTED_KIND]) == 1
        assert store.verify_event_chain("P")["ok"] is True
    finally:
        start.set()
        for process in processes:
            if process.is_alive():
                process.terminate()
                process.join(5)
        for queue in (ready, results):
            queue.close()
            queue.join_thread()


def test_grant_survives_more_than_500_other_events_and_is_sealed(tmp_path):
    store, _ = _store(tmp_path)
    review = _review(store)
    confirmed = _confirm(store, review)
    for n in range(505):
        store.append_event("P", kind="project.observed", payload={"n": n})
    grant = standing_authorization_state(store, "P", **OWNER)
    assert grant is not None and grant["grant_id"] == confirmed["grant_id"]
    with store._conn() as conn:
        rows = conn.execute(
            "SELECT seq, seal_prev, seal FROM project_events ORDER BY seq"
        ).fetchall()
    assert [row[0] for row in rows] == list(range(1, 508))
    assert store.verify_event_chain("P")["ok"] is True
    assert all(previous[2] == current[1] for previous, current in zip(rows, rows[1:], strict=False))


def test_owner_or_tenant_transfer_invalidates_existing_review_and_grant(tmp_path):
    store, _ = _store(tmp_path)
    review = _review(store)
    _confirm(store, review)
    project = store.get_project("P")
    project.owner_id = "new-owner"
    with store._conn() as conn:
        import json

        conn.execute(
            "UPDATE projects SET doc=? WHERE id=?", (json.dumps(project.to_dict()), project.id)
        )
    assert standing_authorization_state(store, "P", actor_id="new-owner", tenant_id="a") is None
    with pytest.raises(PermissionError):
        _confirm(store, review)
    with pytest.raises(PermissionError):
        confirm_standing_authorization(
            store, "P", actor_id="new-owner", tenant_id="a", review_id=review["review_id"]
        )


def test_caller_source_string_does_not_create_reviewed_production_grant(tmp_path):
    store, milestone = _store(tmp_path)
    grant_standing_authorization(
        store, "P", milestones=[milestone], limit_usd=3, granted_by="alice"
    )
    assert standing_authorization_state(store, "P", **OWNER) is None
    assert phase_fingerprint(milestone)


@pytest.mark.parametrize(
    "changes",
    [
        {},
        {"limit_usd": float("nan")},
        {"source": "replayed_script"},
        {"approves_new_phases": True},
    ],
)
def test_malformed_newest_grant_cannot_fall_back_to_an_older_owner_grant(tmp_path, changes):
    store, _ = _store(tmp_path)
    _confirm(store, _review(store))
    original = standing_authorization_state(store, "P", **OWNER)
    store.append_event("P", kind=GRANTED_KIND, payload={**original, **changes})
    assert standing_authorization_state(store, "P", **OWNER) is None
