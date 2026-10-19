"""Snapshot an explicitly selected private lens library into Echo local state."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
from contextlib import closing
from pathlib import Path


def snapshot_library(source: Path, destination: Path) -> dict:
    source = source.resolve(strict=True)
    destination = destination.resolve()
    # Never merge snapshots or operate on the original directory.
    if destination == source or destination.is_relative_to(source):
        raise ValueError("Destination must be outside the source library")
    destination.mkdir(parents=True, exist_ok=False)
    database = source / "lens_library.sqlite"
    target = destination / database.name
    with (
        closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as reader,
        closing(sqlite3.connect(target)) as writer,
    ):
        reader.backup(writer)
        counts = {
            table: writer.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
            for table in ("knowledge", "cases", "surfaces", "catalog_cases")
        }
        if writer.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise RuntimeError("Snapshot integrity check failed")
    for relative in ("library_manifest.json", "knowledge"):
        item = source / relative
        if item.is_dir():
            shutil.copytree(item, destination / relative)
        elif item.is_file():
            shutil.copy2(item, destination / relative)
    with target.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    report = {
        "source_library": str(source),
        "snapshot": str(destination),
        "sha256": digest,
        "counts": counts,
        "source_assets": "Original model and document paths remain unchanged; not copied",
        "evidence": "Index/conditional knowledge; no new native reruns or measurements",
        "workbench_memory": "Not included; requires a separately configured Optics Workbench",
    }
    (destination / "echo-migration.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-library", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.apply:
        parser.error("Pass --apply to snapshot the selected private library")
    report = snapshot_library(args.source_library, args.destination)
    config = Path.home() / ".echo/lens-toolkit.local.json"
    config.parent.mkdir(parents=True, exist_ok=True)
    if config.exists():
        shutil.copy2(config, args.destination / "previous-echo-library-config.json")
    config.write_text(json.dumps({"library_root": report["snapshot"]}, indent=2) + "\n", "utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
