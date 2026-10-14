from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "function_length_check",
    Path(__file__).resolve().parents[1] / "tools/lint/function_length_check.py",
)
check = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(check)


def _body(lines: int) -> str:
    return "".join("    x = 1\n" for _ in range(lines))


@pytest.fixture
def tree(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "runtime"
    root.mkdir()
    monkeypatch.setattr(check, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(check, "ROOT", root)
    monkeypatch.setattr(check, "BASELINE", tmp_path / "baseline.txt")
    monkeypatch.setattr(check, "THRESHOLD", 5)
    return root


def test_names_nested_functions_methods_and_repeats(tree: Path) -> None:
    (tree / "mod.py").write_text(
        "def outer():\n"
        "    def inner():\n" + _body(5).replace("    ", "        ") + "    return inner\n"
        "class Box:\n"
        "    def method(self):\n" + _body(5).replace("    ", "        ") + "def twice():\n"
        "    pass\n"
        "def twice():\n" + _body(5),
        encoding="utf-8",
    )

    found = check.scan()

    assert set(found) == {
        "runtime/mod.py::outer",
        "runtime/mod.py::outer.inner",
        "runtime/mod.py::Box.method",
        "runtime/mod.py::twice#2",
    }


def test_strict_fails_on_new_and_grown_functions_and_stale_entries(tree: Path) -> None:
    target = tree / "mod.py"
    target.write_text("def a():\n" + _body(5), encoding="utf-8")
    check.main(["--write-baseline"])
    assert check.main(["--strict"]) == 0

    target.write_text("def a():\n" + _body(8) + "def b():\n" + _body(6), encoding="utf-8")
    assert check.main(["--strict"]) == 1  # a grew, b is new

    target.write_text("def a():\n    pass\n", encoding="utf-8")
    assert check.main(["--strict"]) == 1  # a shrank below the threshold: stale entry
    check.main(["--write-baseline"])
    assert check.main(["--strict"]) == 0
