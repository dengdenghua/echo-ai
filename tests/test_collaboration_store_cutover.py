from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.group_store import GroupStore
from runtime.memory.cowork.service import invite_member
from runtime.projectos.store import ProjectStore
from runtime.sensing.gateway.projects_router import create_projects_router
from runtime.sensing.gateway.team_tasks_router import create_team_tasks_router
from tests.project_governance_utils import run_governed_to_done


def test_linking_room_with_owned_task_preserves_task_in_new_session(tmp_path):
    from runtime.sensing.gateway.cowork_group_router import create_cowork_group_router
    from runtime.sensing.gateway.team_rooms_router import create_team_rooms_router

    collaboration = CollaborationStore(tmp_path / "cowork")
    groups = GroupStore(tmp_path / "groups")
    rooms = create_team_rooms_router(
        state_path=tmp_path / "rooms.json", room_projection=collaboration.upsert_room_by_id
    )
    tasks = create_team_tasks_router(
        state_path=tmp_path / "tasks.json", collaboration_store=collaboration
    )
    app = FastAPI()
    app.include_router(rooms)
    app.include_router(tasks)
    app.include_router(
        create_cowork_group_router(
            store=groups,
            collaboration_store=collaboration,
            team_rooms_router=rooms,
            team_tasks_router=tasks,
            team_rooms_state_path=tmp_path / "rooms.json",
        )
    )
    client = TestClient(app)
    assert (
        client.post(
            "/api/teams",
            json={"id": "room-old", "name": "Existing", "members": [{"name": "alice"}]},
        ).status_code
        == 200
    )
    task = client.post("/api/team-tasks", json={"room_id": "room-old", "title": "Preserve me"})
    assert task.status_code == 200
    assert (
        client.post(
            "/api/cowork/thread-new/members", json={"target_id": "alice", "kind": "agent"}
        ).status_code
        == 200
    )
    linked = client.post("/api/collab/thread-new/link-room", json={"room_id": "room-old"})
    assert linked.status_code == 200, linked.json()
    current = client.get(f"/api/team-tasks/{task.json()['id']}")
    assert current.status_code == 200 and current.json()["title"] == "Preserve me"
    assert current.json()["metadata"]["collab_session_id"] == "thread-new"
    assert collaboration.tasks_for_session("thread-new")[0]["id"] == task.json()["id"]


def test_projectos_tasks_project_into_collaboration_store(tmp_path) -> None:
    project_store = ProjectStore(base_dir=tmp_path / "projectos")
    collaboration_store = CollaborationStore(base_dir=tmp_path / "cowork")
    groups = GroupStore(base_dir=tmp_path / "groups")
    app = FastAPI()
    app.include_router(
        create_projects_router(
            store=project_store,
            group_store=groups,
            collaboration_store=collaboration_store,
        )
    )
    client = TestClient(app)

    planned = client.post(
        "/api/projects",
        json={"name": "Cutover", "goal": "Build a small audit report"},
    )
    assert planned.status_code == 200
    project_id = planned.json()["project"]["id"]

    invite_member(groups, "thread-cutover", actor="u", target_id="coder", kind="agent")
    project_store.bind_thread("thread-cutover", project_id)
    run_governed_to_done(client, project_id, max_ticks=5)

    tasks = collaboration_store.project_tasks_for_project(project_id)
    assert tasks
    assert {task["kind"] for task in tasks} == {"project"}
    assert {task["project_id"] for task in tasks} == {project_id}
    assert all(task["milestone_id"] for task in tasks)
    assert all(task["metadata"]["source"] == "projectos" for task in tasks)


def test_collaboration_store_preserves_team_task_kind_and_artifacts(tmp_path) -> None:
    store = CollaborationStore(base_dir=tmp_path)
    store.upsert_room("thread-1", {"id": "room-1", "name": "Room"})

    task = store.upsert_task(
        "thread-1",
        {
            "id": "task-1",
            "room_id": "room-1",
            "kind": "team",
            "title": "Do work",
            "status": "blocked",
            "produced_artifacts": [{"kind": "markdown", "path": "report.md"}],
            "lease": {"holder": "agent-a", "expires_at": 123},
        },
    )

    assert task["kind"] == "team"
    assert task["status"] == "blocked"
    assert task["artifacts"] == [{"kind": "markdown", "path": "report.md"}]
    assert task["lease"]["holder"] == "agent-a"


def test_team_tasks_project_into_collaboration_store(tmp_path) -> None:
    collaboration_store = CollaborationStore(base_dir=tmp_path / "cowork")
    collaboration_store.upsert_room("thread-team-alpha", {"id": "team-alpha", "name": "Team Alpha"})

    app = FastAPI()
    app.include_router(
        create_team_tasks_router(
            state_path=tmp_path / "team_tasks.json",
            collaboration_store=collaboration_store,
        ),
    )
    client = TestClient(app)

    created = client.post(
        "/api/team-tasks",
        json={
            "room_id": "team-alpha",
            "title": "Write launch brief",
            "description": "Prepare a concise brief",
            "assignees": [{"kind": "agent", "ref": "writer"}],
        },
    )
    assert created.status_code == 200
    task_id = created.json()["id"]

    tasks = collaboration_store.tasks_for_room("team-alpha")
    assert len(tasks) == 1
    assert tasks[0]["id"] == task_id
    assert tasks[0]["kind"] == "team"
    assert tasks[0]["title"] == "Write launch brief"

    patched = client.patch(
        f"/api/team-tasks/{task_id}",
        json={"status": "done", "title": "Launch brief ready"},
    )
    assert patched.status_code == 200
    projected = collaboration_store.tasks_for_room("team-alpha")[0]
    assert projected["status"] == "done"
    assert projected["title"] == "Launch brief ready"

    deleted = client.delete(f"/api/team-tasks/{task_id}")
    assert deleted.status_code == 200
    assert collaboration_store.tasks_for_room("team-alpha") == []
