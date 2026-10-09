"""Forbid new unversioned SQLite schema handling in runtime/.

Stores declare numbered steps for ``runtime.platform.io.sqlite_schema.migrate``
instead of re-running ``executescript(_SCHEMA)`` (which COMMITs whatever the
caller had open) and sniffing ``PRAGMA table_info`` to decide which
``ALTER TABLE`` to apply (which cannot tell a newer database from an older
one). ``add_column`` / ``has_column`` cover the column probes.

The baseline records the current count of both patterns per file. A file may
not gain any, a new file may not have any, and a file whose count dropped must
lower its baseline (``--strict``) so the migration is locked in.

Run::

    python tools/lint/sqlite_schema_check.py            # report
    python tools/lint/sqlite_schema_check.py --strict
    python tools/lint/sqlite_schema_check.py --write-baseline
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ROOT = REPO_ROOT / "runtime"
BASELINE = REPO_ROOT / "tools/lint/sqlite_schema_baseline.txt"
EXEMPT = {"runtime/platform/io/sqlite_schema.py"}
PATTERN_RE = re.compile(r"""\.executescript\(|PRAGMA\s+table_info""", re.IGNORECASE)


def scan() -> dict[str, int]:
    counts: dict[str, int] = {}
    for path in sorted(ROOT.rglob("*.py")):
        rel = path.relative_to(REPO_ROOT).as_posix()
        if rel in EXEMPT:
            continue
        try:
            found = len(PATTERN_RE.findall(path.read_text(encoding="utf-8")))
        except (OSError, UnicodeDecodeError):
            continue
        if found:
            counts[rel] = found
    return counts


def read_baseline() -> dict[str, int]:
    if not BASELINE.is_file():
        return {}
    entries: dict[str, int] = {}
    for line in BASELINE.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.startswith("#"):
            rel, _, count = line.rpartition("\t")
            entries[rel] = int(count)
    return entries


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--write-baseline", action="store_true")
    args = parser.parse_args(argv)

    current = scan()
    if args.write_baseline:
        rows = [f"{rel}\t{n}" for rel, n in sorted(current.items(), key=lambda kv: (-kv[1], kv[0]))]
        BASELINE.write_text(
            "# Unversioned SQLite schema calls (executescript / PRAGMA table_info) per file,\n"
            "# captured by tools/lint/sqlite_schema_check.py\n"
            "# Moved a store onto sqlite_schema.migrate? Lower or delete its line.\n\n"
            + "\n".join(rows)
            + "\n",
            encoding="utf-8",
            newline="\n",
        )
        print(f"wrote {len(current)} files ({sum(current.values())} calls) to {BASELINE.name}")
        return 0

    baseline = read_baseline()
    grew = {k: (baseline.get(k, 0), v) for k, v in current.items() if v > baseline.get(k, 0)}
    lowered = {k: (v, current.get(k, 0)) for k, v in baseline.items() if current.get(k, 0) < v}
    for rel, (before, after) in sorted(grew.items()):
        print(f"MORE unversioned schema calls {before} -> {after}: {rel}")
    for rel, (before, after) in sorted(lowered.items()):
        print(f"FEWER {before} -> {after} (lower its baseline): {rel}")
    print(
        f"{sum(current.values())} unversioned schema calls in {len(current)} files · "
        f"{len(grew)} grew · {len(lowered)} lowered"
    )
    if grew:
        print("Declare the schema as sqlite_schema.Migration steps instead.")
    return 1 if args.strict and (grew or lowered) else 0


if __name__ == "__main__":
    sys.exit(main())
