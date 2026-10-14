"""Engines installed from the store: pins, downloads, unpacking, resolution, API."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import tarfile
import zipfile
from dataclasses import replace
from pathlib import Path

import httpx
import pytest

from runtime.execution.codex_backend.command import resolve_codex_app_server_command
from runtime.execution.codex_backend.types import ConfigurationError
from runtime.execution.engine_packages import installer as installer_module
from runtime.execution.engine_packages import lock, store
from runtime.execution.engine_packages import status as status_module
from runtime.execution.engine_packages.installer import (
    EngineInstaller,
    EngineInstallError,
    _SourceFailed,
    download,
    unpack,
)
from runtime.execution.engine_packages.lock import ENGINES, EngineArtifact, EngineSpec
from runtime.execution.engine_packages.status import engine_status

ROOT = Path(__file__).resolve().parents[1]
ELF = bytes.fromhex("7f454c46") + b"\x02\x01\x01" + b"\x00" * 64


def test_pins_match_the_desktop_bundle():
    """The store installs exactly what the full offline installer bundles."""

    package = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    codex = ENGINES["codex"]
    assert package["devDependencies"]["@openai/codex"] == codex.version
    pnpm_lock = (ROOT / "frontend" / "pnpm-lock.yaml").read_text(encoding="utf-8")
    for key, artifact in codex.platforms.items():
        entry = f"  '@openai/codex@{codex.version}-{key}':\n    resolution: {{integrity: "
        assert f"{entry}{artifact.integrity}}}" in pnpm_lock, key
        assert artifact.upstream.endswith(f"/codex-{codex.version}-{key}.tgz")
        assert artifact.exclude == ("codex-resources/voice",)

    opencode_lock = json.loads(
        (ROOT / "frontend" / "electron" / "opencode-runtime-lock.json").read_text(encoding="utf-8")
    )
    opencode = ENGINES["opencode"]
    assert opencode.version == opencode_lock["version"]
    assert set(opencode.platforms) == set(opencode_lock["platforms"])
    for key, artifact in opencode.platforms.items():
        pinned = opencode_lock["platforms"][key]
        assert artifact.upstream == pinned["url"]
        assert artifact.integrity == f"sha256:{pinned['sha256']}"
        assert artifact.members == (pinned["executable"],)
        assert artifact.magic == pinned["executableMagic"]


def _codex_tarball(*, extra: dict[str, bytes] | None = None) -> bytes:
    root = "package/vendor/x86_64-unknown-linux-musl"
    files = {
        f"{root}/bin/codex": ELF,
        f"{root}/codex-path/rg": ELF,
        f"{root}/codex-package.json": b"{}",
        f"{root}/codex-resources/voice/bin/codex-voice-host": ELF,
        "package/package.json": b"{}",
        **(extra or {}),
    }
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as bundle:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o755
            bundle.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def _sri(data: bytes) -> str:
    return "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()


def _fake_codex(monkeypatch, data: bytes) -> EngineArtifact:
    artifact = replace(
        ENGINES["codex"].platforms["linux-x64"], integrity=_sri(data), size=len(data)
    )
    spec = replace(ENGINES["codex"], platforms={"linux-x64": artifact})
    monkeypatch.setitem(lock.ENGINES, "codex", spec)
    monkeypatch.setattr(lock, "platform_key", lambda: "linux-x64")
    monkeypatch.setattr(store, "platform_key", lambda: "linux-x64")
    monkeypatch.setattr(installer_module, "platform_key", lambda: "linux-x64")
    monkeypatch.setattr(status_module, "platform_key", lambda: "linux-x64")
    return artifact


@pytest.fixture()
def engines_dir(tmp_path, monkeypatch):
    root = tmp_path / "engines"
    monkeypatch.setenv("ECHO_ENGINES_DIR", str(root))
    monkeypatch.delenv("ECHO_ENGINES_STRICT", raising=False)
    monkeypatch.delenv("ECHO_CODEX_EXECUTABLE", raising=False)
    monkeypatch.delenv("ECHO_OPENCODE_BIN", raising=False)
    return root


def _serving(data: bytes, failing: set[str] = frozenset()):
    seen: list[str] = []

    def fetch(url, destination, artifact, progress):
        seen.append(url)
        if any(part in url for part in failing):
            raise _SourceFailed("unreachable")
        destination.write_bytes(data)
        progress(len(data))

    return fetch, seen


def test_install_falls_back_to_upstream_and_becomes_the_codex_used(engines_dir, monkeypatch):
    data = _codex_tarball()
    _fake_codex(monkeypatch, data)
    fetch, seen = _serving(data, failing={"ai.echo-age.com"})
    job = EngineInstaller(fetch=fetch).install_now("codex")

    assert (job.state, job.source, job.error) == ("done", "upstream", None)
    assert "ai.echo-age.com/marketplace/engines/codex/0.162.0/" in seen[0]
    assert seen[1].startswith("https://registry.npmjs.org/")
    installed = engines_dir / "codex"
    assert (installed / "bin" / "codex").read_bytes() == ELF
    assert not (installed / "codex-resources" / "voice").exists()
    manifest = json.loads((installed / "echo-engine.json").read_text(encoding="utf-8"))
    assert manifest["source"] == "upstream"
    assert manifest["files"]["bin/codex"]["sha256"] == hashlib.sha256(ELF).hexdigest()
    assert not (engines_dir / ".staging").exists() or not any((engines_dir / ".staging").iterdir())

    command = resolve_codex_app_server_command()
    assert Path(command[0]) == installed / "bin" / "codex"
    status = engine_status("codex", EngineInstaller(fetch=fetch))
    assert (status["state"], status["source"], status["can_uninstall"]) == (
        "ready",
        "installed",
        True,
    )


def test_a_failed_update_keeps_the_previous_engine(engines_dir, monkeypatch):
    data = _codex_tarball()
    _fake_codex(monkeypatch, data)
    good, _ = _serving(data)
    EngineInstaller(fetch=good).install_now("codex")
    before = (engines_dir / "codex" / "echo-engine.json").read_bytes()

    broken, seen = _serving(b"", failing={"https://"})
    job = EngineInstaller(fetch=broken).install_now("codex")
    assert (job.state, job.error) == ("failed", "download_failed")
    assert len(seen) == 2
    assert (engines_dir / "codex" / "echo-engine.json").read_bytes() == before


def test_uninstall_removes_only_the_store_install(engines_dir, monkeypatch):
    data = _codex_tarball()
    _fake_codex(monkeypatch, data)
    fetch, _ = _serving(data)
    installer = EngineInstaller(fetch=fetch)
    installer.install_now("codex")
    assert installer.uninstall("codex") is True
    assert not (engines_dir / "codex").exists()
    assert installer.uninstall("codex") is False
    with pytest.raises(EngineInstallError):
        installer.uninstall("not-an-engine")


def test_strict_desktop_never_uses_the_host_path(engines_dir, monkeypatch):
    from runtime.execution import opencode_backend
    from runtime.execution.codex_backend import command as command_module

    monkeypatch.setattr(command_module, "_resolve_codex_command", lambda name: "/usr/bin/codex")
    monkeypatch.setattr(opencode_backend.shutil, "which", lambda name: "/usr/bin/opencode")
    assert resolve_codex_app_server_command()[0] == "/usr/bin/codex"

    monkeypatch.setenv("ECHO_ENGINES_STRICT", "1")
    with pytest.raises(ConfigurationError):
        resolve_codex_app_server_command()
    assert opencode_backend.executable() is None
    readiness = opencode_backend.inspect_readiness(None)
    assert readiness["available"] is False
    assert readiness["reason_code"] in {"not_installed", "executable_unavailable"}


def test_unpack_refuses_links_and_escapes(tmp_path):
    artifact = replace(ENGINES["codex"].platforms["linux-x64"])
    for name in ("package/vendor/x86_64-unknown-linux-musl/../../../evil",):
        data = _codex_tarball(extra={name: b"x"})
        archive = tmp_path / "escape.tgz"
        archive.write_bytes(data)
        with pytest.raises(EngineInstallError):
            unpack(archive, artifact, tmp_path / "out-escape")

    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as bundle:
        info = tarfile.TarInfo("package/vendor/x86_64-unknown-linux-musl/bin/codex")
        info.type = tarfile.SYMTYPE
        info.linkname = "/bin/sh"
        bundle.addfile(info)
    archive = tmp_path / "link.tgz"
    archive.write_bytes(buffer.getvalue())
    with pytest.raises(EngineInstallError):
        unpack(archive, artifact, tmp_path / "out-link")


def test_unpack_checks_the_executable_format(tmp_path):
    artifact = ENGINES["opencode"].platforms["win32-x64"]
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr("opencode.exe", b"not a program")
        bundle.writestr("README.md", b"skipped")
    archive = tmp_path / "opencode.zip"
    archive.write_bytes(buffer.getvalue())
    with pytest.raises(EngineInstallError):
        unpack(archive, artifact, tmp_path / "bad")

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr("opencode.exe", b"MZ" + b"\x00" * 64)
        bundle.writestr("README.md", b"skipped")
    archive.write_bytes(buffer.getvalue())
    files = unpack(archive, artifact, tmp_path / "good")
    assert set(files) == {"opencode.exe"}


def _client(routes: dict[str, httpx.Response]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        return routes.get(str(request.url), httpx.Response(404))

    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)


def test_download_accepts_only_the_pinned_archive_from_known_hosts(tmp_path):
    data = b"pinned engine archive"
    artifact = EngineArtifact(
        asset="engine.tgz",
        upstream="https://github.com/example/engine.tgz",
        integrity="sha256:" + hashlib.sha256(data).hexdigest(),
        size=len(data),
        archive="tar.gz",
        root="",
        entrypoint="engine",
        magic="7f454c46",
    )
    start = "https://github.com/example/engine.tgz"
    cdn = "https://release-assets.githubusercontent.com/engine.tgz"
    target = tmp_path / "engine.tgz"
    received: list[int] = []

    redirect = httpx.Response(302, headers={"location": cdn})
    download(
        start,
        target,
        artifact,
        received.append,
        client=_client({start: redirect, cdn: httpx.Response(200, content=data)}),
    )
    assert target.read_bytes() == data and received[-1] == len(data)

    elsewhere = httpx.Response(302, headers={"location": "https://evil.example/engine.tgz"})
    with pytest.raises(_SourceFailed):
        download(start, target, artifact, received.append, client=_client({start: elsewhere}))
    with pytest.raises(_SourceFailed):
        download(
            start,
            target,
            artifact,
            received.append,
            client=_client({start: httpx.Response(200, content=b"x" * len(data))}),
        )
    with pytest.raises(_SourceFailed):
        download(
            start,
            target,
            artifact,
            received.append,
            client=_client({start: httpx.Response(200, content=data + b"!")}),
        )
    with pytest.raises(_SourceFailed):
        download(
            "http://github.com/example/engine.tgz",
            target,
            artifact,
            received.append,
            client=_client({}),
        )


def test_engines_api_lists_installs_and_requires_admin(engines_dir, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from runtime.sensing.gateway.engine_packages_router import create_engine_packages_router

    data = _codex_tarball()
    _fake_codex(monkeypatch, data)
    fetch, _ = _serving(data)
    installer = EngineInstaller(fetch=fetch)
    monkeypatch.setattr(installer, "start", lambda engine_id: installer.install_now(engine_id))
    app = FastAPI()
    app.include_router(create_engine_packages_router(installer=installer))
    client = TestClient(app)

    listed = client.get("/api/engines").json()["engines"]
    codex = next(item for item in listed if item["id"] == "codex")
    assert codex["state"] in {"not_installed", "ready"}
    assert codex["download_size"] == len(data)

    installed = client.post("/api/engines/codex/install").json()
    assert (installed["state"], installed["source"]) == ("ready", "installed")
    assert installed["job"]["state"] == "done"
    assert client.post("/api/engines/nope/install").status_code == 404
    removed = client.delete("/api/engines/codex").json()
    assert removed["installed_version"] is None

    locked = FastAPI()
    locked.include_router(create_engine_packages_router(require_auth=True, installer=installer))
    assert TestClient(locked).post("/api/engines/codex/install").status_code == 401


def test_installed_engine_of_an_older_pin_is_not_used(engines_dir, monkeypatch):
    data = _codex_tarball()
    _fake_codex(monkeypatch, data)
    fetch, _ = _serving(data)
    EngineInstaller(fetch=fetch).install_now("codex")
    manifest_path = engines_dir / "codex" / "echo-engine.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = "0.100.0"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    assert store.installed_executable("codex") is None
    status = engine_status("codex", EngineInstaller(fetch=fetch))
    assert status["update_available"] is True
    assert status["installed_version"] == "0.100.0"


def test_engine_spec_mirror_layout():
    spec = EngineSpec(id="codex", name="Codex", version="1.2.3", license="x", homepage="h")
    artifact = ENGINES["codex"].platforms["win32-x64"]
    assert spec.mirror_url(artifact) == (
        "https://ai.echo-age.com/marketplace/engines/codex/1.2.3/codex-0.162.0-win32-x64.tgz"
    )
