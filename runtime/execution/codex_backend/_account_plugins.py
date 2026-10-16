"""Codex marketplace plugin catalog: wire normalization and the local official cache."""

from __future__ import annotations

import json
import stat
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .types import ConfigurationError, ProtocolError

_LEGACY_MARKETPLACE_MAX_BYTES = 16 * 1024 * 1024
_LEGACY_PLUGIN_MANIFEST_MAX_BYTES = 2 * 1024 * 1024


def _legacy_plugin_catalog_response(
    source_home: Path,
    *,
    install_home: Path,
) -> dict[str, object]:
    """Project the official on-disk marketplace into the App Server wire shape."""

    source_root = source_home.expanduser().resolve(strict=False)
    catalog_path = source_root / ".tmp" / "plugins" / ".agents" / "plugins" / "marketplace.json"
    payload = _read_bounded_json_object(
        catalog_path,
        root=source_root,
        max_bytes=_LEGACY_MARKETPLACE_MAX_BYTES,
    )
    raw_plugins = payload.get("plugins")
    if not isinstance(raw_plugins, list) or len(raw_plugins) > 5000:
        raise ProtocolError("cached Codex marketplace plugins must be a bounded array")

    # Marketplace source paths are relative to the checkout root, two levels
    # above `.agents/plugins/marketplace.json`.
    checkout_root = catalog_path.parent.parent.parent
    plugins: list[dict[str, object]] = []
    for raw in raw_plugins:
        if not isinstance(raw, Mapping):
            continue
        name = raw.get("name")
        if (
            not isinstance(name, str)
            or not name.strip()
            or len(name) > 128
            or any(char in name for char in "/\\\x00\r\n")
        ):
            continue
        name = name.strip()
        raw_source = raw.get("source")
        raw_source = raw_source if isinstance(raw_source, Mapping) else {}
        relative_source = raw_source.get("path")
        if not isinstance(relative_source, str) or not relative_source.strip():
            continue
        plugin_root = (checkout_root / relative_source).resolve(strict=False)
        try:
            plugin_root.relative_to(checkout_root)
        except ValueError:
            continue
        manifest_path = plugin_root / ".codex-plugin" / "plugin.json"
        try:
            manifest = _read_bounded_json_object(
                manifest_path,
                root=checkout_root,
                max_bytes=_LEGACY_PLUGIN_MANIFEST_MAX_BYTES,
            )
        except (ConfigurationError, ProtocolError):
            continue
        interface = manifest.get("interface")
        interface = dict(interface) if isinstance(interface, Mapping) else {}
        icon_value = interface.get("composerIcon") or interface.get("logo")
        icon_path: Path | None = None
        if isinstance(icon_value, str) and icon_value.strip():
            candidate = (plugin_root / icon_value).resolve(strict=False)
            try:
                candidate.relative_to(plugin_root)
            except ValueError:
                candidate = plugin_root / "__invalid__"
            if candidate.is_file():
                icon_path = candidate
                interface["composerIconUrl"] = icon_value
        policy = raw.get("policy")
        policy = policy if isinstance(policy, Mapping) else {}
        author = manifest.get("author")
        author = author if isinstance(author, Mapping) else {}
        if not interface.get("developerName") and isinstance(author.get("name"), str):
            interface["developerName"] = author["name"]
        if not interface.get("category") and isinstance(raw.get("category"), str):
            interface["category"] = raw["category"]
        if not interface.get("shortDescription") and isinstance(manifest.get("description"), str):
            interface["shortDescription"] = manifest["description"]
        installed = _legacy_plugin_is_installed(install_home, name)
        plugins.append(
            {
                "id": f"{name}@openai-curated",
                "name": name,
                "version": manifest.get("version"),
                "interface": interface,
                "source": {"type": "local"},
                "installPolicy": policy.get("installation"),
                "installed": installed,
                "enabled": installed,
                "_iconPath": str(icon_path) if icon_path is not None else None,
            }
        )
    if not plugins:
        raise ProtocolError("cached Codex marketplace contains no usable plugins")
    return {
        "marketplaces": [
            {
                "name": "openai-curated",
                "path": str(catalog_path),
                "plugins": plugins,
            }
        ],
        "featuredPluginIds": [],
    }


def _read_bounded_json_object(path: Path, *, root: Path, max_bytes: int) -> dict[str, Any]:
    resolved = path.resolve(strict=False)
    try:
        resolved.relative_to(root.resolve(strict=False))
    except ValueError as exc:
        raise ConfigurationError("cached Codex marketplace escaped its source root") from exc
    try:
        metadata = resolved.stat()
    except OSError as exc:
        raise ConfigurationError("cached Codex marketplace is unavailable") from exc
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > max_bytes:
        raise ConfigurationError("cached Codex marketplace file is invalid")
    try:
        parsed = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as exc:
        raise ProtocolError("cached Codex marketplace JSON is invalid") from exc
    if not isinstance(parsed, dict):
        raise ProtocolError("cached Codex marketplace JSON must contain an object")
    return parsed


