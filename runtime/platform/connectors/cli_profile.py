"""Echo-owned CLI homes shared by connector login and direct Echo shell calls.

This routes configuration; it is not a filesystem sandbox. Native external
engine shells and CLIs that ignore these variables require separate adapters.
"""

from __future__ import annotations

from pathlib import Path


def cli_profile_env(connector_id: str) -> dict[str, str]:
    if connector_id != "dingtalk":
        return {}
    from runtime.platform.capabilities.tenant_context import current_capability_scope
    from runtime.platform.process.paths import app_paths
    from runtime.safety.auth.scope import tenant_scoped_path

    root = tenant_scoped_path(
        app_paths().data_dir / "connector-profiles" / connector_id / "home",
        current_capability_scope(),
    ).resolve()
    paths = {
        "HOME": root,
        "USERPROFILE": root,
        "XDG_CONFIG_HOME": root / ".config",
        "XDG_DATA_HOME": root / ".local" / "share",
        "APPDATA": root / "AppData" / "Roaming",
        "LOCALAPPDATA": root / "AppData" / "Local",
    }
    for path in paths.values():
        path.mkdir(parents=True, exist_ok=True)
    return {key: str(path) for key, path in paths.items()}


def direct_cli_profile_env(argv: list[str]) -> dict[str, str]:
    if not argv or Path(argv[0].replace("\\", "/")).name.lower() not in {
        "dws",
        "dws.cmd",
        "dws.exe",
    }:
        return {}
    return cli_profile_env("dingtalk")
