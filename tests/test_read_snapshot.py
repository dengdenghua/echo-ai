from __future__ import annotations

from runtime.platform.io import forget_snapshot_read, read_snapshot, snapshot_read


def test_snapshot_reads_once_per_key_only_inside_the_outermost_scope() -> None:
    reads: list[str] = []

    def read(key: str) -> list[str]:
        reads.append(key)
        return [key]

    outside = [snapshot_read("a", lambda: read("a")) for _ in range(2)]
    with read_snapshot():
        first = snapshot_read("a", lambda: read("a"))
        with read_snapshot():
            nested = snapshot_read("a", lambda: read("a"))
        snapshot_read("b", lambda: read("b"))
        again = snapshot_read("a", lambda: read("a"))
    after = snapshot_read("a", lambda: read("a"))

    assert outside == [["a"], ["a"]]
    assert first is nested is again
    assert after == ["a"]
    assert reads == ["a", "a", "a", "b", "a"]


def test_forget_makes_the_next_read_in_scope_hit_the_source() -> None:
    values = iter([1, 2])

    with read_snapshot():
        first = snapshot_read("grants", lambda: next(values))
        forget_snapshot_read("grants")
        second = snapshot_read("grants", lambda: next(values))
    forget_snapshot_read("grants")  # outside a scope: no-op

    assert (first, second) == (1, 2)
