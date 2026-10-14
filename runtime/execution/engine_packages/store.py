"""Where installed engines live and which executable the runtime may use.

An engine installed from the store sits in ``<engines>/<id>/`` with an
``echo-engine.json`` manifest the installer writes last. Only the version this
build pins counts: after an app update that moves the pin, the old install is
reported as needing an update instead of being run.

The desktop sets ``ECHO_ENGINES_DIR`` (outside the data directory, so backups
skip several hundred megabytes of binaries) and ``ECHO_ENGINES_STRICT=1``:
then an engine is either bundled with the app (its own ``ECHO_*`` variable)
or installed here, and never whatever is on the host PATH.
"""

from __future__ import annotations

import json
import os
import stat
from dataclasses import dataclass
from pathlib import Path

from runtime.platform.process.paths import app_paths

from .lock import ENGINES, platform_key

ENGINES_DIR_ENV = "ECHO_ENGINES_DIR"
STRICT_ENV = "ECHO_ENGINES_STRICT"
MANIFEST_NAME = "echo-engine.json"
MANIFEST_SCHEMA = "echo.engine_install.v1"
# The variable that points each engine at a bundled or hand-picked binary.
EXECUTABLE_ENV = {"codex": "ECHO_CODEX_EXECUTABLE", "opencode": "ECHO_OPENCODE_BIN"}
_MANIFEST_LIMIT = 1024 * 1024


def engines_root() -> Path:
    configured = os.environ.get(ENGINES_DIR_ENV, "").strip()
    if configured:
        return Path(configured).expanduser()
    return app_paths().data_dir / "engines"


def engines_strict() -> bool:
    """True on the desktop: no PATH fallback for engines."""

    return os.environ.get(STRICT_ENV, "").strip() == "1"


@dataclass(frozen=True, slots=True)
class InstalledEngine:
    engine: str
    version: str
    platform: str
    source: str
    installed_at: str
    executable: Path
    size: int


def _inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
    except ValueError:
        return False
    return candidate != root


def read_installed(engine_id: str, root: Path | None = None) -> InstalledEngine | None:
    """The engine installed in ``root``, or None when absent or not intact.

    Cheap enough for every readiness check: the full hash check happens once,
    at install time; here the manifest must parse and the entrypoint must still
    be the regular file of the size that was installed.
    """

    folder = (root or engines_root()) / engine_id
    try:
        if not stat.S_ISDIR(folder.lstat().st_mode):
            return None
        manifest_path = folder / MANIFEST_NAME
        info = manifest_path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > _MANIFEST_LIMIT:
            return None
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict) or manifest.get("schema") != MANIFEST_SCHEMA:
            return None
        if manifest.get("engine") != engine_id:
            return None
        entrypoint = str(manifest.get("entrypoint") or "")
        files = manifest.get("files")
        record = files.get(entrypoint) if isinstance(files, dict) else None
        relative = Path(entrypoint)
        if not entrypoint or relative.is_absolute() or ".." in relative.parts:
            return None
        if not isinstance(record, dict):
            return None
        executable = folder / relative
        if not _inside(folder.resolve(strict=True), executable.resolve(strict=True)):
            return None
        entry = executable.lstat()
        if not stat.S_ISREG(entry.st_mode) or entry.st_size != record.get("size"):
            return None
        total = sum(int(item.get("size") or 0) for item in files.values() if isinstance(item, dict))
        return InstalledEngine(
            engine=engine_id,
            version=str(manifest.get("version") or ""),
            platform=str(manifest.get("platform") or ""),
            source=str(manifest.get("source") or ""),
            installed_at=str(manifest.get("installed_at") or ""),
            executable=executable,
            size=total,
        )
    except (OSError, ValueError, TypeError):
        return None


def installed_executable(engine_id: str) -> str | None:
    """The installed engine's executable, when it is the version this build pins."""

    spec = ENGINES.get(engine_id)
    installed = read_installed(engine_id)
    if spec is None or installed is None:
        return None
    if installed.version != spec.version or installed.platform != platform_key():
        return None
    return str(installed.executable)


def missing_reason(engine_id: str) -> str:
    """Why no executable resolved: ``not_installed`` when the store can fix it."""

    if os.environ.get(EXECUTABLE_ENV.get(engine_id, "")):
        return "executable_unavailable"
    spec = ENGINES.get(engine_id)
    return "not_installed" if spec and spec.artifact() else "executable_unavailable"


def missing_status(engine_id: str) -> dict[str, str]:
    """The ``reason`` / ``reason_code`` pair a readiness answer carries."""

    code = missing_reason(engine_id)
    name = ENGINES[engine_id].name if engine_id in ENGINES else engine_id
    if code == "not_installed":
        reason = f"{name} 还没安装：在 HUB「应用」的执行引擎里安装。"
    else:
        reason = f"找不到 {name} 程序，请检查 {EXECUTABLE_ENV.get(engine_id, '配置')}。"
    return {"reason": reason, "reason_code": code}


__all__ = [
    "ENGINES_DIR_ENV",
    "EXECUTABLE_ENV",
    "MANIFEST_NAME",
    "MANIFEST_SCHEMA",
    "STRICT_ENV",
    "InstalledEngine",
    "engines_root",
    "engines_strict",
    "installed_executable",
    "missing_reason",
    "missing_status",
    "read_installed",
]
