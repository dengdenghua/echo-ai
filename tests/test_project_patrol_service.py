from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Event

from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.platform.ui._app_project_patrol import mount_project_patrol
from runtime.projectos.model import Milestone, Project
from runtime.projectos.patrol_service import (
    PATROL_ATTENTION_KIND,
    current_patrol_notices,
    record_daily_patrol,
)
from runtime.projectos.store import ProjectStore
from tests.test_project_tenant_security import _client


def blocked_project(store, project_id="P", **kwargs):
    project = store.save_project(
        Project(id=project_id, name="Needs review", goal="review", status="blocked", **kwargs)
    )
    store.save_milestone(
        project.id,
        Milestone(id=f"M-{project_id}", name="Delivery", goal="review", status="blocked"),
    )
    return project


def test_daily_patrol_deduplicates_workers_and_keeps_sealed_history(tmp_path):
    store = ProjectStore(tmp_path)
    blocked_project(store)
    now = datetime.now().astimezone()
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: record_daily_patrol(ProjectStore(tmp_path), now=now), range(2)))
    assert len(store.events_for_project("P")) == 1
    assert store.events_for_project("P")[0]["kind"] == PATROL_ATTENTION_KIND
    assert store.verify_event_chain("P")["ok"]
    assert current_patrol_notices(store, now=now)[0]["project_id"] == "P"


def test_next_day_records_new_notice_and_resolved_project_is_quiet(tmp_path):
    from datetime import timedelta

    store = ProjectStore(tmp_path)
    project = blocked_project(store)
    now = datetime.now().astimezone()
    assert current_patrol_notices(store, now=now) == []
    record_daily_patrol(store, now=now)
    tomorrow = now + timedelta(days=1)
    assert current_patrol_notices(store, now=tomorrow) == []
    record_daily_patrol(store, now=tomorrow)
    assert len(store.events_for_project("P")) == 2
    project.status = "done"
    store.save_project(project, allow_terminal_rewrite=True)
    assert current_patrol_notices(store, now=tomorrow) == []
    assert record_daily_patrol(store, now=tomorrow).quiet


def test_patrol_never_drives_execution_and_notices_are_owner_scoped(tmp_path, monkeypatch):
    client, store = _client(tmp_path)
    blocked_project(store, "P-alice", owner_id="alice", tenant_id="tenant-a")
    blocked_project(store, "P-bob", owner_id="bob", tenant_id="tenant-b")
    monkeypatch.setattr(
        "runtime.projectos.engine.ProjectEngine.run",
        lambda *_: (_ for _ in ()).throw(AssertionError("patrol executed")),
    )
    record_daily_patrol(store)
    assert client.get("/api/project-attention").status_code == 401
    alice = client.get("/api/project-attention", headers={"Authorization": "Bearer sk-alice"})
    bob = client.get("/api/project-attention", headers={"Authorization": "Bearer sk-bob"})
    assert alice.status_code == bob.status_code == 200
    assert [item["project_id"] for item in alice.json()["notices"]] == ["P-alice"]
    assert [item["project_id"] for item in bob.json()["notices"]] == ["P-bob"]
    assert alice.json()["digest_id"] != bob.json()["digest_id"]


def test_scheduler_scans_on_start_and_stops_with_app(tmp_path, monkeypatch):
    store = ProjectStore(tmp_path)
    blocked_project(store)
    recorded = Event()

    def scan(received):
        assert received is store
        record_daily_patrol(received)
        recorded.set()

    monkeypatch.setattr("runtime.platform.ui._app_project_patrol.record_daily_patrol", scan)
    app = FastAPI()
    mount_project_patrol(app, store)
    mount_project_patrol(app, store)
    runner = app.state.project_patrol_runner
    assert runner.state == "idle"
    assert runner.task_names() == ["project-daily-patrol"]
    with TestClient(app):
        assert recorded.wait(3)
        assert runner.is_running
        assert current_patrol_notices(store)
    assert not runner.is_running
    assert runner.state == "stopped"
