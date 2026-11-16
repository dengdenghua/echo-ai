"""Capture a known bundled/global engine as the first immutable rollback."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import time
import uuid
from pathlib import Path

from . import versions
from .lock import ENGINES, platform_key
from .store import EXECUTABLE_ENV, MANIFEST_NAME, MANIFEST_SCHEMA


def capture(root: Path, engine: str):
    state = versions.snapshot(root, engine)
    if state.get("previous") or state.get("pending"):
        return
    if (root / engine / MANIFEST_NAME).is_file():
        return  # The legacy store remains available as a rollback already.
    source = None
    if engine == "codebuddy":
        command = os.environ.get(EXECUTABLE_ENV[engine]) or shutil.which("codebuddy.cmd" if os.name == "nt" else "codebuddy")
        if command:
            path = Path(command).resolve()
            candidate = path.parent / "node_modules/@tencent-ai/codebuddy-code" if path.suffix in {".cmd", ".bat"} else path.parent.parent
            manifest = candidate / "package.json"
            if manifest.is_file():
                data = json.loads(manifest.read_text("utf-8"))
                if data.get("name") == "@tencent-ai/codebuddy-code":
                    source, entry, version = candidate, "bin/codebuddy", data["version"]
    elif engine in os.environ.get("ECHO_ENGINES_BUNDLED", "").split(","):
        binary = os.environ.get(EXECUTABLE_ENV[engine])
        artifact = ENGINES[engine].artifact()
        if binary and artifact:
            path = Path(binary)
            source = path.parents[len(Path(artifact.entrypoint).parts) - 1]
            entry, version = artifact.entrypoint, ENGINES[engine].version
    if source is None or not source.is_dir():
        return
    # Copy only the recognized package closure, never the whole global npm tree.
    paths = list(source.rglob("*"))
    if any(path.is_symlink() and not path.resolve().is_relative_to(source.resolve()) for path in paths):
        return  # Do not follow external links during baseline capture.
    size = sum(path.stat().st_size for path in paths if path.is_file())
    if shutil.disk_usage(root).free < size + 512 * 1024**2:
        raise OSError("insufficient disk space for engine rollback baseline")
    staged = root / ".staging" / (engine + "-baseline-" + uuid.uuid4().hex)
    try:
        shutil.copytree(source, staged)
        from .releases import verify
        command = [str(staged / entry)]
        if engine == "codebuddy":
            node = shutil.which("node")
            if not node:
                raise RuntimeError("Node.js is required")
            command.insert(0, node)
        verify(command, version)
        files = {}
        for path in staged.rglob("*"):
            if path.is_file():
                with path.open("rb") as handle:
                    digest = hashlib.file_digest(handle, "sha256").hexdigest()
                files[path.relative_to(staged).as_posix()] = {"size": path.stat().st_size, "sha256": digest}
        (staged / MANIFEST_NAME).write_text(json.dumps({"schema": MANIFEST_SCHEMA, "engine": engine, "version": version, "platform": platform_key(), "source": "baseline", "entrypoint": entry, "files": files, "installed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}), "utf-8")
        from .store import read_release
        if read_release(staged, engine) is None:
            raise ValueError("rollback baseline manifest is invalid")
        with versions.locked(root, engine) as base:
            state = versions._read(base)
            if state.get("previous") or state.get("pending"):
                return
            token = uuid.uuid4().hex
            versions._replace_with_retry(staged, base / token)
            state["previous" if state.get("active") else "active"] = token
            versions._write(base, state)
    finally:
        if staged.exists():
            shutil.rmtree(staged)
