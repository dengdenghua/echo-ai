"""Run the CI ratchets that drift most, against the exact tree being committed.

Wired in by ``.pre-commit-config.yaml`` (hook ``tree-gates``) and
``.husky/pre-push``. CI runs the same scripts; this catches the drift before
it reaches a pushed branch.

This checkout is shared by concurrent sessions, so nothing here stashes or
rewrites the working tree:

* The tree under test is the one being committed (``git write-tree`` of the
  index git hands the hook, which is the temporary index during
  ``git commit -- <paths>``) or, before a push, the pushed commit.
* That tree is checked out into a cached snapshot under
  ``<git-dir>/echo-tree-gates`` (only what the gates read); ``git read-tree -u``
  keeps it incremental. Another session's uncommitted edits can therefore
  neither fail nor pass your commit.
* Only gates whose inputs changed run, in parallel.

Usage::

    python tools/hooks/commit_tree_gates.py                     # pre-commit
    python tools/hooks/commit_tree_gates.py --push FROM_SHA TO_SHA
    python tools/hooks/commit_tree_gates.py --all [--push-gates]  # current index
    python tools/hooks/commit_tree_gates.py --fix-generated [PATH...]

``--fix-generated`` regenerates docs/auto, docs/openapi-snapshot.json and
frontend/src/core/api/openapi-types.ts for what ``git commit -- PATH...``
would commit (HEAD alone without paths) and writes only the files that change
into this checkout, so other sessions' uncommitted code does not leak into
them. Commit them together with those paths.
"""

from __future__ import annotations

import argparse
import difflib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ZERO_SHA = "0" * 40
# Everything the gates read. The rest (extensions/, frontend assets, ...) is
# never checked out into the snapshot.
SNAPSHOT_PATHS = (
    ".gitattributes",
    "README.md",
    "agents",
    "benchmarks",
    "demos",
    "docs",
    "frontend/package.json",
    "frontend/src",
    "pyproject.toml",
    "runtime",
    "scripts",
    "security",
    "tests",
    "tools",
)
KERNEL_CHECK = (
    "import sys;from pathlib import Path;sys.path.insert(0,'.');"
    "from tools.kernel_release import verify_repository;"
    "r=verify_repository(Path('.'));print(*r['issues'],sep='\\n');"
    "sys.exit(r['status']!='passed')"
)
VITEST = "frontend/node_modules/vitest/vitest.mjs"
OPENAPI_TS = "frontend/node_modules/openapi-typescript/bin/cli.js"
OPENAPI_JSON = "docs/openapi-snapshot.json"
OPENAPI_TYPES = "frontend/src/core/api/openapi-types.ts"


@dataclass(frozen=True)
class Gate:
    name: str
    argv: tuple[str, ...]
    trigger: str
    # Paths that only matter when added, deleted or renamed (counted, not read).
    trigger_added: str | None = None
    push_only: bool = False
    # "snapshot": cwd is the snapshot. "repo": cwd is this checkout (the gate
    # is pointed at the snapshot through env).
    cwd: str = "snapshot"
    env: dict[str, str] = field(default_factory=dict)

    def applies(self, changed: dict[str, str]) -> bool:
        for path, status in changed.items():
            if re.search(self.trigger, path):
                return True
            if self.trigger_added and status in "ADR" and re.search(self.trigger_added, path):
                return True
        return False


def _lint(script: str) -> tuple[str, ...]:
    return ("{python}", f"tools/lint/{script}.py", "--strict")


