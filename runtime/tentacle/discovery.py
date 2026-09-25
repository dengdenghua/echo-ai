"""Passive, bounded discovery of existing Echo Mobile UDP beacons.

Discovery is an untrusted hint, never a pairing or execution credential.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import re
import time
from typing import Any


class DeviceDiscovery(asyncio.DatagramProtocol):
    def __init__(self) -> None:
        self.transport: asyncio.DatagramTransport | None = None
        self.devices: dict[str, dict[str, Any]] = {}
        self.error = ""

    async def start(self, host: str, port: int = 9528) -> None:
        if self.transport:
            return
        try:
            transport, _ = await asyncio.get_running_loop().create_datagram_endpoint(
                lambda: self, local_addr=(host, port), allow_broadcast=True
            )
            self.transport = transport
        except OSError:
            self.error = "局域网发现端口不可用，可继续使用配对链接"

    def stop(self) -> None:
        if self.transport:
            self.transport.close()
            self.transport = None
        self.devices.clear()

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        if len(data) > 2048:
            return
        try:
            source = ipaddress.ip_address(addr[0])
            if not source.is_private or source.is_multicast or source.is_unspecified:
                return
            beacon = json.loads(data)
            if not isinstance(beacon, dict) or beacon.get("type") != "octopus-beacon":
                return
            device_id = beacon.get("deviceId")
            if not isinstance(device_id, str) or not re.fullmatch(
                r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", device_id
            ):
                return
            self.snapshot()
            if device_id not in self.devices and len(self.devices) >= 128:
                return
            name = beacon.get("deviceName")
            self.devices[device_id] = {
                "id": device_id,
                "name": "".join(c for c in name[:96] if c.isprintable())
                if isinstance(name, str)
                else device_id,
                "platform": "android",
                "address": str(source),
                "seen": time.monotonic(),
            }
        except (ValueError, UnicodeError, TypeError):
            return

    def snapshot(self) -> dict[str, Any]:
        now = time.monotonic()
        self.devices = {
            key: value for key, value in self.devices.items() if now - value["seen"] < 20
        }
        return {
            "available": self.transport is not None,
            "error": self.error,
            "devices": [
                {key: value for key, value in device.items() if key != "seen"}
                for device in self.devices.values()
            ],
        }
