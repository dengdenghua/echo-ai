from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.group import ContextGrant, MemberEvent
from runtime.memory.cowork.group_store import GroupStore
from runtime.memory.threads import ThreadStateStore
from runtime.platform.process.task_supervisor import TaskRunRecord, TaskRunStatus, TaskSupervisor
from runtime.projectos.model import Milestone, Project, Task
from runtime.projectos.store import ProjectStore
from runtime.safety.auth.identity import Identity, IdentityStore
from runtime.sensing.gateway.assistant_activity_router import create_assistant_activity_router


@pytest.fixture
def stores(tmp_path):
    return SimpleNamespace(
        supervisor=TaskSupervisor.from_path(tmp_path / "runs.json", holder_id="worker"),
        projects=ProjectStore(tmp_path / "projects"),
        collaboration=CollaborationStore(tmp_path / "collaboration"),
        groups=GroupStore(tmp_path / "groups"),
        threads=ThreadStateStore(path=tmp_path / "threads.json"),
    )


def _client(stores, *, authenticated=False, rooms=None):
    identities = IdentityStore()
    for actor, tenant, roles in (
        ("alice", "tenant-a", ()),
        ("bob", "tenant-a", ()),
        ("carol", "tenant-b", ()),
        ("admin", "tenant-a", ("admin",)),
    ):
        identities.add(
            Identity(actor_id=actor, roles=roles, metadata={"tenant_id": tenant}),
            api_key_plaintext=f"sk-{actor}",
        )
    app = FastAPI()
    app.include_router(
        create_assistant_activity_router(
            supervisor=stores.supervisor,
            project_store=stores.projects,
            collaboration_store=stores.collaboration,
            thread_store=stores.threads,
            group_store=stores.groups,
            team_rooms_router=rooms,
            identity_store=identities if authenticated else None,
            require_auth=authenticated,
        )
    )
    return TestClient(app)


def _headers(actor="alice"):
    return {"Authorization": f"Bearer sk-{actor}"}


def _thread(stores, thread_id, *, owner="alice", tenant="tenant-a"):
    stores.threads.ensure_thread(
        thread_id,
        metadata={
            "owner_actor_id": owner,
            "tenant_id": tenant,
        },
    )


def _room(stores, thread_id, room_id, *, owner="alice", tenant="tenant-a", participants=()):
    stores.collaboration.upsert_room(
        thread_id,
        {
            "id": room_id,
            "name": f"Room {room_id}",
            "owner_id": owner,
            "tenant_id": tenant,
            "participants": [
                {"id": actor, "actor_id": actor, "role": "member", "status": "active"}
                for actor in participants
            ],
        },
    )


def _project(
    stores,
    project_id,
    *,
    owner="alice",
    tenant="tenant-a",
    thread=None,
    status="pending",
    source_index=None,
):
    task_id = f"task-{project_id}"
    milestone_id = f"ms-{project_id}"
    stores.projects.save_project(
        Project(
            id=project_id,
            name=f"Project {project_id}",
            goal="Deliver",
            owner_id=owner,
            tenant_id=tenant,
            created_at="2026-10-01T00:00:00+00:00",
        )
    )
    stores.projects.save_milestone(
        project_id,
        Milestone(
            id=milestone_id,
            name="Build",
            goal="Build",
        ),
    )
    task = Task(
        id=task_id,
        milestone_id=milestone_id,
        type="code",
        goal=f"Task {project_id}",
        status=status,
        assigned_agent="engineer",
        input={} if source_index is None else {"source_message_index": source_index},
    )
    stores.projects.save_task(task)
    if thread:
        stores.projects.bind_thread(thread, project_id)
    return task


def _collab_task(
    stores, session, room, task_id, *, status="running", timestamp=None, metadata=None, **fields
):
    task = {
        "id": task_id,
        "room_id": room,
        "title": f"Task {task_id}",
        "status": status,
        "metadata": metadata or {},
        **fields,
    }
    if timestamp:
        task["updated_at"] = timestamp
    return stores.collaboration.upsert_task(session, task)


