"""The safety gate must reject missing, skipped or weakened contract checks."""

from __future__ import annotations

import copy
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from tools import security_contract as gate

REPO = Path(__file__).resolve().parents[1]


@pytest.fixture
def contract():
    return gate.load_contract(REPO)[0]


def _temporary_repo(tmp_path, contract):
    (tmp_path / "security").mkdir()
    (tmp_path / gate.CONTRACT_PATH).write_text(json.dumps(contract), encoding="utf-8")
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "echo-ai-runtime"\nversion = "0.1.0"\n', encoding="utf-8"
    )
    return tmp_path


def test_checked_in_contract_is_pinned_and_product_differences_are_explicit(contract):
    assert contract["version"] == "1.1.0"
    assert gate.contract_digest(contract) == gate.SUPPORTED_CONTRACTS["1.1.0"]
    assert len(contract["cases"]) == 29
    assert "1.0.0" in gate.SUPPORTED_CONTRACTS
    assert "runtime.safety.sandboxing.sandbox" in gate.CRITICAL_MODULES
    assert "runtime.platform.process.streaming" in gate.CRITICAL_MODULES
    assert contract["profiles"]["echo-ai-runtime"]["peerCredentialIssuance"] == "not-implemented"
    assert contract["profiles"]["echo-os"]["peerCredentialIssuance"] == "appliance-managed"


def test_same_version_contract_edits_are_rejected(tmp_path, contract):
    changed = copy.deepcopy(contract)
    changed["cases"][0]["guarantee"] = "weakened"
    repo = _temporary_repo(tmp_path, changed)
    with pytest.raises(ValueError, match="reviewed version/digest update"):
        gate.load_contract(repo)


def test_unknown_versions_are_rejected(tmp_path, contract):
    changed = copy.deepcopy(contract)
    changed["version"] = "9.0.0"
    repo = _temporary_repo(tmp_path, changed)
    with pytest.raises(ValueError, match="Unsupported security contract version"):
        gate.load_contract(repo)


def test_missing_tests_cannot_satisfy_a_contract(contract):
    cases = gate.evaluate_cases(contract, "ai", [], {})
    assert all(case["status"] == "failed" for case in cases)


def test_removed_parameter_variants_fail_the_gate(contract):
    selector = contract["cases"][0]["tests"]["ai"]["node"]
    node = selector + "[only-one-route]"
    case = gate.evaluate_cases(contract, "ai", [node], {node: "passed"})[0]
    assert case["collectedVariants"] == 1
    assert case["minimumVariants"] == 3
    assert case["status"] == "failed"


@pytest.mark.parametrize(
    ("phase", "outcome", "wasxfail", "expected"),
    [
        ("setup", "failed", False, "failed"),
        ("call", "failed", False, "failed"),
        ("teardown", "failed", False, "failed"),
        ("setup", "skipped", False, "skipped"),
        ("call", "skipped", False, "skipped"),
        ("call", "skipped", True, "xfail-or-xpass"),
        ("call", "passed", True, "xfail-or-xpass"),
    ],
)
def test_nonpassing_reports_cannot_satisfy_a_contract(phase, outcome, wasxfail, expected):
    phases = {
        name: {"outcome": "passed", "wasxfail": False} for name in ("setup", "call", "teardown")
    }
    phases[phase] = {"outcome": outcome, "wasxfail": wasxfail}
    assert gate.test_outcome(phases) == expected


def test_execution_requires_all_three_phases():
    assert gate.test_outcome({}) == "not-run"
    assert gate.test_outcome({"call": {"outcome": "passed"}}) == "not-run"


def test_source_imports_from_another_checkout_are_rejected(tmp_path, monkeypatch):
    from runtime.platform.ui import health_router

    foreign = tmp_path / "health_router.py"
    foreign.write_text("# synthetic foreign checkout\n", encoding="utf-8")
    monkeypatch.setattr(health_router, "__file__", str(foreign))
    _, issues = gate.source_provenance(REPO)
    assert any("Source import mismatch" in issue for issue in issues)
    assert any("outside requested checkout" in issue for issue in issues)


