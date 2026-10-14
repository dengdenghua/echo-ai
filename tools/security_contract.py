"""Run the versioned runtime safety contract against one or two source checkouts.

No package installation, service startup or real device/model access is performed.
The existing negative tests are authoritative; source hashes are audit evidence only.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
import subprocess
import sys
import tempfile
import time
import tomllib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

CONTRACT_PATH = Path("security/runtime-contract.json")
RESULT_SCHEMA = "echo.runtime-security-result.v1"
SUPPORTED_CONTRACTS = {
    "1.0.0": "83402b5cba1760652b952edc5800b76f2bd8a3333c361e01cd42f35fbfca3442",
    "1.1.0": "ac36ef035e25d28e89f901ef7e21a51628409557dda2ad81bb082ad760f1c7c9",
}
CRITICAL_MODULES = (
    "runtime",
    "runtime.platform.ui.health_router",
    "runtime.platform.observability.logging_config",
    "runtime.platform.observability.structured_logging",
    "runtime.execution.misc.image_generation",
    "runtime.tentacle.transport.ws_server",
    "runtime.tentacle.execution",
    "runtime.safety.sandboxing.sandbox",
    "runtime.platform.process.streaming",
)


def contract_digest(data: dict[str, Any]) -> str:
    encoded = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode()).hexdigest()


def load_contract(repo: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    data = json.loads((repo / CONTRACT_PATH).read_text(encoding="utf-8"))
    version = data.get("version")
    if version not in SUPPORTED_CONTRACTS:
        raise ValueError(f"Unsupported security contract version: {version!r}")
    if contract_digest(data) != SUPPORTED_CONTRACTS[version]:
        raise ValueError("Contract changed without a reviewed version/digest update")
    project = tomllib.loads((repo / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    if project["name"] not in data["profiles"]:
        raise ValueError(f"Unsupported runtime project: {project['name']!r}")
    return data, project


def _test_matches(nodeid: str, selector: str) -> bool:
    return nodeid == selector or nodeid.startswith(selector + "[")


def test_outcome(phases: dict[str, dict[str, Any]]) -> str:
    if any(value.get("wasxfail") for value in phases.values()):
        return "xfail-or-xpass"
    if any(value["outcome"] == "failed" for value in phases.values()):
        return "failed"
    if any(value["outcome"] == "skipped" for value in phases.values()):
        return "skipped"
    if any(
        phases.get(phase, {}).get("outcome") != "passed" for phase in ("setup", "call", "teardown")
    ):
        return "not-run"
    return "passed"


def evaluate_cases(
    contract: dict[str, Any], product: str, collected: list[str], outcomes: dict[str, str]
) -> list[dict[str, Any]]:
    results = []
    for case in contract["cases"]:
        required = case["tests"][product]
        nodes = [node for node in collected if _test_matches(node, required["node"])]
        passed = sum(outcomes.get(node) == "passed" for node in nodes)
        satisfied = len(nodes) >= required["minVariants"] and passed == len(nodes)
        results.append(
            {
                "id": case["id"],
                "selector": required["node"],
                "minimumVariants": required["minVariants"],
                "collectedVariants": len(nodes),
                "passedVariants": passed,
                "status": "passed" if satisfied else "failed",
            }
        )
    return results


def source_provenance(repo: Path) -> tuple[dict[str, Any], list[str]]:
    """Verify actual imports, including aliases, never a grep of source text."""
    sources, issues = {}, []
    runtime_root = (repo / "runtime").resolve()
    for name in CRITICAL_MODULES:
        module = importlib.import_module(name)
        actual = Path(module.__file__).resolve()
        relative = "runtime/__init__.py" if name == "runtime" else name.replace(".", "/") + ".py"
        expected = (repo / relative).resolve()
        sources[name] = {
            "path": str(actual),
            "sha256": hashlib.sha256(actual.read_bytes()).hexdigest(),
        }
        if actual != expected:
            issues.append(f"Source import mismatch: {name}: {actual} != {expected}")
    for name, module in list(sys.modules.items()):
        if name != "runtime" and not name.startswith("runtime."):
            continue
        filename = getattr(module, "__file__", None)
        if filename and not Path(filename).resolve().is_relative_to(runtime_root):
            issues.append(f"Runtime module imported outside requested checkout: {name}")
    return sources, issues


class ContractProbe:
    def __init__(self, repo: Path):
        self.repo = repo
        self.collected: list[str] = []
        self.phases: dict[str, dict[str, dict[str, Any]]] = {}
        self.sources: dict[str, Any] = {}
        self.issues: list[str] = []

    def pytest_collection_finish(self, session):
        self.collected = [item.nodeid for item in session.items]
        try:
            self.sources, issues = source_provenance(self.repo)
            self.issues.extend(issues)
        except Exception as exc:
            self.issues.append(f"Source verification failed: {type(exc).__name__}: {exc}")

    def pytest_runtest_logreport(self, report):
        self.phases.setdefault(report.nodeid, {})[report.when] = {
            "outcome": report.outcome,
            "wasxfail": hasattr(report, "wasxfail"),
        }

    def pytest_sessionfinish(self, session, exitstatus):
        try:
            _, issues = source_provenance(self.repo)
            self.issues.extend(issues)
        except Exception as exc:
            self.issues.append(f"Final source verification failed: {type(exc).__name__}: {exc}")


def _git_head(repo: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def _failed(repo: Path, message: str) -> dict[str, Any]:
    return {"schema": RESULT_SCHEMA, "repo": str(repo), "status": "failed", "issues": [message]}


def run_repository(repo: Path) -> dict[str, Any]:
    """Worker entry point, always in a fresh target-interpreter process."""
    started = time.monotonic()
    contract, project = load_contract(repo)
    product = contract["profiles"][project["name"]]["product"]
    head = _git_head(repo)
    os.chdir(repo)
    sys.path.insert(0, str(repo))
    import pytest

    probe = ContractProbe(repo)
    with tempfile.TemporaryDirectory(prefix=f"echo-{product}-security-contract-") as temporary:
        os.environ["ECHO_DATA_DIR"] = str(Path(temporary) / "data")
        exit_code = int(
            pytest.main(
                [
                    "-q",
                    "-p",
                    "no:cacheprovider",
                    "-o",
                    "addopts=",
                    "--rootdir",
                    str(repo),
                    "--basetemp",
                    str(Path(temporary) / "pytest"),
                    *contract["testFiles"],
                ],
                plugins=[probe],
            )
        )
    outcomes = {node: test_outcome(probe.phases.get(node, {})) for node in probe.collected}
    cases = evaluate_cases(contract, product, probe.collected, outcomes)
    issues = list(dict.fromkeys(probe.issues))
    if exit_code:
        issues.append(f"pytest exited with {exit_code}")
    if any(outcome != "passed" for outcome in outcomes.values()):
        issues.append("Every collected test must pass; skips, xfails and xpasses are rejected")
    if any(case["status"] != "passed" for case in cases):
        issues.append("One or more required contract cases were missing or did not pass")
    return {
        "schema": RESULT_SCHEMA,
        "repo": str(repo),
        "product": product,
        "project": {"name": project["name"], "version": project["version"], "gitHead": head},
        "contract": {
            "id": contract["contractId"],
            "version": contract["version"],
            "sha256": contract_digest(contract),
        },
        "declaredProfile": contract["profiles"][project["name"]],
        "interpreter": str(Path(sys.executable).absolute()),
        "pythonPrefix": sys.prefix,
        "pytestVersion": pytest.__version__,
        "sources": probe.sources,
        "cases": cases,
        "tests": [
            {"nodeid": node, "outcome": outcomes[node], "phases": probe.phases.get(node, {})}
            for node in probe.collected
        ],
        "summary": {
            "collected": len(probe.collected),
            "passed": sum(outcome == "passed" for outcome in outcomes.values()),
            "commonCases": len(cases),
            "commonCasesPassed": sum(case["status"] == "passed" for case in cases),
        },
        "pytestExitCode": exit_code,
        "durationSeconds": round(time.monotonic() - started, 3),
        "status": "passed" if not issues else "failed",
        "issues": issues,
    }


def pair_issues(results: list[dict[str, Any]]) -> list[str]:
    if len(results) != 2:
        return ["Dual verification requires exactly two results"]
    issues = []
    if [item.get("product") for item in results] != ["ai", "os"]:
        issues.append("--ai-repo must identify AI and --os-repo must identify OS")
    contracts = [item.get("contract") for item in results]
    if not contracts[0] or contracts[0] != contracts[1]:
        issues.append("Repositories do not advertise the same reviewed security contract")
    return issues


def _interpreter(repo: Path, explicit: str | None, *, dual: bool) -> Path:
    if explicit:
        candidate = Path(explicit).absolute()
        if not candidate.is_file():
            raise ValueError(f"Missing explicit interpreter: {candidate}")
        return candidate
    candidate = repo / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if candidate.is_file():
        # Keep a venv symlink as the invocation path; resolving it on POSIX
        # would run the base interpreter without this repository's packages.
        return candidate.absolute()
    if dual:
        raise ValueError(f"Missing repository interpreter; supply an explicit Python for {repo}")
    return Path(sys.executable).absolute()


def check_repository(repo: Path, interpreter: Path, *, timeout: int) -> dict[str, Any]:
    # Validate both manifests using this initiating gate's pin, then run the
    # target checkout's own gate just as its independent CI does.
    load_contract(repo)
    entrypoint = repo / "tools/security_contract.py"
    if not entrypoint.is_file():
        raise ValueError(f"Missing independent repository gate: {entrypoint}")
    environment = dict(os.environ)
    environment.update(
        PYTHONDONTWRITEBYTECODE="1",
        PYTEST_DISABLE_PLUGIN_AUTOLOAD="1",
        PYTHONPATH=str(repo),
    )
    environment.pop("PYTEST_ADDOPTS", None)
    with tempfile.TemporaryDirectory(prefix="echo-security-gate-") as temporary:
        output = Path(temporary) / "result.json"
        command = [
            str(interpreter),
            "-B",
            str(entrypoint),
            "--_worker",
            "--repo",
            str(repo),
            "--output",
            str(output),
        ]
        try:
            completed = subprocess.run(
                command,
                cwd=repo,
                env=environment,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return _failed(repo, f"Repository contract gate exceeded {timeout} seconds")
        if not output.is_file():
            return _failed(repo, f"Worker produced no report (exit {completed.returncode})")
        result = json.loads(output.read_text(encoding="utf-8"))
        if result.get("schema") != RESULT_SCHEMA or result.get("repo") != str(repo):
            return _failed(repo, "Worker report schema or checkout identity mismatch")
        if completed.returncode or result.get("status") != "passed":
            result["status"] = "failed"
        result["gateSha256"] = hashlib.sha256(entrypoint.read_bytes()).hexdigest()
        return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, help="Check one repository, as its own CI does")
    parser.add_argument("--python", help="Interpreter for --repo (default: repository .venv)")
    parser.add_argument("--ai-repo", type=Path)
    parser.add_argument("--os-repo", type=Path)
    parser.add_argument("--ai-python")
    parser.add_argument("--os-python")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--_worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    dual = args.ai_repo is not None or args.os_repo is not None
    if bool(args.repo) == dual or (dual and not (args.ai_repo and args.os_repo)):
        parser.error("Supply either --repo or both --ai-repo and --os-repo")
    if args.timeout < 1:
        parser.error("--timeout must be positive")
    results, issues = [], []
    requested = (
        [(args.ai_repo, args.ai_python), (args.os_repo, args.os_python)]
        if dual
        else [(args.repo, args.python)]
    )
    for requested_repo, explicit in requested:
        repo = requested_repo.resolve()
        try:
            if args._worker:
                result = run_repository(repo)
            else:
                interpreter = _interpreter(repo, explicit, dual=dual)
                result = check_repository(repo, interpreter, timeout=args.timeout)
        except Exception as exc:
            result = _failed(repo, f"{type(exc).__name__}: {exc}")
        results.append(result)
    if dual:
        issues = pair_issues(results)
        if args.ai_repo.resolve() == args.os_repo.resolve():
            issues.append("The two repository paths resolve to the same checkout")
    if args._worker:
        report = results[0]
    else:
        report = {
            "schema": RESULT_SCHEMA,
            "generatedAt": datetime.now(UTC).isoformat(),
            "mode": "dual" if dual else "single",
            "repositories": results,
            "issues": issues,
            "status": "passed"
            if not issues and all(r["status"] == "passed" for r in results)
            else "failed",
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if not args._worker:
        for result in results:
            summary = result.get("summary", {})
            print(
                f"{result.get('product', result['repo'])}: {result['status']}; "
                f"tests={summary.get('passed', 0)}/{summary.get('collected', 0)}; "
                f"cases={summary.get('commonCasesPassed', 0)}/{summary.get('commonCases', 0)}"
            )
        print(f"Structured report: {args.output.resolve()}")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