def test_activity_projects_runs_and_collaboration_keep_delivery_semantics(stores):
    _thread(stores, "thread-project")
    _room(stores, "thread-project", "room-project")
    task = _project(stores, "p1", thread="thread-project")
    stores.collaboration.upsert_project_task(
        session_id="thread-project",
        room_id="room-project",
        project_id="p1",
        milestone_id=task.milestone_id,
        task={"id": task.id, "title": task.goal, "status": "done"},
    )
    stores.supervisor.start_task(
        task_id="execution-p1",
        owner_id="alice",
        thread_id="thread-project",
        origin_task_id=task.id,
        status=TaskRunStatus.COMPLETED,
    )
    # A title match alone must remain a separate activity.
    stores.supervisor.start_task(task_id="unrelated", owner_id="alice", title=task.goal)
    _collab_task(
        stores,
        "thread-project",
        "room-project",
        "team-task",
        status="done",
        assignees=[
            {"ref": "researcher", "kind": "agent"},
            {"ref": "human-owner", "kind": "participant"},
        ],
    )
    stores.supervisor.start_task(
        task_id="raw-complete", owner_id="alice", status=TaskRunStatus.COMPLETED
    )

    body = _client(stores).get("/api/assistant/activity").json()
    assert body["schema"] == "echo.assistant_activity.v1"
    assert len(body["items"]) == 4
    projected = next(row for row in body["items"] if row["source"] == "project_task")
    assert projected["status"] == "pending" and projected["state"] == "working"
    assert projected["reason"] == "execution_completed"
    assert projected["run_id"] == "execution-p1"
    assert (projected["thread_id"], projected["project_id"], projected["room_id"]) == (
        "thread-project",
        "p1",
        "room-project",
    )
    assert projected["agent_ids"] == ["engineer"]
    assert any(row["id"] == "run:unrelated" for row in body["items"])
    completed = [row for row in body["items"] if row["state"] == "completed"]
    assert {row["status"] for row in completed} == {"done", "completed"}
    team = next(row for row in completed if row["source"] == "collaboration_task")
    assert team["agent_ids"] == ["researcher"] and team["updated_at"]
    assert body["summary"] == {"working": 2, "attention": 0, "completed": 2}


@pytest.mark.parametrize(
    "status",
    [
        TaskRunStatus.PAUSED,
        TaskRunStatus.WAITING_APPROVAL,
        TaskRunStatus.FAILED,
        TaskRunStatus.CANCELLED,
        TaskRunStatus.DISCONNECTED,
    ],
)
def test_attention_runs_are_exact_and_merge_without_claiming_delivery(stores, status):
    _thread(stores, "thread-p")
    task = _project(stores, "p", thread="thread-p")
    stores.supervisor.start_task(
        task_id="run-p",
        owner_id="alice",
        thread_id="thread-p",
        origin_task_id=task.id,
        status=status,
    )
    stores.supervisor.start_task(task_id="standalone", owner_id="alice", status=status)
    body = _client(stores).get("/api/assistant/activity").json()
    assert len(body["items"]) == 2
    assert body["summary"]["attention"] == 2
    project = next(row for row in body["items"] if row["source"] == "project_task")
    assert project["status"] == "pending"
    assert project["reason"] == f"run:{status.value}"
    raw = next(row for row in body["items"] if row["source"] == "run")
    assert raw["status"] == status.value


def test_activity_limits_sort_attention_before_recent_work_and_counts_visible_items(stores):
    _thread(stores, "thread")
    _room(stores, "thread", "room")
    for task_id, status, date in (
        ("old-blocked", "blocked", "2026-01-01"),
        ("new-failed", "failed", "2026-02-01"),
        ("new-running", "running", "2026-10-01"),
        ("new-done", "done", "2026-10-02"),
        ("cancelled", "cancelled", "2026-01-02"),
        ("rejected", "rejected", "2026-01-03"),
    ):
        _collab_task(
            stores, "thread", "room", task_id, status=status, timestamp=f"{date}T00:00:00Z"
        )
    client = _client(stores)
    result = client.get("/api/assistant/activity", params={"limit": 2})
    assert result.status_code == 200
    body = result.json()
    assert [row["task_id"] for row in body["items"]] == ["new-failed", "rejected"]
    assert body["summary"] == {"working": 0, "attention": 2, "completed": 0}
    assert body["has_more"] is True
    assert client.get("/api/assistant/activity", params={"limit": 0}).status_code == 422
    assert client.get("/api/assistant/activity", params={"limit": 201}).status_code == 422
    assert client.get("/api/assistant/activity", params={"limit": 200}).json()["has_more"] is False


