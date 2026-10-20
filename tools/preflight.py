"""Preflight: everything CI runs that a local commit can break, in one command.

Why this exists
---------------
Two audits found the same failure mode twice.  2026-08-28: 26 ``runtime/``
modules were never ``git add``-ed, nine of them imported by tracked code, so
CI's clean checkout failed while the author's machine ran green.  2026-10-20:
the tree gates caught god files and line counts, but nothing checked that the
test suite could still *import* what it imports — a god-file split left the
whole backend suite uncollectable (one ImportError aborts collection for all
18,779 tests) — nor that the type ratchet held, nor that a frontend permission
mode added to a menu still matched a test counting three options.  Six red
signals reached commits that way.  None were hard to fix; all were invisible.

Every step below runs at CI's own thresholds, so "preflight green" and "CI
green" mean the same thing:

  1. ``tools/lint/run_ci_gates.py``  the 27 Python gates ``ci.yml`` runs
  2. ``pytest --collect-only -q``    import smoke (~50 s)
  3. ``tsc --noEmit``                frontend types
  4. ``eslint --max-warnings 1``     CI's own frontend lint threshold
  5. ``vitest run``                  frontend unit tests

The full pytest suite is deliberately *not* here: it takes hours locally and is
the one thing CI is better at.  ``make test`` still runs it.

Usage::

    python tools/preflight.py                    # everything
    python tools/preflight.py --skip-frontend    # Python side only
    python tools/preflight.py --fast             # skip the frontend test run
    python tools/preflight.py --list             # print the steps, run nothing
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
FRONTEND = REPO_ROOT / "frontend"
NODE_BIN = FRONTEND / "node_modules" / ".bin"


@dataclass(frozen=True)
class Step:
    name: str
    argv: tuple[str, ...]
    cwd: Path = REPO_ROOT
    env: dict[str, str] | None = None
    frontend: bool = False
    needs_node_modules: bool = False


def _node_tool(tool: str) -> str:
    """Local ``node_modules/.bin`` path, Windows shim included.

    The extensionless entry is a shell script that Windows cannot exec, so the
    ``.cmd`` shim has to win there — otherwise the frontend steps die with a
    confusing "not a valid Win32 application".
    """
    if os.name == "nt":
        shim = NODE_BIN / f"{tool}.cmd"
        if shim.is_file():
            return str(shim)
    return str(NODE_BIN / tool)


def build_steps(*, skip_frontend: bool, fast: bool) -> list[Step]:
    python_gates = Step(
        "python-gates",
        (sys.executable, "tools/lint/run_ci_gates.py"),
        # run_ci_gates.py imports ``tools.*``; without this the repo root is
        # not on sys.path and it dies with "No module named 'tools'".
        env={"PYTHONPATH": "."},
    )
    collect = Step(
        "pytest-collect",
        (sys.executable, "-m", "pytest", "--collect-only", "-q"),
    )
    if skip_frontend:
        return [python_gates, collect]

    steps = [
        python_gates,
        collect,
        Step("tsc", (_node_tool("tsc"), "--noEmit"), cwd=FRONTEND, frontend=True),
        Step(
            "eslint",
            (_node_tool("eslint"), ".", "--ext", ".ts,.tsx", "--max-warnings", "1"),
            cwd=FRONTEND,
            frontend=True,
        ),
    ]
    if not fast:
        steps.append(
            Step(
                "vitest",
                (_node_tool("vitest"), "run"),
                cwd=FRONTEND,
                frontend=True,
                needs_node_modules=True,
            )
        )
    return steps


def _missing(step: Step) -> str | None:
    if step.needs_node_modules and not (FRONTEND / "node_modules").is_dir():
        return "frontend/node_modules is not installed (run: make frontend-install)"
    if step.frontend and not NODE_BIN.is_dir():
        return "frontend/node_modules is not installed (run: make frontend-install)"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--skip-frontend", action="store_true", help="run the Python side only")
    parser.add_argument("--fast", action="store_true", help="skip the frontend unit-test run")
    parser.add_argument("--list", action="store_true", help="print the steps and exit")
    args = parser.parse_args()

    steps = build_steps(skip_frontend=args.skip_frontend, fast=args.fast)
    if args.list:
        for index, step in enumerate(steps, 1):
            where = "" if step.cwd == REPO_ROOT else f"  (in {step.cwd.name}/)"
            print(f"{index}. {step.name}{where}: {' '.join(step.argv[1:])}")
        return 0

    results: list[tuple[str, int, float]] = []
    for index, step in enumerate(steps, 1):
        # flush: the child writes straight to the inherited stdout, so a buffered
        # banner would surface *after* the step it introduces whenever the output
        # is piped (make, CI, `| tee`).
        print(
            f"\n=== [{index}/{len(steps)}] {step.name} " + "=" * max(0, 44 - len(step.name)),
            flush=True,
        )
        reason = _missing(step)
        if reason:
            print(f"SKIPPED: {reason}", flush=True)
            results.append((step.name, 0, 0.0))
            continue
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", **(step.env or {})}
        started = time.monotonic()
        completed = subprocess.run(list(step.argv), cwd=step.cwd, env=env, check=False)
        elapsed = time.monotonic() - started
        results.append((step.name, completed.returncode, elapsed))
        if completed.returncode:
            print(f"--- {step.name} FAILED (exit {completed.returncode})", flush=True)

    print("\n" + "=" * 58)
    print("preflight summary")
    print("=" * 58)
    for name, code, elapsed in results:
        mark = "ok  " if code == 0 else "FAIL"
        print(f"  {mark}  {name:<16} {elapsed:6.1f}s")
    failed = [name for name, code, _ in results if code]
    if failed:
        print(f"\nFAILED: {', '.join(failed)}")
        print("The full pytest suite is separate: make test")
        return 1
    print("\npreflight OK — the full pytest suite is separate: make test")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
