"""Wire contract shared by physical phones, emulators and desktop/VM clients."""

from __future__ import annotations

import re
from typing import Any

PROTOCOL_VERSION = "1.0"
DEVICE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
DESKTOP_PLATFORMS = frozenset({"windows", "linux", "darwin"})
DEVICE_KINDS = frozenset({"physical", "emulator", "vm", "unknown"})


def normalize_hello(payload: dict[str, Any]) -> dict[str, Any]:
    """Accept the Android nested envelope and the original flat v1 envelope.

    Identity and credentials only come from the top-level params. Metadata
    cannot override either, even when supplied by an untrusted client.
    """
    if not isinstance(payload, dict):
        raise ValueError("device/hello params must be an object")
    device_id = payload.get("tentacle_id")
    if not isinstance(device_id, str) or not DEVICE_ID.fullmatch(device_id):
        raise ValueError("invalid tentacle_id")
    version = payload.get("protocol_version", PROTOCOL_VERSION)
    if version != PROTOCOL_VERSION:
        raise ValueError("unsupported device protocol version")
    nested = payload.get("device_meta", {})
    if not isinstance(nested, dict):
        raise ValueError("device_meta must be an object")
    meta = {**nested, **payload}
    platform = meta.get("platform", "android")
    if platform not in {"android", "ios", *DESKTOP_PLATFORMS}:
        raise ValueError("unsupported device platform")
    kind = meta.get("device_kind", "unknown")
    if kind not in DEVICE_KINDS:
        raise ValueError("unsupported device kind")
    caps = payload.get("capabilities", [])
    if (
        not isinstance(caps, list)
        or len(caps) > 512
        or any(not isinstance(cap, str) or not cap or len(cap) > 128 for cap in caps)
    ):
        raise ValueError("invalid device capabilities")
    result = {
        key: meta[key]
        for key in (
            "brand",
            "model",
            "android_version",
            "sdk",
            "screen_size",
            "version",
            "ios_version",
            "udid",
            "wda_port",
            "bundle_id",
            "hostname",
        )
        if key in meta
    }
    result.update(
        tentacle_id=device_id,
        platform=platform,
        device_kind=kind,
        protocol_version=PROTOCOL_VERSION,
        capabilities=list(dict.fromkeys(caps)),
        version=meta.get("version", payload.get("client_version", "0.0.0")),
    )
    # Keep only the credential and nonce fields explicitly supplied by the caller.
    for key in ("auth_token", "token", "nonce"):
        if key in payload:
            result[key] = payload[key]
    return result
