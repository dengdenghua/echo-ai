"""Bounded, durable transfer receipts owned by one device coordinator."""

from __future__ import annotations

import base64
import json
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from typing import Any

LEASE_SECONDS = 45
RETENTION_SECONDS = 86400


class TransferConflict(ValueError):
    """The requested continuation no longer matches this receipt."""


class TransferJournal:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path
        self.jobs: dict[str, dict[str, Any]] = {}
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            with closing(sqlite3.connect(path)) as db, db:
                db.execute(
                    "CREATE TABLE IF NOT EXISTS transfers (key TEXT PRIMARY KEY, payload TEXT)"
                )
                for key, payload in db.execute("SELECT key, payload FROM transfers"):
                    self.jobs[key] = json.loads(payload)
            # A restarted process cannot own the browser's previous in-flight request.
            for key, job in self.jobs.items():
                if job["state"] == "running":
                    job["state"] = "interrupted"
                    self._save(key)
        self.snapshot()

    def _save(self, key: str) -> None:
        if self.path is not None:
            with closing(sqlite3.connect(self.path)) as db, db:
                db.execute(
                    "INSERT OR REPLACE INTO transfers VALUES (?, ?)",
                    (key, json.dumps(self.jobs[key], ensure_ascii=False)),
                )

    def snapshot(self) -> list[dict[str, Any]]:
        now = time.time()
        for key, job in self.jobs.items():
            if job["state"] == "running" and now - job["updatedAt"] > LEASE_SECONDS:
                job["state"] = "interrupted"
                self._save(key)
        keep = sorted(
            (key for key, job in self.jobs.items() if now - job["updatedAt"] < RETENTION_SECONDS),
            key=lambda key: self.jobs[key]["updatedAt"],
        )[-100:]
        removed = self.jobs.keys() - set(keep)
        if removed and self.path is not None:
            with closing(sqlite3.connect(self.path)) as db, db:
                db.executemany("DELETE FROM transfers WHERE key = ?", ((key,) for key in removed))
        self.jobs = {key: self.jobs[key] for key in keep}
        return [
            {key: value for key, value in job.items() if not key.startswith("_")}
            for job in self.jobs.values()
        ]

    def prepare(self, device: str, transfer: str, args: dict[str, Any], attempt: str) -> None:
        """Claim before sending to the phone; fence obsolete browser attempts."""
        self.snapshot()
        key = f"{device}:{transfer}"
        job = self.jobs.get(key)
        operation = args.get("operation")
        if operation not in {"begin", "stat"}:
            if not job or job["state"] != "running" or job.get("_attempt", "") != attempt:
                raise ValueError("传输已暂停或由其他窗口接续，请刷新记录")
            return
        upload = operation == "begin"
        if job:
            if (
                job["name"] != args.get("name")
                or job["upload"] != upload
                or (
                    upload
                    and (job["size"] != args.get("size") or job.get("sha256") != args.get("sha256"))
                )
            ):
                raise ValueError("请选择同一个原文件，名称、大小和内容必须一致")
            if job["state"] == "done":
                raise ValueError("此传输已完成，请刷新记录")
            if job["state"] == "running" and job.get("_attempt", "") != attempt:
                raise ValueError("其他窗口正在传输，请先暂停或等待连接恢复")
        else:
            job = {
                "id": transfer,
                "deviceId": device,
                "name": str(args.get("name", ""))[:255],
                "size": args.get("size", 0),
                "bytes": 0,
                "upload": upload,
                "sha256": args.get("sha256", ""),
            }
            self.jobs[key] = job
        job.update(state="running", updatedAt=time.time(), _attempt=attempt)
        self._save(key)
        self.snapshot()

    def observe(
        self,
        device: str,
        transfer: str,
        args: dict[str, Any],
        result: dict[str, Any],
        attempt: str = "",
    ) -> None:
        operation = args.get("operation")
        key = f"{device}:{transfer}"
        if key not in self.jobs and operation in {"begin", "stat"}:
            self.prepare(device, transfer, args, attempt)
        job = self.jobs.get(key)
        if not job or job.get("_attempt", "") != attempt or job["state"] != "running":
            return
        if operation == "begin":
            job["bytes"] = result.get("offset", 0)
        elif operation == "stat":
            if job.get("sha256") and job["sha256"] != result.get("sha256"):
                job["state"] = "error"
                self._save(key)
                raise TransferConflict("手机文件内容已改变，请从文件列表重新下载")
            job.update(size=result.get("size", 0), bytes=0, sha256=result.get("sha256", ""))
        elif operation == "chunk":
            job["bytes"] = result.get("offset", job["bytes"])
        elif operation == "read":
            job["bytes"] = int(args.get("offset", 0)) + len(
                base64.b64decode(result.get("data", ""), validate=True)
            )
        elif operation == "complete":
            if result.get("name") != job["name"] or result.get("size") != job["size"]:
                job["state"] = "error"
                self._save(key)
                raise ValueError("手机未确认文件完成")
            job["bytes"] = job["size"]
            job["state"] = "done"
        job["updatedAt"] = time.time()
        self._save(key)

    def report(self, device: str, transfer: str, state: str, attempt: str = "") -> bool:
        key = f"{device}:{transfer}"
        job = self.jobs.get(key)
        if not job or state not in {"cancelled", "error", "done"}:
            return False
        if job.get("_attempt", "") != attempt:
            return False
        if job["state"] == "done" and state != "done":
            return False
        # Upload completion must come from the phone's verified complete receipt.
        if state == "done" and (
            job["bytes"] != job["size"] or (job["upload"] and job["state"] != "done")
        ):
            return False
        job["state"] = state
        job["updatedAt"] = time.time()
        self._save(key)
        return True
