from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "raw_fetch_check",
    Path(__file__).resolve().parents[1] / "tools/lint/raw_fetch_check.py",
)
check = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(check)


@pytest.fixture
def src(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "frontend/src"
    (root / "core/api").mkdir(parents=True)
    monkeypatch.setattr(check, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check, "ROOT", root)
    monkeypatch.setattr(check, "BASELINE", tmp_path / "baseline.txt")
    return root


def test_counts_raw_fetch_outside_core_api_and_tests(src: Path) -> None:
    (src / "panel.tsx").write_text(
        "const a = await fetch(`${base}/api/x`);\n"
        "const b = await window.fetch(url, { method: 'POST' });\n"
        "const c = await globalThis.fetch (url);\n"
        "void refetch();\n"
        "await untypedApi.fetch('get', '/api/y', { reason: 'r' });\n"
        "const prefetch = (x: string) => x;\n",
        encoding="utf-8",
    )
    (src / "panel.test.tsx").write_text("await fetch(url);\n", encoding="utf-8")
    (src / "core/api/client.ts").write_text("await fetch(url);\n", encoding="utf-8")
    (src / "core/api/openapi-types.ts").write_text("fetch(\n", encoding="utf-8")

    assert check.scan() == {"frontend/src/panel.tsx": 3}


def test_strict_blocks_new_calls_and_locks_in_migrations(src: Path) -> None:
    panel = src / "panel.tsx"
    panel.write_text("const r = await fetch(url);\n", encoding="utf-8")
    check.main(["--write-baseline"])
    assert check.main(["--strict"]) == 0

    panel.write_text(
        "const r = await fetch(url);\nconst s = await fetch(other);\n", encoding="utf-8"
    )
    assert check.main(["--strict"]) == 1  # grew

    (src / "fresh.ts").write_text("await fetch(url);\n", encoding="utf-8")
    panel.write_text("const r = await fetch(url);\n", encoding="utf-8")
    assert check.main(["--strict"]) == 1  # a new file may not add raw calls
    (src / "fresh.ts").unlink()

    panel.write_text('const r = await apiGet("/api/x");\n', encoding="utf-8")
    assert check.main(["--strict"]) == 1  # migrated but baseline not lowered
    check.main(["--write-baseline"])
    assert check.main(["--strict"]) == 0
