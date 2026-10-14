"""Portable role requirements. A declaration never installs or grants access."""

from __future__ import annotations

import re
from typing import Any

_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")


def normalize_role_dependencies(value: Any) -> dict[str, list[str]]:
    if value is None:
        return {"connectors": [], "mcp_servers": []}
    if not isinstance(value, dict):
        raise ValueError("role dependencies must be an object")
    result: dict[str, list[str]] = {}
    for kind in ("connectors", "mcp_servers"):
        items = value.get(kind, [])
        if not isinstance(items, list) or len(items) > 64:
            raise ValueError(f"dependencies.{kind} must be a list of at most 64 IDs")
        names: list[str] = []
        for item in items:
            if not isinstance(item, str) or not _ID.fullmatch(item):
                raise ValueError(f"dependencies.{kind} contains an invalid ID")
            if item not in names:
                names.append(item)
        result[kind] = names
    return result
