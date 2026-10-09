"""Immutable, bounded project inputs transported independently of node mounts."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from runtime.execution.node_artifacts import relative_path
from runtime.safety.approval.cancellation import current_cancellation_token
from runtime.workspace.directory_sync import MAX_BYTES, MAX_FILES, _file, _hash, _scan

MAX_MANIFEST = 8 * 1024 * 1024
MAX_ARCHIVE = MAX_BYTES + 16 * 1024 * 1024
_CHUNK = 1024 * 1024


def capture_input(source: Path, archive: Path) -> dict[str, Any]:
    """Publish only after every byte agrees with the before/after source scan."""
    source = source.resolve(strict=True)
    archive = archive.resolve()
    if archive.is_relative_to(source):
        raise ValueError("execution input storage must be outside the source project")
    before, skipped = _scan(source)
    names = [relative_path(name) for name in before]
    if len({name.casefold() for name in names}) != len(names):
        raise ValueError("project paths collide on case-insensitive execution devices")
    archive.parent.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, Any] = {"schema": "echo.execution_input.v1", "files": {}}
    total = 0
    with tempfile.TemporaryDirectory(prefix="prepare-", dir=archive.parent) as scratch:
        staged = Path(scratch) / "input.zip"
        with zipfile.ZipFile(staged, "w", compression=zipfile.ZIP_STORED) as bundle:
            for name in sorted(names):
                digest = hashlib.sha256()
                size = 0
                with (
                    _file(source, name).open("rb") as src,
                    bundle.open("files/" + name, "w") as dest,
                ):
                    while chunk := src.read(_CHUNK):
                        current_cancellation_token().throw_if_cancelled()
                        size += len(chunk)
                        total += len(chunk)
                        if total > MAX_BYTES:
                            raise ValueError("execution input exceeds 512 MiB")
                        digest.update(chunk)
                        dest.write(chunk)
                if digest.hexdigest() != before[name]:
                    raise ValueError("project changed while capturing execution input")
                manifest["files"][name] = {"sha256": digest.hexdigest(), "size": size}
            encoded = json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode("utf-8")
            if len(encoded) > MAX_MANIFEST:
                raise ValueError("execution input manifest is too large")
            bundle.writestr("manifest.json", encoded)
        if _scan(source)[0] != before:
            raise ValueError("project changed while capturing execution input")
        if staged.stat().st_size > MAX_ARCHIVE:
            raise ValueError("execution input archive is too large")
        descriptor = dict(
            sha256=_hash(staged),
            archive_bytes=staged.stat().st_size,
            file_count=len(names),
            content_bytes=total,
            skipped_count=len(skipped),
        )
        # Persist archive before the queue record can make this task claimable.
        with staged.open("r+b") as stream:
            os.fsync(stream.fileno())
        os.replace(staged, archive)
    return descriptor


def read_manifest(archive: Path) -> dict[str, dict[str, Any]]:
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        names = [entry.filename for entry in entries]
        if len(entries) > MAX_FILES + 1 or len(names) != len(set(names)):
            raise ValueError("invalid or duplicate input archive entries")
        info = bundle.getinfo("manifest.json")
        if info.file_size > MAX_MANIFEST or info.compress_type != zipfile.ZIP_STORED:
            raise ValueError("invalid input manifest encoding or size")
        manifest = json.loads(bundle.read(info))
        if manifest.get("schema") != "echo.execution_input.v1" or not isinstance(
            manifest.get("files"), dict
        ):
            raise ValueError("invalid execution input manifest")
        files = manifest["files"]
        if len(files) > MAX_FILES or len({name.casefold() for name in files}) != len(files):
            raise ValueError("input file count or portable path collision")
        total = 0
        for name, item in files.items():
            if relative_path(name) != name or not isinstance(item, dict):
                raise ValueError("invalid input file entry")
            digest, size = item.get("sha256"), item.get("size")
            if (
                not isinstance(digest, str)
                or len(digest) != 64
                or any(c not in "0123456789abcdef" for c in digest)
            ):
                raise ValueError("invalid input file digest")
            if type(size) is not int or size < 0:
                raise ValueError("invalid input file size")
            total += size
            file_info = bundle.getinfo("files/" + name)
            if (
                file_info.file_size != size
                or file_info.compress_type != zipfile.ZIP_STORED
                or stat.S_ISLNK(file_info.external_attr >> 16)
            ):
                raise ValueError("input file metadata mismatch")
        if total > MAX_BYTES or set(names) != {
            "manifest.json",
            *("files/" + name for name in files),
        }:
            raise ValueError("input size or archive contents do not match manifest")
    return files


def verify_archive(archive: Path, descriptor: dict[str, Any]) -> None:
    if (
        archive.stat().st_size > MAX_ARCHIVE
        or archive.stat().st_size != descriptor["archive_bytes"]
        or _hash(archive) != descriptor["sha256"]
    ):
        raise ValueError("execution input archive digest or size mismatch")


def restore_input(archive: Path, target: Path, descriptor: dict[str, Any]) -> dict[str, str]:
    verify_archive(archive, descriptor)
    files = read_manifest(archive)
    if (
        len(files) != descriptor["file_count"]
        or sum(item["size"] for item in files.values()) != descriptor["content_bytes"]
    ):
        raise ValueError("execution input descriptor does not match its manifest")
    target.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(archive) as bundle:
        for name, item in files.items():
            dest = _file(target.resolve(), name)
            dest.parent.mkdir(parents=True, exist_ok=True)
            digest = hashlib.sha256()
            with bundle.open("files/" + name) as src, dest.open("xb") as out:
                while chunk := src.read(_CHUNK):
                    current_cancellation_token().throw_if_cancelled()
                    digest.update(chunk)
                    out.write(chunk)
            if digest.hexdigest() != item["sha256"]:
                raise ValueError("execution input file digest mismatch")
    return {name: item["sha256"] for name, item in files.items()}


def download_input(
    client: Any, url: str, identity: dict[str, Any], archive: Path, descriptor: dict[str, Any]
) -> None:
    import httpx

    archive.parent.mkdir(parents=True, exist_ok=True)
    for retry in range(3):
        current_cancellation_token().throw_if_cancelled()
        total = 0
        try:
            with client.stream("POST", url, json=identity) as response:
                response.raise_for_status()
                with archive.open("xb") as stream:
                    for chunk in response.iter_bytes(_CHUNK):
                        current_cancellation_token().throw_if_cancelled()
                        total += len(chunk)
                        if total > MAX_ARCHIVE or total > descriptor["archive_bytes"]:
                            raise ValueError("execution input download exceeds declared size")
                        stream.write(chunk)
            verify_archive(archive, descriptor)
            return
        except httpx.TransportError:
            # This attempt's private partial file has never reached an agent.
            archive.unlink(missing_ok=True)
            if retry == 2:
                raise
