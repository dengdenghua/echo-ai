"""Forbid new raw ``fetch(`` calls in the frontend.

Backend requests belong in the typed request layer
(``frontend/src/core/api/request.ts``): it derives paths, params, bodies and
responses from the OpenAPI snapshot and applies auth, CSRF and error handling
in one place. A hand-rolled ``fetch(`${getBackendBaseURL()}/api/...`)`` skips
all of that and drifts from the contract.

The baseline records the current count of direct ``fetch(`` calls per file.
A file may not gain calls, a new file may not have any, and a file whose count
dropped must lower its baseline (``--strict``) so the migration is locked in.

Run::

    python tools/lint/raw_fetch_check.py            # report
    python tools/lint/raw_fetch_check.py --strict
    python tools/lint/raw_fetch_check.py --write-baseline
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ROOT = REPO_ROOT / "frontend/src"
BASELINE = REPO_ROOT / "tools/lint/raw_fetch_baseline.txt"
# core/api/ owns the one sanctioned fetch; openapi-types.ts is generated.
EXCLUDE_PARTS = ("core/api/", "node_modules", "core/api/openapi-types.ts")
TEST_RE = re.compile(r"\.(test|spec)\.[jt]sx?$")
# `fetch(` and `window.fetch(` / `globalThis.fetch(`, but not `untypedApi.fetch(`,
# `refetch(` or other methods that merely end in "fetch".
FETCH_RE = re.compile(r"(?<![\w$.])fetch\s*\(|\b(?:window|globalThis|self)\.fetch\s*\(")


def scan() -> dict[str, int]:
    counts: dict[str, int] = {}
    for path in sorted(ROOT.rglob("*")):
        if path.suffix not in {".ts", ".tsx"} or not path.is_file():
            continue
        rel = path.relative_to(REPO_ROOT).as_posix()
        if TEST_RE.search(rel) or any(part in rel for part in EXCLUDE_PARTS):
            continue
        try:
            found = len(FETCH_RE.findall(path.read_text(encoding="utf-8")))
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
        rows = [f"{rel}\t{n}" for rel, n in sorted(current.items(), key=lambda kv: -kv[1])]
        BASELINE.write_text(
            "# Raw fetch( calls per frontend file, captured by "
            "tools/lint/raw_fetch_check.py\n"
            "# Moved a file onto core/api/request.ts? Lower or delete its line.\n\n"
            + "\n".join(rows)
            + "\n",
            encoding="utf-8",
        )
        print(f"wrote {len(current)} files ({sum(current.values())} calls) to {BASELINE.name}")
        return 0

    baseline = read_baseline()
    grew = {k: (baseline.get(k, 0), v) for k, v in current.items() if v > baseline.get(k, 0)}
    lowered = {k: (v, current.get(k, 0)) for k, v in baseline.items() if current.get(k, 0) < v}
    for rel, (before, after) in sorted(grew.items()):
        print(f"MORE raw fetch calls {before} -> {after}: {rel}")
    for rel, (before, after) in sorted(lowered.items()):
        print(f"FEWER {before} -> {after} (lower its baseline): {rel}")
    print(
        f"{sum(current.values())} raw fetch calls in {len(current)} files · "
        f"{len(grew)} grew · {len(lowered)} lowered"
    )
    return 1 if args.strict and (grew or lowered) else 0


if __name__ == "__main__":
    sys.exit(main())
