"""Small, versioned JSON documents isolated by installed app and owning principal."""

from __future__ import annotations

import hashlib
import json
import re
import threading
from pathlib import Path
from typing import Any

from runtime.platform.io.atomic import _cross_process_lock, atomic_write_json
from runtime.platform.process import paths

_LOCK = threading.RLock()
MAX_DATA_BYTES = 1024 * 1024
MAX_KEYS = 1000
_KEY = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")


class AppDataConflict(ValueError):
    pass


class AppDataUnavailable(ValueError):
    pass


class PersonalAppData:
    def __init__(self, entry: dict[str, Any], *, root: Path | None = None) -> None:
        app = entry.get("app") or {}
        if app.get("schema") != "echo.app.v1" or not app.get("id"):
            raise ValueError("not a personal app")
        scope = [entry.get("tenant_id", ""), entry.get("owner_actor_id", ""), app["id"]]
        digest = hashlib.sha256(json.dumps(scope, ensure_ascii=True).encode()).hexdigest()
        self.path = (root or paths.app_paths().data_dir / "personal-app-data") / f"{digest}.json"

    @staticmethod
    def validate_key(key: str) -> None:
        if not _KEY.fullmatch(key):
            raise ValueError("invalid app data key")

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"schema": "echo.app_data.v1", "documents": {}}
        try:
            if self.path.stat().st_size > MAX_DATA_BYTES:
                raise AppDataUnavailable("app data exceeds size limit")
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if (
                not isinstance(data, dict)
                or data.get("schema") != "echo.app_data.v1"
                or not isinstance(data.get("documents"), dict)
            ):
                raise AppDataUnavailable("invalid app data format")
            if len(data["documents"]) > MAX_KEYS or any(
                not isinstance(document, dict)
                or type(document.get("revision")) is not int
                or document["revision"] < 1
                or type(document.get("deleted")) is not bool
                or "value" not in document
                for document in data["documents"].values()
            ):
                raise AppDataUnavailable("invalid app document format")
            return data
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            # Never turn corruption into an empty store that the next write overwrites.
            raise AppDataUnavailable("app data cannot be read") from exc

    def read(self, key: str) -> dict[str, Any]:
        self.validate_key(key)
        with _LOCK:
            document = self._load()["documents"].get(key)
            return dict(document or {"value": None, "revision": 0, "deleted": True})

    def write(
        self, key: str, value: Any, *, expected_revision: int, delete: bool = False
    ) -> dict[str, Any]:
        self.validate_key(key)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # atomic_write_json takes its own file lock. Use a distinct outer
        # transaction lock for read/compare/write; locking the JSON twice
        # deadlocks on POSIX and stalls on Windows.
        transaction = self.path.with_suffix(".transaction")
        with _LOCK, _cross_process_lock(transaction, required=True, timeout_s=5):
            data = self._load()
            documents = data["documents"]
            previous = documents.get(key) or {"revision": 0}
            if previous["revision"] != expected_revision:
                raise AppDataConflict("app data changed; read it again before saving")
            if key not in documents and len(documents) >= MAX_KEYS:
                raise ValueError("app document limit reached")
            # Tombstones keep revisions monotonic after delete/recreate (no ABA).
            document = {
                "value": None if delete else value,
                "revision": expected_revision + 1,
                "deleted": delete,
            }
            documents[key] = document
            encoded = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
            if len(encoded) + 1 > MAX_DATA_BYTES:
                raise ValueError("app data exceeds 1 MiB limit")
            # Keep the previous file in place until replace, so concurrent
            # readers in other workers never observe a missing-file gap.
            atomic_write_json(self.path, data, indent=None, mode=0o600, keep_backup=False)
            return document
