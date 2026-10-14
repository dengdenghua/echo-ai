"""Creating a project on an install with no planning model says what to do."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.group_store import GroupStore
from runtime.memory.threads import ThreadStateStore
from runtime.projectos.store import ProjectStore
from runtime.sensing.gateway._projects_group_endpoints import _planning_failure_detail
from runtime.sensing.gateway.projects_router import create_projects_router
from runtime.sensing.gateway.team_rooms_router import create_team_rooms_router


class _NoModelRouter:
    """The model router of a fresh install: chat runs elsewhere, nothing here."""

    def call(self, request):  # noqa: ANN001 - router protocol
        raise RuntimeError("no LLM model configured — add one to data/custom_models.json")


def _client(tmp_path: Path) -> tuple[TestClient, ProjectStore]:
    projects = ProjectStore(base_dir=tmp_path / "projects")
    rooms = create_team_rooms_router(state_path=tmp_path / "rooms.json")
    app = FastAPI()
    app.include_router(rooms)
    app.include_router(
        create_projects_router(
            store=projects,
            group_store=GroupStore(base_dir=tmp_path / "cowork"),
            collaboration_store=CollaborationStore(base_dir=tmp_path / "cowork"),
            team_rooms_router=rooms,
            thread_store=ThreadStateStore(
                path=tmp_path / "threads.jsonl",
                index_enabled=False,
                search_enabled=False,
                feedback_enabled=False,
            ),
            model_router=_NoModelRouter(),
        )
    )
    return TestClient(app), projects


def test_missing_planning_model_is_a_503_that_names_the_fix(tmp_path: Path) -> None:
    client, projects = _client(tmp_path)

    response = client.post(
        "/api/projects/group",
        json={"name": "季度增长", "goal": "拆解下季度增长目标", "icon": "trending-up"},
    )

    assert response.status_code == 503
    assert "设置 → 模型" in response.json()["detail"]
    assert projects.list_projects() == []


def test_planning_failure_detail_reads_the_cause_chain() -> None:
    def chained(outer: str, inner: str) -> RuntimeError:
        try:
            try:
                raise RuntimeError(inner)
            except RuntimeError as cause:
                raise RuntimeError(outer) from cause
        except RuntimeError as exc:
            return exc

    no_model = chained(
        "项目规划失败，请检查执行模型后重试；未生成占位里程碑。", "no LLM model configured"
    )
    timeout = chained("项目规划失败，请检查执行模型后重试；未生成占位里程碑。", "timed out")
    other = chained("store not wired", "boom")
    assert "设置 → 模型" in (_planning_failure_detail(no_model) or "")
    assert _planning_failure_detail(timeout) == "项目规划失败，请检查执行模型后重试。"
    assert _planning_failure_detail(other) is None
