from __future__ import annotations

import json
import tomllib
from pathlib import Path

import runtime


def test_runtime_version_matches_project_metadata():
    root = Path(__file__).resolve().parents[1]
    pyproject = root / "pyproject.toml"
    metadata = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    version = metadata["project"]["version"]
    frontend = json.loads((root / "frontend" / "package.json").read_text(encoding="utf-8"))

    assert runtime.__version__ == version
    assert frontend["version"] == version
    assert f"> v{version} ·" in (root / "README.md").read_text(encoding="utf-8")
    assert f"Beta v{version}" in (root / "QUICKSTART.md").read_text(encoding="utf-8")
