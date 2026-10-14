"""Forbid new inline locale branches in the frontend.

Copy belongs in ``frontend/src/core/i18n/locales``; a component that picks
its text with ``locale.startsWith("zh") ? "中文" : "English"`` shows English
to Japanese and Korean users and bypasses the typed translation tables.

The baseline records the current count of such branches per file. A file may
not gain branches, a new file may not have any, and a file whose count dropped
must lower its baseline (``--strict``) so the cleanup is locked in.

Run::

    python tools/lint/inline_locale_check.py            # report
    python tools/lint/inline_locale_check.py --strict
    python tools/lint/inline_locale_check.py --write-baseline
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ROOT = REPO_ROOT / "frontend/src"
BASELINE = REPO_ROOT / "tools/lint/inline_locale_baseline.txt"
EXCLUDE_PARTS = ("core/i18n/", "node_modules", "core/api/openapi-types.ts")
TEST_RE = re.compile(r"\.(test|spec)\.[jt]sx?$")
# `locale.startsWith("zh")`, `lang === "zh-CN"`, and `zh ? … : …` ternaries.
BRANCH_RE = re.compile(
    r"""startsWith\(\s*["']zh["']\s*\)|===?\s*["']zh(?:-CN)?["']|\bzh(?:Ui)?\s*\?"""
)


def scan() -> dict[str, int]:
    counts: dict[str, int] = {}
    for path in sorted(ROOT.rglob("*")):
        if path.suffix not in {".ts", ".tsx"} or not path.is_file():
            continue
        rel = path.relative_to(REPO_ROOT).as_posix()
        if TEST_RE.search(rel) or any(part in rel for part in EXCLUDE_PARTS):
            continue
        try:
            found = len(BRANCH_RE.findall(path.read_text(encoding="utf-8")))
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
            "# Inline locale branches per frontend file, captured by "
            "tools/lint/inline_locale_check.py\n"
            "# Moved a file's copy into core/i18n/locales? Lower or delete its line.\n\n"
            + "\n".join(rows)
            + "\n",
            encoding="utf-8",
        )
        print(f"wrote {len(current)} files ({sum(current.values())} branches) to {BASELINE.name}")
        return 0

    baseline = read_baseline()
    grew = {k: (baseline.get(k, 0), v) for k, v in current.items() if v > baseline.get(k, 0)}
    lowered = {k: (v, current.get(k, 0)) for k, v in baseline.items() if current.get(k, 0) < v}
    for rel, (before, after) in sorted(grew.items()):
        print(f"MORE inline locale branches {before} -> {after}: {rel}")
    for rel, (before, after) in sorted(lowered.items()):
        print(f"FEWER {before} -> {after} (lower its baseline): {rel}")
    print(
        f"{sum(current.values())} inline locale branches in {len(current)} files · "
        f"{len(grew)} grew · {len(lowered)} lowered"
    )
    return 1 if args.strict and (grew or lowered) else 0


if __name__ == "__main__":
    sys.exit(main())