def _legacy_plugin_is_installed(install_home: Path, plugin_name: str) -> bool:
    cache_root = install_home / "plugins" / "cache"
    if not cache_root.is_dir():
        return False
    try:
        marketplaces = list(cache_root.iterdir())[:256]
    except OSError:
        return False
    for marketplace in marketplaces:
        plugin_root = marketplace / plugin_name
        if plugin_root.is_dir():
            return True
    return False


def _normalize_plugin_catalog(response: Mapping[str, Any]) -> list[dict[str, object]]:
    raw_marketplaces = response.get("marketplaces")
    if not isinstance(raw_marketplaces, list):
        raise ProtocolError("plugin/list marketplaces must be an array")
    featured = {value for value in response.get("featuredPluginIds", []) if isinstance(value, str)}
    rows: list[dict[str, object]] = []
    seen: set[str] = set()
    for raw_marketplace in raw_marketplaces:
        if not isinstance(raw_marketplace, Mapping):
            continue
        marketplace_name = raw_marketplace.get("name")
        if not isinstance(marketplace_name, str) or not marketplace_name.strip():
            continue
        marketplace_name = marketplace_name.strip()
        marketplace_path = raw_marketplace.get("path")
        if not isinstance(marketplace_path, str) or not Path(marketplace_path).is_absolute():
            marketplace_path = None
        raw_plugins = raw_marketplace.get("plugins")
        if not isinstance(raw_plugins, list):
            continue
        for raw_plugin in raw_plugins:
            if not isinstance(raw_plugin, Mapping):
                continue
            plugin_name = raw_plugin.get("name")
            codex_plugin_id = raw_plugin.get("id")
            if not isinstance(plugin_name, str) or not plugin_name.strip():
                continue
            if not isinstance(codex_plugin_id, str) or not codex_plugin_id.strip():
                codex_plugin_id = f"{plugin_name.strip()}@{marketplace_name}"
            catalog_id = f"codex-marketplace:{codex_plugin_id.strip()}"
            if catalog_id in seen:
                continue
            seen.add(catalog_id)
            interface = raw_plugin.get("interface")
            interface = interface if isinstance(interface, Mapping) else {}
            source = raw_plugin.get("source")
            source = source if isinstance(source, Mapping) else {}
            remote_marketplace_name = (
                marketplace_name
                if source.get("type") == "remote" or marketplace_path is None
                else None
            )
            display_name = interface.get("displayName")
            short_description = interface.get("shortDescription")
            logo_url = interface.get("logoUrl") or interface.get("composerIconUrl")
            category = interface.get("category")
            developer_name = interface.get("developerName")
            capabilities = interface.get("capabilities")
            capability_names = (
                [value for value in capabilities if isinstance(value, str)]
                if isinstance(capabilities, list)
                else []
            )
            install_policy = raw_plugin.get("installPolicy")
            availability = raw_plugin.get("availability")
            installable = install_policy != "NOT_AVAILABLE" and availability != "DISABLED_BY_ADMIN"
            rows.append(
                {
                    "id": catalog_id,
                    "name": (
                        display_name.strip()
                        if isinstance(display_name, str) and display_name.strip()
                        else plugin_name.strip()
                    ),
                    "name_zh": (
                        display_name.strip()
                        if isinstance(display_name, str) and display_name.strip()
                        else plugin_name.strip()
                    ),
                    "description": (
                        short_description if isinstance(short_description, str) else ""
                    ),
                    "description_zh": (
                        short_description if isinstance(short_description, str) else ""
                    ),
                    "type": "plugin",
                    "auth_mode": "none",
                    "source": "codex_plugin",
                    "provider_id": plugin_name.strip(),
                    "author": developer_name if isinstance(developer_name, str) else "",
                    "category": category if isinstance(category, str) else "plugin",
                    "icon": logo_url if isinstance(logo_url, str) else "",
                    "surface_capabilities": capability_names,
                    "mcp_servers": [],
                    "skill_count": 0,
                    "examples_zh": [],
                    "installed": raw_plugin.get("installed") is True,
                    "enabled": raw_plugin.get("enabled") is True,
                    "connected": False,
                    "version": (
                        str(raw_plugin.get("version") or raw_plugin.get("localVersion") or "")
                    ),
                    "featured": codex_plugin_id in featured or plugin_name in featured,
                    "installable": installable,
                    "marketplace_name": marketplace_name,
                    "_marketplace_path": marketplace_path,
                    "remote_marketplace_name": remote_marketplace_name,
                    "plugin_name": plugin_name.strip(),
                    "codex_plugin_id": codex_plugin_id.strip(),
                    "is_codex_marketplace": True,
                    "_icon_path": (
                        raw_plugin.get("_iconPath")
                        if isinstance(raw_plugin.get("_iconPath"), str)
                        else None
                    ),
                }
            )
    return rows
