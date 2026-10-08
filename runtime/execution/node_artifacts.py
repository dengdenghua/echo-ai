"""Bounded execution snapshots and byte-verified remote deliveries."""

from __future__ import annotations

import base64
import hashlib
from pathlib import Path, PureWindowsPath
from typing import Any

from runtime.platform.io.atomic import atomic_write_bytes
from runtime.platform.io.file_coordination import coordinate_file_mutations
from runtime.workspace.directory_sync import _file, _hash, _scan

MAX_ARTIFACT = 8 * 1024 * 1024
MAX_DELIVERY = 32 * 1024 * 1024


def relative_path(name: str) -> str:
    name = name.replace("\\", "/")
    if (
        not name
        or name.startswith("/")
        or PureWindowsPath(name).drive
        or any(
            p in {"", ".", ".."}
            or p.endswith((".", " "))
            or ":" in p
            or PureWindowsPath(p).is_reserved()
            for p in name.split("/")
        )
    ):
        raise ValueError("artifact path must be relative to the workspace")
    return name


def snapshot(source: Path, target: Path) -> dict[str, str]:
    source = source.resolve(strict=True)
    target = target.resolve()
    if target.is_relative_to(source) or source.is_relative_to(target):
        raise ValueError("snapshot must be outside the source workspace")
    before, _ = _scan(source)
    target.mkdir(parents=True, exist_ok=False)
    for name, digest in before.items():
        data = _file(source, name).read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError("workspace changed while taking execution snapshot")
        dest = target / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    if _scan(source)[0] != before:
        raise ValueError("workspace changed while taking execution snapshot")
    return before


def collect_outputs(
    root: Path, baseline: dict[str, str], declared: list[str]
) -> list[dict[str, Any]]:
    root = root.resolve(strict=True)
    current, _ = _scan(root)
    names = (
        [relative_path(n) for n in declared]
        if declared
        else [n for n, h in current.items() if baseline.get(n) != h]
    )
    if len(names) > 32:
        raise ValueError("delivery exceeds 32 files")
    result = []
    total = 0
    for name in names:
        path = _file(root, name)
        if not path.is_file() or path.stat().st_size > MAX_ARTIFACT:
            raise ValueError(f"output missing or exceeds 8 MiB: {name}")
        data = path.read_bytes()
        total += len(data)
        if len(data) > MAX_ARTIFACT or total > MAX_DELIVERY:
            raise ValueError("delivery exceeds size limit")
        result.append(
            dict(
                path=name,
                sha256=hashlib.sha256(data).hexdigest(),
                size=len(data),
                baseline_sha256=baseline.get(name),
                content=base64.b64encode(data).decode("ascii"),
            )
        )
    return result


def receive_artifact(root: Path, body: dict[str, Any]) -> dict[str, Any]:
    name = relative_path(body["path"])
    data = base64.b64decode(body["content"], validate=True)
    digest = hashlib.sha256(data).hexdigest()
    if len(data) > MAX_ARTIFACT or digest != body["sha256"]:
        raise ValueError("artifact size or digest mismatch")
    with coordinate_file_mutations([root / ".storage-quota"]):
        root.mkdir(parents=True, exist_ok=True)
        path = root / digest
        if path.exists():
            if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise ValueError("stored artifact is corrupt")
        else:
            stored = sum(p.stat().st_size for p in root.iterdir() if p.is_file())
            if stored + len(data) > MAX_DELIVERY:
                raise ValueError("delivery storage limit reached")
            atomic_write_bytes(path, data, keep_backup=False)
    return dict(
        path=name, sha256=digest, size=len(data), baseline_sha256=body.get("baseline_sha256")
    )


def apply_delivery(workspace: Path, artifacts_root: Path, artifacts: list[dict[str, Any]]) -> None:
    workspace = workspace.resolve(strict=True)
    targets = [_file(workspace, relative_path(a["path"])) for a in artifacts]
    if len(set(targets)) != len(targets):
        raise ValueError("duplicate delivery paths")
    with coordinate_file_mutations(targets):
        pending = []
        for target, artifact in zip(targets, artifacts, strict=True):
            digest = artifact["sha256"]
            if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
                raise ValueError("invalid artifact digest")
            data = (artifacts_root / digest).read_bytes()
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError("stored artifact is corrupt")
            current = _hash(target)
            if current == digest:
                continue  # Repeated apply after a lost HTTP response is harmless.
            if current != artifact.get("baseline_sha256"):
                raise ValueError(f"workspace changed; preserve conflict: {target.name}")
            pending.append((target, data))
        for target, data in pending:
            target.parent.mkdir(parents=True, exist_ok=True)
            _file(workspace, target.relative_to(workspace).as_posix())
            atomic_write_bytes(target, data)
