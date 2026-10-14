"""Pinned execution engines the desktop can install on demand.

Each archive is the upstream release file, unmodified: Codex's npm platform
package and OpenCode's GitHub release asset. ai.echo-age.com serves
byte-identical copies under ``MIRROR_BASE``, so one pinned digest and size
cover both sources and an install never trusts where the bytes came from.

The versions and digests are the ones the full offline installer bundles
(``extras/desktop/prepare-codex-*.cjs``,
``frontend/electron/backend-runtime.cjs`` and
``frontend/electron/opencode-runtime-lock.json``);
``tests/test_engine_packages.py`` fails when they drift apart.
"""

from __future__ import annotations

import platform
import sys
from dataclasses import dataclass, field

MIRROR_BASE = "https://ai.echo-age.com/marketplace/engines"


@dataclass(frozen=True, slots=True)
class EngineArtifact:
    """One platform's release archive and how it becomes an engine directory."""

    asset: str
    """File name upstream, and the file name on the mirror."""
    upstream: str
    integrity: str
    """``sha512-<base64>`` (npm's form) or ``sha256:<hex>``."""
    size: int
    """Exact archive size in bytes; a download of any other size is rejected."""
    archive: str
    """``tar.gz`` or ``zip``."""
    root: str
    """Archive directory whose contents become the engine directory."""
    entrypoint: str
    magic: str
    """First bytes of the entrypoint, hex: PE, Mach-O or ELF."""
    members: tuple[str, ...] = ()
    """Install only these files under ``root``; empty installs all of them."""
    exclude: tuple[str, ...] = ()
    """Directories under ``root`` that are never installed."""


@dataclass(frozen=True, slots=True)
class EngineSpec:
    id: str
    name: str
    version: str
    license: str
    homepage: str
    platforms: dict[str, EngineArtifact] = field(default_factory=dict)

    def artifact(self, key: str | None = None) -> EngineArtifact | None:
        return self.platforms.get(key or platform_key())

    def mirror_url(self, artifact: EngineArtifact) -> str:
        return f"{MIRROR_BASE}/{self.id}/{self.version}/{artifact.asset}"


def platform_key() -> str:
    """This machine as the locks name it: ``win32-x64``, ``darwin-arm64`` …"""

    system = {"win32": "win32", "darwin": "darwin"}.get(sys.platform, "linux")
    machine = platform.machine().lower()
    arch = {"amd64": "x64", "x86_64": "x64", "arm64": "arm64", "aarch64": "arm64"}
    return f"{system}-{arch.get(machine, machine)}"


_NPM = "https://registry.npmjs.org/@openai/codex/-/codex-0.162.0"
# Codex 0.162 also ships an optional voice host with its own native closure;
# Echo never starts it, so it is not installed (the bundle skips it too).
_CODEX_SKIP = ("codex-resources/voice",)


def _codex(key: str, triple: str, integrity: str, size: int) -> EngineArtifact:
    windows = key.startswith("win32")
    return EngineArtifact(
        asset=f"codex-0.162.0-{key}.tgz",
        upstream=f"{_NPM}-{key}.tgz",
        integrity=integrity,
        size=size,
        archive="tar.gz",
        root=f"package/vendor/{triple}",
        entrypoint="bin/codex.exe" if windows else "bin/codex",
        magic="4d5a" if windows else ("cffaedfe" if key.startswith("darwin") else "7f454c46"),
        exclude=_CODEX_SKIP,
    )


_OPENCODE = "https://github.com/anomalyco/opencode/releases/download/v1.18.29"


def _opencode(key: str, asset: str, sha256: str, size: int) -> EngineArtifact:
    windows = key.startswith("win32")
    executable = "opencode.exe" if windows else "opencode"
    return EngineArtifact(
        asset=asset,
        upstream=f"{_OPENCODE}/{asset}",
        integrity=f"sha256:{sha256}",
        size=size,
        archive="zip" if asset.endswith(".zip") else "tar.gz",
        root="",
        entrypoint=executable,
        magic="4d5a" if windows else ("cffaedfe" if key.startswith("darwin") else "7f454c46"),
        members=(executable,),
    )