def test_personal_view_filters_owners_tenants_and_private_admin_access(stores):
    for project_id, owner, tenant in (
        ("alice", "alice", "tenant-a"),
        ("bob", "bob", "tenant-a"),
        ("cross", "alice", "tenant-b"),
        ("ownerless", "", "tenant-a"),
        ("admin", "admin", "tenant-a"),
    ):
        _project(stores, project_id, owner=owner, tenant=tenant)
    for run_id, owner, tenant in (
        ("run-alice", "alice", "tenant-a"),
        ("run-bob", "bob", "tenant-a"),
        ("run-cross", "alice", "tenant-b"),
        ("run-unowned", None, "tenant-a"),
        ("run-admin", "admin", "tenant-a"),
    ):
        stores.supervisor.start_task(task_id=run_id, owner_id=owner, metadata={"tenant_id": tenant})
    _thread(stores, "cross-thread", owner="alice", tenant="tenant-b")
    stores.supervisor.start_task(
        task_id="thread-cross-run", owner_id="alice", thread_id="cross-thread"
    )
    for session, owner, tenant in (
        ("alice-thread", "alice", "tenant-a"),
        ("bob-thread", "bob", "tenant-a"),
        ("cross-room", "alice", "tenant-b"),
    ):
        _thread(stores, session, owner=owner, tenant=tenant)
        _room(stores, session, f"room-{session}", owner=owner, tenant=tenant)
        _collab_task(stores, session, f"room-{session}", f"task-{session}")
    client = _client(stores, authenticated=True)
    alice = client.get("/api/assistant/activity", headers=_headers()).json()["items"]
    assert {row["id"] for row in alice} == {
        "project_task:alice:task-alice",
        "run:run-alice",
        "collaboration_task:alice-thread:task-alice-thread",
    }
    admin = client.get("/api/assistant/activity", headers=_headers("admin")).json()["items"]
    assert {row["id"] for row in admin} == {"project_task:admin:task-admin", "run:run-admin"}
    assert client.get("/api/assistant/activity").status_code == 401
    assert client.get("/api/assistant/activity", headers=_headers("missing")).status_code == 401
    assert (
        client.get(
            "/api/assistant/activity", headers=_headers(), params={"owner_id": "bob"}
        ).status_code
        == 400
    )


def test_shared_work_requires_current_membership_and_tenant(stores):
    _thread(stores, "shared", owner="bob")
    _room(stores, "shared", "shared-room", owner="bob", participants=("alice",))
    _project(stores, "shared-p", owner="bob", thread="shared")
    _collab_task(stores, "shared", "shared-room", "shared-task")
    participant = {"actor_id": "alice", "role": "viewer", "status": "offline"}
    rooms = SimpleNamespace(
        get_room_participant=lambda _room, actor, tenant: (
            participant if actor == "alice" and tenant == "tenant-a" else None
        )
    )
    client = _client(stores, authenticated=True, rooms=rooms)
    rows = client.get("/api/assistant/activity", headers=_headers()).json()["items"]
    assert {row["source"] for row in rows} == {"project_task", "collaboration_task"}
    assert all(row["thread_id"] == "shared" for row in rows)
    assert client.get("/api/assistant/activity", headers=_headers("carol")).json()["items"] == []
    # A negative authoritative answer must override stale persisted participants.
    participant = None
    assert client.get("/api/assistant/activity", headers=_headers()).json()["items"] == []