GATES = (
    Gate("exception-audit", _lint("exception_audit"), r"^(runtime/.*\.py$|tools/lint/exception)"),
    Gate(
        "god-file", _lint("god_file_check"), r"^(runtime/.*\.py$|frontend/src/|tools/lint/god_file)"
    ),
    Gate(
        "function-length",
        _lint("function_length_check"),
        r"^(runtime/.*\.py$|tools/lint/function_length)",
    ),
    Gate(
        "inline-locale", _lint("inline_locale_check"), r"^(frontend/src/|tools/lint/inline_locale)"
    ),
    Gate(
        "kernel-release",
        ("{python}", "-I", "-B", "-c", KERNEL_CHECK),
        r"^(runtime/|security/|tools/kernel_release\.py$)",
    ),
    Gate(
        "docs-auto",
        ("{python}", "scripts/gen_wiki.py", "--check"),
        r"^(runtime/|docs/auto/|docs/adr/|agents/|scripts/gen_wiki\.py$|README\.md$"
        r"|pyproject\.toml$|frontend/package\.json$)",
        trigger_added=r"^(tests/(.*/)?test_[^/]*\.py|frontend/src/.*\.tsx)$",
    ),
    Gate(
        "type-assertions",
        ("node", VITEST, "run", "--config", "tools/hooks/vitest.ratchets.config.mjs"),
        r"^(frontend/src/.*\.tsx?$|frontend/src/test/type-assertion)",
        cwd="repo",
        env={"ECHO_RATCHET_FRONTEND_ROOT": "{snapshot}/frontend"},
    ),
    # CI's "OpenAPI schema + TS types contract gate": regenerate both files and
    # compare bytes (tests/test_openapi_snapshot.py alone ignores model fields).
    Gate(
        "openapi",
        ("{python}", "{driver}", "--check-openapi", "{snapshot}"),
        r"^(runtime/|docs/openapi-snapshot\.json$|frontend/src/core/api/openapi-types\.ts$)",
        cwd="repo",
    ),
    # Whole-tree AST scans of 10-15 s each that rarely trip: before a push only.
    Gate(
        "import-direction",
        _lint("import_direction_check"),
        r"^(runtime/.*\.py$|tools/lint/import_direction)",
        push_only=True,
    ),
    Gate(
        "orphan-module",
        _lint("orphan_module_check"),
        r"^((runtime|tests|demos|benchmarks|tools|scripts)/.*\.py$|tools/lint/orphan_module)",
        push_only=True,
    ),
    Gate(
        "async-lock",
        _lint("async_lock_check"),
        r"^((runtime|tests)/.*\.py$|tools/lint/async_lock)",
        push_only=True,
    ),
    Gate(
        "async-blocking",
        _lint("async_blocking_check"),
        r"^((runtime|tests)/.*\.py$|tools/lint/async_blocking)",
        push_only=True,
    ),
    # Scans every tracked text file (~2 min); only when a URL source changes.
    Gate(
        "repo-url",
        _lint("repo_url_check"),
        r"^(pyproject\.toml$|frontend/package\.json$|mkdocs\.yml$|scripts/install\.sh$"
        r"|permissions\.example\.json$|tools/lint/repo_url_check\.py$|runtime/cli\.py$"
        r"|runtime/platform/demo\.py$|deploy/echo-ai\.service$"
        r"|frontend/src/core/config/index\.ts$|frontend/src/components/workspace/settings/about)",
        push_only=True,
        cwd="repo",
    ),
)


def git(*args: str, env: dict[str, str] | None = None, stdin: bytes | None = None) -> str:
    result = subprocess.run(
        ["git", *args], cwd=REPO, env=env, input=stdin, capture_output=True, check=False
    )
    if result.returncode:
        raise SystemExit(
            f"tree-gates: git {' '.join(args)} failed: {result.stderr.decode(errors='replace')}"
        )
    return result.stdout.decode("utf-8", errors="surrogateescape")


def filtered_tree(tree: str, keep: tuple[str, ...]) -> str:
    """A tree object holding only ``keep`` (top-level names or nested paths)."""
    whole = {path for path in keep if "/" not in path}
    nested: dict[str, list[str]] = {}
    for path in keep:
        if "/" in path:
            head, rest = path.split("/", 1)
            nested.setdefault(head, []).append(rest)
    entries = []
    for line in git("ls-tree", "-z", tree).split("\0"):
        if not line:
            continue
        meta, name = line.split("\t", 1)
        if name in whole:
            entries.append(line)
        elif name in nested and meta.split()[1] == "tree":
            mode, kind, sha = meta.split()
            entries.append(f"{mode} {kind} {filtered_tree(sha, tuple(nested[name]))}\t{name}")
    return git("mktree", "-z", stdin="".join(f"{e}\0" for e in entries).encode()).strip()


