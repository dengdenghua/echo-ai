"""Connector brand-icon resolution for the capability registry.

Extracted from ``capability_registry`` to keep the registry class under the
god-file threshold. The registry method keeps the same name and delegates
here with its three configured icon roots.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from runtime.platform.capabilities._capability_ids import _slug
from runtime.platform.capabilities._icon_metadata import (
    _CONNECTOR_BRAND_ALIASES,
    _ICON_PRIORITY,
)


def _resolve_connector_icon_path(
    item: dict[str, Any],
    *,
    workbuddy_icon_root: Path,
    native_icon_root: Path,
    storefront_icon_root: Path,
) -> Path | None:
    connector_id = _slug(str(item.get("id") or ""))

    # The WorkBuddy connector fork already ships the vendors' original
    # artwork. Keep that exact connector asset ahead of cross-source brand
    # matching and the generated storefront placeholder icons.
    for suffix in (".svg", ".png", ".webp", ".jpg", ".jpeg"):
        original = workbuddy_icon_root / f"{connector_id}{suffix}"
        if original.is_file():
            return original

    candidates: list[str] = []
    alias = _CONNECTOR_BRAND_ALIASES.get(connector_id)
    if alias:
        candidates.append(alias)
    for value in (
        item.get("provider_id"),
        connector_id,
        item.get("source"),
        item.get("name"),
    ):
        slug = _slug(str(value or ""))
        if slug and slug not in candidates:
            candidates.append(slug)
    for suffix in ("-connector", "-mcp", "-api", "-token", "-ai"):
        if connector_id.endswith(suffix):
            stripped = connector_id[: -len(suffix)]
            if stripped and stripped not in candidates:
                candidates.append(stripped)

    for candidate in candidates:
        assets = native_icon_root / candidate / "assets"
        if not assets.is_dir():
            continue
        # Compact vector marks are ideal in dense marketplace rows and
        # avoid loading megabyte-sized app icons for a 32px thumbnail.
        for pattern in ("*-small.svg", "*icon*.svg"):
            match = next(iter(sorted(assets.glob(pattern))), None)
            if match is not None and match.is_file():
                return match
        for filename in _ICON_PRIORITY:
            path = assets / filename
            if path.is_file():
                return path
        for pattern in ("*icon*.png", "*.svg", "*.png"):
            match = next(iter(sorted(assets.glob(pattern))), None)
            if (
                match is not None
                and match.is_file()
                and "dark" not in match.name
                and "screenshot" not in match.name
            ):
                return match

    for filename in (f"wb_{connector_id}.svg", f"wb_{connector_id}.png"):
        fallback = storefront_icon_root / filename
        if fallback.is_file():
            return fallback
    return None
