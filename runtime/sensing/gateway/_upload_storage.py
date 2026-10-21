"""Immutable upload instances and compatibility reads for legacy flat files."""

from __future__ import annotations

import contextlib
import os
import stat
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException

from runtime.platform.process.paths import app_paths
from runtime.platform.runtime_policy.workspaces import WorkspaceManager

_MAX_UPLOAD_FILENAME_LENGTH = 255


class UploadStorage:
    def __init__(self, workspace_root: Path | None, legacy_root: Path | None):
        self.legacy_root = legacy_root
        self.workspace_manager = WorkspaceManager(workspace_root) if workspace_root else None

    def _has_control_chars(self, value: str) -> bool:
        return any(ord(ch) < 32 or ord(ch) == 127 for ch in value)

    def _is_redirect(self, path: Path) -> bool:
        """Windows junctions are reparse points but are not symlinks."""
        try:
            attributes = path.lstat()
        except FileNotFoundError:
            return False
        return stat.S_ISLNK(attributes.st_mode) or bool(
            getattr(attributes, "st_file_attributes", 0)
            & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        )

    def _contained_path(self, root: Path, path: Path) -> Path | None:
        try:
            relative = path.relative_to(root)
            current = root
            for component in ("", *relative.parts):
                current = current / component
                if self._is_redirect(current):
                    return None
            resolved = path.resolve(strict=False)
            resolved.relative_to(root.resolve())
            return resolved
        except (OSError, ValueError, RuntimeError):
            return None

    def _safe_upload_filename(self, filename: str | None) -> str:
        raw = (filename or "upload.bin").replace("\\", "/")
        safe_name = Path(raw).name.strip()
        if (
            not safe_name
            or safe_name in {".", ".."}
            or "/" in safe_name
            or "\\" in safe_name
            or self._has_control_chars(safe_name)
            or len(safe_name.encode("utf-8")) > _MAX_UPLOAD_FILENAME_LENGTH
        ):
            raise HTTPException(400, "invalid upload filename")
        return safe_name

    def _legacy_dir_for_root(self, root: Path, thread_id: str, *, create: bool) -> Path:
        if (
            not thread_id
            or thread_id in {".", ".."}
            or "/" in thread_id
            or "\\" in thread_id
            or self._has_control_chars(thread_id)
        ):
            raise HTTPException(400, "invalid thread_id")
        root_resolved = Path(root).expanduser().resolve()
        candidate = root_resolved / thread_id
        with contextlib.suppress(ValueError):
            candidate.relative_to(root_resolved)
            if self._is_redirect(candidate):
                raise HTTPException(409, "upload directory is not a real directory")
            if create:
                candidate.mkdir(parents=True, exist_ok=True)
                if self._contained_path(root_resolved, candidate) is None or not candidate.is_dir():
                    raise HTTPException(409, "upload directory is not a real directory")
            return candidate
        raise HTTPException(400, "invalid thread_id")

    def _ensure_real_upload_dir(self, path: Path) -> Path:
        if self._is_redirect(path):
            raise HTTPException(409, "upload directory is not a real directory")
        path.mkdir(parents=True, exist_ok=True)
        if self._is_redirect(path) or not path.is_dir():
            raise HTTPException(409, "upload directory is not a real directory")
        return path

    def _upload_dir(self, thread_id: str) -> Path:
        if self.workspace_manager is not None:
            workspace = self.workspace_manager.path_for(thread_id)
            if self._contained_path(self.workspace_manager.root, workspace / "upload") is None:
                raise HTTPException(409, "upload directory is not a real directory")
            return self._ensure_real_upload_dir(self.workspace_manager.layout(thread_id).upload)
        root = self.legacy_root or (app_paths().data_dir / "thread_uploads")
        return self._legacy_dir_for_root(root, thread_id, create=True)

    def _legacy_upload_dir(self, thread_id: str) -> Path | None:
        if self.legacy_root is None:
            return None
        return self._legacy_dir_for_root(self.legacy_root, thread_id, create=False)

    def _upload_dirs_for_read(self, thread_id: str) -> list[Path]:
        dirs = [self._upload_dir(thread_id)]
        legacy = self._legacy_upload_dir(thread_id)
        if legacy is not None and legacy not in dirs:
            dirs.append(legacy)
        return dirs

    def _absolute_artifact_candidate(self, thread_id: str, raw_path: Path) -> Path | None:
        for upload_dir in self._upload_dirs_for_read(thread_id):
            candidate = self._safe_file_candidate(raw_path, upload_dir)
            if candidate is not None:
                return candidate
        return None

    def _safe_file_candidate(self, path: Path, root: Path) -> Path | None:
        resolved = self._contained_path(root, path)
        if resolved is None or not resolved.is_file():
            return None
        return resolved

    def _stored_files(self, upload_dir: Path) -> list[Path]:
        """Read flat legacy uploads and the single-file immutable upload directories."""
        if not upload_dir.is_dir():
            return []
        files = []
        for path in sorted(upload_dir.iterdir(), key=lambda p: p.name.lower()):
            if self._contained_path(upload_dir, path) is None:
                continue
            if path.is_file():
                files.append(path)
            elif path.is_dir() and path.name.startswith("upload-"):
                files.extend(
                    candidate
                    for p in path.iterdir()
                    if (candidate := self._safe_file_candidate(p, upload_dir)) is not None
                )
        return files

    def _find_upload(self, thread_id: str, reference: str) -> Path | None:
        roots = self._upload_dirs_for_read(thread_id)
        raw_path = Path(reference)
        if raw_path.is_absolute():
            return self._absolute_artifact_candidate(thread_id, raw_path)
        parts = reference.replace("\\", "/").split("/")
        if len(parts) == 2 and parts[0].startswith("upload-"):
            if parts[1] != self._safe_upload_filename(parts[1]):
                return None
            for root in roots:
                parent = root / parts[0]
                if self._contained_path(root, parent) is None or not parent.is_dir():
                    continue
                candidate = self._safe_file_candidate(parent / parts[1], root)
                if candidate is not None:
                    return candidate
            return None
        if len(parts) != 1 or parts[0] != self._safe_upload_filename(parts[0]):
            return None
        # Persisted flat URLs must keep reading their original bytes. Older
        # clients may also ask for a new upload by its display name; support
        # that only while it identifies exactly one instance.
        for root in roots:
            candidate = self._safe_file_candidate(root / parts[0], root)
            if candidate is not None:
                return candidate
        matches = [p for root in roots for p in self._stored_files(root) if p.name == parts[0]]
        if len(matches) > 1:
            raise HTTPException(409, "ambiguous upload filename; use its artifact URL or path")
        return matches[0] if matches else None

    def _write_upload_bytes(self, target: Path, data: bytes) -> None:
        if self._contained_path(target.parent.parent, target) is None or target.exists():
            raise HTTPException(409, "upload target is not a real file")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            fd = os.open(target, flags, 0o600)
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
        except OSError as exc:
            raise HTTPException(
                500,
                f"failed to store upload: {exc}",
            ) from exc

    def _metadata(
        self,
        thread_id: str,
        file_path: Path,
        *,
        extracted_text: str | None = None,
    ) -> dict[str, Any]:
        rel_name = file_path.name
        artifact_path = rel_name
        for root in self._upload_dirs_for_read(thread_id):
            if file_path.is_relative_to(root):
                artifact_path = file_path.relative_to(root).as_posix()
                break
        stat = file_path.stat()
        return {
            "filename": rel_name,
            "size": stat.st_size,
            "path": str(file_path),
            "virtual_path": str(file_path),
            "artifact_url": (
                f"/api/threads/{quote(thread_id, safe='')}/artifacts/{quote(artifact_path)}"
            ),
            "extension": file_path.suffix.lstrip(".") or None,
            "modified": int(stat.st_mtime),
            "extracted_text": extracted_text,
        }