ENGINES: dict[str, EngineSpec] = {
    "codex": EngineSpec(
        id="codex",
        name="Codex",
        version="0.162.0",
        license="Apache-2.0",
        homepage="https://github.com/openai/codex",
        platforms={
            "win32-x64": _codex(
                "win32-x64",
                "x86_64-pc-windows-msvc",
                "sha512-W8kqHaqpW0qPz71E0rRT5dq+socGz1BbJyYN7o3SP1TWQt8Zl6ML74R9Hvt/xn1NNLVlDTRfXqNmaMkte6yEMQ==",
                165_147_932,
            ),
            "darwin-arm64": _codex(
                "darwin-arm64",
                "aarch64-apple-darwin",
                "sha512-hyiGlMCbZog7IY2TcSWzXbsmtUnynT93QA4utqGlVmFlmz8TurADk3LV28zqUIdgh9GLOzumDIdHQbYieo9Nqw==",
                136_616_226,
            ),
            "darwin-x64": _codex(
                "darwin-x64",
                "x86_64-apple-darwin",
                "sha512-4XzCUJgEDDdme6VWDEKvbWDA6f+470d4xhhorYUgNBZwY8Dq5NYqvWkO33rnc1vjxkqSj+SwkymHxRMxL6h1CA==",
                145_619_081,
            ),
            "linux-x64": _codex(
                "linux-x64",
                "x86_64-unknown-linux-musl",
                "sha512-qHWp6oKpf456PqjberGN8avs8zChv2oS+UuDiqVFYAuDOhq6vBc1drh8jEsnR7dBX+zcw03PN5VLtePGlMcC3w==",
                165_503_686,
            ),
            "linux-arm64": _codex(
                "linux-arm64",
                "aarch64-unknown-linux-musl",
                "sha512-6NYWwy09FsZ+/0Dz/bvV/yz3aFhkNzj86fSiux9Ax9VMBOID5nPdwd51OySm7fy8TMRud4fgJFELSi3Enc1s7Q==",
                157_897_651,
            ),
        },
    ),
    "opencode": EngineSpec(
        id="opencode",
        name="OpenCode",
        version="1.18.29",
        license="MIT",
        homepage="https://github.com/anomalyco/opencode",
        platforms={
            "win32-x64": _opencode(
                "win32-x64",
                "opencode-windows-x64.zip",
                "b32618aa3d1415f6e4f473aec248edef25759203fb707d7d968359d86d4a35ee",
                60_655_378,
            ),
            "darwin-arm64": _opencode(
                "darwin-arm64",
                "opencode-darwin-arm64.zip",
                "fe764f7f360c584a83e18dd5f23fb1a6b2725f5ee8854b0252fe558f7798e946",
                46_205_298,
            ),
            "darwin-x64": _opencode(
                "darwin-x64",
                "opencode-darwin-x64.zip",
                "9858853e7bacdbbd22c2d70c377e009dc4b354dd04f5588705411e7afb89fd2d",
                48_403_326,
            ),
            "linux-x64": _opencode(
                "linux-x64",
                "opencode-linux-x64.tar.gz",
                "ea800b7ff56226b70952126c9fc1e2517ca4c4b5682fd9d3f9e87449697a1194",
                60_527_414,
            ),
            "linux-arm64": _opencode(
                "linux-arm64",
                "opencode-linux-arm64.tar.gz",
                "70baf769395ca4e7a68924026530c390eace194f3b7e4919d4efcb2aa2eed3c0",
                60_343_887,
            ),
        },
    ),
}


__all__ = ["ENGINES", "MIRROR_BASE", "EngineArtifact", "EngineSpec", "platform_key"]
