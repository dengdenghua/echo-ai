"""CI shard placement (tests/sharding.py) and its duration refresh tool."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from tests import sharding
from tools.shard_durations import durations_from_log

ROOT = Path(__file__).resolve().parents[1]


def _tracked_test_files() -> list[str]:
    listed = subprocess.run(
        ["git", "ls-files", "tests/test_*.py", "tests/**/test_*.py"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    return sorted(set(listed))


@pytest.mark.parametrize(
    ("value", "expected"),
    [("1/4", sharding.Shard(0, 4)), (" 4/4 ", sharding.Shard(3, 4)), ("1/1", sharding.Shard(0, 1))],
)
def test_parse_shard(value: str, expected: sharding.Shard) -> None:
    assert sharding.parse_shard(value) == expected


@pytest.mark.parametrize("value", ["0/4", "5/4", "1/0", "2", "a/4", "1/-4", "1/4/2"])
def test_parse_shard_rejects_malformed_values(value: str) -> None:
    with pytest.raises(ValueError):
        sharding.parse_shard(value)


def test_unset_variable_means_the_whole_suite(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(sharding.ENV_VAR, raising=False)
    assert sharding.selected_shard() is None
    monkeypatch.setenv(sharding.ENV_VAR, "3/4")
    assert sharding.selected_shard() == sharding.Shard(2, 4)


def test_recorded_slow_files_balance_across_four_shards() -> None:
    files = json.loads(sharding.DURATIONS.read_text(encoding="utf-8"))["files"]
    loads = [0.0] * 4
    for path, seconds in files.items():
        loads[sharding.shard_for(path, 4)] += seconds
    mean = sum(loads) / 4
    assert max(loads) - min(loads) <= max(seconds for seconds in files.values())
    assert max(loads) <= mean * 1.1


def test_every_tracked_test_file_runs_in_exactly_one_shard() -> None:
    tracked = _tracked_test_files()
    assert len(tracked) > 1000
    for total in (1, 2, 4, 7):
        counts = [0] * total
        for path in tracked:
            counts[sharding.shard_for(path, total)] += 1
        assert sum(counts) == len(tracked)
        assert all(counts), f"an empty shard with {total} shards: {counts}"


def test_an_unrecorded_file_has_a_stable_hash_placement() -> None:
    path = "tests/test_added_after_the_durations_were_recorded.py"
    assert path not in json.loads(sharding.DURATIONS.read_text(encoding="utf-8"))["files"]
    assert {sharding.shard_for(path, 4) for _ in range(3)} == {sharding.shard_for(path, 4)}


def test_durations_from_log_measures_files_between_progress_lines() -> None:
    prefix = "Lint + Test\tUNKNOWN STEP\t"
    log = [
        f"{prefix}2026-10-16T17:51:50.0000000Z ============ test session starts ============",
        f"{prefix}2026-10-16T17:51:57.0000000Z tests/test_a.py ....        [  1%]",
        f"{prefix}2026-10-16T17:52:07.5000000Z tests/test_b.py ......      [  2%]",
        f"{prefix}2026-10-16T17:52:09.5000000Z ........                    [  3%]",
        f"{prefix}2026-10-16T17:52:10.0000000Z tests/sub/test_c.py .s      [  4%]",
        f"{prefix}2026-10-16T17:52:20.0000000Z runtime/foo.py     120  10  92%",
    ]
    assert durations_from_log(log) == {
        "tests/test_b.py": 12.5,
        "tests/sub/test_c.py": 0.5,
    }
