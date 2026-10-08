"""Public identity and source verification for the reviewed, scoped kernel release.

This verifies a selected source scope, not a signed bundle, device acceptance,
or the complete runtime. CRLF/LF differences are deliberately normalized.
"""

from __future__ import annotations

import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path, PurePosixPath
from typing import Any

SCHEMA = "echo.kernel-release.v1"
SUPPORTED_RELEASES = {"1.0.0": "398a5700503a0d28829318ffd453529904dc009b688cd13a4afd5308a816fa32"}


def canonical_digest(value: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def normalized_source_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def load_release(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise ValueError("Unsupported kernel release schema")
    expected = SUPPORTED_RELEASES.get(value.get("manifestVersion"))
    if expected is None or canonical_digest(value) != expected:
        raise ValueError("Kernel release changed without a reviewed version/digest update")
    payload = {key: item for key, item in value.items() if key != "revision"}
    if value.get("revision") != "sha256:" + canonical_digest(payload):
        raise ValueError("Invalid kernel revision")
    return value


def source_path(root: Path, name: str) -> Path:
    relative = PurePosixPath(name)
    if (
        not name.startswith("runtime/")
        or "\\" in name
        or ":" in name
        or relative.is_absolute()
        or ".." in relative.parts
        or relative.suffix != ".py"
    ):
        raise ValueError("Invalid kernel source path")
    candidate = root.joinpath(*relative.parts).resolve()
    if not candidate.is_relative_to((root / "runtime").resolve()):
        raise ValueError("Kernel source path escapes runtime")
    return candidate


def verify_sources(root: Path, product: str, release: dict[str, Any]) -> dict[str, Any]:
    if product not in release["profiles"]:
        raise ValueError("Unsupported kernel product profile")
    entries = [*release["sharedSources"], *release["profiles"][product]["sources"]]
    sources, issues, seen = [], [], set()
    for entry in entries:
        name = entry["path"]
        if name in seen or not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]):
            raise ValueError("Invalid or duplicate kernel source entry")
        seen.add(name)
        path = source_path(root, name)
        actual = normalized_source_digest(path) if path.is_file() else None
        sources.append({"path": name, "expectedSha256": entry["sha256"], "actualSha256": actual})
        if actual != entry["sha256"]:
            issues.append(f"Kernel source missing or changed: {name}")
    return {"status": "passed" if not issues else "failed", "sources": sources, "issues": issues}


@lru_cache(maxsize=2)
def _public_identity(product: str) -> dict[str, Any]:
    try:
        root = Path(__file__).resolve().parent.parent
        release = load_release(root / "runtime/kernel-release.json")
        verification = verify_sources(root, product, release)
        return {
            "manifestVersion": release["manifestVersion"],
            "revision": release["revision"],
            "deviceProtocolVersion": release["deviceProtocolVersion"],
            "securityContractVersion": release["securityContractVersion"],
            "sourceScopeVerified": verification["status"] == "passed",
        }
    except (OSError, ValueError, KeyError, TypeError):
        # Public health must never return filesystem paths or parsing errors.
        return {"sourceScopeVerified": False}


def public_kernel_identity(product: str) -> dict[str, Any]:
    """Return a copy of the identity captured on first use in this process."""
    return dict(_public_identity(product))
