"""Standing authorization is bounded, revocable and fail-closed."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from runtime.projectos.governance import phase_fingerprint
from runtime.projectos.model import Milestone, Project
from runtime.projectos.standing_authorization import (
    GRANTED_KIND,
    UI_CONFIRMATION_SOURCE,
    active_grant,
    admits_unattended_phase,
    grant_standing_authorization,
    revoke_standing_authorization,
)
from runtime.projectos.store import ProjectStore


def _store(tmp_path: Path) -> ProjectStore:
    return ProjectStore(base_dir=tmp_path / "projectos")


def _project(store: ProjectStore, project_id: str = "P-standing") -> Project:
    project = Project(id=project_id, name="长期项目", goal="跑几个月")
    project.status = "running"  # type: ignore[assignment]
    store.save_project(project)
    return project


def _milestone(milestone_id: str = "M1", *, goal: str = "第一阶段") -> Milestone:
    # ``phase_authorized`` only gates phases that declare members, and
    # ``phase_fingerprint`` folds the spec in — declare one so the fingerprint
    # is sensitive to the same fields the real authorization flow depends on.
    return Milestone(
        id=milestone_id,
        name=f"阶段-{milestone_id}",
        goal=goal,
        spec={"phase_agents": ["general"], "ai_budget_usd": 50.0},
    )


def test_no_grant_denies_unattended_execution(tmp_path: Path) -> None:
    store = _store(tmp_path)
    _project(store)

    decision = admits_unattended_phase(store, "P-standing", _milestone())

    assert decision.denied
    assert decision.reason == "no_standing_authorization"


def test_granted_phase_is_admitted_with_remaining_budget(tmp_path: Path) -> None:
    store = _store(tmp_path)
    _project(store)
    ms = _milestone()
    grant_standing_authorization(
        store,
        "P-standing",
        milestones=[ms],
        limit_usd=20.0,
        granted_by="owner",
    )

    decision = admits_unattended_phase(store, "P-standing", ms)

    assert decision.admitted
    assert decision.reason == "standing_authorization_active"
    # Nothing has been spent yet, so the whole ceiling is available.
    assert decision.remaining_usd == pytest.approx(20.0)


def test_rewriting_a_phase_drops_it_out_of_scope(tmp_path: Path) -> None:
    """The grant names fingerprints, so an edited plan is no longer covered."""

    store = _store(tmp_path)
    _project(store)
    ms = _milestone()
    grant_standing_authorization(
        store,
        "P-standing",
        milestones=[ms],
        limit_usd=20.0,
        granted_by="owner",
    )

    rewritten = _milestone(goal="换了目标")
    assert phase_fingerprint(rewritten) != phase_fingerprint(ms)

    decision = admits_unattended_phase(store, "P-standing", rewritten)
    assert decision.denied
    assert decision.reason == "phase_outside_standing_scope"


def test_a_phase_never_named_is_not_covered(tmp_path: Path) -> None:
    store = _store(tmp_path)
    _project(store)
    grant_standing_authorization(
        store,
        "P-standing",
        milestones=[_milestone("M1")],
        limit_usd=20.0,
        granted_by="owner",
    )

    decision = admits_unattended_phase(store, "P-standing", _milestone("M2"))
    assert decision.denied
    assert decision.reason == "phase_outside_standing_scope"


def test_revocation_beats_the_grant_and_regranting_works(tmp_path: Path) -> None:
    store = _store(tmp_path)
    _project(store)
    ms = _milestone()
    grant_standing_authorization(
        store,
        "P-standing",
        milestones=[ms],
        limit_usd=20.0,
        granted_by="owner",
    )
    revoke_standing_authorization(store, "P-standing", revoked_by="owner", reason="出差回来再说")

    assert active_grant(store, "P-standing") is None
    assert admits_unattended_phase(store, "P-standing", ms).denied

    grant_standing_authorization(
        store,
        "P-standing",
        milestones=[ms],
        limit_usd=5.0,
        granted_by="owner",
    )
    regranted = active_grant(store, "P-standing")
    assert regranted is not None
    assert regranted.limit_usd == pytest.approx(5.0)
    assert admits_unattended_phase(store, "P-standing", ms).admitted


def test_a_grant_that_did_not_come_from_a_human_is_refused(tmp_path: Path) -> None:
    """A replayed payload must not stand in for an explicit confirmation."""

    store = _store(tmp_path)
    _project(store)
    ms = _milestone()
    # Written straight to the event log, bypassing the writer's source check —
    # what a script or API replay would produce.
    store.append_event(
        "P-standing",
        kind=GRANTED_KIND,
        payload={
            "phase_fingerprints": [phase_fingerprint(ms)],
            "limit_usd": 20.0,
            "granted_by": "script",
            "source": "api_replay",
        },
    )

    decision = admits_unattended_phase(store, "P-standing", ms)
    assert decision.denied
    assert decision.reason == "grant_not_human_confirmed"


def test_the_writer_refuses_a_non_human_source_and_an_empty_scope(tmp_path: Path) -> None:
    store = _store(tmp_path)
    _project(store)

    with pytest.raises(ValueError):
        grant_standing_authorization(
            store,
            "P-standing",
            milestones=[_milestone()],
            limit_usd=20.0,
            granted_by="script",
            source="api_replay",
        )
    with pytest.raises(ValueError):
        grant_standing_authorization(
            store,
            "P-standing",
            milestones=[],
            limit_usd=20.0,
            granted_by="owner",
        )
    for bad_limit in (0.0, -1.0, None, "twenty"):
        with pytest.raises(ValueError):
            grant_standing_authorization(
                store,
                "P-standing",
                milestones=[_milestone()],
                limit_usd=bad_limit,  # type: ignore[arg-type]
                granted_by="owner",
            )


def test_a_malformed_grant_denies_instead_of_defaulting_open(tmp_path: Path) -> None:
    store = _store(tmp_path)
    _project(store)
    ms = _milestone()
    store.append_event(
        "P-standing",
        kind=GRANTED_KIND,
        payload={"limit_usd": 20.0, "source": UI_CONFIRMATION_SOURCE},
    )

    assert active_grant(store, "P-standing") is None
    assert admits_unattended_phase(store, "P-standing", ms).denied


def test_unreadable_cost_denies_rather_than_spending_more(tmp_path: Path, monkeypatch: Any) -> None:
    store = _store(tmp_path)
    _project(store)
    ms = _milestone()
    grant_standing_authorization(
        store,
        "P-standing",
        milestones=[ms],
        limit_usd=20.0,
        granted_by="owner",
    )

    def unreadable(*_args: Any, **_kwargs: Any) -> float:
        raise RuntimeError("usage table unavailable")

    monkeypatch.setattr("runtime.projectos.governance.reported_cost", unreadable)

    decision = admits_unattended_phase(store, "P-standing", ms)
    assert decision.denied
    assert decision.reason == "reported_cost_unavailable"


def test_an_exhausted_ceiling_stops_unattended_work(tmp_path: Path, monkeypatch: Any) -> None:
    store = _store(tmp_path)
    _project(store)
    ms = _milestone()
    grant_standing_authorization(
        store,
        "P-standing",
        milestones=[ms],
        limit_usd=20.0,
        granted_by="owner",
    )

    monkeypatch.setattr(
        "runtime.projectos.governance.reported_cost",
        lambda *_args, **_kwargs: 20.0,
    )

    decision = admits_unattended_phase(store, "P-standing", ms)
    assert decision.denied
    assert decision.reason == "standing_budget_exhausted"
    assert decision.remaining_usd == pytest.approx(0.0)


def test_a_grant_never_approves_the_human_gates(tmp_path: Path) -> None:
    """Unattended progress inside authorized phases — not approval authority."""

    store = _store(tmp_path)
    _project(store)
    event = grant_standing_authorization(
        store,
        "P-standing",
        milestones=[_milestone()],
        limit_usd=20.0,
        granted_by="owner",
    )

    payload = event["payload"]
    assert payload["approves_initiation"] is False
    assert payload["approves_new_phases"] is False
    assert payload["approves_owner_acceptance"] is False