class SnapshotLock:
    """One snapshot per checkout; concurrent commits take turns."""

    def __init__(self, path: Path, timeout: float = 300.0) -> None:
        self.path = path
        self.timeout = timeout

    def __enter__(self) -> SnapshotLock:
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                os.close(os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
                return self
            except FileExistsError:
                try:
                    if time.time() - self.path.stat().st_mtime > self.timeout:
                        self.path.unlink()  # left behind by a killed hook
                        continue
                except FileNotFoundError:
                    continue
                if time.monotonic() > deadline:
                    raise SystemExit(f"tree-gates: {self.path} is held by another commit") from None
                time.sleep(0.5)

    def __exit__(self, *_exc: object) -> None:
        self.path.unlink(missing_ok=True)


def snapshot_env(state: Path) -> dict[str, str]:
    """Point git at the snapshot's own index and work tree, never this checkout's."""
    return {
        **os.environ,
        "GIT_DIR": str(state.parent),
        "GIT_INDEX_FILE": str(state / "index"),
        "GIT_WORK_TREE": str(state / "tree"),
    }


def sync_snapshot(state: Path, tree: str) -> Path:
    work = state / "tree"
    work.mkdir(parents=True, exist_ok=True)
    git("read-tree", "--reset", "-u", filtered_tree(tree, SNAPSHOT_PATHS), env=snapshot_env(state))
    return work


def tree_with_paths(paths: list[str]) -> str:
    """HEAD plus the working-tree state of ``paths``, as ``git commit -- paths`` builds it."""
    with tempfile.TemporaryDirectory() as tmp:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(tmp) / "index")}
        git("read-tree", "HEAD", env=env)
        if paths:  # never a bare `git add -A`
            git("add", "-A", "--", *paths, env=env)
        return git("write-tree", env=env).strip()


def regenerate_docs(state: Path, snapshot: Path) -> dict[str, bytes | None]:
    """docs/auto as generated from the snapshot: ``{path: bytes, or None if removed}``."""
    subprocess.run(
        [sys.executable, "scripts/gen_wiki.py"],
        cwd=snapshot,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        stdout=subprocess.DEVNULL,
        check=True,
    )
    status = git(
        "status",
        "--porcelain",
        "-z",
        "--untracked-files=all",
        "--",
        ":/docs/auto",
        env=snapshot_env(state),
    )
    changed: dict[str, bytes | None] = {}
    for entry in filter(None, status.split("\0")):
        code, rel = entry[:2], entry[3:]
        source = snapshot / rel
        changed[rel] = None if "D" in code else source.read_bytes()
        if code == "??":
            source.unlink()  # keep the snapshot equal to its index
    manifest = "docs/auto/index.json"
    if changed.get(manifest) is not None:
        # Like gen_wiki --check: a new generated_at alone is not a change.
        def payload(text: str) -> dict:
            value = json.loads(text)
            value.pop("generated_at", None)
            return value

        committed = git("show", f":{manifest}", env=snapshot_env(state))
        if payload(committed) == payload(changed[manifest].decode("utf-8")):
            del changed[manifest]
    return changed


def openapi_outputs(snapshot: Path) -> dict[str, bytes]:
    """The OpenAPI snapshot and TS types exactly as CI regenerates them for this tree."""
    spec = importlib.util.spec_from_file_location(
        "echo_openapi_snapshot", snapshot / "tests/test_openapi_snapshot.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    schema = json.dumps(
        module._normalize(module._current_schema()), indent=2, sort_keys=True, ensure_ascii=False
    )
    outputs = {OPENAPI_JSON: schema.encode("utf-8")}
    if (REPO / OPENAPI_TS).is_file():
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / "openapi.json", Path(tmp) / "openapi-types.ts"
            source.write_bytes(outputs[OPENAPI_JSON])
            subprocess.run(
                ["node", str(REPO / OPENAPI_TS), str(source), "-o", str(target)],
                capture_output=True,
                check=True,
            )
            outputs[OPENAPI_TYPES] = target.read_bytes()
    return outputs


def _lf(data: bytes) -> bytes:
    return data.replace(b"\r\n", b"\n")


def stale_openapi(snapshot: Path) -> dict[str, bytes]:
    return {
        rel: data
        for rel, data in openapi_outputs(snapshot).items()
        if _lf(data) != _lf((snapshot / rel).read_bytes())
    }


def check_openapi(snapshot: Path) -> int:
    stale = stale_openapi(snapshot)
    for rel, data in stale.items():
        committed = _lf((snapshot / rel).read_bytes()).decode("utf-8", "replace").splitlines()
        current = _lf(data).decode("utf-8", "replace").splitlines()
        diff = difflib.unified_diff(committed, current, rel, "regenerated", n=1, lineterm="")
        print(f"{rel} is stale:", *list(diff)[:40], sep="\n")
    return 1 if stale else 0


