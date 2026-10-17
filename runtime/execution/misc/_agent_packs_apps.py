"""App-manifest scanning (echo-app.jsonc / app.json / apps/*) for agent packs."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from runtime.execution.misc._agent_packs_models import PackModule
from runtime.execution.misc._agent_packs_parsing import _read_json, _read_jsonc, _read_yaml


def _scan_app_modules(
    plugin_dir: Path,
    plugin: PackModule,
    warnings: list[str],
) -> list[PackModule]:
    modules: list[PackModule] = []
    seen_paths: set[Path] = set()
    candidates = [
        plugin_dir / "echo-app.jsonc",
        plugin_dir / ".echo-app.jsonc",
        plugin_dir / ".app.json",
        plugin_dir / "app.jsonc",
        plugin_dir / "app.json",
        plugin_dir / "app.yaml",
    ]
    apps_dir = plugin_dir / "apps"
    if apps_dir.is_dir():
        for child in sorted(apps_dir.iterdir()):
            if not child.is_dir():
                continue
            candidates.extend(
                [
                    child / "echo-app.jsonc",
                    child / "app.jsonc",
                    child / "app.json",
                    child / "app.yaml",
                    child / "meta.jsonc",
                    child / "meta.json",
                    child / "meta.yaml",
                ]
            )

    for manifest in candidates:
        if manifest in seen_paths or not manifest.is_file():
            continue
        seen_paths.add(manifest)
        data = _read_app_manifest(manifest, warnings) or {}
        for name, app_data in _iter_app_manifest_entries(data, manifest, warnings):
            title = str(
                app_data.get("title")
                or app_data.get("displayName")
                or app_data.get("display_name")
                or app_data.get("name")
                or name
            )
            actions = _normalize_app_actions(app_data.get("actions"))
            modules.append(
                PackModule(
                    id=f"{plugin.id}:app:{name}",
                    kind="app",
                    name=name,
                    path=str(
                        plugin_dir
                        if manifest.name in {"echo-app.jsonc", ".echo-app.jsonc", ".app.json"}
                        else manifest.parent
                    ),
                    description=str(
                        app_data.get("description")
                        or app_data.get("shortDescription")
                        or app_data.get("short_description")
                        or ""
                    ),
                    source_plugin=plugin.id,
                    metadata={
                        "manifest": str(manifest),
                        "schema_version": app_data.get("schema_version")
                        or data.get("schema_version")
                        or data.get("version"),
                        "title": title,
                        "category": app_data.get("category") or data.get("category") or "connector",
                        "route": app_data.get("route") or app_data.get("path"),
                        "entry": app_data.get("entry") or app_data.get("main"),
                        "icon": app_data.get("icon"),
                        "connector_id": app_data.get("connector_id")
                        or app_data.get("connectorId")
                        or (
                            app_data.get("id")
                            if isinstance(app_data.get("id"), str)
                            and str(app_data.get("id")).startswith("connector_")
                            else None
                        ),
                        "permissions": app_data.get("permissions")
                        if isinstance(app_data.get("permissions"), list)
                        else [],
                        "actions": actions,
                        "action_count": len(actions),
                    },
                )
            )
    return modules


def _read_app_manifest(path: Path, warnings: list[str]) -> dict[str, Any] | None:
    suffix = path.suffix.lower()
    if suffix in {".yaml", ".yml"}:
        return _read_yaml(path, warnings)
    if suffix == ".jsonc":
        return _read_jsonc(path, warnings)
    return _read_json(path, warnings)


def _iter_app_manifest_entries(
    data: dict[str, Any],
    manifest: Path,
    warnings: list[str],
) -> list[tuple[str, dict[str, Any]]]:
    raw_apps = data.get("apps")
    entries: list[tuple[str, dict[str, Any]]] = []
    if isinstance(raw_apps, dict):
        for key, value in sorted(raw_apps.items()):
            if not isinstance(value, dict):
                warnings.append(f"{manifest}: app `{key}` must be an object")
                continue
            name = str(value.get("app_id") or value.get("slug") or key).strip()
            if not name:
                warnings.append(f"{manifest}: app key `{key}` resolved to an empty id")
                continue
            entries.append((name, value))
        return entries
    if isinstance(raw_apps, list):
        for index, value in enumerate(raw_apps):
            if not isinstance(value, dict):
                warnings.append(f"{manifest}: apps[{index}] must be an object")
                continue
            name = str(value.get("id") or value.get("name") or "").strip()
            if not name:
                warnings.append(f"{manifest}: apps[{index}] is missing id")
                continue
            entries.append((name, value))
        return entries

    name = str(data.get("id") or data.get("name") or manifest.parent.name).strip()
    if not name:
        warnings.append(f"{manifest}: app manifest resolved to an empty id")
        return []
    return [(name, data)]


def _normalize_app_actions(raw: Any) -> list[dict[str, Any]]:
    items: list[Any]
    if isinstance(raw, dict):
        items = [
            {**value, "name": key} if isinstance(value, dict) else {"name": key}
            for key, value in raw.items()
        ]
    elif isinstance(raw, list):
        items = raw
    else:
        return []

    actions: list[dict[str, Any]] = []
    for item in items:
        if isinstance(item, str):
            name = item.strip()
            if name:
                actions.append({"name": name, "description": "", "input_schema": {}})
            continue
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("id") or "").strip()
        if not name:
            continue
        schema = (
            item.get("input_schema")
            or item.get("inputSchema")
            or item.get("schema")
            or item.get("parameters")
            or {}
        )
        actions.append(
            {
                "name": name,
                "description": str(item.get("description") or ""),
                "input_schema": schema if isinstance(schema, dict) else {},
                "requires_confirmation": bool(
                    item.get("requires_confirmation") or item.get("confirm")
                ),
            }
        )
    return actions
