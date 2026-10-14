"""Unbounded or unreadable numeric values must not permit unattended work."""

from pathlib import Path

import pytest

from runtime.projectos.governance import phase_fingerprint
from runtime.projectos.model import Milestone, Project
from runtime.projectos.standing_authorization import (
    GRANTED_KIND,
    UI_CONFIRMATION_SOURCE,
    active_grant,
    admits_unattended_phase,
    grant_standing_authorization,
)
from runtime.projectos.store import ProjectStore


def fixture_project(root):
    store = ProjectStore(base_dir=root / "projects")
    store.save_project(Project(id="numeric-bounds", name="bounded project", goal="test"))
    phase = Milestone(id="phase", name="phase", goal="test", spec={"phase_agents": ["general"]})
    return store, phase


@pytest.mark.parametrize("ceiling", [float("inf"), float("-inf"), float("nan"), "Infinity", "NaN"])
def test_nonfinite_ceiling_never_records_a_grant(tmp_path: Path, ceiling):
    store, phase = fixture_project(tmp_path)
    with pytest.raises(ValueError):
        grant_standing_authorization(
            store, "numeric-bounds", milestones=[phase], limit_usd=ceiling, granted_by="owner"
        )
    assert not any(
        event["kind"] == GRANTED_KIND for event in store.events_for_project("numeric-bounds")
    )
    assert active_grant(store, "numeric-bounds") is None


@pytest.mark.parametrize("ceiling", ["Infinity", "-Infinity", "NaN"])
def test_corrupted_persisted_ceiling_denies_admission(tmp_path: Path, ceiling):
    store, phase = fixture_project(tmp_path)
    store.append_event(
        "numeric-bounds",
        kind=GRANTED_KIND,
        payload={
            "phase_fingerprints": [phase_fingerprint(phase)],
            "limit_usd": ceiling,
            "granted_by": "owner",
            "source": UI_CONFIRMATION_SOURCE,
        },
    )
    assert active_grant(store, "numeric-bounds") is None
    assert admits_unattended_phase(store, "numeric-bounds", phase).denied


@pytest.mark.parametrize("spent", [float("inf"), float("-inf"), float("nan"), -0.01])
def test_invalid_reported_cost_never_reopens_budget(tmp_path: Path, monkeypatch, spent):
    store, phase = fixture_project(tmp_path)
    grant_standing_authorization(
        store, "numeric-bounds", milestones=[phase], limit_usd=20, granted_by="owner"
    )
    monkeypatch.setattr("runtime.projectos.governance.reported_cost", lambda *_args: spent)
    decision = admits_unattended_phase(store, "numeric-bounds", phase)
    assert decision.denied
    assert decision.reason == "reported_cost_unavailable"
    assert decision.remaining_usd is None
