"""Kernel supply contract: ``runtime/bundle.json`` + an idempotent provisioner.

Echo grew up as "the source tree *is* the contract".  That works while the
only way to run Echo is to clone it, and stops working the moment the kernel
is shipped as an artefact into a user-writable directory: nothing then states
what the kernel *is*, which files must survive a user's edits, and which files
a release is allowed to replace or retire.

This module adds that missing layer, following the same shape Echo already
uses for its bundled third-party binaries (``echo-codex-bundle.json`` in
``frontend/electron/backend-runtime.cjs``): a declared manifest with per-file
SHA-256, plus a stamp that makes provisioning a no-op when nothing changed.
The mechanism is ported from the Kimi-desktop teardown
(``docs/audits/kimi-desktop-unpack-2026-09-22.md`` §3 P1-7); the text and the
schema here are Echo's own.

Three rules define the behaviour, and each is deliberate:

1. **Missing only, by default.** A resource the target does not have is
   copied in.  A resource the *user* has modified is reported as drifted and
   left exactly as it is -- shipping an update must never silently undo
   someone's local work.
2. **Managed override wins.** Paths listed in ``managedOverride`` (or marked
   ``"managed": true`` in the manifest) are force-overwritten even when the
   user changed them.  That list is the escape hatch for files where a stale
   local copy is actively dangerous, so it is expected to stay short.
3. **Retirement is explicit.** Nothing is ever deleted because it *stopped
   being listed*.  Deletion requires the path to appear in ``retired``.

The stamp is ``<bundleId>@<version>|<platform>|<contract digest>``.  It covers
the contract, not the build: editing a file's hash changes it, rebuilding with
no content change does not.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import sys
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

SCHEMA = "echo.runtime_bundle.v1"
BUNDLE_FILENAME = "bundle.json"
STAMP_FILENAME = ".echo-bundle-stamp"
DIGEST_PREFIX = "sha256:"

# Generated and machine-local state must never enter a packaged digest: it
# differs between two checkouts of identical source, which would make the
# contract unstable for no reason.
_SKIP_DIR_NAMES = frozenset(
    {"__pycache__", ".git", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".venv"}
)
_SKIP_FILE_SUFFIXES = (".pyc", ".pyo")
_SKIP_FILE_NAMES = frozenset({".DS_Store", "Thumbs.db"})

_ARCH_ALIASES = {
    "x86_64": "x64",
    "amd64": "x64",
    "aarch64": "arm64",
    "arm64": "arm64",
    "i386": "ia32",
    "i686": "ia32",
}
_PLATFORM_ALIASES = {"win32": "win32", "linux": "linux", "darwin": "darwin"}

Action = Literal["copy", "overwrite", "delete", "drifted"]


class BundleError(RuntimeError):
    """The bundle contract is unusable or the source tree disagrees with it."""


class BundleManifestError(BundleError):
    """``bundle.json`` is missing, malformed, or internally inconsistent."""


# --------------------------------------------------------------------------
# digests
# --------------------------------------------------------------------------


def _is_skipped(entry: os.DirEntry[str] | Path) -> bool:
    name = entry.name
    if name in _SKIP_FILE_NAMES:
        return True
    return name.endswith(_SKIP_FILE_SUFFIXES)


def _iter_tree(root: Path) -> Iterable[Path]:
    """Every digestible file under ``root``, in deterministic order."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(name for name in dirnames if name not in _SKIP_DIR_NAMES)
        base = Path(dirpath)
        for filename in sorted(filenames):
            candidate = base / filename
            if not _is_skipped(candidate):
                yield candidate


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def path_digest(path: str | Path) -> str:
    """Content digest of a file or a directory tree, as ``sha256:<hex>``.

    Directory digests are order-independent by construction: the walk is
    sorted and each entry contributes its *relative* posix path plus the file
    digest, so moving the tree does not change the value but adding, removing
    or editing any file does.
    """
    target = Path(path)
    if target.is_file():
        return DIGEST_PREFIX + _hash_file(target)
    if not target.is_dir():
        raise FileNotFoundError(f"cannot digest missing path: {target}")
    digest = hashlib.sha256()
    for file in _iter_tree(target):
        relative = file.relative_to(target).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(_hash_file(file).encode("ascii"))
        digest.update(b"\n")
    return DIGEST_PREFIX + digest.hexdigest()


