"""A project keeps the icon and category picked in the 新建项目 dialog."""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from runtime.projectos.appearance import normalize_project_category, normalize_project_icon
from runtime.projectos.model import Project
from runtime.projectos.store import ProjectStore
from tests.test_project_group_creation import _stack


def _create(client, **appearance: object):
    return client.post(
        "/api/projects/group",
        json={
            "name": "Trip planning",
            "goal": "Plan the autumn trip",
            "initialAgents": [{"id": "general", "displayName": "General"}],
            **appearance,
        },
    )


def test_create_project_group_keeps_icon_and_category(tmp_path: Path) -> None:
    client, projects, *_ = _stack(tmp_path)

    response = _create(client, icon="plane", category="travel")

    assert response.status_code == 200, response.json()
    project_id = response.json()["project"]["id"]
    assert response.json()["project"]["icon"] == "plane"
    assert response.json()["project"]["category"] == "travel"

    listed = client.get("/api/projects").json()["projects"]
    assert [(p["id"], p["icon"], p["category"]) for p in listed] == [
        (project_id, "plane", "travel")
    ]
    detail = client.get(f"/api/projects/{project_id}").json()["project"]
    assert (detail["icon"], detail["category"]) == ("plane", "travel")
    portfolio = client.get("/api/projects/portfolio").json()["projects"]
    assert (portfolio[0]["icon"], portfolio[0]["category"]) == ("plane", "travel")

    # A fresh store over the same database (a restart) reads them back.
    reloaded = ProjectStore(base_dir=tmp_path / "projects").get_project(project_id)
    assert reloaded is not None
    assert (reloaded.icon, reloaded.category) == ("plane", "travel")
    assert projects.get_project(project_id).icon == "plane"


def test_plan_endpoint_keeps_icon_and_category(tmp_path: Path) -> None:
    client, *_ = _stack(tmp_path)

    response = client.post(
        "/api/projects",
        json={"name": "Essay", "goal": "Write it", "icon": "pen-line", "category": "writing"},
    )

    assert response.status_code == 200, response.json()
    project = response.json()["project"]
    assert (project["icon"], project["category"]) == ("pen-line", "writing")


def test_project_without_appearance_reports_none(tmp_path: Path) -> None:
    client, *_ = _stack(tmp_path)

    response = _create(client)

    assert response.status_code == 200, response.json()
    project = client.get("/api/projects").json()["projects"][0]
    assert project["icon"] is None
    assert project["category"] is None


@pytest.mark.parametrize(
    "appearance",
    [
        {"icon": "📁"},
        {"icon": "Folder"},
        {"icon": "https://example.com/x.png"},
        {"icon": "a" * 33},
        {"category": "x" * 65},
        {"category": "line\u0000break"},
    ],
)
def test_create_rejects_invalid_appearance(tmp_path: Path, appearance: dict) -> None:
    client, projects, *_ = _stack(tmp_path)

    response = _create(client, **appearance)

    assert response.status_code == 422, response.json()
    assert projects.list_projects() == []


def test_blank_category_is_stored_as_none(tmp_path: Path) -> None:
    client, *_ = _stack(tmp_path)

    response = _create(client, icon="folder", category="   ")

    assert response.status_code == 200, response.json()
    assert response.json()["project"]["category"] is None


def test_rows_written_before_appearance_still_load(tmp_path: Path) -> None:
    store = ProjectStore(base_dir=tmp_path / "projects")
    store.save_project(Project(id="P-old", name="Old", goal="Legacy", status="running"))
    with closing(sqlite3.connect(tmp_path / "projects" / "projectos.db")) as conn, conn:
        legacy_doc = json.loads(conn.execute("SELECT doc FROM projects").fetchone()[0])
        legacy_doc.pop("icon")
        legacy_doc.pop("category")
        conn.execute("UPDATE projects SET doc=?", (json.dumps(legacy_doc),))

    project = ProjectStore(base_dir=tmp_path / "projects").get_project("P-old")

    assert project is not None
    assert (project.name, project.icon, project.category) == ("Old", None, None)


def test_corrupt_stored_appearance_is_dropped_on_read() -> None:
    project = Project.from_dict(
        {"id": "P-x", "name": "X", "icon": "<svg/>", "category": 42},
    )

    assert (project.icon, project.category) == (None, None)


def test_appearance_normalizers() -> None:
    assert normalize_project_icon(" trending-up ") == "trending-up"
    assert normalize_project_icon("notebook_pen2") == "notebook_pen2"
    assert normalize_project_icon("✈️") is None
    assert normalize_project_icon(None) is None
    assert normalize_project_category("  side   project ") == "side project"
    assert normalize_project_category("旅行") == "旅行"
    assert normalize_project_category("") is None
    assert normalize_project_category("tab​join") is None
