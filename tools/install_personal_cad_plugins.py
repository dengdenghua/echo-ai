"""Install the four user-owned CAD plugins into a local Echo deployment.

The explicit --apply switch authorizes local MCP launch, inventory approval,
plugin upgrades and startup configuration. No CAD tool is invoked.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
PLUGINS = {
    "blender-control": "blender_official",
    "kicad-control": "kicad",
    "solidworks-control": "solidworks_local",
    "zemax-control": "zemax",
}


def echo_entry(name: str, config: dict[str, Any]) -> dict[str, Any]:
    """Translate Codex seconds to Echo milliseconds without dropping cwd."""
    return {
        "name": name,
        "command": config["command"],
        "args": config.get("args", []),
        "env": config.get("env", {}),
        "cwd": config.get("cwd"),
        "name_prefix": f"mcp_{name}_",
        "timeout_ms": int(float(config.get("tool_timeout_sec", 30)) * 1000),
        "connect_timeout_ms": int(float(config.get("startup_timeout_sec", 30)) * 1000),
    }


def merge_config(config: dict[str, Any], entries: list[dict[str, Any]]) -> dict[str, Any]:
    """Keep unrelated servers and add only the four selected trust sources."""
    result = dict(config)
    managed = {entry["name"] for entry in entries}
    result["mcp_servers"] = [
        entry for entry in config.get("mcp_servers", []) if entry["name"] not in managed
    ] + entries
    immunity = dict(config.get("immunity", {}))
    sources = list(immunity.get("trusted_sources", []))
    for name in sorted(managed):
        source = f"mcp://{name}/*"
        if source not in sources:
            sources.append(source)
    immunity["trusted_sources"] = sources
    result["immunity"] = immunity
    return result


def install(
    echo_home: Path | None, config_path: Path, zemax_python: Path, data_dir: Path | None = None
) -> dict[str, Any]:
    # Resolve before importing modules whose paths are captured at import time.
    if echo_home is not None:
        os.environ["ECHO_HOME"] = str(echo_home)
    if data_dir is not None:
        os.environ["ECHO_DATA_DIR"] = str(data_dir)
    runtime_home = Path(os.environ.get("ECHO_HOME") or Path.home() / ".echo")
    sys.path.insert(0, str(ROOT))
    from runtime.adapters.mcp_client import MCPServerConfig, PersistentStdioMCPClient
    from runtime.adapters.mcp_client.trust import get_trust_store
    from runtime.execution.suckers import SkillRegistry
    from runtime.platform.capabilities.capability_registry import CapabilityRegistry
    from runtime.platform.config.builder import _register_mcp_server
    from runtime.platform.config.loader import load_from_dict, load_from_yaml
    from runtime.platform.config.schema import MCPServerConfigEntry
    from runtime.platform.io import atomic_write_json
    from runtime.platform.plugins.codex_discovery import discover_codex_plugins
    from runtime.platform.plugins.plugin_lifecycle import install_local_plugin
    from runtime.platform.process.paths import app_paths

    if not zemax_python.is_file():
        raise ValueError(f"Create the Zemax environment first: {zemax_python}")
    original = config_path.read_text("utf-8")
    raw = yaml.safe_load(original) or {}
    # Include inherited servers and trust sources when editing an extends file.
    effective = load_from_yaml(config_path)
    raw["mcp_servers"] = [entry.model_dump() for entry in effective.mcp_servers]
    raw.setdefault("immunity", {})["trusted_sources"] = list(effective.immunity.trusted_sources)
    plugin_root = app_paths().codex_plugins_path
    entries: list[dict[str, Any]] = []
    inventories: dict[str, list[str]] = {}
    transactions: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="echo-cad-") as temporary:
        staging = Path(temporary)
        for plugin_id, server in PLUGINS.items():
            source = ROOT / "extensions/codex-plugins" / plugin_id
            candidate = staging / plugin_id
            shutil.copytree(
                source, candidate, ignore=shutil.ignore_patterns("__pycache__", "*.pyc")
            )
            mcp = json.loads((candidate / ".mcp.json").read_text("utf-8"))
            local = mcp["mcpServers"][server]
            target = plugin_root / plugin_id
            if plugin_id == "zemax-control":
                local.update(
                    command=str(zemax_python),
                    args=[str(target / "scripts/run_server.py")],
                    cwd=str(target),
                )
            entry = echo_entry(server, local)
            MCPServerConfigEntry.model_validate(entry)
            if not Path(entry["command"]).is_file():
                raise ValueError(f"Missing MCP interpreter: {entry['command']}")
            (candidate / ".mcp.json").write_text(json.dumps(mcp, indent=2) + "\n", "utf-8")
            probe = dict(entry)
            if plugin_id == "zemax-control":
                probe.update(args=[str(candidate / "scripts/run_server.py")], cwd=str(candidate))
            client = PersistentStdioMCPClient(
                MCPServerConfig.model_validate(probe),
                connect_timeout_ms=entry["connect_timeout_ms"],
            )
            try:
                inventories[server] = sorted(tool.name for tool in client.list_tools())
                if not inventories[server]:
                    raise RuntimeError(f"No MCP tools discovered: {server}")
            finally:
                client.close()
            entries.append(entry)
            print(f"{plugin_id}: discovered {len(inventories[server])} tools", flush=True)

        proposed = merge_config(raw, entries)
        load_from_dict(proposed)
        candidates = {p["id"]: p for p in discover_codex_plugins([staging])}
        for plugin_id in PLUGINS:
            if not candidates[plugin_id]["smoke"]["ok"]:
                raise ValueError(f"Plugin smoke failed: {plugin_id}")
        # Preflight all four before making any installation changes.
        installed = {p["id"]: p for p in discover_codex_plugins([plugin_root])}
        for plugin_id in PLUGINS:
            old = installed.get(plugin_id)
            new = candidates[plugin_id]
            if old and old["version"] == new["version"]:
                old_digest = old["smoke"]["content_provenance"]["digest"]
                if old_digest != new["smoke"]["content_provenance"]["digest"]:
                    raise ValueError(
                        f"Changed installed package requires a version bump: {plugin_id}"
                    )
        for plugin_id in PLUGINS:
            old = installed.get(plugin_id)
            if old and old["version"] == candidates[plugin_id]["version"]:
                continue
            transactions.append(
                install_local_plugin(
                    staging / plugin_id, plugin_root=plugin_root, confirm_install=True
                )
            )

    store = get_trust_store()
    for server, names in inventories.items():
        store.approve(
            server, names, note="User-requested migration of personal CAD plugins to Echo"
        )
    registry = SkillRegistry()
    for entry in entries:
        client = _register_mcp_server(registry, MCPServerConfigEntry.model_validate(entry))
        if client is None:
            raise RuntimeError(f"Echo could not register {entry['name']}")
        try:
            expected = {entry["name_prefix"] + name for name in inventories[entry["name"]]}
            if not expected.issubset(registry.all_names()):
                raise RuntimeError(f"Echo tool registration incomplete: {entry['name']}")
        finally:
            client.close()

    capabilities = CapabilityRegistry()
    for plugin_id in PLUGINS:
        item = capabilities.get(plugin_id)
        if item is None:
            raise RuntimeError(f"Installed plugin not discoverable: {plugin_id}")
        if not item["installed"]:
            capabilities.install(plugin_id)
        capabilities.grant_permissions(plugin_id, item.get("permissions", []))
        if not capabilities.set_enabled(plugin_id, True):
            raise RuntimeError(f"Could not enable {plugin_id}")

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    backup = runtime_home / "backups" / f"config-before-cad-{timestamp}.yaml"
    backup.parent.mkdir(parents=True, exist_ok=True)
    backup.write_text(original, "utf-8")
    rendered = yaml.safe_dump(proposed, allow_unicode=True, sort_keys=False)
    temporary_config = config_path.with_suffix(".cad-install.tmp")
    temporary_config.write_text(rendered, "utf-8")
    temporary_config.replace(config_path)
    report = {
        "timestamp_utc": timestamp,
        "config_backup": str(backup),
        "plugin_root": str(plugin_root),
        "transactions": transactions,
        "tool_counts": {name: len(tools) for name, tools in inventories.items()},
        "tools": inventories,
        "echo_registered_tools": len(registry.all_names()),
        "cad_document_operations": "none",
        "activation": "restart Echo to load the updated startup configuration",
    }
    atomic_write_json(app_paths().data_dir / "personal-cad-migration.json", report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--echo-home", type=Path, help="Omit to retain Echo's current default paths"
    )
    parser.add_argument("--data-dir", type=Path, help="Explicit ECHO_DATA_DIR override")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--zemax-python", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.apply:
        parser.error("Pass --apply to install and approve the four local CAD MCP inventories")
    echo_home = args.echo_home.resolve() if args.echo_home else None
    runtime_home = echo_home or Path(os.environ.get("ECHO_HOME") or Path.home() / ".echo")
    zemax_python = args.zemax_python or runtime_home / "runtimes/zemax-control/Scripts/python.exe"
    report = install(
        echo_home,
        args.config.resolve(),
        zemax_python.resolve(),
        args.data_dir.resolve() if args.data_dir else None,
    )
    print(json.dumps({"tool_counts": report["tool_counts"], "activation": report["activation"]}))


if __name__ == "__main__":
    main()
