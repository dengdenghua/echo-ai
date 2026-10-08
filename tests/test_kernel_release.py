"""Negative regressions for the scoped release identity and source-drift gate."""

import copy
import json
import shutil
import tomllib
from pathlib import Path

import pytest

from runtime import release_identity as identity

ROOT = Path(__file__).resolve().parents[1]
PRODUCT = {"echo-ai-runtime": "ai", "echo-os": "os"}[
    tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]["name"]
]


@pytest.fixture(autouse=True)
def reset_identity_cache():
    identity._public_identity.cache_clear()
    yield
    identity._public_identity.cache_clear()


@pytest.fixture
def release():
    return identity.load_release(ROOT / "runtime/kernel-release.json")


@pytest.fixture
def source_copy(tmp_path, release):
    for entry in [*release["sharedSources"], *release["profiles"][PRODUCT]["sources"]]:
        target = tmp_path / entry["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / entry["path"], target)
    return tmp_path


def test_reviewed_release_matches_actual_product_sources(release):
    assert identity.verify_sources(ROOT, PRODUCT, release)["status"] == "passed"
    assert release["authority"] == "echo-ai"


@pytest.mark.parametrize("operation", ["changed", "missing"])
def test_shared_source_drift_is_rejected(source_copy, release, operation):
    target = source_copy / release["sharedSources"][0]["path"]
    if operation == "changed":
        target.write_bytes(target.read_bytes() + b"\n# unreviewed change\n")
    else:
        target.unlink()
    result = identity.verify_sources(source_copy, PRODUCT, release)
    assert result["status"] == "failed"
    assert len(result["issues"]) == 1


def test_product_specific_source_drift_is_also_rejected(source_copy, release):
    target = source_copy / release["profiles"][PRODUCT]["sources"][0]["path"]
    target.write_bytes(target.read_bytes() + b"\n# adapter changed\n")
    assert identity.verify_sources(source_copy, PRODUCT, release)["status"] == "failed"


def test_crlf_and_lf_are_the_same_reviewed_source(source_copy, release):
    target = source_copy / release["sharedSources"][0]["path"]
    target.write_bytes(target.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
    assert identity.verify_sources(source_copy, PRODUCT, release)["status"] == "passed"


def test_recomputing_a_manifest_revision_does_not_bypass_review(tmp_path, release):
    changed = copy.deepcopy(release)
    changed["deviceProtocolVersion"] = "unreviewed"
    changed["revision"] = "sha256:" + identity.canonical_digest(
        {key: value for key, value in changed.items() if key != "revision"}
    )
    path = tmp_path / "release.json"
    path.write_text(json.dumps(changed), encoding="utf-8")
    with pytest.raises(ValueError, match="reviewed version/digest"):
        identity.load_release(path)


def test_nonobject_manifest_is_rejected_without_a_parser_crash(tmp_path):
    path = tmp_path / "release.json"
    path.write_text("[]", encoding="utf-8")
    with pytest.raises(ValueError, match="schema"):
        identity.load_release(path)


@pytest.mark.parametrize(
    "name",
    ["runtime/../../secret.py", "runtime/C:/secret.py", "runtime\\secret.py", "/runtime/secret.py"],
)
def test_release_source_paths_cannot_escape_runtime(tmp_path, name):
    with pytest.raises(ValueError, match="source path"):
        identity.source_path(tmp_path, name)


def test_unknown_product_cannot_select_another_profiles_sources(release):
    with pytest.raises(ValueError, match="product profile"):
        identity.verify_sources(ROOT, "unknown", release)


def test_public_release_failure_exposes_no_paths_or_exception(monkeypatch):
    def failed(_path):
        raise ValueError("secret-path-and-parser-detail")

    monkeypatch.setattr(identity, "load_release", failed)
    assert identity.public_kernel_identity(PRODUCT) == {"sourceScopeVerified": False}


def test_public_release_identity_is_a_copy_and_not_a_bundle_claim():
    public = identity.public_kernel_identity(PRODUCT)
    assert public["sourceScopeVerified"] is True
    assert set(public) == {
        "manifestVersion",
        "revision",
        "deviceProtocolVersion",
        "securityContractVersion",
        "sourceScopeVerified",
    }
    public["revision"] = "changed by caller"
    assert identity.public_kernel_identity(PRODUCT)["revision"] != public["revision"]


def test_verifier_rejects_imports_from_another_checkout(tmp_path):
    from tools.kernel_release import verify_repository

    with pytest.raises(ValueError, match="different checkout"):
        verify_repository(tmp_path)