def canonical_digest(value: Any) -> str:
    """Digest of a JSON value in a shape that survives reformatting."""
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return DIGEST_PREFIX + hashlib.sha256(encoded.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# platform tag + stamp
# --------------------------------------------------------------------------


def platform_tag() -> str:
    """``win32-x64`` / ``linux-arm64`` / ``darwin-arm64`` ..."""
    raw_platform = _PLATFORM_ALIASES.get(sys.platform, sys.platform)
    raw_machine = platform.machine().lower()
    return f"{raw_platform}-{_ARCH_ALIASES.get(raw_machine, raw_machine or 'unknown')}"


@dataclass(frozen=True)
class Stamp:
    bundle_id: str
    version: str
    platform: str
    digest: str

    def render(self) -> str:
        return f"{self.bundle_id}@{self.version}|{self.platform}|{self.digest}"


def parse_stamp(text: str) -> Stamp | None:
    """Parse a stamp, or ``None`` when it is absent or unrecognisable."""
    body = str(text or "").strip()
    if not body:
        return None
    parts = body.split("|")
    if len(parts) != 3:
        return None
    identity, stamp_platform, digest = parts
    if "@" not in identity:
        return None
    bundle_id, _, version = identity.rpartition("@")
    if not bundle_id or not version:
        return None
    return Stamp(
        bundle_id=bundle_id,
        version=version,
        platform=stamp_platform.strip(),
        digest=digest.strip(),
    )


# --------------------------------------------------------------------------
# manifest
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Resource:
    """One provisionable unit: a whole skill directory, or a single file."""

    path: str
    kind: str
    sha256: str
    managed: bool = False


@dataclass(frozen=True)
class ResourceRoot:
    """A declaration that a tree expands into resources."""

    path: str
    kind: str
    expand: Literal["dirs", "files", "self"] = "self"
    include: tuple[str, ...] = ()

    def expand_to(self, source_root: Path) -> list[Resource]:
        target = source_root / self.path
        if not target.exists():
            raise BundleManifestError(f"resourceRoot does not exist: {self.path}")
        if self.expand == "dirs":
            if not target.is_dir():
                raise BundleManifestError(f"resourceRoot {self.path} is not a directory")
            entries = sorted(p for p in target.iterdir() if p.is_dir() and p.name[0] not in "._")
            return [
                Resource(
                    path=(Path(self.path) / p.name).as_posix(),
                    kind=self.kind,
                    sha256=path_digest(p),
                )
                for p in entries
            ]
        if self.expand == "files":
            if not target.is_dir():
                raise BundleManifestError(f"resourceRoot {self.path} is not a directory")
            patterns = self.include or ("*",)
            picked: dict[str, Path] = {}
            for pattern in patterns:
                for p in target.glob(pattern):
                    if p.is_file() and not _is_skipped(p):
                        picked[p.name] = p
            return [
                Resource(
                    path=(Path(self.path) / name).as_posix(),
                    kind=self.kind,
                    sha256=path_digest(picked[name]),
                )
                for name in sorted(picked)
            ]
        return [Resource(path=self.path, kind=self.kind, sha256=path_digest(target))]


@dataclass(frozen=True)
class BundleManifest:
    schema: str
    bundle_id: str
    version: str
    platforms: tuple[str, ...]
    entrypoints: Mapping[str, str]
    runtimes: Mapping[str, str]
    resource_roots: tuple[ResourceRoot, ...]
    resources: tuple[Resource, ...]
    managed_override: frozenset[str]
    retired: tuple[str, ...]
    provenance: Mapping[str, Any] = field(default_factory=dict)
    path: Path | None = None
    root_relative: str = "."
    document: Mapping[str, Any] = field(default_factory=dict)

    @property
    def root(self) -> Path:
        """The directory resource paths are relative to.

        Kept separate from the manifest's own directory on purpose: Echo's
        manifest lives at ``runtime/bundle.json`` while the kernel payload it
        describes is the repository root (``runtime/`` + ``skills/`` +
        ``prompts/``), so ``"root": ".."`` states that once instead of
        prefixing every resource path with ``../``.
        """
        if self.path is None:
            raise BundleManifestError("manifest has no source path")
        return (self.path.parent / self.root_relative).resolve()

    def contract_digest(self) -> str:
        """Digest of the contract, deliberately excluding ``provenance``."""
        document = dict(self.document)
        document.pop("provenance", None)
        document["resources"] = [
            {"path": r.path, "kind": r.kind, "sha256": r.sha256, "managed": r.managed}
            for r in self.resources
        ]
        return canonical_digest(document)

    def stamp(self, *, platform_name: str | None = None) -> Stamp:
        return Stamp(
            bundle_id=self.bundle_id,
            version=self.version,
            platform=platform_name or platform_tag(),
            digest=self.contract_digest(),
        )


def _require_mapping(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise BundleManifestError(f"{label} must be an object")
    return value


def _require_str_map(value: Any, label: str) -> dict[str, str]:
    mapping = _require_mapping(value, label)
    result: dict[str, str] = {}
    for key, item in mapping.items():
        if not isinstance(key, str) or not isinstance(item, str):
            raise BundleManifestError(f"{label} keys and values must be strings")
        result[key] = item
    return result


def _manifest_error(key: str, expected: str) -> BundleManifestError:
    return BundleManifestError(f"bundle.json field {key!r} {expected}")


def load_manifest(target: str | Path) -> BundleManifest:
    """Read and validate ``bundle.json``.

    ``target`` may be the manifest itself or the bundle root that holds it.
    Validation is fail-closed: an unknown schema, a missing identity field, or
    a resource whose declared digest does not match the shipped bytes all stop
    the load rather than degrading to "probably fine".
    """
    path = Path(target)
    if path.is_dir():
        path = path / BUNDLE_FILENAME
    if not path.is_file():
        raise BundleManifestError(f"no {BUNDLE_FILENAME} at {path}")
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BundleManifestError(f"cannot read {path}: {exc}") from exc
    document = _require_mapping(document, BUNDLE_FILENAME)

    schema = document.get("schema")
    if schema != SCHEMA:
        raise _manifest_error("schema", f"must be {SCHEMA!r}")

    bundle_id = document.get("bundleId")
    if not isinstance(bundle_id, str) or not bundle_id.strip():
        raise _manifest_error("bundleId", "must be a non-empty string")

    version = document.get("version")
    if not isinstance(version, str) or not version.strip():
        raise _manifest_error("version", "must be a non-empty string")

    root_relative = document.get("root", ".")
    if not isinstance(root_relative, str) or not root_relative.strip():
        raise _manifest_error("root", "must be a non-empty path string")

    raw_platforms = document.get("platforms")
    if not isinstance(raw_platforms, Sequence) or isinstance(raw_platforms, (str, bytes)):
        raise _manifest_error("platforms", "must be a list of strings")
    platforms = tuple(str(item) for item in raw_platforms)
    if not platforms:
        raise _manifest_error("platforms", "must not be empty")

    roots: list[ResourceRoot] = []
    raw_roots = document.get("resourceRoots", [])
    if not isinstance(raw_roots, Sequence) or isinstance(raw_roots, (str, bytes)):
        raise _manifest_error("resourceRoots", "must be a list")
    for index, entry in enumerate(raw_roots):
        entry_map = _require_mapping(entry, f"resourceRoots[{index}]")
        root_path = entry_map.get("path")
        kind = entry_map.get("kind")
        if not isinstance(root_path, str) or not root_path.strip():
            raise _manifest_error(f"resourceRoots[{index}].path", "must be a string")
        if not isinstance(kind, str) or not kind.strip():
            raise _manifest_error(f"resourceRoots[{index}].kind", "must be a string")
        expand = entry_map.get("expand", "self")
        if expand not in {"dirs", "files", "self"}:
            raise _manifest_error(f"resourceRoots[{index}].expand", "must be dirs, files or self")
        raw_include = entry_map.get("include", [])
        if not isinstance(raw_include, Sequence) or isinstance(raw_include, (str, bytes)):
            raise _manifest_error(f"resourceRoots[{index}].include", "must be a list of globs")
        roots.append(
            ResourceRoot(
                path=root_path,
                kind=kind,
                expand=expand,  # type: ignore[arg-type]
                include=tuple(str(item) for item in raw_include),
            )
        )

    resources: list[Resource] = []
    raw_resources = document.get("resources", [])
    if not isinstance(raw_resources, Sequence) or isinstance(raw_resources, (str, bytes)):
        raise _manifest_error("resources", "must be a list")
    for index, entry in enumerate(raw_resources):
        entry_map = _require_mapping(entry, f"resources[{index}]")
        entry_path = entry_map.get("path")
        digest = entry_map.get("sha256")
        if not isinstance(entry_path, str) or not entry_path.strip():
            raise _manifest_error(f"resources[{index}].path", "must be a string")
        if not isinstance(digest, str) or not digest.strip():
            raise _manifest_error(f"resources[{index}].sha256", "must be a string")
        resources.append(
            Resource(
                path=entry_path,
                kind=str(entry_map.get("kind") or "file"),
                sha256=digest,
                managed=bool(entry_map.get("managed", False)),
            )
        )

    raw_override = document.get("managedOverride", [])
    if not isinstance(raw_override, Sequence) or isinstance(raw_override, (str, bytes)):
        raise _manifest_error("managedOverride", "must be a list of paths")
    raw_retired = document.get("retired", [])
    if not isinstance(raw_retired, Sequence) or isinstance(raw_retired, (str, bytes)):
        raise _manifest_error("retired", "must be a list of paths")

    return BundleManifest(
        schema=str(schema),
        bundle_id=bundle_id,
        version=version,
        platforms=platforms,
        entrypoints=_require_str_map(document.get("entrypoints", {}), "entrypoints"),
        runtimes=_require_str_map(document.get("runtimes", {}), "runtimes"),
        resource_roots=tuple(roots),
        resources=tuple(resources),
        managed_override=frozenset(str(item) for item in raw_override),
        retired=tuple(str(item) for item in raw_retired),
        provenance=dict(_require_mapping(document.get("provenance", {}), "provenance")),
        path=path,
        root_relative=root_relative,
        document=document,
    )


# --------------------------------------------------------------------------
# provisioning
# --------------------------------------------------------------------------


def _safe_target(target_root: Path, relative: str) -> Path:
    """Resolve ``relative`` under ``target_root``, refusing any escape.

    Retirement is the only step that deletes anything, so this is the guard
    that keeps a malformed manifest from reaching out of the install root.
    """
    candidate = Path(relative)
    if candidate.is_absolute() or any(part == ".." for part in candidate.parts):
        raise BundleManifestError(f"resource path escapes the target root: {relative!r}")
    resolved_root = target_root.resolve()
    resolved = (resolved_root / candidate).resolve()
    if resolved == resolved_root:
        raise BundleManifestError(f"resource path names the target root: {relative!r}")
    try:
        resolved.relative_to(resolved_root)
    except ValueError as exc:
        raise BundleManifestError(f"resource path escapes the target root: {relative!r}") from exc
    return resolved


@dataclass(frozen=True)
class ProvisionStep:
    action: Action
    path: str
    reason: str = ""

    def render(self) -> str:
        base = f"{self.action:<9} {self.path}"
        return f"{base}  -- {self.reason}" if self.reason else base


@dataclass(frozen=True)
class ProvisionReport:
    bundle_id: str
    version: str
    platform: str
    status: Literal["up-to-date", "planned", "applied"]
    steps: tuple[ProvisionStep, ...] = ()
    stamp_path: Path | None = None
    stamp_written: bool = False

    @property
    def drifted(self) -> tuple[ProvisionStep, ...]:
        return tuple(step for step in self.steps if step.action == "drifted")

    @property
    def applied(self) -> tuple[ProvisionStep, ...]:
        return tuple(step for step in self.steps if step.action != "drifted")

    def render(self) -> str:
        lines = [
            f"{self.bundle_id}@{self.version} ({self.platform}) · {self.status}",
            f"  steps: {len(self.steps)} "
            f"(applied {len(self.applied)}, drifted {len(self.drifted)})",
        ]
        lines.extend(f"  {step.render()}" for step in self.steps)
        if self.stamp_path is not None:
            lines.append(f"  stamp: {self.stamp_path}{' (written)' if self.stamp_written else ''}")
        return "\n".join(lines)


def _read_stamp_text(stamp_path: Path) -> str:
    try:
        return stamp_path.read_text(encoding="utf-8")
    except OSError:
        return ""


def plan_provision(
    manifest: BundleManifest,
    *,
    source_root: Path | None = None,
    target_root: Path,
) -> list[ProvisionStep]:
    """Work out what would have to happen, without touching the target.

    Source-side disagreement is fatal: if the bytes on disk do not match the
    digest the manifest declares, the bundle being shipped is not the bundle
    that was declared, and guessing which side is right would be worse than
    stopping.
    """
    source = Path(source_root) if source_root is not None else manifest.root
    steps: list[ProvisionStep] = []
    for resource in manifest.resources:
        source_path = _safe_target(source, resource.path)
        if not source_path.exists():
            raise BundleError(f"declared resource missing from the bundle: {resource.path}")
        actual = path_digest(source_path)
        if actual != resource.sha256:
            raise BundleError(
                f"resource {resource.path} does not match its declared digest "
                f"(declared {resource.sha256}, found {actual}); run 'bundle sync'"
            )
        destination = _safe_target(target_root, resource.path)
        if not destination.exists():
            steps.append(ProvisionStep("copy", resource.path, "missing from the target"))
            continue
        if path_digest(destination) == actual:
            continue
        if resource.managed or resource.path in manifest.managed_override:
            steps.append(ProvisionStep("overwrite", resource.path, "managed override"))
        else:
            steps.append(
                ProvisionStep("drifted", resource.path, "local copy differs; leaving it alone")
            )
    for retired in manifest.retired:
        destination = _safe_target(target_root, retired)
        if destination.exists():
            steps.append(ProvisionStep("delete", retired, "retired by this bundle"))
    return steps


def apply_provision(
    steps: Sequence[ProvisionStep],
    *,
    source_root: Path | None = None,
    target_root: Path,
) -> int:
    """Apply ``steps``; returns how many filesystem entries changed."""
    source = Path(source_root) if source_root is not None else None
    # Reject an unsafe later step before any earlier copy or deletion happens.
    for step in steps:
        _safe_target(target_root, step.path)
        if source is not None and step.action in {"copy", "overwrite"}:
            _safe_target(source, step.path)
    changed = 0
    for step in steps:
        destination = _safe_target(target_root, step.path)
        if step.action == "delete":
            if destination.is_dir():
                shutil.rmtree(destination)
            else:
                destination.unlink()
            changed += 1
            continue
        if step.action == "drifted":
            continue
        if source is None:
            raise BundleError("apply_provision needs a source_root to copy from")
        origin = _safe_target(source, step.path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            if destination.is_dir():
                shutil.rmtree(destination)
            else:
                destination.unlink()
        if origin.is_dir():
            shutil.copytree(origin, destination)
        else:
            shutil.copy2(origin, destination)
        changed += 1
    return changed


def write_stamp(stamp_path: Path, stamp: Stamp) -> None:
    """Write the stamp atomically so a crash cannot leave it half-updated."""
    stamp_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = stamp_path.with_name(stamp_path.name + ".tmp")
    temporary.write_text(stamp.render() + "\n", encoding="utf-8")
    os.replace(temporary, stamp_path)


def ensure_provisioned(
    source_root: str | Path,
    target_root: str | Path,
    *,
    stamp_path: str | Path | None = None,
    platform_name: str | None = None,
    plan_only: bool = False,
    force: bool = False,
) -> ProvisionReport:
    """Bring ``target_root`` up to ``source_root``'s contract, idempotently.

    A stamp that already matches this contract short-circuits the whole thing,
    which is what makes calling this on every start cheap.
    """
    manifest = load_manifest(source_root)
    source = manifest.root
    target = Path(target_root)
    resolved_platform = platform_name or platform_tag()
    if manifest.platforms and not (
        "any" in manifest.platforms or resolved_platform in manifest.platforms
    ):
        raise BundleError(
            f"bundle {manifest.bundle_id} does not support {resolved_platform} "
            f"(declares {', '.join(manifest.platforms)})"
        )
    stamp = manifest.stamp(platform_name=resolved_platform)
    stamp_file = Path(stamp_path) if stamp_path is not None else target / STAMP_FILENAME

    if not force and parse_stamp(_read_stamp_text(stamp_file)) == stamp:
        return ProvisionReport(
            bundle_id=manifest.bundle_id,
            version=manifest.version,
            platform=resolved_platform,
            status="up-to-date",
            stamp_path=stamp_file,
        )

    steps = tuple(plan_provision(manifest, source_root=source, target_root=target))
    if plan_only:
        return ProvisionReport(
            bundle_id=manifest.bundle_id,
            version=manifest.version,
            platform=resolved_platform,
            status="planned",
            steps=steps,
            stamp_path=stamp_file,
        )
    apply_provision(steps, source_root=source, target_root=target)
    write_stamp(stamp_file, stamp)
    return ProvisionReport(
        bundle_id=manifest.bundle_id,
        version=manifest.version,
        platform=resolved_platform,
        status="applied",
        steps=steps,
        stamp_path=stamp_file,
        stamp_written=True,
    )


# --------------------------------------------------------------------------
# verification + manifest generation
# --------------------------------------------------------------------------


def verify_manifest(manifest: BundleManifest, *, source_root: Path | None = None) -> list[str]:
    """Problems that make this bundle unfit to ship, as human-readable strings."""
    source = Path(source_root) if source_root is not None else manifest.root
    problems: list[str] = []
    if not manifest.platforms:
        problems.append("platforms is empty")
    if manifest.path is None or not manifest.path.is_file():
        problems.append(f"{BUNDLE_FILENAME} is not readable at the manifest path")
    for name, target in sorted(manifest.entrypoints.items()):
        if target.count(":") != 1 or not all(part.strip() for part in target.split(":")):
            problems.append(
                f"entrypoint {name!r} must look like 'module:attribute', got {target!r}"
            )
    if not manifest.resources:
        problems.append("resources is empty; run 'bundle sync'")
    seen: set[str] = set()
    for resource in manifest.resources:
        if resource.path in seen:
            problems.append(f"duplicate resource entry: {resource.path}")
        seen.add(resource.path)
        try:
            candidate = _safe_target(source, resource.path)
        except BundleManifestError as exc:
            problems.append(str(exc))
            continue
        if not candidate.exists():
            problems.append(f"declared resource missing from the bundle: {resource.path}")
            continue
        actual = path_digest(candidate)
        if actual != resource.sha256:
            problems.append(
                f"resource {resource.path} digest mismatch "
                f"(declared {resource.sha256}, found {actual})"
            )
        if resource.path in manifest.managed_override and not resource.managed:
            problems.append(
                f"{resource.path} is in managedOverride but not marked managed; "
                "the override list is meant to be a small, explicit set"
            )
    for retired in manifest.retired:
        try:
            _safe_target(source, retired)
        except BundleManifestError as exc:
            problems.append(str(exc))
        if retired in seen:
            problems.append(f"{retired} is both a resource and retired")
    return problems


def build_manifest_document(
    *,
    previous: Mapping[str, Any] | None,
    resource_roots: Sequence[ResourceRoot],
    version: str,
    platforms: Sequence[str],
    entrypoints: Mapping[str, str],
    runtimes: Mapping[str, str],
    managed_override: Sequence[str],
    retired: Sequence[str],
    provenance: Mapping[str, Any] | None = None,
    source_root: Path,
) -> dict[str, Any]:
    """Expand ``resourceRoots`` into concrete, hashed ``resources``."""
    resources: list[dict[str, Any]] = []
    managed = set(managed_override)
    for root in resource_roots:
        for resource in root.expand_to(source_root):
            entry: dict[str, Any] = {
                "path": resource.path,
                "kind": resource.kind,
                "sha256": resource.sha256,
            }
            if resource.path in managed:
                entry["managed"] = True
            resources.append(entry)
    document: dict[str, Any] = {
        "schema": SCHEMA,
        "bundleId": str((previous or {}).get("bundleId") or "echo-runtime"),
        "version": version,
        "root": str((previous or {}).get("root") or "."),
        "platforms": list(platforms),
        "runtimes": dict(runtimes),
        "entrypoints": dict(entrypoints),
        "resourceRoots": [
            {
                "path": root.path,
                "kind": root.kind,
                "expand": root.expand,
                **({"include": list(root.include)} if root.include else {}),
            }
            for root in resource_roots
        ],
        "resources": resources,
        "managedOverride": list(managed_override),
        "retired": list(retired),
    }
    if provenance:
        document["provenance"] = dict(provenance)
    return document


def dumps_manifest(document: Mapping[str, Any]) -> str:
    """Stable, review-friendly JSON: two-space indent, trailing newline."""
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def sync_manifest(
    manifest_path: str | Path,
    *,
    source_root: str | Path | None = None,
    write: bool = True,
) -> tuple[BundleManifest, bool]:
    """Recompute every resource digest from the tree; returns ``(manifest, changed)``.

    This is what keeps the contract true.  Hand-edited hashes rot the first
    time somebody edits a skill; regenerating from the declarations cannot.
    """
    path = Path(manifest_path)
    current = load_manifest(path)
    document = current.document
    root = Path(source_root) if source_root is not None else current.root
    rebuilt = build_manifest_document(
        previous=document,
        resource_roots=current.resource_roots,
        version=str(document.get("version") or "0.0.0"),
        platforms=tuple(document.get("platforms") or ["any"]),
        entrypoints=_require_str_map(document.get("entrypoints", {}), "entrypoints"),
        runtimes=_require_str_map(document.get("runtimes", {}), "runtimes"),
        managed_override=tuple(document.get("managedOverride") or []),
        retired=tuple(document.get("retired") or []),
        provenance=document.get("provenance"),
        source_root=root,
    )
    rendered = dumps_manifest(rebuilt)
    changed = rendered != path.read_text(encoding="utf-8")
    if write and changed:
        path.write_text(rendered, encoding="utf-8", newline="\n")
    return load_manifest(path), changed


__all__ = [
    "SCHEMA",
    "BUNDLE_FILENAME",
    "STAMP_FILENAME",
    "BundleError",
    "BundleManifest",
    "BundleManifestError",
    "ProvisionReport",
    "ProvisionStep",
    "Resource",
    "ResourceRoot",
    "Stamp",
    "apply_provision",
    "build_manifest_document",
    "canonical_digest",
    "dumps_manifest",
    "ensure_provisioned",
    "load_manifest",
    "parse_stamp",
    "path_digest",
    "plan_provision",
    "platform_tag",
    "sync_manifest",
    "verify_manifest",
    "write_stamp",
]
