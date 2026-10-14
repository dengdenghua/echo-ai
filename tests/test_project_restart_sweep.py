"""A restart marks a running project as interrupted without resuming it."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from runtime.projectos.model import Project
from runtime.projectos.restart_sweep import (
    RESTART_INTERRUPTED_KIND,
    sweep_projects_interrupted_by_restart,
)
from runtime.projectos.store import ProjectStore


def _store(tmp_path: Path) -> ProjectStore:
    return ProjectStore(base_dir=tmp_path / "projectos")


def _saved_project(store: ProjectStore, project_id: str, *, status: str) -> Project:
    project = Project(id=project_id, name=f"项目-{project_id}", goal="长期目标")
    project.status = status  # type: ignore[assignment]
    store.save_project(project)
    return project


def _kinds(store: ProjectStore, project_id: str) -> list[str]:
    return [str(event.get("kind") or "") for event in store.events_for_project(project_id)]


def test_running_project_is_marked_interrupted_and_left_running(tmp_path: Path) -> None:
    store = _store(tmp_path)
    project = _saved_project(store, "P-running", status="running")

    marked = sweep_projects_interrupted_by_restart(store)

    assert [item["project_id"] for item in marked] == [project.id]
    assert RESTART_INTERRUPTED_KIND in _kinds(store, project.id)
    # State must survive untouched: the sweep records a discontinuity, it does
    # not fail the project or rewrite acceptance/authorization state.
    reloaded = store.get_project(project.id)
    assert reloaded is not None
    assert reloaded.status == "running"


def test_sweep_never_resumes_execution(tmp_path: Path, monkeypatch: Any) -> None:
    """Resuming would spend budget and invoke tools on an unapproved restart."""

    store = _store(tmp_path)
    _saved_project(store, "P-no-resume", status="running")

    def fail_if_run(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("the restart sweep must not drive the project engine")

    monkeypatch.setattr("runtime.projectos.engine.ProjectEngine.run", fail_if_run)

    assert sweep_projects_interrupted_by_restart(store)


def test_marker_is_not_duplicated_until_the_project_runs_again(tmp_path: Path) -> None:
    store = _store(tmp_path)
    project = _saved_project(store, "P-repeat", status="running")

    assert sweep_projects_interrupted_by_restart(store)
    assert sweep_projects_interrupted_by_restart(store) == []
    assert _kinds(store, project.id).count(RESTART_INTERRUPTED_KIND) == 1

    # An explicit drive supersedes the marker, so a second interruption is
    # recorded rather than silently swallowed.
    store.append_event(project.id, kind="project.run", payload={})
    assert sweep_projects_interrupted_by_restart(store)
    assert _kinds(store, project.id).count(RESTART_INTERRUPTED_KIND) == 2


def test_an_older_marker_does_not_suppress_a_later_interruption(tmp_path: Path) -> None:
    """Event history is oldest-first, so recency must be read from the tail.

    A project interrupted, driven again, then interrupted a second time has an
    old marker sitting *before* the newer ``project.run``. Scanning forwards
    would find that stale marker first and skip the new interruption entirely.
    """

    store = _store(tmp_path)
    project = _saved_project(store, "P-order", status="running")

    store.append_event(project.id, kind=RESTART_INTERRUPTED_KIND, payload={"resumed": False})
    store.append_event(project.id, kind="project.run", payload={})

    assert [item["project_id"] for item in sweep_projects_interrupted_by_restart(store)] == [
        project.id
    ]
    assert _kinds(store, project.id).count(RESTART_INTERRUPTED_KIND) == 2


def test_projects_that_were_not_running_are_untouched(tmp_path: Path) -> None:
    store = _store(tmp_path)
    for status in ("planning", "blocked", "done", "failed"):
        _saved_project(store, f"P-{status}", status=status)

    assert sweep_projects_interrupted_by_restart(store) == []


def test_unreadable_store_does_not_block_startup() -> None:
    class Broken:
        def list_projects(self) -> list[Any]:
            raise RuntimeError("store unavailable")

        def append_event(self, *_args: Any, **_kwargs: Any) -> dict:
            raise AssertionError("nothing may be written when listing failed")

    assert sweep_projects_interrupted_by_restart(Broken()) == []
    assert sweep_projects_interrupted_by_restart(None) == []
