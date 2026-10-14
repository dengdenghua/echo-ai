"""Install a pinned engine from the store: download, verify, unpack, swap in.

A download tries ai.echo-age.com first and the official source second; a
mirror slower than ``MIRROR_MIN_RATE`` gives way to the official source and is
used at any speed only when that fails. Either way the bytes must be exactly
the pinned archive (size and digest) before any of them is unpacked, so a
mirror can only be slow or missing, never wrong.
Unpacking keeps regular files only, inside the engine directory, and the new
directory replaces the old one with a rename, so a failed or interrupted
install leaves the previous engine working.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import logging
import os
import shutil
import stat
import tarfile
import threading
import time
import uuid
import zipfile
from collections.abc import Callable, Iterator
from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from typing import IO, Any
from urllib.parse import urljoin, urlsplit

from .lock import ENGINES, EngineArtifact, EngineSpec, platform_key
from .store import MANIFEST_NAME, MANIFEST_SCHEMA, engines_root, read_installed

_logger = logging.getLogger(__name__)

# Every hop of a download, redirects included, must stay on these hosts.
ALLOWED_HOSTS = frozenset(
    {
        "ai.echo-age.com",
        "registry.npmjs.org",
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
    }
)
_REDIRECTS = frozenset({301, 302, 303, 307, 308})
_MAX_HOPS = 6
_CHUNK = 1024 * 1024
_MAX_UNPACKED = 1024**3
# The mirror is tried first but runs on a small server link: when it averages
# under this rate after the window, the official source is tried instead, and
# the mirror is used at any speed only when that fails too.
MIRROR_MIN_RATE = 1_000_000
_RATE_WINDOW = 15.0


class EngineInstallError(RuntimeError):
    """An install failure with a code the UI can explain."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(detail or code)
        self.code = code


class _SourceFailed(Exception):
    """This source did not deliver the pinned archive; try the next one."""


class _SourceTooSlow(_SourceFailed):
    """This source works but is slower than ``min_rate``; try a faster one first."""


@dataclass
class InstallJob:
    engine: str
    version: str
    state: str = "downloading"
    """``downloading`` → ``installing`` → ``done``, or ``failed``."""
    received: int = 0
    total: int = 0
    source: str | None = None
    error: str | None = None
    finished_at: float | None = None

    @property
    def running(self) -> bool:
        return self.state in {"downloading", "installing"}

    def snapshot(self) -> dict[str, Any]:
        return asdict(self)


def _expected_digest(integrity: str) -> tuple[Any, str]:
    if integrity.startswith("sha512-"):
        return hashlib.sha512(), base64.b64decode(integrity.removeprefix("sha512-")).hex()
    if integrity.startswith("sha256:"):
        return hashlib.sha256(), integrity.removeprefix("sha256:").lower()
    raise ValueError(f"unsupported integrity: {integrity}")


def _check_hop(url: str) -> None:
    parts = urlsplit(url)
    if (
        parts.scheme != "https"
        or parts.hostname not in ALLOWED_HOSTS
        or parts.username is not None
        or parts.password is not None
    ):
        raise _SourceFailed(f"refusing to download from {parts.scheme}://{parts.hostname}")


