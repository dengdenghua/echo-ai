"""Execution engines (Codex, OpenCode) installed on demand from the store.

``lock`` pins each engine's release archive per platform, ``store`` says
where installs live and which executable the runtime may use, and
``installer`` downloads, verifies and swaps in a pinned engine.
"""

from __future__ import annotations

from .installer import EngineInstaller, EngineInstallError, InstallJob, engine_installer
from .lock import ENGINES, MIRROR_BASE, EngineArtifact, EngineSpec, platform_key
from .store import (
    engines_root,
    engines_strict,
    installed_executable,
    missing_reason,
    read_installed,
)

__all__ = [
    "ENGINES",
    "MIRROR_BASE",
    "EngineArtifact",
    "EngineInstallError",
    "EngineInstaller",
    "EngineSpec",
    "InstallJob",
    "engine_installer",
    "engines_root",
    "engines_strict",
    "installed_executable",
    "missing_reason",
    "platform_key",
    "read_installed",
]
