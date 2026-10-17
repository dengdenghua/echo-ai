"""Agent pack discovery for file-based, pluggable agent repositories.

This module intentionally stops at *preview*. External repositories can carry
powerful prompts, skills, commands, and MCP connector definitions; importing
them into Echo should first produce a normalized manifest that the UI can
review, diff, and permission-gate before anything is installed or executed.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

from runtime.execution.misc._agent_packs_apps import _scan_app_modules
from runtime.execution.misc._agent_packs_models import (
    AgentPackAgentNotFound,
    AgentPackImportResult,
    AgentPackPreview,
    PackModule,
)
from runtime.execution.misc._agent_packs_parsing import (
    _coerce_tool_list,
    _count_assets,
    _first_heading_or_line,
    _parse_frontmatter,
    _read_json,
    _read_readme_summary,
    _read_text,
    _read_yaml,
    _strip_frontmatter,
)
from runtime.execution.misc.agent_avatar import pixel_agent_avatar_svg
from runtime.platform.io import atomic_write_json, atomic_write_text

_SAFE_PACK_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
_PACK_IMPORT_SOURCE = "agent-pack-import"

# Manifest directories this scanner understands. WorkBuddy/CodeBuddy experts use
# `.codebuddy-plugin/plugin.json` (same agents/*.md + skills/**/SKILL.md shapes),
# so we treat it as a first-class peer of Claude/Codex packs.
_PACK_MANIFEST_FORMATS: tuple[tuple[str, str], ...] = (
    (".claude-plugin", "claude"),
    (".codex-plugin", "codex"),
    (".codebuddy-plugin", "codebuddy"),
)


def scan_agent_pack(root: str | Path) -> AgentPackPreview:
    base = Path(root).expanduser().resolve()
    if not base.exists():
        raise FileNotFoundError(f"agent pack root not found: {base}")
    if not base.is_dir():
        raise NotADirectoryError(f"agent pack root is not a directory: {base}")

    warnings: list[str] = []
    marketplace = _read_marketplace(base, warnings)
    plugins = _scan_plugins(base, warnings)
    plugin_by_dir = {Path(module.path): module for module in plugins}

    agents: list[PackModule] = []
    apps: list[PackModule] = []
    skills: list[PackModule] = []
    commands: list[PackModule] = []
    mcp_servers: list[PackModule] = []

    for plugin_dir, plugin in plugin_by_dir.items():
        apps.extend(_scan_app_modules(plugin_dir, plugin, warnings))
        agents.extend(_scan_markdown_modules(plugin_dir / "agents", "agent", plugin, warnings))
        skills.extend(_scan_skill_modules(plugin_dir / "skills", plugin, warnings))
        commands.extend(
            _scan_markdown_modules(plugin_dir / "commands", "command", plugin, warnings)
        )
        for config_path in _plugin_mcp_paths(plugin_dir, plugin, warnings):
            mcp_servers.extend(_scan_mcp_servers(config_path, plugin, warnings))

    managed_agents, subagents = _scan_managed_agents(base, warnings)
    _append_security_warnings(warnings, mcp_servers, managed_agents)

    return AgentPackPreview(
        root=str(base),
        marketplace=marketplace,
        plugins=plugins,
        apps=apps,
        agents=agents,
        skills=skills,
        commands=commands,
        mcp_servers=mcp_servers,
        managed_agents=managed_agents,
        subagents=subagents,
        warnings=warnings,
    )


def import_agent_from_pack(
    root: str | Path,
    agent_name: str,
    agents_root: str | Path,
    skills_root: str | Path,
) -> AgentPackImportResult:
    preview = scan_agent_pack(root)
    module = next(
        (agent for agent in preview.agents if agent.name == agent_name or agent.id == agent_name),
        None,
    )
    if module is None:
        raise AgentPackAgentNotFound(f"agent not found in pack: {agent_name}")

    pack_root = Path(preview.root)
    source_path = _require_real_file_under(Path(module.path), pack_root, "agent markdown")
    plugin_dir = source_path.parent.parent
    plugin = next((item for item in preview.plugins if item.id == module.source_plugin), None)
    if plugin and plugin.metadata.get("dependency_error"):
        raise ValueError("invalid role dependencies; fix the package manifest before importing")
    from runtime.execution.agents.dependencies import normalize_role_dependencies

    dependencies = normalize_role_dependencies(
        {
            "connectors": (plugin.metadata.get("required_connectors", []) if plugin else []),
            "mcp_servers": [
                m.name for m in preview.mcp_servers if m.source_plugin == module.source_plugin
            ],
        }
    )
    plugin_name = plugin.name if plugin else str(module.source_plugin or plugin_dir.name)
    plugin_version = str((plugin.metadata.get("version") if plugin else "") or "0.1.0")
    agent_id = _slugify_agent_id(module.name)
    agents_base = _ensure_real_directory(Path(agents_root).expanduser(), "agents root")
    skills_base = Path(skills_root).expanduser().resolve()
    agent_dir = agents_base / agent_id
    warnings = list(preview.warnings)

    if agent_dir.is_symlink() or (agent_dir.exists() and not agent_dir.is_dir()):
        raise FileExistsError(f"agent path already exists but is not a real directory: {agent_dir}")
    if agent_dir.exists():
        return AgentPackImportResult(
            agent_id=agent_id,
            agent_name=_titleize(module.name),
            agent_path=str(agent_dir),
            copied_skills=[],
            skipped_skills=[],
            warnings=[*warnings, f"agent already exists: {agent_id}"],
            already_exists=True,
        )

    text = source_path.read_text(encoding="utf-8")
    body = _strip_frontmatter(text).strip()
    tools = module.metadata.get("tools") if isinstance(module.metadata, dict) else []
    mcp_tools = [tool for tool in tools if isinstance(tool, str) and tool.startswith("mcp__")]
    if mcp_tools:
        warnings.append("MCP tools were detected and left disabled: " + ", ".join(mcp_tools))

    plugin_skills = [
        skill for skill in preview.skills if skill.source_plugin == module.source_plugin
    ]
    selected_skills = _select_agent_skills(body, plugin_skills)
    copied_skills: list[str] = []
    skipped_skills: list[str] = []
    created_agent = False
    try:
        copied_skills, skipped_skills = _copy_pack_skills(
            selected_skills,
            skills_base,
            pack_root=pack_root,
        )

        core_dir = agent_dir / "agent-core"
        agent_dir.mkdir(parents=True)
        created_agent = True
        core_dir.mkdir()
        profile = {
            "id": agent_id,
            "templateId": f"{plugin_name}:{module.name}",
            "templateVersion": plugin_version,
            "source_kind": _PACK_IMPORT_SOURCE,
            "managed_by": "agent-pack",
            "source_pack_root": preview.root,
            "source_plugin": module.source_plugin,
            "source_agent_path": str(source_path),
            "name": _titleize(module.name),
            "icon": "Agent",
            "description": module.description,
            "avatar": "avatar.svg",
            "model": {"provider": "auto", "name": "auto"},
            "runtime": "local",
            "dependencies": dependencies,
            "creator": f"pack:{plugin_name}",
            "category": "researcher",
            "tags": ["finance", "research", "market", "analysis"],
        }
        atomic_write_json(agent_dir / "profile.jsonc", profile, ensure_ascii=False, indent=2)
        atomic_write_text(
            core_dir / "SOUL.md",
            (
                f"# Imported Agent: {_titleize(module.name)}\n\n"
                f"Source pack: {plugin_name} ({plugin_version}).\n"
                "External MCP connectors from the source pack are not enabled by default. "
                "Use only locally available tools and copied skills unless the user explicitly configures trusted connectors.\n\n"
                f"{body}\n"
            ),
            newline=None,
        )
        atomic_write_text(
            core_dir / "IDENTITY.md",
            (
                f"- Name: {_titleize(module.name)}\n"
                "- Role: Financial research agent\n"
                f"- Source: {plugin_name}\n"
            ),
            newline=None,
        )
        atomic_write_json(
            core_dir / "tool-registry.jsonc",
            {
                "arms": ["web_read", "fs_writer"],
                "extra_affinity": ["finance", "research", "market", "sector", "comps", "analysis"],
                "private_skills": [skill.name for skill in selected_skills],
                "disabled_source_tools": mcp_tools,
            },
            ensure_ascii=False,
            indent=2,
        )
        _write_agent_avatar(agent_dir / "avatar.svg", _titleize(module.name))
    except Exception:
        if created_agent and agent_dir.is_dir() and not agent_dir.is_symlink():
            shutil.rmtree(agent_dir, ignore_errors=True)
        _cleanup_copied_skill_dirs(skills_base, copied_skills)
        raise

    return AgentPackImportResult(
        agent_id=agent_id,
        agent_name=_titleize(module.name),
        agent_path=str(agent_dir),
        copied_skills=copied_skills,
        skipped_skills=skipped_skills,
        warnings=warnings,
    )


def _scan_plugins(base: Path, warnings: list[str]) -> list[PackModule]:
    modules: list[PackModule] = []
    seen_ids: set[str] = set()
    for manifest_dir, format_name in _PACK_MANIFEST_FORMATS:
        for manifest in sorted(base.rglob(f"{manifest_dir}/plugin.json")):
            plugin_dir = manifest.parent.parent
            data = _read_json(manifest, warnings) or {}
            dependency_metadata: dict[str, Any] = {}
            try:
                from runtime.execution.agents.dependencies import normalize_role_dependencies

                raw_dependencies = data.get("dependencies")
                normalized = normalize_role_dependencies(raw_dependencies)
                dependency_metadata["required_connectors"] = normalized["connectors"]
                dependency_metadata["mcp_paths"] = (raw_dependencies or {}).get("mcpServers")
            except ValueError as exc:
                warnings.append(f"{manifest}: {exc}")
                dependency_metadata["dependency_error"] = True
            raw_name = str(data.get("name") or plugin_dir.name)
            module_id = raw_name
            if module_id in seen_ids:
                module_id = f"{format_name}:{raw_name}"
            seen_ids.add(module_id)
            modules.append(
                PackModule(
                    id=module_id,
                    kind="plugin",
                    name=raw_name,
                    path=str(plugin_dir),
                    description=str(data.get("description") or ""),
                    metadata={
                        "version": data.get("version"),
                        "author": data.get("author"),
                        "manifest": str(manifest),
                        "format": format_name,
                        "layout": _infer_plugin_layout(plugin_dir),
                        **dependency_metadata,
                    },
                )
            )
    return modules


def _plugin_mcp_paths(plugin_dir: Path, plugin: PackModule, warnings: list[str]) -> list[Path]:
    """Resolve declared MCP files without following paths outside the plugin."""
    raw = plugin.metadata.get("mcp_paths")
    declared = raw is not None
    refs = ([raw] if isinstance(raw, str) else raw) if declared else [".mcp.json"]
    if not isinstance(refs, list) or len(refs) > 64:
        plugin.metadata["dependency_error"] = True
        warnings.append(f"{plugin.name}: dependencies.mcpServers must contain file paths")
        return []
    paths: list[Path] = []
    for ref in refs:
        try:
            if not isinstance(ref, str) or not ref or Path(ref).is_absolute():
                raise ValueError("MCP dependency must be a relative file path")
            candidate = plugin_dir / ref
            if not declared and not candidate.exists():
                continue
            resolved = _require_real_file_under(candidate, plugin_dir, "MCP dependency")
            if resolved not in paths:
                paths.append(resolved)
        except (ValueError, OSError) as exc:
            plugin.metadata["dependency_error"] = True
            warnings.append(f"{plugin.name}: invalid MCP dependency ({type(exc).__name__})")
    return paths


def _infer_plugin_layout(plugin_dir: Path) -> list[str]:
    present: list[str] = []
    for name in ("agents", "skills", "commands", "apps", "bin"):
        if (plugin_dir / name).is_dir():
            present.append(name)
    if (plugin_dir / ".mcp.json").is_file():
        present.append("mcp")
    if (
        (plugin_dir / "echo-app.jsonc").is_file()
        or (plugin_dir / ".echo-app.jsonc").is_file()
        or (plugin_dir / ".app.json").is_file()
    ):
        present.append("app")
    return present


def _read_marketplace(base: Path, warnings: list[str]) -> dict[str, Any] | None:
    marketplaces: dict[str, dict[str, Any]] = {}
    for manifest_dir, format_name in _PACK_MANIFEST_FORMATS:
        data = _read_json(base / manifest_dir / "marketplace.json", warnings)
        if data is not None:
            marketplaces[format_name] = data
    if not marketplaces:
        return None
    if len(marketplaces) == 1:
        format_name, data = next(iter(marketplaces.items()))
        return {**data, "_format": format_name}
    return {"_format": "mixed", "marketplaces": marketplaces}


def _scan_markdown_modules(
    directory: Path,
    kind: str,
    plugin: PackModule,
    warnings: list[str],
) -> list[PackModule]:
    if not directory.is_dir():
        return []
    modules: list[PackModule] = []
    for path in sorted(directory.glob("*.md")):
        text = _read_text(path, warnings)
        meta = _parse_frontmatter(text, path, warnings)
        name = str(meta.get("name") or path.stem)
        modules.append(
            PackModule(
                id=f"{plugin.id}:{kind}:{name}",
                kind=kind,
                name=name,
                path=str(path),
                description=str(meta.get("description") or _first_heading_or_line(text)),
                source_plugin=plugin.id,
                metadata={
                    "frontmatter": meta,
                    "tools": _coerce_tool_list(meta.get("tools")),
                },
            )
        )
    return modules


def _scan_skill_modules(
    directory: Path,
    plugin: PackModule,
    warnings: list[str],
) -> list[PackModule]:
    if not directory.is_dir():
        return []
    modules: list[PackModule] = []
    for path in sorted(directory.rglob("SKILL.md")):
        text = _read_text(path, warnings)
        meta = _parse_frontmatter(text, path, warnings)
        skill_dir = path.parent
        name = str(meta.get("name") or skill_dir.name)
        modules.append(
            PackModule(
                id=f"{plugin.id}:skill:{name}",
                kind="skill",
                name=name,
                path=str(skill_dir),
                description=str(meta.get("description") or _first_heading_or_line(text)),
                source_plugin=plugin.id,
                metadata={
                    "frontmatter": meta,
                    "skill_file": str(path),
                    "asset_count": _count_assets(skill_dir),
                },
            )
        )
    return modules


def _scan_mcp_servers(
    path: Path,
    plugin: PackModule,
    warnings: list[str],
) -> list[PackModule]:
    data = _read_json(path, warnings)
    if not data:
        plugin.metadata["dependency_error"] = True
        return []
    servers = data.get("mcpServers")
    if not isinstance(servers, dict):
        plugin.metadata["dependency_error"] = True
        warnings.append(f"{path}: missing mcpServers mapping")
        return []
    modules: list[PackModule] = []
    for name, config in sorted(servers.items()):
        cfg = config if isinstance(config, dict) else {}
        modules.append(
            PackModule(
                id=f"{plugin.id}:mcp:{name}",
                kind="mcp_server",
                name=str(name),
                path=str(path),
                description=str(cfg.get("url") or cfg.get("command") or ""),
                source_plugin=plugin.id,
                metadata={"config": cfg},
            )
        )
    return modules


def _scan_managed_agents(
    base: Path,
    warnings: list[str],
) -> tuple[list[PackModule], list[PackModule]]:
    cookbook_root = base / "managed-agent-cookbooks"
    if not cookbook_root.is_dir():
        return [], []
    managed: list[PackModule] = []
    subagents: list[PackModule] = []
    for agent_yaml in sorted(cookbook_root.glob("*/agent.yaml")):
        data = _read_yaml(agent_yaml, warnings) or {}
        name = str(data.get("name") or agent_yaml.parent.name)
        managed.append(
            PackModule(
                id=f"managed:{name}",
                kind="managed_agent",
                name=name,
                path=str(agent_yaml),
                description=_read_readme_summary(agent_yaml.parent, warnings),
                metadata={
                    "model": data.get("model"),
                    "system": data.get("system"),
                    "tools": data.get("tools") or [],
                    "mcp_servers": data.get("mcp_servers") or [],
                    "skills": data.get("skills") or [],
                    "callable_agents": data.get("callable_agents") or [],
                },
            )
        )
        for sub_manifest in sorted((agent_yaml.parent / "subagents").glob("*.yaml")):
            sub = _read_yaml(sub_manifest, warnings) or {}
            sub_name = str(sub.get("name") or sub_manifest.stem)
            subagents.append(
                PackModule(
                    id=f"managed:{name}:subagent:{sub_name}",
                    kind="subagent",
                    name=sub_name,
                    path=str(sub_manifest),
                    description=str(sub.get("description") or ""),
                    source_plugin=name,
                    metadata={
                        "model": sub.get("model"),
                        "tools": sub.get("tools") or [],
                        "system": sub.get("system"),
                    },
                )
            )
    return managed, subagents


def _append_security_warnings(
    warnings: list[str],
    mcp_servers: list[PackModule],
    managed_agents: list[PackModule],
) -> None:
    if mcp_servers:
        warnings.append(
            f"{len(mcp_servers)} MCP server(s) found; require trust review and credentials before enabling."
        )
    write_enabled = [
        agent.name
        for agent in managed_agents
        if "write" in json.dumps(agent.metadata.get("tools", []), ensure_ascii=False).lower()
    ]
    if write_enabled:
        warnings.append(
            "Managed agent(s) reference write-capable tools: "
            + ", ".join(write_enabled)
            + ". Install should require explicit human approval."
        )


def _slugify_agent_id(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", value.strip().lower()).strip("_")
    return slug or "imported_agent"


def _require_safe_pack_name(value: str, *, label: str) -> str:
    name = str(value or "").strip()
    if not _SAFE_PACK_NAME_RE.fullmatch(name):
        raise ValueError(
            f"invalid {label}: only alphanumeric characters, hyphens, and underscores are allowed"
        )
    return name


def _ensure_real_directory(path: Path, label: str) -> Path:
    if path.is_symlink():
        raise ValueError(f"{label} must be a real directory: {path}")
    if path.exists() and not path.is_dir():
        raise ValueError(f"{label} must be a directory: {path}")
    path.mkdir(parents=True, exist_ok=True)
    if path.is_symlink() or not path.is_dir():
        raise ValueError(f"{label} must be a real directory: {path}")
    return path.resolve()


def _require_under(path: Path, root: Path, label: str) -> Path:
    resolved = path.expanduser().resolve()
    root_resolved = root.expanduser().resolve()
    try:
        resolved.relative_to(root_resolved)
    except ValueError as exc:
        raise ValueError(f"{label} must stay inside pack root: {resolved}") from exc
    return resolved


def _require_real_file_under(path: Path, root: Path, label: str) -> Path:
    if path.is_symlink():
        raise ValueError(f"{label} must not be a symlink: {path}")
    resolved = _require_under(path, root, label)
    if not resolved.is_file():
        raise FileNotFoundError(f"{label} not found: {resolved}")
    return resolved


def _require_real_dir_under(path: Path, root: Path, label: str) -> Path:
    if path.is_symlink():
        raise ValueError(f"{label} must not be a symlink: {path}")
    resolved = _require_under(path, root, label)
    if not resolved.is_dir():
        raise NotADirectoryError(f"{label} is not a directory: {resolved}")
    return resolved


def _contains_symlink(directory: Path) -> bool:
    return any(child.is_symlink() for child in directory.rglob("*"))


def _cleanup_copied_skill_dirs(skills_root: Path, copied_skills: list[str]) -> None:
    for skill_name in copied_skills:
        try:
            safe_name = _require_safe_pack_name(skill_name, label="skill name")
        except ValueError:
            continue
        target = skills_root / safe_name
        if target.is_dir() and not target.is_symlink():
            shutil.rmtree(target, ignore_errors=True)


def _titleize(value: str) -> str:
    return (
        " ".join(part.capitalize() for part in re.split(r"[-_\s]+", value.strip()) if part) or value
    )


def _select_agent_skills(body: str, plugin_skills: list[PackModule]) -> list[PackModule]:
    lowered = body.lower()
    selected = [skill for skill in plugin_skills if skill.name.lower() in lowered]
    if selected:
        return selected
    return plugin_skills


def _copy_pack_skills(
    skills: list[PackModule],
    skills_root: Path,
    *,
    pack_root: Path,
) -> tuple[list[str], list[str]]:
    copied: list[str] = []
    skipped: list[str] = []
    skills_base = _ensure_real_directory(skills_root, "skills root")
    try:
        for skill in skills:
            skill_name = _require_safe_pack_name(skill.name, label="skill name")
            source = _require_real_dir_under(Path(skill.path), pack_root, "skill source")
            if _contains_symlink(source):
                raise ValueError(f"skill source must not contain symlinks: {source}")
            if not (source / "SKILL.md").is_file():
                raise FileNotFoundError(f"skill source missing SKILL.md: {source}")
            target = skills_base / skill_name
            if target.exists() or target.is_symlink():
                skipped.append(skill_name)
                continue
            shutil.copytree(source, target)
            copied.append(skill_name)
        return copied, skipped
    except Exception:
        _cleanup_copied_skill_dirs(skills_base, copied)
        raise


def _write_agent_avatar(path: Path, label: str) -> None:
    atomic_write_text(path, pixel_agent_avatar_svg(label), newline=None)


__all__ = [
    "AgentPackAgentNotFound",
    "AgentPackImportResult",
    "AgentPackPreview",
    "PackModule",
    "import_agent_from_pack",
    "scan_agent_pack",
]