def download(
    url: str,
    destination: Path,
    artifact: EngineArtifact,
    progress: Callable[[int], None],
    *,
    client: Any = None,
    min_rate: float | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> None:
    """Stream ``url`` to ``destination``; fail unless it is the pinned archive.

    ``httpx`` honours the system proxy settings, which is how many desktops
    reach GitHub and npm at all. With ``min_rate`` (bytes per second) a
    download that averages less after the first seconds stops early.
    """

    import httpx

    hasher, expected = _expected_digest(artifact.integrity)
    owned = client is None
    if client is None:
        client = httpx.Client(
            timeout=httpx.Timeout(30.0, read=120.0),
            follow_redirects=False,
            headers={"User-Agent": "echo-ai/1.0"},
        )
    try:
        current = url
        for _hop in range(_MAX_HOPS):
            _check_hop(current)
            with client.stream("GET", current) as response:
                if response.status_code in _REDIRECTS:
                    location = response.headers.get("location")
                    if not location:
                        raise _SourceFailed("redirect without a location")
                    current = urljoin(current, location)
                    continue
                if response.status_code != 200:
                    raise _SourceFailed(f"HTTP {response.status_code}")
                received = 0
                started = clock()
                with destination.open("wb") as handle:
                    for chunk in response.iter_bytes(_CHUNK):
                        received += len(chunk)
                        if received > artifact.size:
                            raise _SourceFailed("larger than the pinned archive")
                        elapsed = clock() - started
                        if (
                            min_rate is not None
                            and elapsed >= _RATE_WINDOW
                            and received < min_rate * elapsed
                        ):
                            raise _SourceTooSlow(f"{received / elapsed / 1e6:.2f} MB/s")
                        hasher.update(chunk)
                        handle.write(chunk)
                        progress(received)
            if received != artifact.size:
                raise _SourceFailed(f"incomplete download ({received} of {artifact.size} bytes)")
            if hasher.hexdigest() != expected:
                raise _SourceFailed("archive digest does not match the pinned release")
            return
        raise _SourceFailed("too many redirects")
    except httpx.HTTPError as exc:
        raise _SourceFailed(f"{type(exc).__name__}: {exc}") from exc
    finally:
        if owned:
            client.close()


def _engine_path(artifact: EngineArtifact, name: str) -> str | None:
    """Where an archive member goes inside the engine directory, or None to skip it."""

    name = name.replace("\\", "/")
    while name.startswith("./"):
        name = name[2:]
    prefix = artifact.root.strip("/")
    if prefix:
        if not name.startswith(prefix + "/"):
            return None
        name = name[len(prefix) + 1 :]
    relative = name.strip("/")
    if not relative:
        return None
    path = PurePosixPath(relative)
    if path.is_absolute() or ".." in path.parts or ":" in path.parts[0]:
        raise EngineInstallError("install_failed", f"unsafe archive member: {name}")
    if artifact.members and relative not in artifact.members:
        return None
    if any(relative == skip or relative.startswith(skip + "/") for skip in artifact.exclude):
        return None
    return relative


def _archive_files(
    archive: Path, artifact: EngineArtifact
) -> Iterator[tuple[str, int, int, IO[bytes]]]:
    """Each regular file to install: (engine path, size, mode, readable stream)."""

    if artifact.archive == "zip":
        with zipfile.ZipFile(archive) as bundle:
            for info in bundle.infolist():
                relative = _engine_path(artifact, info.filename)
                if relative is None or info.is_dir():
                    continue
                mode = info.external_attr >> 16
                # Zips made on Windows carry no file type at all.
                if stat.S_IFMT(mode) not in (0, stat.S_IFREG):
                    raise EngineInstallError("install_failed", f"not a regular file: {relative}")
                with bundle.open(info) as stream:
                    yield relative, info.file_size, mode, stream
        return
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle:
            relative = _engine_path(artifact, member.name)
            if relative is None or member.isdir():
                continue
            if not member.isfile():
                raise EngineInstallError("install_failed", f"not a regular file: {relative}")
            stream = bundle.extractfile(member)
            if stream is None:
                raise EngineInstallError("install_failed", f"unreadable member: {relative}")
            with stream:
                yield relative, member.size, member.mode, stream


def unpack(archive: Path, artifact: EngineArtifact, destination: Path) -> dict[str, dict[str, Any]]:
    """Unpack the engine into ``destination``; returns its file inventory."""

    files: dict[str, dict[str, Any]] = {}
    total = 0
    for relative, size, mode, stream in _archive_files(archive, artifact):
        total += size
        if total > _MAX_UNPACKED:
            raise EngineInstallError("install_failed", "archive unpacks too large")
        target = destination.joinpath(*PurePosixPath(relative).parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        written = 0
        with target.open("xb") as handle:
            while chunk := stream.read(_CHUNK):
                written += len(chunk)
                digest.update(chunk)
                handle.write(chunk)
        if os.name != "nt":
            executable = mode & 0o111 or relative == artifact.entrypoint
            target.chmod(0o755 if executable else 0o644)
        files[relative] = {"sha256": digest.hexdigest(), "size": written}
    missing = [name for name in (*artifact.members, artifact.entrypoint) if name not in files]
    if missing:
        raise EngineInstallError("install_failed", f"archive is missing {', '.join(missing)}")
    with (destination / artifact.entrypoint).open("rb") as handle:
        if handle.read(len(artifact.magic) // 2).hex() != artifact.magic:
            raise EngineInstallError("install_failed", "entrypoint is not a native executable")
    return files


def _remove_quietly(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)


def _swap_in(staged: Path, target: Path) -> None:
    """Replace ``target`` with ``staged`` by renames on the same volume."""

    trash = target.parent / ".trash" / f"{target.name}-{uuid.uuid4().hex[:8]}"
    if target.exists():
        trash.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.replace(target, trash)
        except PermissionError as exc:
            # Windows refuses to move a folder whose program is running.
            raise EngineInstallError("busy", str(exc)) from exc
    os.replace(staged, target)
    _remove_quietly(trash)


class EngineInstaller:
    """Runs at most one install per engine, in a background thread."""

    def __init__(self, *, root: Callable[[], Path] = engines_root, fetch=download) -> None:
        self._root = root
        self._fetch = fetch
        self._jobs: dict[str, InstallJob] = {}
        self._lock = threading.Lock()

    def job(self, engine_id: str) -> InstallJob | None:
        with self._lock:
            return self._jobs.get(engine_id)

    def start(self, engine_id: str) -> InstallJob:
        spec = ENGINES.get(engine_id)
        if spec is None:
            raise EngineInstallError("unknown_engine", engine_id)
        artifact = spec.artifact()
        if artifact is None:
            raise EngineInstallError("unsupported_platform", platform_key())
        with self._lock:
            current = self._jobs.get(engine_id)
            if current is not None and current.running:
                return current
            job = InstallJob(engine=engine_id, version=spec.version, total=artifact.size)
            self._jobs[engine_id] = job
        threading.Thread(
            target=self._run,
            args=(job, spec, artifact),
            name=f"engine-install-{engine_id}",
            daemon=True,
        ).start()
        return job

    def install_now(self, engine_id: str) -> InstallJob:
        """Install in the calling thread (tests and the command line)."""

        spec = ENGINES[engine_id]
        artifact = spec.artifact()
        if artifact is None:
            raise EngineInstallError("unsupported_platform", platform_key())
        job = InstallJob(engine=engine_id, version=spec.version, total=artifact.size)
        with self._lock:
            self._jobs[engine_id] = job
        self._run(job, spec, artifact)
        return job

    def _run(self, job: InstallJob, spec: EngineSpec, artifact: EngineArtifact) -> None:
        root = self._root()
        staging = root / ".staging" / f"{spec.id}-{uuid.uuid4().hex[:8]}"
        try:
            for leftover in (root / ".staging", root / ".trash"):
                for stale in leftover.glob(f"{spec.id}-*") if leftover.is_dir() else ():
                    if stale != staging:
                        _remove_quietly(stale)
            staging.mkdir(parents=True)
            if shutil.disk_usage(staging).free < artifact.size * 4:
                raise EngineInstallError("disk_full")
            archive = staging / artifact.asset
            source_url = self._download(job, spec, artifact, archive)
            job.state = "installing"
            content = staging / "engine"
            content.mkdir()
            files = unpack(archive, artifact, content)
            manifest = {
                "schema": MANIFEST_SCHEMA,
                "engine": spec.id,
                "version": spec.version,
                "platform": platform_key(),
                "asset": artifact.asset,
                "integrity": artifact.integrity,
                "source": job.source,
                "source_url": source_url,
                "installed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "entrypoint": artifact.entrypoint,
                "files": files,
            }
            (content / MANIFEST_NAME).write_text(
                json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
            archive.unlink()
            _swap_in(content, root / spec.id)
            job.state = "done"
        except EngineInstallError as exc:
            _logger.warning("engine %s install failed: %s", spec.id, exc)
            job.state, job.error = "failed", exc.code
        except Exception:  # noqa: BLE001 — a background install must always end in a state
            _logger.exception("engine %s install failed", spec.id)
            job.state, job.error = "failed", "install_failed"
        finally:
            job.finished_at = time.time()
            _remove_quietly(staging)

    def _download(
        self, job: InstallJob, spec: EngineSpec, artifact: EngineArtifact, archive: Path
    ) -> str:
        mirror = spec.mirror_url(artifact)
        attempts: list[tuple[str, str, float | None]] = [
            ("mirror", mirror, MIRROR_MIN_RATE),
            ("upstream", artifact.upstream, None),
        ]
        for index, (source, url, min_rate) in enumerate(attempts):
            job.source, job.received = source, 0

            def progress(received: int) -> None:
                job.received = received

            try:
                self._fetch(url, archive, artifact, progress, min_rate=min_rate)
                return url
            except _SourceTooSlow as exc:
                _logger.info("engine %s: %s source too slow (%s)", spec.id, source, exc)
                # A slow mirror still beats no download: last resort, any speed.
                if index == 0:
                    attempts.append(("mirror", mirror, None))
            except _SourceFailed as exc:
                _logger.info("engine %s: %s source failed: %s", spec.id, source, exc)
            with contextlib.suppress(OSError):
                archive.unlink()
        raise EngineInstallError("download_failed")

    def uninstall(self, engine_id: str) -> bool:
        """Remove a store-installed engine; False when there was none."""

        if engine_id not in ENGINES:
            raise EngineInstallError("unknown_engine", engine_id)
        current = self.job(engine_id)
        if current is not None and current.running:
            raise EngineInstallError("busy", "an install is running")
        root = self._root()
        target = root / engine_id
        if read_installed(engine_id, root) is None and not target.exists():
            return False
        trash = root / ".trash" / f"{engine_id}-{uuid.uuid4().hex[:8]}"
        trash.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.replace(target, trash)
        except PermissionError as exc:
            raise EngineInstallError("busy", str(exc)) from exc
        _remove_quietly(trash)
        with self._lock:
            self._jobs.pop(engine_id, None)
        return True


_installer: EngineInstaller | None = None
_installer_lock = threading.Lock()


def engine_installer() -> EngineInstaller:
    global _installer
    with _installer_lock:
        if _installer is None:
            _installer = EngineInstaller()
        return _installer


__all__ = [
    "ALLOWED_HOSTS",
    "EngineInstallError",
    "EngineInstaller",
    "InstallJob",
    "download",
    "engine_installer",
    "unpack",
]
