"""Official stable release discovery, independent of the desktop version."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from dataclasses import replace
from pathlib import Path
from urllib.parse import quote

import httpx

from .lock import ENGINES, EngineArtifact, platform_key

PACKAGES = {"codex": "@openai/codex", "opencode": "opencode-ai", "codebuddy": "@tencent-ai/codebuddy-code"}
REGISTRY = "https://registry.npmjs.org"


def metadata(package, version="latest"):
    # Requests never inherit an alternate registry or follow metadata redirects.
    with httpx.Client(timeout=30, follow_redirects=False) as client:
        url = f"{REGISTRY}/{quote(package, safe='@')}/{quote(version, safe='')}"
        for attempt in range(3):
            try:
                response = client.get(url)
                break
            except httpx.TransportError:
                if attempt == 2:
                    raise
                time.sleep(0.5 * (attempt + 1))
        response.raise_for_status()
        if len(response.content) > 2 * 1024 * 1024:
            raise ValueError("release metadata too large")
        data = response.json()
    if data.get("name") != package or not re.fullmatch(r"\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?", data.get("version", "")):
        raise ValueError("unexpected official release metadata")
    dist = data.get("dist", {})
    if not str(dist.get("tarball", "")).startswith(REGISTRY + "/") or not str(dist.get("integrity", "")).startswith("sha512-"):
        raise ValueError("release has no trusted integrity")
    return data


def latest(engine):
    data = metadata(PACKAGES[engine])
    if "-" in data["version"]:
        raise ValueError("stable channel points to a prerelease")
    return data


def native_spec(engine, data):
    key = platform_key()
    if engine == "codex":
        template = ENGINES[engine].artifact()
        if template is None:
            raise ValueError("unsupported platform")
        platform_data = metadata(PACKAGES[engine], data["version"] + "-" + key)
        root, entry, excludes = template.root, template.entrypoint, template.exclude
    else:
        package = "opencode-" + key.replace("win32", "windows")
        platform_data = metadata(package, data["version"])
        root, entry, excludes = "package/bin", "opencode.exe" if os.name == "nt" else "opencode", ()
    dist = platform_data["dist"]
    # npm metadata does not promise a compressed archive length; the
    # downloader enforces its hard cap and verifies the official SHA-512.
    size = 0
    artifact = EngineArtifact(asset=dist["tarball"].rsplit("/", 1)[1], upstream=dist["tarball"], integrity=dist["integrity"], size=size, archive="tar.gz", root=root, entrypoint=entry, magic="4d5a" if os.name == "nt" else ("cffaedfe" if key.startswith("darwin") else "7f454c46"), exclude=excludes)
    return replace(ENGINES[engine], version=data["version"], platforms={key: artifact})


def install_codebuddy(destination: Path, data):
    """Resolve dependencies with npm's integrity lock, with lifecycle scripts disabled."""
    from .node_runtime import ensure_runtime
    node, command = ensure_runtime()
    package = PACKAGES["codebuddy"]
    (destination / "package.json").write_text(json.dumps({"private": True, "dependencies": {package: data["version"]}}), "utf-8")
    env = dict(os.environ)
    env.pop("NODE_OPTIONS", None)
    env.pop("NODE_PATH", None)
    env = {key: value for key, value in env.items() if not key.lower().startswith("npm_config_")}
    for name in (".npmrc", "global.npmrc"):
        (destination / name).write_text("", "utf-8")
    result = subprocess.run(command + ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=" + REGISTRY, "--userconfig=" + str(destination / ".npmrc"), "--globalconfig=" + str(destination / "global.npmrc"), "--cache=" + str(destination / ".npm-cache")], cwd=destination, env=env, capture_output=True, timeout=600, **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}))
    if result.returncode:
        raise RuntimeError("official npm installation failed")
    lock = json.loads((destination / "package-lock.json").read_text("utf-8"))
    installed = lock["packages"]["node_modules/" + package]
    if installed.get("version") != data["version"] or installed.get("integrity") != data["dist"]["integrity"]:
        raise ValueError("CodeBuddy release integrity mismatch")
    for name, record in lock["packages"].items():
        if name and (not str(record.get("resolved", "")).startswith(REGISTRY + "/") or not str(record.get("integrity", "")).startswith("sha512-")):
            raise ValueError("untrusted npm dependency source")
    shutil.rmtree(destination / ".npm-cache", ignore_errors=True)
    entry = "node_modules/" + package + "/bin/codebuddy"
    verify([node, str(destination / entry)], data["version"])
    files = {}
    for path in destination.rglob("*"):
        if path.is_file() and not path.is_symlink():
            with path.open("rb") as source:
                digest = hashlib.file_digest(source, "sha256").hexdigest()
            files[path.relative_to(destination).as_posix()] = {"size": path.stat().st_size, "sha256": digest}
    files[entry]["sha256"] = hashlib.sha256((destination / entry).read_bytes()).hexdigest()
    return entry, files


def verify(command, version):
    result = subprocess.run([*command, "--version"], capture_output=True, timeout=30, **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}))
    text = (result.stdout + result.stderr).decode("utf-8", "replace")
    if result.returncode or not re.search(r"(?<![\d.])" + re.escape(version) + r"(?![\d.])", text):
        raise ValueError("engine version smoke test failed")