def test_ownerless_legacy_threads_do_not_grant_other_users_projects(stores):
    _thread(stores, "legacy", owner="", tenant="tenant-a")
    _project(stores, "bob-legacy", owner="bob", thread="legacy")
    client = _client(stores, authenticated=True)
    assert client.get("/api/assistant/activity", headers=_headers()).json()["items"] == []


def test_collaboration_task_explicit_foreign_tenant_is_filtered(stores):
    _thread(stores, "thread")
    _room(stores, "thread", "room")
    _collab_task(stores, "thread", "room", "foreign", metadata={"tenant_id": "tenant-b"})
    client = _client(stores, authenticated=True)
    assert client.get("/api/assistant/activity", headers=_headers()).json()["items"] == []


def test_historical_grants_filter_task_titles_in_all_sources(stores):
    _thread(stores, "shared", owner="bob")
    _room(stores, "shared", "room", owner="bob", participants=("alice",))
    stores.groups.append(
        "shared",
        MemberEvent(
            action="invite",
            actor="bob",
            target_id="alice",
            target_kind="human",
            grant=ContextGrant(scope="from_join"),
            at_message=10,
        ),
    )
    _project(stores, "historic-project", owner="bob", thread="shared", source_index=2)
    for task_id, metadata in (
        ("old", {"source_message_index": 2}),
        ("new", {"source_message_index": 10}),
        ("unknown", {}),
    ):
        _collab_task(stores, "shared", "room", task_id, metadata=metadata)
    stores.supervisor.start_task(
        task_id="old-run",
        owner_id="alice",
        thread_id="shared",
        metadata={"source_message_index": 2},
    )
    stores.supervisor.start_task(
        task_id="new-run",
        owner_id="alice",
        thread_id="shared",
        metadata={"source_message_index": 10},
    )
    client = _client(stores, authenticated=True)
    rows = client.get("/api/assistant/activity", headers=_headers()).json()["items"]
    assert {row["task_id"] for row in rows} == {"new", "new-run"}
    stores.groups.append(
        "shared",
        MemberEvent(
            action="invite",
            actor="bob",
            target_id="alice",
            target_kind="human",
            grant=ContextGrant(scope="summary"),
            at_message=10,
        ),
    )
    assert client.get("/api/assistant/activity", headers=_headers()).json()["items"] == []


@pytest.mark.parametrize(
    ("scope", "visible_task_ids"),
    [("from_join", {"new"}), ("summary", set())],
)
def test_standalone_shared_room_respects_historical_grants_and_member_revocation(
    stores, scope, visible_task_ids
):
    session = "historical-session"
    _room(stores, session, "shared-room", owner="bob", participants=("alice",))
    stores.groups.append(
        session,
        MemberEvent(
            action="invite",
            actor="bob",
            target_id="alice",
            target_kind="human",
            grant=ContextGrant(scope=scope),
            at_message=10,
        ),
    )
    for task_id, metadata in (
        ("old", {"source_message_index": 2}),
        ("new", {"source_message_index": 10}),
        ("unknown", {}),
    ):
        _collab_task(stores, session, "shared-room", task_id, metadata=metadata)
    assert stores.threads.get(session) is None
    client = _client(stores, authenticated=True)

    response = client.get("/api/assistant/activity", headers=_headers())
    assert response.status_code == 200
    rows = response.json()["items"]
    assert {row["task_id"] for row in rows} == visible_task_ids
    assert all(row["thread_id"] is None and row["room_id"] == "shared-room" for row in rows)

    # A context grant alone cannot keep a removed room participant authorized.
    _room(stores, session, "shared-room", owner="bob", participants=())
    revoked = client.get("/api/assistant/activity", headers=_headers())
    assert revoked.status_code == 200
    assert revoked.json()["items"] == []


