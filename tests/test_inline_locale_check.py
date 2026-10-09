from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "inline_locale_check",
    Path(__file__).resolve().parents[1] / "tools/lint/inline_locale_check.py",
)
check = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(check)


@pytest.fixture
def src(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "frontend/src"
    (root / "core/i18n/locales").mkdir(parents=True)
    monkeypatch.setattr(check, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check, "ROOT", root)
    monkeypatch.setattr(check, "BASELINE", tmp_path / "baseline.txt")
    return root


def test_counts_branches_outside_locales_and_tests(src: Path) -> None:
    (src / "panel.tsx").write_text(
        'const zh = locale.startsWith("zh");\n'
        'const a = zh ? "中" : "en";\n'
        'if (lang === "zh-CN") {}\n',
        encoding="utf-8",
    )
    (src / "panel.test.tsx").write_text('const x = zh ? "a" : "b";\n', encoding="utf-8")
    (src / "core/i18n/locales/x.ts").write_text('startsWith("zh")\n', encoding="utf-8")

    assert check.scan() == {"frontend/src/panel.tsx": 3}


def test_strict_blocks_new_branches_and_locks_in_cleanups(src: Path) -> None:
    panel = src / "panel.tsx"
    panel.write_text('const a = zh ? "中" : "en";\n', encoding="utf-8")
    check.main(["--write-baseline"])
    assert check.main(["--strict"]) == 0

    panel.write_text(
        'const a = zh ? "中" : "en";\nconst b = zh ? "二" : "two";\n', encoding="utf-8"
    )
    assert check.main(["--strict"]) == 1  # grew

    panel.write_text("const a = copy.title;\n", encoding="utf-8")
    assert check.main(["--strict"]) == 1  # cleaned up but baseline not lowered
    check.main(["--write-baseline"])
    assert check.main(["--strict"]) == 0
