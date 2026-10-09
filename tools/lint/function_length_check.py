"""Forbid new long functions (≥ a configured line count) in ``runtime/``.

``god_file_check`` counts lines per file, so a file can be split while the
function that made it huge survives intact (``_tool_bridge_loop`` was 2,487
lines in one function). This ratchet works on functions instead:

  * The baseline records every function at or above the threshold, keyed by
    ``path::qualified.name`` (nested defs and methods included).
  * A long function that is not on the baseline fails the check.
  * A baseline function that GREW fails the check.
  * A baseline entry that shrank below the threshold, or disappeared, must be
    removed so the win is locked in (``--strict``).

Run::

    python tools/lint/function_length_check.py            # report
    python tools/lint/function_length_check.py --strict   # exit 1 on regressions or stale baseline
    python tools/lint/function_length_check.py --write-baseline
"""

from __future__ import annotations

import argparse
import ast
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ROOT = REPO_ROOT / "runtime"
BASELINE = REPO_ROOT / "tools/lint/function_length_baseline.txt"
THRESHOLD = 200
EXCLUDE_PARTS = ("__pycache__", "all_skills", "agent_market_sources")


def _functions(path: Path) -> list[tuple[str, int]]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, SyntaxError, UnicodeDecodeError):
        return []
    rel = path.relative_to(REPO_ROOT).as_posix()
    found: list[tuple[str, int]] = []
    seen: dict[str, int] = {}

    def visit(node: ast.AST, scope: tuple[str, ...]) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                name = ".".join((*scope, child.name))
                if not isinstance(child, ast.ClassDef):
                    # Conditional redefinitions share a name; number the repeats.
                    seen[name] = seen.get(name, 0) + 1
                    key = name if seen[name] == 1 else f"{name}#{seen[name]}"
                    length = (child.end_lineno or child.lineno) - child.lineno + 1
                    found.append((f"{rel}::{key}", length))
                visit(child, (*scope, child.name))
            else:
                visit(child, scope)

    visit(tree, ())
    return found


def scan() -> dict[str, int]:
    long_functions: dict[str, int] = {}
    for path in sorted(ROOT.rglob("*.py")):
        if any(part in path.as_posix() for part in EXCLUDE_PARTS):
            continue
        for key, length in _functions(path):
            if length >= THRESHOLD:
                long_functions[key] = length
    return long_functions


def read_baseline() -> dict[str, int]:
    if not BASELINE.is_file():
        return {}
    entries: dict[str, int] = {}
    for line in BASELINE.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        key, _, count = line.rpartition("\t")
        entries[key] = int(count)
    return entries


def write_baseline(current: dict[str, int]) -> None:
    header = [
        f"# Functions >={THRESHOLD} lines in runtime/, captured by tools/lint/function_length_check.py",
        "# Shortening or splitting one? Remove (or lower) its line so the win is locked in.",
        "",
    ]
    rows = [f"{key}\t{length}" for key, length in sorted(current.items(), key=lambda kv: -kv[1])]
    BASELINE.write_text("\n".join(header + rows) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--write-baseline", action="store_true")
    args = parser.parse_args(argv)

    current = scan()
    if args.write_baseline:
        write_baseline(current)
        print(f"wrote {len(current)} functions >={THRESHOLD} lines to {BASELINE.name}")
        return 0

    baseline = read_baseline()
    new = {k: v for k, v in current.items() if k not in baseline}
    grown = {k: (baseline[k], v) for k, v in current.items() if k in baseline and v > baseline[k]}
    stale = {k: baseline[k] for k in baseline if k not in current}
    shrunk = {
        k: (baseline[k], current[k]) for k in baseline if k in current and current[k] < baseline[k]
    }

    for key, length in sorted(new.items(), key=lambda kv: -kv[1]):
        print(f"NEW long function ({length} lines >= {THRESHOLD}): {key}")
    for key, (before, after) in sorted(grown.items()):
        print(f"GREW {before} -> {after} lines: {key}")
    for key, length in sorted(stale.items()):
        print(f"STALE baseline (now < {THRESHOLD} lines or gone, was {length}): {key}")
    for key, (before, after) in sorted(shrunk.items()):
        print(f"SHRANK {before} -> {after} lines (lower its baseline): {key}")
    print(
        f"{len(current)} functions >={THRESHOLD} lines · {len(new)} new · {len(grown)} grew · "
        f"{len(stale)} stale · {len(shrunk)} shrank"
    )
    if args.strict and (new or grown or stale or shrunk):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
