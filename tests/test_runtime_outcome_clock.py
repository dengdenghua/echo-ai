from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from runtime.safety.evolution import runtime_outcomes
from tests.test_runtime_outcome_inbox import _registered_candidate, _sample_count


def _entry(path: Path) -> dict:
    entries = json.loads(path.read_text(encoding="utf-8"))["entries"]
    assert len(entries) == 1
    return next(iter(entries.values()))


def test_clock_rollback_preserves_activation_and_ungradable_settlement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    inbox = tmp_path / "outcomes.json"
    clock = [100.0]
    monkeypatch.setattr(runtime_outcomes, "time", SimpleNamespace(time=lambda: clock[0]))
    assert runtime_outcomes.record_runtime_candidate_activation(
        "candidate-one", turn_id="rollback-turn", inbox_path=inbox
    )
    clock[0] = 90.0
    assert runtime_outcomes.record_runtime_candidate_activation(
        "candidate-two", turn_id="rollback-turn", inbox_path=inbox
    )
    assert _entry(inbox)["updated_at"] == 100.0
    clock[0] = 80.0
    runtime_outcomes.settle_runtime_candidate_outcomes(
        "rollback-turn", success=None, inbox_path=inbox
    )
    entry = _entry(inbox)
    assert entry["created_at"] == entry["updated_at"] == 100.0
    assert entry["outcome"] == "ungradable"
    assert entry["candidate_ids"] == []


def test_clock_rollback_settles_and_acknowledges_exactly_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    registry, state_dir, candidate_id = _registered_candidate(tmp_path)
    inbox = tmp_path / "outcomes.json"
    ticks = iter([100.0, 90.0, 80.0])
    monkeypatch.setattr(runtime_outcomes, "time", SimpleNamespace(time=lambda: next(ticks, 70.0)))
    assert runtime_outcomes.record_runtime_candidate_activation(
        candidate_id, turn_id="settlement-rollback", inbox_path=inbox
    )
    result = runtime_outcomes.settle_runtime_candidate_outcomes(
        "settlement-rollback",
        success=True,
        registry=registry,
        state_dir=state_dir,
        inbox_path=inbox,
    )
    assert result[0]["recorded"] is True
    entry = _entry(inbox)
    assert entry["created_at"] == entry["updated_at"] == 100.0
    assert entry["outcome"] is True
    assert entry["candidate_ids"] == []
    runtime_outcomes.settle_runtime_candidate_outcomes(
        "settlement-rollback",
        success=True,
        registry=registry,
        state_dir=state_dir,
        inbox_path=inbox,
    )
    assert _sample_count(registry, state_dir, candidate_id) == 1


def test_timestamp_is_sampled_after_transaction_lock(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    inbox = tmp_path / "outcomes.json"
    clock = [100.0]
    monkeypatch.setattr(runtime_outcomes, "time", SimpleNamespace(time=lambda: clock[0]))
    real_mutate = runtime_outcomes.mutate_json_file

    def delayed_transaction(*args, **kwargs):
        clock[0] = 200.0
        return real_mutate(*args, **kwargs)

    monkeypatch.setattr(runtime_outcomes, "mutate_json_file", delayed_transaction)
    assert runtime_outcomes.record_runtime_candidate_activation(
        "candidate-after-lock", turn_id="delayed-lock", inbox_path=inbox
    )
    assert _entry(inbox)["created_at"] == 200.0
