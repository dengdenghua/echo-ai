from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "sqlite_schema_check",
    Path(__file__).resolve().parents[1] / "tools/lint/sqlite_schema_check.py",
)
check = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(check)


@pytest.fixture
def runtime(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "runtime"
    (root / "platform/io").mkdir(parents=True)
    monkeypatch.setattr(check, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check, "ROOT", root)
    monkeypatch.setattr(check, "BASELINE", tmp_path / "baseline.txt")
    return root


def test_counts_schema_scripts_and_column_probes_outside_the_helper(runtime: Path) -> None:
    (runtime / "store.py").write_text(
        'conn.executescript(_SCHEMA)\ncols = conn.execute("PRAGMA table_info(items)")\n',
        encoding="utf-8",
    )
    (runtime / "platform/io/sqlite_schema.py").write_text(
        'conn.execute(f"PRAGMA table_info({t})")\n', encoding="utf-8"
    )

    assert check.scan() == {"runtime/store.py": 2}


def test_strict_blocks_new_calls_and_locks_in_migrations(runtime: Path) -> None:
    store = runtime / "store.py"
    store.write_text("conn.executescript(_SCHEMA)\n", encoding="utf-8")
    check.main(["--write-baseline"])
    assert check.main(["--strict"]) == 0

    (runtime / "new_store.py").write_text("conn.executescript(S)\n", encoding="utf-8")
    assert check.main(["--strict"]) == 1  # a new store skipped migrate()
    (runtime / "new_store.py").unlink()

    store.write_text('migrate(conn, _MIGRATIONS, name="items")\n', encoding="utf-8")
    assert check.main(["--strict"]) == 1  # migrated but baseline not lowered
    check.main(["--write-baseline"])
    assert check.main(["--strict"]) == 0
