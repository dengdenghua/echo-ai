"""Contract for the preview release channel.

Preview tags (vX.Y.Z-preview.N) publish unsigned installers as a GitHub
pre-release through preview-release.yml. Stable tags (vX.Y.Z) keep the strict
release.yml gate. Neither workflow may start on the other's tags, and the
preview channel must never reach PyPI, GHCR or any signing material.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
PREVIEW = "preview-release.yml"
STABLE = "release.yml"
STABLE_TAGS = ("v0.2.0", "v1.0.0", "v10.20.30")
PREVIEW_TAGS = ("v0.2.0-preview.1", "v0.2.0-preview.12", "v1.0.0-preview.3")


def _workflow(name: str) -> dict:
    value = yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def _trigger(workflow: dict) -> dict:
    # PyYAML (YAML 1.1) reads the bare key `on` as boolean True.
    value = workflow.get("on", workflow.get(True))
    assert isinstance(value, dict)
    return value


def _filter_regex(pattern: str) -> re.Pattern[str]:
    """GitHub filter-pattern semantics for the subset the tag filters use."""

    assert not set(pattern) & set("?+[]"), f"helper does not model {pattern!r}"
    regex = ""
    index = 0
    while index < len(pattern):
        if pattern.startswith("**", index):
            regex += ".*"
            index += 2
        elif pattern[index] == "*":
            regex += "[^/]*"
            index += 1
        else:
            regex += re.escape(pattern[index])
            index += 1
    return re.compile(regex)


def _tag_push_triggers(name: str, tag: str) -> bool:
    push = _trigger(_workflow(name)).get("push") or {}
    assert "tags-ignore" not in push, f"{name}: model tags-ignore before using it"
    matched = False
    # Later patterns override earlier ones; "!" negates.
    for pattern in push.get("tags", []):
        negated = pattern.startswith("!")
        if _filter_regex(pattern.removeprefix("!")).fullmatch(tag):
            matched = not negated
    return matched


def _steps(job: dict) -> dict[str, dict]:
    return {step["name"]: step for step in job.get("steps", []) if step.get("name")}


def test_filter_helper_matches_github_semantics() -> None:
    assert _filter_regex("v*.*.*").fullmatch("v0.2.0-preview.1")
    assert not _filter_regex("v*").fullmatch("v0/2")


@pytest.mark.parametrize("tag", STABLE_TAGS)
def test_stable_tags_start_only_the_stable_release(tag: str) -> None:
    assert _tag_push_triggers(STABLE, tag)
    assert not _tag_push_triggers(PREVIEW, tag)


@pytest.mark.parametrize("tag", PREVIEW_TAGS)
def test_preview_tags_start_only_the_preview_release(tag: str) -> None:
    assert _tag_push_triggers(PREVIEW, tag)
    assert not _tag_push_triggers(STABLE, tag)


@pytest.mark.parametrize("tag", ("v0.2.0-rc.1", "v0.2.0-beta", "release-0.2.0"))
def test_other_tags_start_neither_release(tag: str) -> None:
    assert not _tag_push_triggers(STABLE, tag)
    assert not _tag_push_triggers(PREVIEW, tag)


def test_stable_release_still_requires_exact_version_tag() -> None:
    # release.yml can also be dispatched on any ref; this check is what keeps
    # a dispatch on a preview tag from publishing a stable release.
    check = _steps(_workflow(STABLE)["jobs"]["release-readiness"])[
        "Verify release tag matches package versions"
    ]
    assert check["env"]["RELEASE_TAG"] == "${{ github.ref_name }}"
    assert 'expected_tag = f"v{python_version}"' in check["run"]
    assert "if actual_tag != expected_tag:" in check["run"]


def test_preview_tag_version_and_dispatch_are_bound_to_the_tagged_commit() -> None:
    workflow = _workflow(PREVIEW)
    dispatch = _trigger(workflow)["workflow_dispatch"]["inputs"]
    assert dispatch["tag"]["required"] is True
    readiness = workflow["jobs"]["preview-readiness"]
    check = _steps(readiness)["Verify preview tag matches package versions"]
    assert check["env"]["PREVIEW_TAG"] == "${{ github.ref_name }}"
    assert check["env"]["REF_TYPE"] == "${{ github.ref_type }}"
    script = check["run"]
    assert r're.fullmatch(r"v(\d+\.\d+\.\d+)-preview\.([1-9]\d*)", tag)' in script
    assert 'root / "pyproject.toml"' in script
    assert 'root / "frontend" / "package.json"' in script
    assert "if base_version != python_version:" in script
    assert "dispatch_tag != tag" in script
    assert 'f"## [{base_version}]" not in changelog' in script


def test_preview_requires_same_sha_ci_and_security_but_not_behavioral_evidence() -> None:
    workflow = _workflow(PREVIEW)
    text = (WORKFLOWS / PREVIEW).read_text(encoding="utf-8")
    readiness = workflow["jobs"]["preview-readiness"]
    assert readiness["permissions"] == {"actions": "read", "contents": "read"}
    lookup = _steps(readiness)["Find successful same-SHA CI and runtime security runs"]["run"]
    assert "actions/workflows/ci.yml/runs" in lookup
    assert "actions/workflows/runtime-security-contract.yml/runs" in lookup
    assert 'head_sha="${GITHUB_SHA}"' in lookup
    assert ".head_sha == $sha" in lookup
    assert '[[ -z "${ci_run_id}" ]]' in lookup
    assert '[[ -z "${security_run_id}" ]]' in lookup
    assert "behavioral-evidence.yml" not in text
    assert "production-readiness" not in text
    for job_name in ("windows", "linux", "python-distribution"):
        assert workflow["jobs"][job_name]["needs"] == "preview-readiness"


def test_preview_never_publishes_to_pypi_ghcr_or_touches_signing_material() -> None:
    workflow = _workflow(PREVIEW)
    text = (WORKFLOWS / PREVIEW).read_text(encoding="utf-8")
    for forbidden in (
        "pypa/gh-action-pypi-publish",
        "environment:",
        "ghcr.io",
        "docker/",
        "cosign",
        "packages: write",
        "id-token",
        "CSC_LINK",
        "WINDOWS_CODE_SIGNING",
        "ECHO_PLUGIN_SIGNING_PRIVATE_KEY",
        "secrets: inherit",
    ):
        assert forbidden not in text, forbidden
    assert set(re.findall(r"secrets\.(\w+)", text)) == {"GITHUB_TOKEN"}
    assert workflow["permissions"] == {"contents": "read"}
    assert workflow["jobs"]["python-distribution"]["permissions"] == {"contents": "read"}
    assert workflow["jobs"]["publish"]["permissions"] == {"contents": "write"}


def test_preview_reuses_the_build_workflows_with_an_unsigned_windows_build() -> None:
    jobs = _workflow(PREVIEW)["jobs"]
    windows_job = jobs["windows"]
    assert windows_job["uses"] == "./.github/workflows/build-win.yml"
    assert windows_job["with"] == {"preview": True}
    linux_job = jobs["linux"]
    assert linux_job["uses"] == "./.github/workflows/build-linux.yml"
    for job in (windows_job, linux_job):
        assert "secrets" not in job
        assert job["permissions"] == {"contents": "read"}

    build_win = _workflow("build-win.yml")
    inputs = _trigger(build_win)["workflow_call"]["inputs"]
    assert inputs["preview"]["type"] == "boolean"
    assert inputs["preview"]["default"] is False
    job = build_win["jobs"]["build-win"]
    # Every signed-only step keys off HAS_WINDOWS_SIGNING, so a preview build
    # never runs a step that reads the signing secrets.
    assert job["env"]["HAS_WINDOWS_SIGNING"] == (
        "${{ !inputs.preview && secrets.WINDOWS_CODE_SIGNING_CERTIFICATE_BASE64 != '' }}"
    )
    steps = _steps(job)
    for signed_only in (
        "Validate protected Windows signing identity",
        "Build canonical Electron EXE",
        "Verify Authenticode signatures and create commit-bound checksums",
    ):
        assert steps[signed_only]["if"] == "env.HAS_WINDOWS_SIGNING == 'true'"

    assert "workflow_call" in _trigger(_workflow("build-linux.yml"))
    linux_steps = _steps(_workflow("build-linux.yml")["jobs"]["build-linux"])
    assert linux_steps["Configure trusted first-party plugin publisher"]["if"] == (
        "${{ vars.ECHO_PLUGIN_SIGNING_PUBLIC_KEY != '' }}"
    )

    publish = _steps(jobs["publish"])
    windows_download = publish["Download unsigned Windows installer"]["with"]
    assert windows_download["name"] == "Echo-Setup-Windows-${{ github.sha }}-UNSIGNED"
    assert "run-id" not in windows_download
    assert publish["Download Linux AppImage"]["with"]["name"] == (
        "Echo-Setup-Linux-${{ github.sha }}"
    )


def test_preview_builds_python_distribution_and_checksums_every_asset() -> None:
    jobs = _workflow(PREVIEW)["jobs"]
    build = _steps(jobs["python-distribution"])
    assert build["Sync locked release validation tools"]["run"] == (
        "uv sync --locked --python 3.11.9 --extra release"
    )
    assert build["Build wheel and source distribution"]["run"] == (
        "uv build --no-sources --out-dir dist"
    )
    assert "twine check --strict dist/*" in build["Validate distribution metadata"]["run"]

    staging = _steps(jobs["publish"])["Stage commit-bound preview assets and SHA256SUMS"]["run"]
    assert '== *"${GITHUB_SHA}"*' in staging
    assert "sha256sum -- * >" in staging
    assert "preview-assets/SHA256SUMS" in staging
    # Update metadata stays out of the pre-release so no updater offers it.
    assert "latest" not in staging


def test_preview_is_published_as_a_prerelease_that_is_never_latest() -> None:
    steps = _steps(_workflow(PREVIEW)["jobs"]["publish"])
    create = steps["Create GitHub pre-release (not latest)"]["run"]
    assert 'gh release create "${PREVIEW_TAG}" preview-assets/*' in create
    assert "--prerelease" in create
    assert "--latest=false" in create
    assert "--verify-tag" in create
    assert "--notes-file preview_release_notes.md" in create
    notes = steps["Compose preview release notes"]
    assert "cat .github/preview-release-notes.md" in notes["run"]
    assert notes["env"]["RELEASE_VERSION"] == "${{ needs.preview-readiness.outputs.version }}"
    assert "CHANGELOG.md" in notes["run"]

    banner = (ROOT / ".github" / "preview-release-notes.md").read_text(encoding="utf-8")
    for required in (
        "预览版",
        "preview build",
        "SmartScreen",
        "仍要运行",
        "Run anyway",
        "SHA256SUMS",
        "PyPI",
        "设置 → 模型",
        "API key",
    ):
        assert required in banner, required