def test_standalone_rooms_have_no_invented_thread_and_owned_orphans_remain_visible(stores):
    _room(stores, "team:room", "room", owner="alice")
    _collab_task(stores, "team:room", "room", "room-task")
    stores.supervisor.start_task(task_id="orphan", owner_id="alice", thread_id="missing-thread")
    client = _client(stores, authenticated=True)
    rows = client.get("/api/assistant/activity", headers=_headers()).json()["items"]
    assert len(rows) == 2
    assert all(row["thread_id"] is None for row in rows)
    team = next(row for row in rows if row["source"] == "collaboration_task")
    assert team["room_id"] == "room"
    assert next(row for row in rows if row["source"] == "run")["run_id"] == "orphan"


def test_known_origin_requires_matching_work_coordinate_and_latest_run_wins(stores):
    _thread(stores, "project-thread")
    _thread(stores, "other-thread")
    task = _project(stores, "p", thread="project-thread")
    stores.supervisor.start_task(
        task_id="wrong-coordinate",
        owner_id="alice",
        thread_id="other-thread",
        origin_task_id=task.id,
    )
    stores.supervisor.start_task(
        task_id="first",
        owner_id="alice",
        thread_id="project-thread",
        origin_task_id=task.id,
        status=TaskRunStatus.FAILED,
    )
    stores.supervisor.start_task(
        task_id="latest",
        owner_id="alice",
        thread_id="project-thread",
        origin_task_id=task.id,
        status=TaskRunStatus.RUNNING,
    )
    rows = _client(stores).get("/api/assistant/activity").json()["items"]
    assert len(rows) == 2
    projected = next(row for row in rows if row["source"] == "project_task")
    assert projected["run_id"] == "latest" and projected["state"] == "working"
    assert any(row["id"] == "run:wrong-coordinate" for row in rows)


def test_project_activity_uses_latest_task_event_timestamp(stores):
    task = _project(stores, "p")
    for event_id, stamp in (("late", 1800000000), ("early", 1700000000)):
        stores.projects.append_event(
            "p",
            kind="task.updated",
            payload={"task_id": task.id},
            event_id=event_id,
            created_at=stamp,
        )
    row = _client(stores).get("/api/assistant/activity").json()["items"][0]
    assert row["updated_at"] == "2027-01-15T08:00:00+00:00"


@pytest.mark.parametrize(
    "run_thread,metadata",
    [
        ("other-thread", {"project_id": "p"}),
        ("other-thread", {"room_id": "project-room"}),
        ("project-thread", {"project_id": "another-project"}),
        ("project-thread", {"room_id": "another-room"}),
    ],
)
def test_matching_coordinate_cannot_override_another_explicit_source_conflict(
    stores, run_thread, metadata
):
    _thread(stores, "project-thread")
    _thread(stores, "other-thread")
    _room(stores, "project-thread", "project-room")
    task = _project(stores, "p", thread="project-thread")
    stores.supervisor.start_task(
        task_id="conflicting-run",
        owner_id="alice",
        thread_id=run_thread,
        origin_task_id=task.id,
        metadata=metadata,
    )
    rows = _client(stores).get("/api/assistant/activity").json()["items"]
    assert len(rows) == 2
    project = next(row for row in rows if row["source"] == "project_task")
    run = next(row for row in rows if row["source"] == "run")
    assert project["run_id"] is None and project["thread_id"] == "project-thread"
    assert run["run_id"] == "conflicting-run" and run["thread_id"] == run_thread


@pytest.mark.parametrize("metadata", [{"project_id": "p"}, {"room_id": "project-room"}])
def test_unknown_execution_coordinates_do_not_block_a_known_origin_match(stores, metadata):
    _thread(stores, "project-thread")
    _room(stores, "project-thread", "project-room")
    task = _project(stores, "p", thread="project-thread")
    stores.supervisor.start_task(
        task_id="unbound-run",
        owner_id="alice",
        origin_task_id=task.id,
        metadata=metadata,
    )
    rows = _client(stores).get("/api/assistant/activity").json()["items"]
    assert len(rows) == 1
    assert rows[0]["source"] == "project_task" and rows[0]["run_id"] == "unbound-run"


