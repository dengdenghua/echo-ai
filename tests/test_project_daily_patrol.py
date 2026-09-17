"""The daily sweep is read-only, and only speaks when something needs the owner."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from runtime.projectos.daily_patrol import (
    assess_project,
    render_digest,
    run_patrol,
)
from runtime.projectos.model import Project
from runtime.projectos.store import ProjectStore


def _report(**overrides: Any) -> dict[str, Any]:
    report: dict[str, Any] = {
        "project_id": "P-1",
        "name": "长期项目",
        "status": "running",
        "overall_progress": 0.5,
        "awaiting_acceptance_count": 0,
        "milestones": [],
        "risks": [],
        "blockers": [],
        "overdue": [],
        "next_actions": [],
    }
    report.update(overrides)
    return report


def _phase(name: str, health: str) -> dict[str, Any]:
    return {"id": name, "name": name, "health": health}


def test_a_healthy_project_needs_no_attention() -> None:
    attention = assess_project(_report(milestones=[_phase("阶段一", "on_track")]))

    assert not attention.needs_attention
    assert attention.reasons == ()


def test_a_blocked_phase_needs_attention() -> None:
    attention = assess_project(_report(milestones=[_phase("阶段一", "blocked")]))

    assert attention.needs_attention
    assert attention.blocked_phases == ("阶段一",)
    assert any("阻塞" in reason for reason in attention.reasons)


def test_an_overdue_phase_needs_attention() -> None:
    attention = assess_project(_report(milestones=[_phase("阶段二", "overdue")]))

    assert attention.needs_attention
    assert attention.overdue_phases == ("阶段二",)


def test_at_risk_alone_is_reported_but_not_urgent() -> None:
    """A forecast is not an alarm; daily false alarms train people to ignore."""

    attention = assess_project(_report(milestones=[_phase("阶段三", "at_risk")]))

    assert not attention.needs_attention
    assert attention.at_risk_phases == ("阶段三",)


def test_delivery_awaiting_the_owner_needs_attention() -> None:
    """By definition it cannot progress without them."""

    attention = assess_project(_report(awaiting_acceptance_count=2))

    assert attention.needs_attention
    assert attention.awaiting_acceptance == 2
    assert any("验收" in reason for reason in attention.reasons)


def test_overdue_tasks_count_even_when_the_phase_looks_fine() -> None:
    attention = assess_project(
        _report(
            milestones=[_phase("阶段一", "on_track")],
            overdue=[{"task": "T1"}, {"task": "T2"}],
        )
    )

    assert attention.needs_attention
    assert any("任务逾期" in reason for reason in attention.reasons)


def test_a_restart_interruption_needs_attention() -> None:
    attention = assess_project(_report(), interrupted_by_restart=True)

    assert attention.needs_attention
    assert attention.interrupted_by_restart
    assert any("重启" in reason for reason in attention.reasons)


def test_a_malformed_report_does_not_crash_the_sweep() -> None:
    attention = assess_project(
        _report(
            overall_progress="不是数字",
            awaiting_acceptance_count="也不是",
            milestones="不是列表",
            overdue="也不是列表",
        )
    )

    assert not attention.needs_attention
    assert attention.progress == 0.0


def test_a_quiet_sweep_sends_nothing() -> None:
    from runtime.projectos.daily_patrol import PatrolDigest

    assert render_digest(PatrolDigest(scanned=3)) is None


def test_the_digest_names_what_needs_doing_and_states_its_limit() -> None:
    from runtime.projectos.daily_patrol import PatrolDigest

    digest = PatrolDigest(
        scanned=1,
        attention=[assess_project(_report(milestones=[_phase("阶段一", "blocked")]))],
    )

    body = render_digest(digest)

    assert body is not None
    assert "长期项目" in body
    assert "阶段一" in body
    # The digest must not be mistaken for an acceptance signal.
    assert "不代表交付质量已通过验收" in body


def test_the_sweep_only_reads_and_skips_finished_projects(tmp_path: Path) -> None:
    store = ProjectStore(base_dir=tmp_path / "projectos")
    for project_id, status in (
        ("P-running", "running"),
        ("P-blocked", "blocked"),
        ("P-done", "done"),
        ("P-planning", "planning"),
    ):
        project = Project(id=project_id, name=project_id, goal="目标")
        project.status = status  # type: ignore[assignment]
        store.save_project(project)

    digest = run_patrol(store)

    # Only running/blocked projects are worth chasing.
    assert digest.scanned == 2


def test_an_unreadable_project_is_counted_not_fatal(
    tmp_path: Path, monkeypatch: Any
) -> None:
    store = ProjectStore(base_dir=tmp_path / "projectos")
    project = Project(id="P-bad", name="坏项目", goal="目标")
    project.status = "running"  # type: ignore[assignment]
    store.save_project(project)

    def boom(*_args: Any, **_kwargs: Any) -> dict:
        raise RuntimeError("milestones unreadable")

    # ``run_patrol`` imports this inside the function, so patching the module
    # attribute takes effect on the next call.
    monkeypatch.setattr("runtime.projectos.pm.build_pm_report", boom)

    digest = run_patrol(store)

    assert digest.scanned == 1
    assert digest.unreadable == 1
    assert digest.quiet


def test_an_unusable_store_returns_an_empty_digest() -> None:
    class Broken:
        def list_projects(self) -> list[Any]:
            raise RuntimeError("store unavailable")

    assert run_patrol(Broken()).scanned == 0
    assert run_patrol(object()).scanned == 0
