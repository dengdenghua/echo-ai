"""Run every Python gate ``ci.yml`` runs, from one local command.

Why this exists
---------------
``make lint`` used to run five groups (invariants, fixtures, untracked sources,
mypy, ruff) while the ``lint-and-test`` CI job ran roughly thirty separate
steps. A contributor could therefore be green locally and red in CI on a gate
they never invoked — exactly the mismatch that let twelve machine-local tests
survive undetected in the 2026-08 audit.

``tools/lint/run_gates.py`` already covers the thirteen "mechanical" gates and
is the source of truth for those (``mech-gates.yml`` calls it). This runner
composes that list with the remaining CI steps so the two sets cannot drift:

    python tools/lint/run_ci_gates.py              # everything CI runs
    python tools/lint/run_ci_gates.py --only ruff_format,exception_audit
    python tools/lint/run_ci_gates.py --skip mypy_ratchet  # slow ones
    python tools/lint/run_ci_gates.py --json report.json

Frontend gates (eslint / tsc / vitest) live in the separate ``frontend`` CI job
and are not covered here; run them from ``frontend/`` or ``make frontend-*``.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from tools.lint.run_gates import GATES, REPO_ROOT, Gate, render_table, run_one

PY = sys.executable or "python"

# Steps from .github/workflows/ci.yml's `lint-and-test` job that run_gates.py
# does not already carry. Keep this list in the same order as the workflow so a
# local failure reads like the CI failure above it.
EXTRA_GATES: tuple[Gate, ...] = (
    Gate(
        "invariant_check",
        (PY, "-m", "tools.lint.invariant_check", "runtime/", "tests/"),
    ),
    Gate("fixture_visibility_check", (PY, "-m", "tools.lint.fixture_visibility_check")),
    Gate("skill_dedup_check", (PY, "tools/lint/skill_dedup_check.py", "--strict")),
    Gate("skill_cross_dir_check", (PY, "tools/lint/skill_cross_dir_check.py", "--strict")),
    Gate("protocol_method_drift", (PY, "tools/lint/protocol_method_drift.py", "--strict")),
    Gate("exception_audit", (PY, "tools/lint/exception_audit.py", "--strict")),
    Gate(
        "desktop_core_sync_check",
        (PY, "tools/lint/desktop_core_sync_check.py", "--strict"),
    ),
    Gate("count_tests", (PY, "tools/lint/count_tests.py", "--check")),
    Gate("doc_claims_check", (PY, "tools/lint/doc_claims_check.py", "--strict")),
    Gate("auth_actor_check", (PY, "tools/lint/auth_actor_check.py", "--strict")),
    Gate("hardcoded_path_check", (PY, "tools/lint/hardcoded_path_check.py", "--strict")),
    # mypy is the slowest gate by an order of magnitude; keep it last so a fast
    # failure never waits behind it.
    Gate("mypy_ratchet", (PY, "tools/lint/mypy_ratchet.py")),
    Gate("ruff_check", (PY, "-m", "ruff", "check", "runtime/", "tests/", "tools/")),
    Gate(
        "ruff_format",
        (PY, "-m", "ruff", "format", "--check", "runtime/", "tests/", "tools/"),
    ),
)

ALL_GATES: tuple[Gate, ...] = GATES + EXTRA_GATES


def _select(only: str | None, skip: str | None) -> tuple[Gate, ...]:
    known = {gate.name for gate in ALL_GATES}
    selected = ALL_GATES
    if only:
        names = {name.strip() for name in only.split(",") if name.strip()}
        unknown = names - known
        if unknown:
            raise SystemExit(f"unknown gate(s): {', '.join(sorted(unknown))}")
        selected = tuple(gate for gate in selected if gate.name in names)
    if skip:
        names = {name.strip() for name in skip.split(",") if name.strip()}
        unknown = names - known
        if unknown:
            raise SystemExit(f"unknown gate(s): {', '.join(sorted(unknown))}")
        selected = tuple(gate for gate in selected if gate.name not in names)
    if not selected:
        raise SystemExit("no gates selected")
    return selected


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--only", default=None, help="comma-separated gate names")
    parser.add_argument("--skip", default=None, help="comma-separated gate names")
    parser.add_argument("--timeout", type=float, default=900.0, help="per-gate timeout")
    parser.add_argument("--json", default=None, help="write a JSON report here")
    args = parser.parse_args(argv)

    gates = _select(args.only, args.skip)
    results = [run_one(gate, args.timeout, REPO_ROOT) for gate in gates]

    print(render_table(results))
    failed = [r for r in results if r.exit_code != 0]
    if failed:
        for result in failed:
            print(f"\n--- {result.name} (exit {result.exit_code}) ---")
            print(result.output_tail)

    if args.json:
        Path(args.json).write_text(
            json.dumps(
                {
                    "gates": [
                        {
                            "name": r.name,
                            "exit_code": r.exit_code,
                            "passed": r.exit_code == 0,
                            "duration_s": r.duration_s,
                            "output_tail": r.output_tail,
                        }
                        for r in results
                    ],
                    "all_passed": not failed,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        print(f"wrote JSON report to {args.json}")

    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