def test_collaboration_session_enumeration_and_timestamp_projection_are_read_only(stores):
    for session in ("z-session", "a-session", "m-session"):
        _room(stores, session, f"room-{session}")
        _collab_task(stores, session, f"room-{session}", f"task-{session}")
    stores.collaboration.upsert_project_task(
        session_id="task-only",
        room_id="historical-room",
        project_id="historical-project",
        milestone_id="historical-ms",
        task={"id": "historical-task", "title": "History"},
    )
    before = (stores.collaboration.base_dir / "collaboration.db").read_bytes()
    assert stores.collaboration.list_session_ids(limit=2) == ["a-session", "m-session"]
    assert stores.collaboration.list_session_ids(limit=2, offset=2) == ["task-only", "z-session"]
    assert len(stores.collaboration.list_session_ids(limit=0, offset=-1)) == 1
    tasks = stores.collaboration.tasks_for_session("a-session")
    assert tasks[0]["created_at"] and tasks[0]["updated_at"]
    assert (stores.collaboration.base_dir / "collaboration.db").read_bytes() == before
    _collab_task(
        stores, "a-session", "room-a-session", "task-a-session", timestamp="2026-01-01T00:00:00Z"
    )
    assert (
        stores.collaboration.tasks_for_session("a-session")[0]["updated_at"]
        == "2026-01-01T00:00:00Z"
    )


def test_activity_contract_is_declared_in_openapi(stores):
    client = _client(stores)
    schema = client.get("/openapi.json").json()
    response = schema["paths"]["/api/assistant/activity"]["get"]["responses"]["200"]
    assert response["content"]["application/json"]["schema"]["$ref"].endswith(
        "AssistantActivityResponse"
    )
    model = schema["components"]["schemas"]["AssistantActivityResponse"]
    assert model["properties"]["schema"]["const"] == "echo.assistant_activity.v1"


def test_run_agents_read_real_single_agent_metadata_and_legacy_list(stores):
    for run_id, metadata in (
        ("single", {"agent_id": "echo-assistant"}),
        ("legacy-list", {"agent_ids": ["planner", "engineer"], "agent_id": "fallback"}),
        ("empty-list", {"agent_ids": [], "agent_id": "echo-assistant"}),
        ("unassigned", {}),
    ):
        stores.supervisor.start_task(task_id=run_id, owner_id="alice", metadata=metadata)
    rows = _client(stores).get("/api/assistant/activity").json()["items"]
    agents = {row["run_id"]: row["agent_ids"] for row in rows}
    assert agents == {
        "single": ["echo-assistant"],
        "legacy-list": ["engineer", "planner"],
        "empty-list": ["echo-assistant"],
        "unassigned": [],
    }


def test_run_snapshot_preserves_filters_and_refreshes_after_a_write(stores, monkeypatch):
    for task_id, owner, status, kind, thread in (
        ("active", "alice", TaskRunStatus.RUNNING, "loop", "thread"),
        ("failed", "alice", TaskRunStatus.FAILED, "loop", "thread"),
        ("other-user", "bob", TaskRunStatus.RUNNING, "loop", "thread"),
        ("unowned", None, TaskRunStatus.RUNNING, "loop", "thread"),
        ("other-kind", "alice", TaskRunStatus.RUNNING, "realtime", "another-thread"),
    ):
        stores.supervisor.start_task(
            task_id=task_id, owner_id=owner, status=status, kind=kind, thread_id=thread
        )
    store = stores.supervisor.store
    before = store.path.read_bytes()
    reads = 0
    real_read = store._read_payload

    def read_payload():
        nonlocal reads
        reads += 1
        return real_read()

    monkeypatch.setattr(store, "_read_payload", read_payload)
    owned = store.list_snapshot(owner_id="alice", include_unowned=False)
    assert {row.task_id for row in owned} == {"active", "failed", "other-kind"}
    assert reads == 1 and store.path.read_bytes() == before
    filters = {"owner_id": "alice", "status": "running", "kind": "loop", "thread_id": "thread"}
    assert {row.task_id for row in store.list_snapshot(**filters, include_unowned=False)} == {
        "active"
    }
    assert {row.task_id for row in store.list_snapshot(**filters, include_unowned=True)} == {
        "active",
        "unowned",
    }
    stores.supervisor.transition("active", TaskRunStatus.COMPLETED)
    assert store.list_snapshot(**filters, include_unowned=False) == []


