"""Pick the test files that belong to one CI shard (``ECHO_TEST_SHARD=i/N``).

The full suite ran as one ~57 minute job. CI now runs it as N parallel shards.
Every shard computes the same placement on its own: files listed in
``shard_durations.json`` go to the least-loaded shard, slowest first; any other
file goes where a hash of its path sends it. A file therefore always lands in
exactly one shard, including files added after the durations were recorded.
"""

from __future__ import annotations

import hashlib
import json
import os
from functools import cache
from pathlib import Path
from typing import NamedTuple

DURATIONS = Path(__file__).with_name("shard_durations.json")
ENV_VAR = "ECHO_TEST_SHARD"


class Shard(NamedTuple):
    index: int  # zero-based
    total: int


def parse_shard(value: str) -> Shard:
    """``"2/4"`` -> ``Shard(index=1, total=4)``."""

    number, sep, total = value.strip().partition("/")
    if not sep or not number.isdigit() or not total.isdigit():
        raise ValueError(f"{ENV_VAR} must look like 2/4, got {value!r}")
    shard = Shard(int(number) - 1, int(total))
    if shard.total < 1 or not 0 <= shard.index < shard.total:
        raise ValueError(f"{ENV_VAR} shard {value!r} is out of range")
    return shard


def selected_shard() -> Shard | None:
    value = os.environ.get(ENV_VAR, "").strip()
    return parse_shard(value) if value else None


@cache
def _placement(total: int) -> dict[str, int]:
    files = json.loads(DURATIONS.read_text(encoding="utf-8"))["files"]
    loads = [0.0] * total
    placement: dict[str, int] = {}
    for path, seconds in sorted(files.items(), key=lambda item: (-item[1], item[0])):
        index = min(range(total), key=lambda shard: (loads[shard], shard))
        placement[path] = index
        loads[index] += seconds
    return placement


def shard_for(path: str, total: int) -> int:
    """Shard index for a repo-relative POSIX path such as ``tests/test_x.py``."""

    placed = _placement(total).get(path)
    if placed is not None:
        return placed
    return int(hashlib.sha256(path.encode("utf-8")).hexdigest(), 16) % total