def fix_generated(state: Path, tree: str) -> int:
    """Regenerate every compared artifact for ``tree`` and write the changes here."""
    snapshot = sync_snapshot(state, tree)
    changed = {**regenerate_docs(state, snapshot), **stale_openapi(snapshot)}
    for rel, data in changed.items():
        target = REPO / rel
        if data is None:
            target.unlink(missing_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    print("\n".join(changed) if changed else "generated files already match that tree")
    return 0


def changed_paths(base: str | None, head: str | None) -> dict[str, str]:
    """``{path: status letter}``; the staged change when no refs are given."""
    args = ["diff", "--name-status", "-z", "--no-renames"]
    if base and head:
        args += [base, head]
    else:
        args += ["--cached", "HEAD"]
    fields = git(*args).split("\0")
    return {fields[i + 1]: fields[i][0] for i in range(0, len(fields) - 1, 2) if fields[i]}


def run_gate(gate: Gate, snapshot: Path) -> tuple[Gate, int, str, float]:
    def fill(value: str) -> str:
        return (
            value.replace("{python}", sys.executable)
            .replace("{driver}", str(Path(__file__).resolve()))
            .replace("{snapshot}", str(snapshot))
        )

    argv = [fill(part) for part in gate.argv]
    if gate.name == "type-assertions" and not (REPO / VITEST).is_file():
        return gate, 0, "skipped: frontend/node_modules is not installed", 0.0
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    env.update({key: fill(value) for key, value in gate.env.items()})
    started = time.monotonic()
    result = subprocess.run(
        argv,
        cwd=snapshot if gate.cwd == "snapshot" else REPO,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    return gate, result.returncode, result.stdout + result.stderr, time.monotonic() - started


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--push", nargs=2, metavar=("FROM", "TO"), help="pre-push range")
    parser.add_argument("--all", action="store_true", help="run every gate, changed or not")
    parser.add_argument("--push-gates", action="store_true", help="include push-only gates")
    parser.add_argument(
        "--fix-generated", nargs="*", metavar="PATH", help="regenerate docs/auto and OpenAPI"
    )
    parser.add_argument("--check-openapi", metavar="SNAPSHOT", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    if args.check_openapi:  # one gate, run by the parent that holds the lock
        return check_openapi(Path(args.check_openapi))
    state = Path(git("rev-parse", "--absolute-git-dir").strip()) / "echo-tree-gates"
    state.mkdir(exist_ok=True)
    if args.fix_generated is not None:
        tree = tree_with_paths(args.fix_generated)
        with SnapshotLock(state / "lock"):
            return fix_generated(state, tree)

    if args.push:
        base, head = args.push
        tree = git("rev-parse", f"{head}^{{tree}}").strip()
        known = (
            base != ZERO_SHA
            and subprocess.run(
                ["git", "cat-file", "-e", f"{base}^{{commit}}"], cwd=REPO, capture_output=True
            ).returncode
            == 0
        )
        changed = changed_paths(base, head) if known else {}
        run_all = args.all or not known
    else:
        tree = git("write-tree").strip()
        changed = changed_paths(None, None)
        run_all = args.all
    with_push_gates = bool(args.push) or args.push_gates
    gates = [
        gate
        for gate in GATES
        if (with_push_gates or not gate.push_only) and (run_all or gate.applies(changed))
    ]
    if not gates:
        return 0

    stamp = f"{tree} {','.join(gate.name for gate in gates)}"
    passed = state / "passed"
    with SnapshotLock(state / "lock"):
        if passed.is_file() and stamp in passed.read_text(encoding="utf-8").splitlines():
            return 0  # pre-commit split a large commit into batches; already checked
        started = time.monotonic()
        snapshot = sync_snapshot(state, tree)
        print(
            f"tree-gates: {len(gates)} gate(s) on tree {tree[:10]} "
            f"(snapshot {time.monotonic() - started:.1f}s)"
        )
        with ThreadPoolExecutor(max_workers=len(gates)) as pool:
            results = list(pool.map(lambda gate: run_gate(gate, snapshot), gates))
        failed = 0
        for gate, code, output, seconds in results:
            print(f"  {'FAIL' if code else 'ok  '} {gate.name} ({seconds:.1f}s)")
            if code:
                failed += 1
                tail = output.strip().splitlines()[-60:]
                print("\n".join(f"    | {line}" for line in tail))
        if any(code and gate.name in {"docs-auto", "openapi"} for gate, code, _, _ in results):
            print(
                "tree-gates: regenerate the generated files for exactly this commit with\n"
                "  python tools/hooks/commit_tree_gates.py --fix-generated <the paths you commit>"
            )
        if failed:
            print(
                f"tree-gates: {failed} gate(s) failed on the tree being committed. "
                "Fix them as CI would require; do not raise baselines to hide new debt."
            )
            return 1
        lines = passed.read_text(encoding="utf-8").splitlines() if passed.is_file() else []
        fd, tmp = tempfile.mkstemp(dir=state)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write("\n".join([*lines[-49:], stamp]) + "\n")
        os.replace(tmp, passed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