def test_activity_reads_large_run_ledger_once_and_keeps_old_unfinished_work(stores, monkeypatch):
    records = [
        TaskRunRecord(
            task_id=f"completed-{index:04}",
            owner_id="alice",
            status=TaskRunStatus.COMPLETED,
            created_at="2026-10-05T00:00:00Z",
            updated_at="2026-10-05T00:00:00Z",
        )
        for index in range(601)
    ]
    for run_id, owner, status in (
        ("old-attention", "alice", TaskRunStatus.WAITING_APPROVAL),
        ("old-working", "alice", TaskRunStatus.RUNNING),
        ("other-user", "bob", TaskRunStatus.FAILED),
        ("unowned", None, TaskRunStatus.FAILED),
    ):
        records.append(
            TaskRunRecord(
                task_id=run_id,
                owner_id=owner,
                status=status,
                created_at="2026-01-01T00:00:00Z",
                updated_at="2026-01-01T00:00:00Z",
            )
        )
    store = stores.supervisor.store
    store._write_payload({"tasks": [row.model_dump(mode="json") for row in records]})
    before = store.path.read_bytes()
    reads = 0
    real_read = store._read_payload

    def read_payload():
        nonlocal reads
        reads += 1
        return real_read()

    def no_offset_pages(**_kwargs):
        pytest.fail("activity must read a single complete run snapshot")

    monkeypatch.setattr(store, "_read_payload", read_payload)
    monkeypatch.setattr(store, "list", no_offset_pages)
    response = _client(stores, authenticated=True).get(
        "/api/assistant/activity", headers=_headers(), params={"limit": 200}
    )
    assert response.status_code == 200
    body = response.json()
    assert reads == 1 and store.path.read_bytes() == before
    assert [row["run_id"] for row in body["items"][:2]] == ["old-attention", "old-working"]
    assert [row["run_id"] for row in body["items"][2:]] == [
        f"completed-{index:04}" for index in range(198)
    ]
    assert body["summary"] == {"working": 1, "attention": 1, "completed": 198}
    assert body["has_more"] is True
    assert {
        row.task_id for row in store.list_snapshot(owner_id="alice", include_unowned=False)
    } == {row.task_id for row in records if row.owner_id == "alice"}


def test_activity_request_caches_shared_reads_but_rechecks_revocation(stores, monkeypatch):
    _thread(stores, "shared", owner="bob")
    _room(stores, "shared", "shared-room", owner="bob", participants=("alice",))
    stores.groups.append(
        "shared", MemberEvent(action="room_link", actor="bob", target_id="shared-room")
    )
    stores.groups.append(
        "shared",
        MemberEvent(action="invite", actor="bob", target_id="alice", target_kind="human"),
    )
    original = _project(stores, "shared-p", owner="bob", thread="shared")
    for index in range(3):
        stores.projects.save_task(
            Task(
                id=f"project-task-{index}",
                milestone_id=original.milestone_id,
                type="code",
                goal=f"Project task {index}",
            )
        )
        stores.supervisor.start_task(
            task_id=f"shared-run-{index}", owner_id="alice", thread_id="shared"
        )
    for index in range(8):
        _collab_task(stores, "shared", "shared-room", f"team-task-{index}")

    reads = {"group": 0, "room": 0, "membership": 0}
    real_state = stores.groups.state
    real_room = stores.collaboration.room_for_session

    def group_state(thread_id):
        reads["group"] += 1
        return real_state(thread_id)

    def room_for_session(thread_id):
        reads["room"] += 1
        return real_room(thread_id)

    participant = {"actor_id": "alice", "role": "viewer", "status": "active"}

    def current_member(room_id, actor, tenant):
        reads["membership"] += 1
        return (
            participant
            if room_id == "shared-room" and actor == "alice" and tenant == "tenant-a"
            else None
        )

    monkeypatch.setattr(stores.groups, "state", group_state)
    monkeypatch.setattr(stores.collaboration, "room_for_session", room_for_session)
    client = _client(
        stores, authenticated=True, rooms=SimpleNamespace(get_room_participant=current_member)
    )
    first = client.get("/api/assistant/activity", headers=_headers()).json()
    assert len(first["items"]) == 15
    assert reads == {"group": 1, "room": 1, "membership": 2}
    assert all(row["room_id"] == "shared-room" for row in first["items"])
    participant = None
    assert client.get("/api/assistant/activity", headers=_headers()).json()["items"] == []
    assert reads == {"group": 2, "room": 2, "membership": 3}


