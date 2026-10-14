"""Share a device capture across OS/AI viewers without Android screenshot contention."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import HTTPException


class MirrorFrames:
    def __init__(self) -> None:
        self.entries: dict[str, dict[str, Any]] = {}

    async def capture(self, device_id: str, socket: Any, args: dict, request: Any) -> Any:
        now = time.monotonic()
        self.entries = {
            key: entry
            for key, entry in self.entries.items()
            if not entry["task"].done() or now - entry["created"] < 20
        }
        entry = self.entries.get(device_id)
        key = json.dumps(args, sort_keys=True)
        if entry and entry["socket"] is socket:
            result = await asyncio.shield(entry["task"])
            if (
                entry["key"] == key
                and result.success
                and time.monotonic() - entry["finished"] < 0.6
            ):
                return result
            await asyncio.sleep(max(0, 0.6 - (time.monotonic() - entry["finished"])))
            if self.entries.get(device_id) is not entry:
                return await self.capture(device_id, socket, args, request)
        if device_id not in self.entries and len(self.entries) >= 64:
            raise HTTPException(429, "同时取帧的设备过多")
        record = {"socket": socket, "key": key, "created": time.monotonic(), "finished": 0.0}

        async def run():
            try:
                return await request()
            finally:
                record["finished"] = time.monotonic()

        record["task"] = asyncio.create_task(run())
        self.entries[device_id] = record
        try:
            return await asyncio.shield(record["task"])
        except Exception:
            if self.entries.get(device_id) is record:
                self.entries.pop(device_id, None)
            raise
