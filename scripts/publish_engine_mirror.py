"""Lay out the engine mirror served at ai.echo-age.com/marketplace/engines.

The desktop store downloads Codex and OpenCode from this mirror first and from
the official source second; both must be the same bytes, so the mirror holds
unmodified upstream archives. This script fetches every pinned archive from
its official source with the store's own checks (allowed hosts, exact size,
pinned digest) and writes::

    <out>/<engine>/<version>/<asset>
    <out>/<engine>/<version>/SHA256SUMS
    <out>/<engine>/<version>/LICENSE, NOTICE …   (the upstream license texts)

Upload the result to the server's ``/var/www/echo/marketplace/engines/``
(the nginx ``/marketplace/`` location), for example::

    uv run python scripts/publish_engine_mirror.py --out <dir>
    rsync -av <dir>/ echo-prod:/var/www/echo/marketplace/engines/

Existing files that already match their pin are kept, so reruns only fetch
what is missing.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from runtime.execution.engine_packages.installer import (  # noqa: E402
    _expected_digest,
    _SourceFailed,
    download,
)
from runtime.execution.engine_packages.lock import ENGINES  # noqa: E402

LICENSES = ROOT / "extras" / "desktop" / "licenses"


def _matches(path: Path, integrity: str, size: int) -> bool:
    if not path.is_file() or path.stat().st_size != size:
        return False
    hasher, expected = _expected_digest(integrity)
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest() == expected


def _license_dir(engine: str, version: str) -> Path | None:
    candidate = LICENSES / f"{engine}-{version}"
    return candidate if candidate.is_dir() else None


def publish(out: Path, engines: list[str], platforms: list[str] | None) -> int:
    failures = 0
    for engine_id in engines:
        spec = ENGINES[engine_id]
        folder = out / spec.id / spec.version
        folder.mkdir(parents=True, exist_ok=True)
        sums: list[str] = []
        for key, artifact in sorted(spec.platforms.items()):
            if platforms and key not in platforms:
                continue
            target = folder / artifact.asset
            if _matches(target, artifact.integrity, artifact.size):
                print(f"[keep] {spec.id} {key} {artifact.asset}")
            else:
                partial = target.with_name(target.name + ".part")
                print(f"[get ] {spec.id} {key} {artifact.upstream}")
                try:
                    download(artifact.upstream, partial, artifact, lambda _received: None)
                except _SourceFailed as exc:
                    print(f"[fail] {spec.id} {key}: {exc}", file=sys.stderr)
                    partial.unlink(missing_ok=True)
                    failures += 1
                    continue
                partial.replace(target)
            digest = hashlib.sha256(target.read_bytes()).hexdigest()
            sums.append(f"{digest}  {artifact.asset}")
        licenses = _license_dir(spec.id, spec.version)
        if licenses is not None:
            for name in ("LICENSE", "NOTICE"):
                if (licenses / name).is_file():
                    shutil.copyfile(licenses / name, folder / name)
        if sums:
            (folder / "SHA256SUMS").write_text("\n".join(sums) + "\n", encoding="utf-8")
    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", required=True, type=Path, help="mirror root to write")
    parser.add_argument(
        "--engine", action="append", choices=sorted(ENGINES), help="only these engines"
    )
    parser.add_argument("--platform", action="append", help="only these platforms, e.g. win32-x64")
    args = parser.parse_args(argv)
    failures = publish(args.out, args.engine or sorted(ENGINES), args.platform)
    if failures:
        print(f"{failures} archive(s) could not be fetched", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