@pytest.mark.parametrize("role", ["owner", "member", "viewer"])
def test_authorized_shared_work_remains_visible_without_local_room_projection(stores, role):
    _thread(stores, "shared", owner="bob")
    _room(stores, "shared", "shared-room", owner="bob", participants=("alice",))
    stores.groups.append(
        "shared", MemberEvent(action="room_link", actor="bob", target_id="shared-room")
    )
    _project(stores, "shared-p", owner="bob", thread="shared")
    _collab_task(stores, "shared", "shared-room", "shared-task")
    stores.supervisor.start_task(task_id="shared-run", owner_id="alice", thread_id="shared")
    # Historical task streams can survive a missing local room projection.
    with stores.collaboration._lock, stores.collaboration._connect() as conn:
        conn.execute("DELETE FROM collaboration_rooms WHERE room_id=?", ("shared-room",))
    assert stores.collaboration.room_for_session("shared") is None
    participant = {"actor_id": "alice", "role": role, "status": "active"}
    rooms = SimpleNamespace(
        get_room_participant=lambda room, actor, tenant: (
            participant
            if room == "shared-room" and actor == "alice" and tenant == "tenant-a"
            else None
        )
    )
    client = _client(stores, authenticated=True, rooms=rooms)
    rows = client.get("/api/assistant/activity", headers=_headers()).json()["items"]
    assert {row["source"] for row in rows} == {"project_task", "collaboration_task", "run"}
    assert all(row["thread_id"] == "shared" and row["room_id"] == "shared-room" for row in rows)
    assert all(row["room_name"] is None for row in rows)
    assert client.get("/api/assistant/activity", headers=_headers("carol")).json()["items"] == []
    participant = None
    assert client.get("/api/assistant/activity", headers=_headers()).json()["items"] == []


def test_missing_room_projection_never_turns_ownerless_management_into_shared_access(stores):
    _thread(stores, "legacy", owner="")
    _room(stores, "legacy", "shared-room", owner="bob")
    stores.groups.append(
        "legacy", MemberEvent(action="room_link", actor="bob", target_id="shared-room")
    )
    _project(stores, "shared-p", owner="bob", thread="legacy")
    _collab_task(stores, "legacy", "shared-room", "shared-task")
    with stores.collaboration._lock, stores.collaboration._connect() as conn:
        conn.execute("DELETE FROM collaboration_rooms WHERE room_id=?", ("shared-room",))
    rooms = SimpleNamespace(get_room_participant=lambda *_args: None)
    client = _client(stores, authenticated=True, rooms=rooms)
    assert client.get("/api/assistant/activity", headers=_headers()).json()["items"] == []


def test_activity_filters_project_tenant_before_reading_binding(stores, monkeypatch):
    _project(stores, "local", owner="alice")
    _project(stores, "foreign", owner="alice", tenant="tenant-b")
    _project(stores, "ownerless", owner="")
    binding_reads = []
    real_binding = stores.projects.thread_for_project

    def thread_for_project(project_id):
        binding_reads.append(project_id)
        return real_binding(project_id)

    monkeypatch.setattr(stores.projects, "thread_for_project", thread_for_project)
    rows = (
        _client(stores, authenticated=True)
        .get("/api/assistant/activity", headers=_headers())
        .json()["items"]
    )
    assert [row["project_id"] for row in rows] == ["local"]
    assert binding_reads == ["local"]
