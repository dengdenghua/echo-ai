"""Private official Node runtime for desktops without a system Node/npm."""
from __future__ import annotations

import json
import os
import re
import shutil
import tarfile
import uuid
from dataclasses import replace
from pathlib import Path

import httpx

from .lock import EngineArtifact, platform_key
from .store import engines_root


def node_executable():
    if node := shutil.which("node"):
        return node
    base = engines_root() / ".node"
    try:
        state = json.loads((base / "runtime.json").read_text("utf-8"))
        path = base / state["node"]
        if path.resolve().is_relative_to(base.resolve()) and path.is_file():
            return str(path)
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def ensure_runtime():
    node = node_executable()
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if node and npm:
        if os.name == "nt":
            cli = Path(npm).parent / "node_modules/npm/bin/npm-cli.js"
            if cli.is_file():
                return node, [node, str(cli)]
        else:
            return node, [npm]
    base = engines_root() / ".node"
    if node and (base / "runtime.json").is_file():
        state = json.loads((base / "runtime.json").read_text("utf-8"))
        cli = base / state["npm"]
        if cli.resolve().is_relative_to(base.resolve()) and cli.is_file():
            return node, [node, str(cli)]
    # Use an official supported LTS line, not the npm package named `node`.
    key = platform_key().replace("win32", "win")
    suffix = ".zip" if os.name == "nt" else ".tar.gz"
    url = "https://nodejs.org/dist/latest-v24.x/"
    response = httpx.get(url + "SHASUMS256.txt", timeout=30, follow_redirects=False)
    response.raise_for_status()
    if len(response.content) > 128 * 1024:
        raise ValueError("invalid Node release index")
    match = re.search(r"(?m)^([a-f0-9]{64})\s+(node-v24\.\d+\.\d+-" + re.escape(key + suffix) + r")$", response.text)
    if match is None:
        raise ValueError("Node LTS is unavailable for this platform")
    asset = match[2]
    folder = asset.removesuffix(suffix)
    node_entry = "node.exe" if os.name == "nt" else "bin/node"
    npm_entry = "node_modules/npm/bin/npm-cli.js" if os.name == "nt" else "lib/node_modules/npm/bin/npm-cli.js"
    artifact = EngineArtifact(asset=asset, upstream=url + asset, integrity="sha256:" + match[1], size=0, archive="zip" if os.name == "nt" else "tar.gz", root=folder, entrypoint=node_entry, magic="4d5a" if os.name == "nt" else ("cffaedfe" if key.startswith("darwin") else "7f454c46"))
    base.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(base).free < 400 * 1024**2:
        raise OSError("insufficient disk space for private Node runtime")
    staging = base / ("staging-" + uuid.uuid4().hex)
    staging.mkdir()
    try:
        from .installer import _engine_path, download, unpack
        archive = staging / asset
        download(url + asset, archive, artifact, lambda _: None)
        if artifact.archive == "tar.gz":
            with tarfile.open(archive, "r:gz") as bundle:
                # npm's shell symlinks are unnecessary: invoke its JS entry with Node.
                members = tuple(_engine_path(artifact, member.name) for member in bundle if member.isfile())
            artifact = replace(artifact, members=tuple(name for name in members if name))
        content = staging / "runtime"
        content.mkdir()
        unpack(archive, artifact, content)
        from .releases import verify
        verify([str(content / node_entry)], folder.split("-")[1].removeprefix("v"))
        destination = base / folder
        if not destination.exists():
            os.replace(content, destination)
        state = {"node": f"{folder}/{node_entry}", "npm": f"{folder}/{npm_entry}"}
        pointer = staging / "runtime.json"
        pointer.write_text(json.dumps(state), "utf-8")
        os.replace(pointer, base / "runtime.json")
        return str(destination / node_entry), [str(destination / node_entry), str(destination / npm_entry)]
    finally:
        shutil.rmtree(staging, ignore_errors=True)
