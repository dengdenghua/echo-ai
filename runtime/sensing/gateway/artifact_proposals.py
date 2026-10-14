"""Disk-backed HTML edit proposals. Callers hold the artifact's shared edit lock."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from runtime.platform.io.atomic import atomic_write_bytes, atomic_write_json

_ID = re.compile(r"\d+-[0-9a-f]{12}")
_MAX_BYTES = 8 * 1024 * 1024


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


class ArtifactProposals:
    def __init__(self, workspace: Path, target: Path) -> None:
        self.workspace = workspace.resolve()
        self.target = target
        try:
            relative = target.relative_to(self.workspace)
        except ValueError as exc:
            raise HTTPException(400, "output path escapes workspace") from exc
        key = digest(os.path.normcase(relative.as_posix()).encode())
        self.root = self._safe(self.workspace, f".artifact-proposals/{key}")

    def _safe(self, root: Path, relative: str) -> Path:
        path = (root / relative).resolve()
        try:
            path.relative_to(root.resolve())
            path.relative_to(self.workspace)
        except ValueError as exc:
            raise HTTPException(400, "invalid proposal path") from exc
        return path

    def _file(self, proposal_id: str, name: str) -> Path:
        if not _ID.fullmatch(proposal_id):
            raise HTTPException(400, "invalid proposal_id")
        directory = self._safe(self.root, proposal_id)
        return self._safe(directory, name)

    def _read_bytes(self, path: Path) -> bytes:
        if path.stat().st_size > _MAX_BYTES:
            raise HTTPException(413, "HTML proposal exceeds the 8 MB edit limit")
        content = path.read_bytes()
        try:
            content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(415, "proposal must be UTF-8 HTML") from exc
        return content

    def _save_state(self, proposal_id: str, state: dict[str, Any]) -> None:
        atomic_write_json(
            self._file(proposal_id, "state.json"), state, keep_backup=False, mode=0o600
        )

    def _load(self, proposal_id: str) -> dict[str, Any]:
        path = self._file(proposal_id, "state.json")
        if not path.is_file():
            raise HTTPException(404, "proposal not found")
        if path.stat().st_size > 16_384:
            raise HTTPException(409, "invalid proposal state")
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
            if (
                not isinstance(state, dict)
                or state.get("proposal_id") != proposal_id
                or state.get("status")
                not in {"pending", "applying", "accepted", "rejected", "interrupted"}
                or not re.fullmatch(r"[0-9a-f]{64}", str(state.get("base_sha256", "")))
            ):
                raise ValueError("invalid proposal state")
        except (ValueError, UnicodeError) as exc:
            raise HTTPException(409, "invalid proposal state") from exc
        # A process may stop after replacing the artifact but before recording
        # acceptance. Reconcile this checkpoint without replaying the write.
        if state["status"] == "applying":
            current = digest(self._read_bytes(self.target))
            if current == state.get("reviewed_sha256"):
                state["status"] = "accepted"
            elif current == state["base_sha256"]:
                state["status"] = "pending"
            else:
                state["status"] = "interrupted"
            self._save_state(proposal_id, state)
        return state

    def create(self, expected_sha256: str) -> dict[str, Any]:
        original = self._read_bytes(self.target)
        if digest(original) != expected_sha256:
            raise HTTPException(409, "文件已变化，请重新加载后再请求修改。")
        proposal_id = f"{time.time_ns()}-{secrets.token_hex(6)}"
        state = {
            "proposal_id": proposal_id,
            "status": "pending",
            "created_at": time.time(),
            "base_sha256": digest(original),
        }
        atomic_write_bytes(
            self._file(proposal_id, "base.html"), original, keep_backup=False, mode=0o600
        )
        atomic_write_bytes(
            self._file(proposal_id, "candidate.html"), original, keep_backup=False, mode=0o600
        )
        # Publishing state last makes partially created proposals invisible.
        self._save_state(proposal_id, state)
        return {**state, "candidate_path": str(self._file(proposal_id, "candidate.html"))}

    def list(self) -> list[dict[str, Any]]:
        if not self.root.exists():
            return []
        result = []
        for path in sorted(self.root.iterdir(), key=lambda entry: entry.name, reverse=True):
            if _ID.fullmatch(path.name) and self._file(path.name, "state.json").is_file():
                result.append(self._load(path.name))
        return result

    def read(self, proposal_id: str) -> dict[str, Any]:
        state = self._load(proposal_id)
        original = self._read_bytes(self._file(proposal_id, "base.html"))
        if digest(original) != state["base_sha256"]:
            raise HTTPException(409, "proposal base has changed")
        name = "reviewed.html" if state["status"] == "accepted" else "candidate.html"
        candidate = self._read_bytes(self._file(proposal_id, name))
        candidate_sha = digest(candidate)
        if state["status"] == "accepted" and candidate_sha != state.get("reviewed_sha256"):
            raise HTTPException(409, "accepted proposal snapshot has changed")
        return {
            **state,
            "base_content": original.decode("utf-8"),
            "candidate_content": candidate.decode("utf-8"),
            "candidate_sha256": candidate_sha,
            "changed": candidate_sha != state["base_sha256"],
            "conflict": digest(self._read_bytes(self.target)) != state["base_sha256"],
        }

    def decide(
        self,
        proposal_id: str,
        action: str,
        reviewed_sha256: str | None,
        preserve_revision: Callable[[bytes], str],
    ) -> dict[str, Any]:
        state = self._load(proposal_id)
        desired = "accepted" if action == "accept" else "rejected"
        if state["status"] == desired:
            if action == "accept" and reviewed_sha256 != state.get("reviewed_sha256"):
                raise HTTPException(
                    409, "a different proposal version was accepted; reload the artifact"
                )
            return state  # Network retries must never reapply an accepted edit.
        if state["status"] not in {"pending", "interrupted"}:
            raise HTTPException(409, "proposal has already been decided")
        if action == "reject":
            state["status"] = "rejected"
            self._save_state(proposal_id, state)
            return state
        if state["status"] == "interrupted":
            raise HTTPException(409, "上次接受过程被中断且文件已变化，请检查版本历史。")
        proposal = self.read(proposal_id)
        if proposal["conflict"]:
            raise HTTPException(409, "原文件已变化，本次修改未应用。请重新生成修改。")
        if not proposal["changed"]:
            raise HTTPException(409, "工作副本尚未产生修改。")
        if proposal["candidate_sha256"] != reviewed_sha256:
            raise HTTPException(409, "工作副本已变化，请重新比较后再接受。")
        payload = proposal["candidate_content"].encode("utf-8")
        atomic_write_bytes(
            self._file(proposal_id, "reviewed.html"), payload, keep_backup=False, mode=0o600
        )
        state.update(
            status="applying",
            reviewed_sha256=reviewed_sha256,
            revision_id=preserve_revision(self._read_bytes(self.target)),
        )
        self._save_state(proposal_id, state)
        atomic_write_bytes(self.target, payload, keep_backup=False, mode=self.target.stat().st_mode)
        state["status"] = "accepted"
        self._save_state(proposal_id, state)
        return state
