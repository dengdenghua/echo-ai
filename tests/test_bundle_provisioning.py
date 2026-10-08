"""Tests for the kernel supply contract (``runtime/bundle.json``).

The mechanism is ported from the Kimi-desktop teardown
(``docs/audits/kimi-desktop-unpack-2026-09-22.md`` §3 P1-7).  The three rules
worth pinning down are the ones that decide whether a shipped update can
destroy a user's install: copy-missing-only, managed-override-wins, and
retire-explicitly.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import pytest

from runtime.platform.observability.doctor import DoctorReport
from runtime.platform.provisioning import bundle

REPO_ROOT = Path(__file__).resolve().parents[1]
SHIPPED_MANIFEST = REPO_ROOT / "runtime" / "bundle.json"


# ── fixtures ─────────────────────────────────────────────────────────


def _make_bundle(root: Path, *, managed: bool = False, retired: list[str] | None = None) -> Path:
    """A three-resource bundle: two skills and one prompt."""
    (root / "skills" / "alpha").mkdir(parents=True)
    (root / "skills" / "alpha" / "SKILL.md").write_text(
        "---\nname: alpha\ndescription: a\n---\n\nA\n", encoding="utf-8"
    )
    (root / "skills" / "beta").mkdir(parents=True)
    (root / "skills" / "beta" / "SKILL.md").write_text(
        "---\nname: beta\ndescription: b\n---\n\nB\n", encoding="utf-8"
    )
    (root / "prompts").mkdir()
    (root / "prompts" / "one.yaml").write_text("k: v\n", encoding="utf-8")
    (root / "runtime").mkdir()
    manifest_path = root / "runtime" / "bundle.json"
    document = {
        "schema": bundle.SCHEMA,
        "bundleId": "test-bundle",
        "version": "1.2.3",
        "root": "..",
        "platforms": ["any"],
        "runtimes": {"python": ">=3.10"},
        "entrypoints": {"cli": "runtime.cli:main"},
        "resourceRoots": [
            {"path": "skills", "kind": "skill-catalog", "expand": "dirs"},
            {"path": "prompts", "kind": "prompt-assets", "expand": "files"},
        ],
        "resources": [],
        "managedOverride": ["skills/beta"] if managed else [],
        "retired": list(retired or []),
    }
    manifest_path.write_text(bundle.dumps_manifest(document), encoding="utf-8", newline="\n")
    bundle.sync_manifest(manifest_path)
    return manifest_path


# ── digests ──────────────────────────────────────────────────────────


def test_path_digest_is_location_independent_but_content_sensitive(tmp_path: Path) -> None:
    first = tmp_path / "a"
    second = tmp_path / "elsewhere" / "a-copy"
    for base in (first, second):
        (base / "nested").mkdir(parents=True)
        (base / "one.txt").write_text("one\n", encoding="utf-8")
        (base / "nested" / "two.txt").write_text("two\n", encoding="utf-8")

    assert bundle.path_digest(first) == bundle.path_digest(second)

    (second / "nested" / "two.txt").write_text("TWO\n", encoding="utf-8")
    assert bundle.path_digest(first) != bundle.path_digest(second)


def test_path_digest_ignores_generated_state(tmp_path: Path) -> None:
    tree = tmp_path / "tree"
    (tree / "__pycache__").mkdir(parents=True)
    (tree / "mod.py").write_text("x = 1\n", encoding="utf-8")
    before = bundle.path_digest(tree)

    (tree / "__pycache__" / "mod.cpython-311.pyc").write_bytes(b"\x00\x01")
    (tree / ".DS_Store").write_bytes(b"junk")

    assert bundle.path_digest(tree) == before


def test_path_digest_rejects_a_missing_path(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        bundle.path_digest(tmp_path / "nope")


def test_canonical_digest_survives_reformatting() -> None:
    assert bundle.canonical_digest({"b": 1, "a": [1, 2]}) == bundle.canonical_digest(
        {"a": [1, 2], "b": 1}
    )
    assert bundle.canonical_digest({"a": 1}) != bundle.canonical_digest({"a": 2})


# ── platform tag + stamp ─────────────────────────────────────────────


def test_platform_tag_is_platform_arch() -> None:
    tag = bundle.platform_tag()
    assert "-" in tag
    assert tag.split("-", 1)[0] in {"win32", "linux", "darwin"}


def test_stamp_round_trips() -> None:
    stamp = bundle.Stamp(
        bundle_id="echo-runtime", version="0.2.0", platform="linux-x64", digest="sha256:ab"
    )
    assert bundle.parse_stamp(stamp.render()) == stamp


@pytest.mark.parametrize(
    "text", ["", "   ", "garbage", "a@b|only-two", "nostamp|win32-x64|sha256:ff"]
)
def test_parse_stamp_rejects_malformed_input(text: str) -> None:
    assert bundle.parse_stamp(text) is None


# ── manifest loading ─────────────────────────────────────────────────


def test_shipped_manifest_loads_and_verifies() -> None:
    manifest = bundle.load_manifest(SHIPPED_MANIFEST)
    assert manifest.schema == bundle.SCHEMA
    assert manifest.bundle_id == "echo-runtime"
    assert manifest.root == REPO_ROOT
    # The kernel payload is the repository root, not the manifest's directory.
    assert manifest.root_relative == ".."
    assert len(manifest.resources) > 40
    assert bundle.verify_manifest(manifest) == []


def test_load_manifest_accepts_the_bundle_directory(tmp_path: Path) -> None:
    manifest_path = _make_bundle(tmp_path)
    assert bundle.load_manifest(tmp_path / "runtime").path == manifest_path


def test_load_manifest_rejects_an_unknown_schema(tmp_path: Path) -> None:
    manifest_path = _make_bundle(tmp_path)
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    document["schema"] = "something.else.v9"
    manifest_path.write_text(bundle.dumps_manifest(document), encoding="utf-8", newline="\n")

    with pytest.raises(bundle.BundleManifestError, match="schema"):
        bundle.load_manifest(manifest_path)


@pytest.mark.parametrize("field", ["bundleId", "version", "platforms"])
def test_load_manifest_requires_identity_fields(tmp_path: Path, field: str) -> None:
    manifest_path = _make_bundle(tmp_path)
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    document.pop(field)
    manifest_path.write_text(bundle.dumps_manifest(document), encoding="utf-8", newline="\n")

    with pytest.raises(bundle.BundleManifestError):
        bundle.load_manifest(manifest_path)


def test_load_manifest_reports_a_missing_file(tmp_path: Path) -> None:
    with pytest.raises(bundle.BundleManifestError, match="no bundle.json"):
        bundle.load_manifest(tmp_path)


def test_load_manifest_rejects_invalid_json(tmp_path: Path) -> None:
    (tmp_path / "bundle.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(bundle.BundleManifestError, match="cannot read"):
        bundle.load_manifest(tmp_path)


def test_contract_digest_tracks_resources_but_not_provenance(tmp_path: Path) -> None:
    manifest_path = _make_bundle(tmp_path)
    before = bundle.load_manifest(manifest_path)

    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    document["provenance"] = {"gitHead": "deadbeef", "builtAt": "whenever"}
    manifest_path.write_text(bundle.dumps_manifest(document), encoding="utf-8", newline="\n")
    after_provenance = bundle.load_manifest(manifest_path)
    assert after_provenance.contract_digest() == before.contract_digest()

    document["resources"][0]["sha256"] = "sha256:" + "0" * 64
    manifest_path.write_text(bundle.dumps_manifest(document), encoding="utf-8", newline="\n")
    after_resource = bundle.load_manifest(manifest_path)
    assert after_resource.contract_digest() != before.contract_digest()


# ── manifest generation ──────────────────────────────────────────────


def test_sync_manifest_expands_roots_and_is_idempotent(tmp_path: Path) -> None:
    manifest_path = _make_bundle(tmp_path)
    manifest, changed = bundle.sync_manifest(manifest_path)

    assert changed is False
    assert [resource.path for resource in manifest.resources] == [
        "skills/alpha",
        "skills/beta",
        "prompts/one.yaml",
    ]
    for resource in manifest.resources:
        assert resource.sha256.startswith("sha256:")
        assert bundle.path_digest(tmp_path / resource.path) == resource.sha256


def test_sync_manifest_picks_up_an_edited_skill(tmp_path: Path) -> None:
    manifest_path = _make_bundle(tmp_path)
    skill = tmp_path / "skills" / "alpha" / "SKILL.md"
    skill.write_text(skill.read_text(encoding="utf-8") + "\nmore\n", encoding="utf-8")

    manifest, changed = bundle.sync_manifest(manifest_path)

    assert changed is True
    entry = next(r for r in manifest.resources if r.path == "skills/alpha")
    assert entry.sha256 == bundle.path_digest(tmp_path / "skills" / "alpha")


def test_expand_dirs_only_takes_direct_child_directories(tmp_path: Path) -> None:
    (tmp_path / "skills" / "alpha").mkdir(parents=True)
    (tmp_path / "skills" / "alpha" / "SKILL.md").write_text("x", encoding="utf-8")
    (tmp_path / "skills" / "loose.json").write_text("{}", encoding="utf-8")
    (tmp_path / "skills" / ".hidden").mkdir()

    expanded = bundle.ResourceRoot(path="skills", kind="skill-catalog", expand="dirs").expand_to(
        tmp_path
    )

    assert [resource.path for resource in expanded] == ["skills/alpha"]


def test_expand_files_honours_the_include_globs(tmp_path: Path) -> None:
    (tmp_path / "prompts").mkdir()
    (tmp_path / "prompts" / "a.yaml").write_text("a", encoding="utf-8")
    (tmp_path / "prompts" / "b.yml").write_text("b", encoding="utf-8")

    expanded = bundle.ResourceRoot(
        path="prompts", kind="prompt-assets", expand="files", include=("*.yaml",)
    ).expand_to(tmp_path)

    assert [resource.path for resource in expanded] == ["prompts/a.yaml"]


def test_expand_reports_a_missing_root(tmp_path: Path) -> None:
    with pytest.raises(bundle.BundleManifestError, match="does not exist"):
        bundle.ResourceRoot(path="nope", kind="x", expand="dirs").expand_to(tmp_path)


# ── verification ─────────────────────────────────────────────────────


def test_verify_manifest_flags_a_digest_mismatch(tmp_path: Path) -> None:
    manifest_path = _make_bundle(tmp_path)
    (tmp_path / "prompts" / "one.yaml").write_text("changed\n", encoding="utf-8")

    problems = bundle.verify_manifest(bundle.load_manifest(manifest_path))

    assert any("prompts/one.yaml" in problem and "mismatch" in problem for problem in problems)


def test_verify_manifest_flags_a_missing_resource(tmp_path: Path) -> None:
    manifest_path = _make_bundle(tmp_path)
    (tmp_path / "prompts" / "one.yaml").unlink()

    problems = bundle.verify_manifest(bundle.load_manifest(manifest_path))

    assert any("missing from the bundle" in problem for problem in problems)


def test_verify_manifest_flags_a_malformed_entrypoint(tmp_path: Path) -> None:
    manifest_path = _make_bundle(tmp_path)
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    document["entrypoints"] = {"cli": "runtime.cli.main"}
    manifest_path.write_text(bundle.dumps_manifest(document), encoding="utf-8", newline="\n")

    problems = bundle.verify_manifest(bundle.load_manifest(manifest_path))

    assert any("module:attribute" in problem for problem in problems)


def test_verify_manifest_flags_a_duplicate_resource(tmp_path: Path) -> None:
    manifest_path = _make_bundle(tmp_path)
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    document["resources"].append(dict(document["resources"][0]))
    manifest_path.write_text(bundle.dumps_manifest(document), encoding="utf-8", newline="\n")

    problems = bundle.verify_manifest(bundle.load_manifest(manifest_path))

    assert any("duplicate resource" in problem for problem in problems)


def test_verify_manifest_flags_an_override_that_is_not_marked_managed(tmp_path: Path) -> None:
    manifest_path = _make_bundle(tmp_path)
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    document["managedOverride"] = ["skills/beta"]
    manifest_path.write_text(bundle.dumps_manifest(document), encoding="utf-8", newline="\n")

    problems = bundle.verify_manifest(bundle.load_manifest(manifest_path))

    assert any("not marked managed" in problem for problem in problems)


# ── planning: the three rules ────────────────────────────────────────


def test_plan_copies_everything_into_an_empty_target(tmp_path: Path) -> None:
    manifest_path = _make_bundle(tmp_path / "source")
    target = tmp_path / "target"

    steps = bundle.plan_provision(bundle.load_manifest(manifest_path), target_root=target)

    assert {step.action for step in steps} == {"copy"}
    assert len(steps) == 3


def test_plan_is_empty_when_the_target_already_matches(tmp_path: Path) -> None:
    source = tmp_path / "source"
    manifest_path = _make_bundle(source)
    target = tmp_path / "target"
    bundle.ensure_provisioned(manifest_path, target)

    assert bundle.plan_provision(bundle.load_manifest(manifest_path), target_root=target) == []


def test_plan_leaves_a_user_edited_resource_alone(tmp_path: Path) -> None:
    """Rule 1: shipping an update must not silently undo local work."""
    source = tmp_path / "source"
    manifest_path = _make_bundle(source)
    target = tmp_path / "target"
    bundle.ensure_provisioned(manifest_path, target)
    edited = target / "skills" / "alpha" / "SKILL.md"
    edited.write_text("locally rewritten\n", encoding="utf-8")

    steps = bundle.plan_provision(bundle.load_manifest(manifest_path), target_root=target)

    assert [(step.action, step.path) for step in steps] == [("drifted", "skills/alpha")]

    bundle.apply_provision(steps, source_root=source, target_root=target)
    assert edited.read_text(encoding="utf-8") == "locally rewritten\n"


def test_plan_overwrites_a_managed_resource(tmp_path: Path) -> None:
    """Rule 2: the explicit override list is the one place staleness loses."""
    source = tmp_path / "source"
    manifest_path = _make_bundle(source, managed=True)
    target = tmp_path / "target"
    bundle.ensure_provisioned(manifest_path, target)
    edited = target / "skills" / "beta" / "SKILL.md"
    edited.write_text("locally rewritten\n", encoding="utf-8")

    steps = bundle.plan_provision(bundle.load_manifest(manifest_path), target_root=target)

    assert [(step.action, step.path) for step in steps] == [("overwrite", "skills/beta")]

    bundle.apply_provision(steps, source_root=source, target_root=target)
    assert "locally rewritten" not in edited.read_text(encoding="utf-8")


def test_plan_deletes_only_declared_retirements(tmp_path: Path) -> None:
    """Rule 3: dropping a resource from the list is not a deletion."""
    source = tmp_path / "source"
    manifest_path = _make_bundle(source)
    target = tmp_path / "target"
    bundle.ensure_provisioned(manifest_path, target)
    orphan = target / "skills" / "leftover-from-an-older-release"
    orphan.mkdir(parents=True)
    (orphan / "SKILL.md").write_text("old\n", encoding="utf-8")

    # Not retired yet: the orphan must survive untouched.
    assert bundle.plan_provision(bundle.load_manifest(manifest_path), target_root=target) == []
    assert orphan.is_dir()

    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    document["retired"] = ["skills/beta"]
    manifest_path.write_text(bundle.dumps_manifest(document), encoding="utf-8", newline="\n")

    steps = bundle.plan_provision(bundle.load_manifest(manifest_path), target_root=target)

    assert [(step.action, step.path) for step in steps] == [("delete", "skills/beta")]
    bundle.apply_provision(steps, source_root=source, target_root=target)
    assert not (target / "skills" / "beta").exists()
    # Still not the orphan: only the declared path is deleted.
    assert orphan.is_dir()


def test_plan_refuses_to_let_a_retirement_escape_the_target(tmp_path: Path) -> None:
    source = tmp_path / "source"
    manifest_path = _make_bundle(source)
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    document["retired"] = ["../../outside"]
    manifest_path.write_text(bundle.dumps_manifest(document), encoding="utf-8", newline="\n")
    target = tmp_path / "target"
    target.mkdir()

    with pytest.raises(bundle.BundleManifestError, match="escapes the target root"):
        bundle.plan_provision(bundle.load_manifest(manifest_path), target_root=target)


def test_plan_fails_closed_when_the_source_disagrees_with_the_manifest(tmp_path: Path) -> None:
    source = tmp_path / "source"
    manifest_path = _make_bundle(source)
    (source / "prompts" / "one.yaml").write_text("tampered\n", encoding="utf-8")

    with pytest.raises(bundle.BundleError, match="does not match its declared digest"):
        bundle.plan_provision(bundle.load_manifest(manifest_path), target_root=tmp_path / "target")


def test_plan_fails_closed_when_a_declared_resource_is_absent(tmp_path: Path) -> None:
    source = tmp_path / "source"
    manifest_path = _make_bundle(source)
    (source / "prompts" / "one.yaml").unlink()

    with pytest.raises(bundle.BundleError, match="declared resource missing"):
        bundle.plan_provision(bundle.load_manifest(manifest_path), target_root=tmp_path / "target")


# ── end to end ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "retired",
    [
        "",
        ".",
        "./",
        "././",
        pytest.param(
            ".\\",
            marks=pytest.mark.skipif(sys.platform != "win32", reason="Windows path separator"),
        ),
    ],
)
def test_retirement_cannot_name_the_install_root(tmp_path: Path, retired: str) -> None:
    manifest_path = _make_bundle(tmp_path / "source", retired=[retired])
    manifest = bundle.load_manifest(manifest_path)
    target = tmp_path / "target"
    target.mkdir()
    sentinel = target / "user-data.txt"
    sentinel.write_text("keep", encoding="utf-8")

    assert any("target root" in item for item in bundle.verify_manifest(manifest))
    with pytest.raises(bundle.BundleManifestError, match="target root"):
        bundle.ensure_provisioned(manifest_path, target)
    # Also reject direct application, before even a preceding copy is applied.
    with pytest.raises(bundle.BundleManifestError, match="target root"):
        bundle.apply_provision(
            [
                bundle.ProvisionStep("copy", "prompts/one.yaml"),
                bundle.ProvisionStep("delete", retired),
            ],
            source_root=manifest.root,
            target_root=target,
        )
    assert sentinel.read_text(encoding="utf-8") == "keep"
    assert list(target.iterdir()) == [sentinel]


def test_ensure_provisioned_applies_then_short_circuits_on_the_stamp(tmp_path: Path) -> None:
    source = tmp_path / "source"
    manifest_path = _make_bundle(source)
    target = tmp_path / "target"

    first = bundle.ensure_provisioned(manifest_path, target)
    assert first.status == "applied"
    assert first.stamp_written is True
    assert len(first.applied) == 3
    assert (target / bundle.STAMP_FILENAME).read_text(encoding="utf-8").strip() == (
        bundle.load_manifest(manifest_path).stamp(platform_name=bundle.platform_tag()).render()
    )
    assert (target / "skills" / "alpha" / "SKILL.md").is_file()

    second = bundle.ensure_provisioned(manifest_path, target)
    assert second.status == "up-to-date"
    assert second.steps == ()


def test_stamp_makes_provision_cheap_and_force_is_how_drift_is_seen(tmp_path: Path) -> None:
    """A matching stamp short-circuits the walk; ``force`` re-plans anyway.

    This is the deliberate trade: start-up does not re-hash 53 trees, so drift
    is only surfaced by an explicit ``--force`` (or by ``bundle verify``).
    """
    source = tmp_path / "source"
    manifest_path = _make_bundle(source)
    target = tmp_path / "target"
    bundle.ensure_provisioned(manifest_path, target)
    (target / "skills" / "alpha" / "SKILL.md").unlink()

    plain = bundle.ensure_provisioned(manifest_path, target)
    assert plain.status == "up-to-date"
    assert plain.steps == ()

    forced = bundle.ensure_provisioned(manifest_path, target, force=True)
    assert forced.status == "applied"
    assert [step.action for step in forced.steps] == ["drifted"]
    assert forced.drifted[0].path == "skills/alpha"


def test_a_wholly_deleted_resource_is_restored(tmp_path: Path) -> None:
    """Deleting the whole skill is "missing", so rule 1 copies it back."""
    source = tmp_path / "source"
    manifest_path = _make_bundle(source)
    target = tmp_path / "target"
    bundle.ensure_provisioned(manifest_path, target)
    shutil.rmtree(target / "skills" / "alpha")

    report = bundle.ensure_provisioned(manifest_path, target, force=True)

    assert [step.action for step in report.steps] == ["copy"]
    assert (target / "skills" / "alpha" / "SKILL.md").is_file()


def test_ensure_provisioned_plan_only_touches_nothing(tmp_path: Path) -> None:
    source = tmp_path / "source"
    manifest_path = _make_bundle(source)
    target = tmp_path / "target"

    report = bundle.ensure_provisioned(manifest_path, target, plan_only=True)

    assert report.status == "planned"
    assert not target.exists()


def test_ensure_provisioned_refuses_an_unsupported_platform(tmp_path: Path) -> None:
    source = tmp_path / "source"
    manifest_path = _make_bundle(source)
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    document["platforms"] = ["plan9-vax"]
    manifest_path.write_text(bundle.dumps_manifest(document), encoding="utf-8", newline="\n")

    with pytest.raises(bundle.BundleError, match="does not support"):
        bundle.ensure_provisioned(manifest_path, tmp_path / "target")


def test_provisioning_ignores_a_stamp_that_describes_a_different_contract(tmp_path: Path) -> None:
    source = tmp_path / "source"
    manifest_path = _make_bundle(source)
    target = tmp_path / "target"
    target.mkdir()
    (target / bundle.STAMP_FILENAME).write_text(
        "test-bundle@1.2.3|any|sha256:" + "0" * 64, encoding="utf-8"
    )

    report = bundle.ensure_provisioned(manifest_path, target)

    assert report.status == "applied"
    assert len(report.applied) == 3


def test_write_stamp_leaves_no_temporary_file_behind(tmp_path: Path) -> None:
    stamp_path = tmp_path / "nested" / ".stamp"
    stamp = bundle.Stamp(bundle_id="b", version="1", platform="p", digest="sha256:aa")

    bundle.write_stamp(stamp_path, stamp)

    assert stamp_path.read_text(encoding="utf-8") == stamp.render() + "\n"
    assert list(tmp_path.rglob("*.tmp")) == []


# ── CLI ──────────────────────────────────────────────────────────────


def test_cli_show_and_verify_report_the_shipped_bundle(capsys: pytest.CaptureFixture[str]) -> None:
    from runtime._cli_commands import run_bundle

    assert run_bundle(argparse.Namespace(manifest=None, bundle_op="show"), color=False) == 0
    shown = capsys.readouterr().out
    assert "echo-runtime" in shown
    assert "resources   : 53" in shown

    assert run_bundle(argparse.Namespace(manifest=None, bundle_op="verify"), color=False) == 0
    assert "resources intact" in capsys.readouterr().out


def test_cli_verify_fails_when_a_resource_drifted(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    from runtime._cli_commands import run_bundle

    manifest_path = _make_bundle(tmp_path)
    (tmp_path / "prompts" / "one.yaml").write_text("tampered\n", encoding="utf-8")

    rc = run_bundle(argparse.Namespace(manifest=manifest_path, bundle_op="verify"), color=False)

    assert rc == 1
    assert "problem(s)" in capsys.readouterr().out


def test_cli_provision_dry_run_writes_nothing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    from runtime._cli_commands import run_bundle

    manifest_path = _make_bundle(tmp_path / "source")
    target = tmp_path / "target"

    rc = run_bundle(
        argparse.Namespace(
            manifest=manifest_path,
            bundle_op="provision",
            target=target,
            stamp=None,
            dry_run=True,
            force=False,
        ),
        color=False,
    )

    assert rc == 0
    assert "planned" in capsys.readouterr().out
    assert not target.exists()


def test_cli_reports_a_broken_manifest(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    from runtime._cli_commands import run_bundle

    broken = tmp_path / "bundle.json"
    broken.write_text("{ nope", encoding="utf-8")

    rc = run_bundle(argparse.Namespace(manifest=broken, bundle_op="verify"), color=False)

    assert rc == 1
    assert "cannot read" in capsys.readouterr().out


# ── packaging wiring ─────────────────────────────────────────────────


def test_manifest_is_declared_as_packaged_data() -> None:
    """``runtime/bundle.json`` must survive into an sdist and a wheel.

    The manifest is useless if it only exists in a git checkout: the whole
    point is that a *shipped* kernel can state what it contains.  setuptools
    pulls files listed in ``MANIFEST.in`` that live inside a package into the
    wheel too, but only while ``include-package-data`` stays on.
    """

    assert SHIPPED_MANIFEST.is_file()
    manifest_in = (REPO_ROOT / "MANIFEST.in").read_text(encoding="utf-8")
    declared = {
        line.split(maxsplit=1)[1].strip()
        for line in manifest_in.splitlines()
        if line.startswith("include ") and len(line.split(maxsplit=1)) == 2
    }
    assert "runtime/bundle.json" in declared

    pyproject = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert "include-package-data = true" in pyproject


def test_provisioning_package_is_discoverable_and_reexports_its_api() -> None:
    """A new subpackage only ships if it looks like one to ``packages.find``."""

    package_root = REPO_ROOT / "runtime" / "platform" / "provisioning"
    assert (package_root / "__init__.py").is_file()

    import runtime.platform.provisioning as provisioning

    for name in ("ensure_provisioned", "load_manifest", "verify_manifest"):
        assert hasattr(provisioning, name), name


# ── doctor wiring ────────────────────────────────────────────────────


def _doctor_report() -> DoctorReport:
    from runtime.platform.observability.doctor import Doctor

    report = DoctorReport()
    Doctor()._check_kernel_bundle(report)
    return report


def test_doctor_reports_the_shipped_kernel_as_intact() -> None:
    report = _doctor_report()

    assert len(report.results) == 1
    result = report.results[0]
    assert result.status == "ok", result.message
    assert "echo-runtime" in result.message
    assert "53 resources intact" in result.message


def test_doctor_warns_about_a_drifted_kernel_without_touching_it(tmp_path: Path) -> None:
    from runtime.platform.observability.doctor import Doctor, DoctorReport

    manifest_path = _make_bundle(tmp_path)
    edited = tmp_path / "prompts" / "one.yaml"
    edited.write_text("tampered\n", encoding="utf-8")

    report = DoctorReport()
    Doctor()._check_kernel_bundle(report, manifest_path)

    assert len(report.results) == 1
    result = report.results[0]
    assert result.status == "warn", result.message
    assert "1 resource(s) disagree" in result.message
    assert "echo-ai bundle verify" in result.fix_hint
    # Diagnosis must stay read-only: the drifted file is exactly as the user left it.
    assert edited.read_text(encoding="utf-8") == "tampered\n"


def test_doctor_fails_loudly_on_an_unreadable_manifest(tmp_path: Path) -> None:
    from runtime.platform.observability.doctor import Doctor, DoctorReport

    broken = tmp_path / "bundle.json"
    broken.write_text("{ nope", encoding="utf-8")

    report = DoctorReport()
    Doctor()._check_kernel_bundle(report, broken)

    assert report.results[0].status == "fail"
    assert report.fail_count == 1


def test_doctor_warns_when_the_manifest_is_absent(tmp_path: Path) -> None:
    from runtime.platform.observability.doctor import Doctor, DoctorReport

    report = DoctorReport()
    Doctor()._check_kernel_bundle(report, tmp_path / "nope" / "bundle.json")

    assert report.results[0].status == "warn"
    assert report.all_ok  # a missing manifest is a warning, not a failed install