def test_repository_pair_requires_matching_contract_and_distinct_products():
    contract = {"id": "echo-runtime-safety", "version": "1.0.0", "sha256": "digest"}
    ai = {"product": "ai", "contract": contract}
    other_ai = {"product": "ai", "contract": contract}
    os_repo = {"product": "os", "contract": contract}
    assert gate.pair_issues([ai, os_repo]) == []
    assert gate.pair_issues([os_repo, ai])
    assert gate.pair_issues([ai, other_ai])
    changed = {"product": "os", "contract": {**contract, "version": "1.0.1"}}
    assert gate.pair_issues([ai, changed])


def test_venv_interpreter_invocation_does_not_resolve_symlinks(tmp_path, monkeypatch):
    executable = tmp_path / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"synthetic interpreter")

    def resolve_is_wrong(*args, **kwargs):
        raise AssertionError("Resolving a venv Python can lose the venv on POSIX")

    monkeypatch.setattr(Path, "resolve", resolve_is_wrong)
    assert gate._interpreter(tmp_path, None, dual=True) == executable.absolute()


def test_invalid_contract_produces_nonzero_cli_and_structured_failure(tmp_path, contract):
    changed = copy.deepcopy(contract)
    changed["version"] = "unsupported"
    repo = _temporary_repo(tmp_path, changed)
    output = tmp_path / "result.json"
    assert gate.main(["--repo", str(repo), "--output", str(output)]) == 1
    report = json.loads(output.read_text(encoding="utf-8"))
    assert report["status"] == "failed"
    assert report["repositories"][0]["status"] == "failed"


def test_independent_workflow_runs_both_gates_on_both_platforms():
    import yaml

    path = REPO / ".github/workflows/runtime-security-contract.yml"
    workflow = yaml.load(path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
    assert set(workflow["on"]) == {"push", "pull_request", "workflow_dispatch"}
    assert workflow["permissions"] == {"contents": "read"}
    job = workflow["jobs"]["runtime-security-contract"]
    assert set(job["strategy"]["matrix"]["os"]) == {"ubuntu-24.04", "windows-2022"}
    commands = [step.get("run", "") for step in job["steps"]]
    assert any("tests/test_security_contract_gate.py" in command for command in commands)
    assert any("tools/security_contract.py --repo ." in command for command in commands)
    assert "continue-on-error" not in job
    assert all("continue-on-error" not in step for step in job["steps"])


def test_real_diagnostics_auth_regression_makes_the_gate_fail(tmp_path):
    """Inject a process-local auth regression; never edit production sources."""
    output = tmp_path / "deliberate-auth-regression.json"
    code = r"""
import json, sys
from pathlib import Path
from tools import security_contract as gate
from runtime.platform.ui import health_router
repo, output = Path(sys.argv[1]), Path(sys.argv[2])
contract, project = gate.load_contract(repo)
case = contract["cases"][0]
product = contract["profiles"][project["name"]]["product"]
contract = {**contract, "cases": [case], "testFiles": [case["tests"][product]["node"]]}
gate.load_contract = lambda _: (contract, project)
original = health_router.create_health_router
def deliberately_unsafe(*args, **kwargs):
    kwargs["require_auth"] = False
    return original(*args, **kwargs)
health_router.create_health_router = deliberately_unsafe
result = gate.run_repository(repo)
output.write_text(json.dumps(result), encoding="utf-8")
raise SystemExit(0 if result["status"] == "passed" else 1)
"""
    environment = {
        **os.environ,
        "PYTHONPATH": str(REPO),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
    }
    environment.pop("PYTEST_ADDOPTS", None)
    completed = subprocess.run(
        [sys.executable, "-B", "-c", code, str(REPO), str(output)],
        cwd=REPO,
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert completed.returncode == 1
    result = json.loads(output.read_text(encoding="utf-8"))
    assert result["status"] == "failed"
    assert result["pytestExitCode"] == 1
    assert result["summary"]["collected"] == 3
    assert result["summary"]["passed"] == 0
    assert result["cases"][0]["status"] == "failed"
    assert all(test["outcome"] == "failed" for test in result["tests"])
