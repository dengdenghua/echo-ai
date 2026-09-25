"""Bounded transfer receipts shared by OS and AI views of a coordinator."""

from __future__ import annotations

import base64
import time
from typing import Any


class TransferJournal:
    def __init__(self) -> None:
        self.jobs: dict[str, dict[str, Any]] = {}

    def snapshot(self) -> list[dict[str, Any]]:
        now = time.time()
        self.jobs = {key: job for key, job in self.jobs.items() if now - job["updatedAt"] < 86400}
        return list(self.jobs.values())[-100:]

    def observe(
        self, device: str, transfer: str, args: dict[str, Any], result: dict[str, Any]
    ) -> None:
        operation = args.get("operation")
        self.snapshot()
        key = f"{device}:{transfer}"
        if operation in {"begin", "stat"}:
            self.jobs[key] = {
                "id": transfer,
                "deviceId": device,
                "name": str(args.get("name", ""))[:255],
                "size": args.get("size", result.get("size", 0)),
                "bytes": result.get("offset", 0),
                "upload": operation == "begin",
                "state": "running",
                "updatedAt": time.time(),
            }
            while len(self.jobs) > 100:
                self.jobs.pop(next(iter(self.jobs)))
        job = self.jobs.get(key)
        if not job:
            return
        if operation == "chunk":
            job["bytes"] = result.get("offset", job["bytes"])
        elif operation == "read":
            try:
                job["bytes"] = int(args.get("offset", 0)) + len(
                    base64.b64decode(result.get("data", ""), validate=True)
                )
            except (ValueError, TypeError):
                return
        elif operation == "complete":
            job["bytes"] = job["size"]
            job["state"] = "done"
        job["updatedAt"] = time.time()

    def report(self, device: str, transfer: str, state: str) -> bool:
        job = self.jobs.get(f"{device}:{transfer}")
        if not job or state not in {"cancelled", "error", "done"}:
            return False
        if job["state"] == "done" and state != "done":
            return False
        if state == "done" and job["bytes"] != job["size"]:
            return False
        job["state"] = state
        job["updatedAt"] = time.time()
        return True
