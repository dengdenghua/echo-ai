"""Check the reviewed kernel release from this checkout or a pair of checkouts."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tomllib
from pathlib import Path
from typing import Any

PRODUCTS = {"echo-ai-runtime": "ai", "echo-os": "os"}


def verify_repository(repo: Path) -> dict[str, Any]:
    from runtime import release_identity

    repo = repo.resolve()
    if Path(release_identity.__file__).resolve() != repo / "runtime/release_identity.py":
        raise ValueError("Release verifier imported from a different checkout")
    project = tomllib.loads((repo / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    product = PRODUCTS[project["name"]]
    release = release_identity.load_release(repo / "runtime/kernel-release.json")
    report = release_identity.verify_sources(repo, product, release)
    security = json.loads((repo / "security/runtime-contract.json").read_text(encoding="utf-8"))
    if (
        security["version"] != release["securityContractVersion"]
        or release_identity.canonical_digest(security) != release["securityContractSha256"]
    ):
        report["issues"].append("Security contract does not match kernel release")
        report["status"] = "failed"
    return {
        "schema": "echo.kernel-release-result.v1",
        "repo": str(repo),
        "product": product,
        "projectVersion": project["version"],
        "manifestVersion": release["manifestVersion"],
        "revision": release["revision"],
        "authority": release["authority"],
        "deviceProtocolVersion": release["deviceProtocolVersion"],
        "securityContractVersion": release["securityContractVersion"],
        **report,
    }


def run_worker(repo: Path) -> dict[str, Any]:
    repo = repo.resolve()
    python = repo / (".venv/Scripts/python.exe" if os.name == "nt" else ".venv/bin/python")
    if not python.is_file():
        return {
            "repo": str(repo),
            "status": "failed",
            "issues": ["Repository Python is unavailable"],
        }
    code = (
        "import sys;sys.path.insert(0,sys.argv[1]);"
        "from pathlib import Path;from tools.kernel_release import verify_repository;"
        "import json;print(json.dumps(verify_repository(Path(sys.argv[1])),ensure_ascii=True))"
    )
    result = subprocess.run(
        [str(python), "-I", "-B", "-c", code, str(repo)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
        check=False,
    )
    if result.returncode:
        return {
            "repo": str(repo),
            "status": "failed",
            "issues": ["Kernel worker rejected the checkout"],
            "diagnostics": result.stderr[-2000:],
        }
    return json.loads(result.stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path)
    parser.add_argument("--ai-repo", type=Path)
    parser.add_argument("--os-repo", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    options = parser.parse_args()
    if options.repo and (options.ai_repo or options.os_repo):
        parser.error("Use either --repo or the complete --ai-repo/--os-repo pair")
    if not options.repo and not (options.ai_repo and options.os_repo):
        parser.error("A repository or complete repository pair is required")
    repos = [options.repo] if options.repo else [options.ai_repo, options.os_repo]
    reports = [run_worker(repo) for repo in repos]
    issues = []
    if len(reports) == 2 and (
        {report.get("product") for report in reports} != {"ai", "os"}
        or len({report.get("revision") for report in reports}) != 1
    ):
        issues.append("Repository profiles or kernel revisions do not match")
    passed = not issues and all(report["status"] == "passed" for report in reports)
    report = {
        "schema": "echo.kernel-release-pair.v1",
        "status": "passed" if passed else "failed",
        "repositories": reports,
        "issues": issues,
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": report["status"], "repositories": len(reports)}))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
