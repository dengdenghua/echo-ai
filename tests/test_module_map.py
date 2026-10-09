"""Keep docs/architecture/module-map.md in step with the runtime tree."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP = (ROOT / "docs/architecture/module-map.md").read_text(encoding="utf-8")


def test_every_top_level_runtime_package_is_mapped() -> None:
    packages = sorted(d.name for d in (ROOT / "runtime").iterdir() if (d / "__init__.py").is_file())
    unmapped = [name for name in packages if f"runtime/{name}/" not in MAP]
    assert unmapped == [], f"add these packages to module-map.md: {unmapped}"


def test_every_cited_path_exists() -> None:
    cited = set(re.findall(r"`((?:runtime|frontend|tools|tests|docs)/[\w./\-\[\]]+)`", MAP))
    missing = sorted(path for path in cited if not (ROOT / path.rstrip("/")).exists())
    assert missing == [], f"module-map.md cites paths that no longer exist: {missing}"
