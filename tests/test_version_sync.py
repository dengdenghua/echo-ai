from __future__ import annotations

import json
import tomllib
from pathlib import Path

import runtime

ROOT = Path(__file__).resolve().parents[1]


def _project_version() -> str:
    metadata = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    return str(metadata["project"]["version"])


def test_runtime_version_matches_project_metadata():
    assert runtime.__version__ == _project_version()


def test_every_release_version_source_agrees():
    """One version per release: release.yml tags ``v<pyproject version>``.

    The release workflow itself only compares pyproject.toml with
    frontend/package.json; the desktop packages and the lock file carry the
    same number and must move with them. (runtime/bundle.json has its own
    supply-contract version and is deliberately not pinned here.)
    """
    expected = _project_version()
    sources = {
        "frontend/package.json": json.loads(
            (ROOT / "frontend/package.json").read_text(encoding="utf-8")
        )["version"],
        "extras/desktop/package.json": json.loads(
            (ROOT / "extras/desktop/package.json").read_text(encoding="utf-8")
        )["version"],
        "package.json": json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"],
    }
    lock = tomllib.loads((ROOT / "uv.lock").read_text(encoding="utf-8"))
    sources["uv.lock"] = next(
        package["version"] for package in lock["package"] if package["name"] == "echo-ai-runtime"
    )

    assert {name: version for name, version in sources.items() if version != expected} == {}


def test_changelog_has_a_section_for_the_current_version():
    """release.yml extracts the GitHub release notes from ``## [<version>]``."""
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")

    assert f"## [{_project_version()}]" in changelog
