"""Manage downloaded prompt packages and runtime enablement, not bundled files."""

import re
import shutil
from pathlib import Path

from runtime.platform.assets.skill_inventory import scan_local_skills
from runtime.platform.io.transactional import path_transaction
from runtime.platform.process.paths import app_paths


def _download_path(name: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,159}", name):
        raise ValueError("invalid skill identifier")
    root = (app_paths().data_dir / "skills").resolve()
    target = root / name
    if (
        target.is_symlink()
        or (hasattr(target, "is_junction") and target.is_junction())
        or target.resolve().parent != root
    ):
        raise ValueError("unsafe skill destination")
    return target


def _source_index(registry) -> dict[str, list[str]]:
    """Registry names grouped by package source (``trusted_source`` before ``#``), in registry order."""
    index: dict[str, list[str]] = {}
    for n in registry.all_names():
        source = str(registry.get(n).trusted_source or "").split("#", 1)[0]
        index.setdefault(source, []).append(n)
    return index


def _runtime_names(registry, name: str, index: dict[str, list[str]] | None = None) -> list[str]:
    if registry is None or not registry.has(name):
        return []
    skill = registry.get(name)
    # Aliases of a prompt package share its trusted source.
    source = skill.trusted_source
    if source and source.startswith("skill://all_skills/"):
        source = source.split("#", 1)[0]
        return list((index if index is not None else _source_index(registry)).get(source, []))
    return [skill.name]


def skill_management_states(registry, rows: list[dict] | None = None) -> dict:
    """Per-skill toggle/uninstall state; pass ``rows`` to reuse a scan already made.

    Runs on every HUB load over hundreds of skills, so the registry is indexed by source once
    (instead of a full registry pass per skill) and a skill with no downloaded copy skips the
    path-safety resolve: it cannot be uninstalled either way.
    """
    states = {}
    downloads = app_paths().data_dir / "skills"
    index = _source_index(registry) if registry is not None else None
    for row in scan_local_skills() if rows is None else rows:
        name = row["name"]
        removable = False
        if (downloads / name / "SKILL.md").is_file():
            try:
                target = _download_path(name)
                removable = any(Path(v["path"]) == target for v in row["variants"])
            except ValueError:
                removable = False
        names = _runtime_names(registry, name, index)
        states[name] = {
            "enabled": all(registry.is_enabled(n) for n in names) if names else True,
            "can_toggle": bool(names),
            "can_uninstall": removable,
        }
    return states


def manage_skill(name: str, action: str, registry) -> dict:
    if action not in {"enable", "disable", "uninstall"}:
        raise ValueError("unsupported skill action")
    rows = {r["name"]: r for r in scan_local_skills()}
    if name not in rows:
        raise KeyError("skill is not installed")
    names = _runtime_names(registry, name)
    if action != "uninstall":
        if not names:
            raise ValueError("技能尚未载入运行时，暂不能切换状态")
        for runtime_name in names:
            registry.set_enabled(runtime_name, action == "enable")
        return {"name": name, "enabled": action == "enable"}
    target = _download_path(name)
    with path_transaction(target):
        if not (target / "SKILL.md").is_file() or not any(
            Path(v["path"]) == target for v in rows[name]["variants"]
        ):
            raise ValueError("内置或外部管理的技能不能在此卸载，可使用停用")
        # Do not follow reparse points while removing a user-modified package.
        if any(
            p.is_symlink() or (hasattr(p, "is_junction") and p.is_junction())
            for p in target.rglob("*")
        ):
            raise ValueError("技能目录含链接文件，请先移除链接后重试")
        shutil.rmtree(target)
        if registry is not None:
            for runtime_name in names:
                registry.set_enabled(runtime_name, True)
                registry.unregister(runtime_name)
            # A bundled copy may have been shadowed by this downloaded version.
            from runtime.execution.suckers.market_skills import load_single_market_skill

            remaining = next((r for r in scan_local_skills() if r["name"] == name), None)
            if remaining:
                folder = Path(remaining["variants"][0]["path"])
                load_single_market_skill(
                    registry, folder.name, all_skills_dir=folder.parent, verify_tests=False
                )
    return {"name": name, "uninstalled": True}
