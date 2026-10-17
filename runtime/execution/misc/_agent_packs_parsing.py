"""File readers (JSON / JSONC / YAML / markdown frontmatter) used by the agent-pack scanner."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore[import-untyped]
except ImportError:  # pragma: no cover
    yaml = None  # type: ignore[assignment]

_FRONTMATTER_RE = re.compile(r"\A\s*---\s*\n(.*?)\n---\s*(?:\n|$)", re.DOTALL)


def _read_json(path: Path, warnings: list[str]) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        warnings.append(f"{path}: JSON parse failed: {exc}")
        return None
    if not isinstance(data, dict):
        warnings.append(f"{path}: expected JSON object")
        return None
    return data


def _read_jsonc(path: Path, warnings: list[str]) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8")
        data = json.loads(_remove_jsonc_trailing_commas(_strip_jsonc_comments(text)))
    except (OSError, json.JSONDecodeError) as exc:
        warnings.append(f"{path}: JSONC parse failed: {exc}")
        return None
    if not isinstance(data, dict):
        warnings.append(f"{path}: expected JSONC object")
        return None
    return data


def _strip_jsonc_comments(text: str) -> str:
    result: list[str] = []
    i = 0
    in_string = False
    quote = ""
    escaped = False
    while i < len(text):
        char = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if in_string:
            result.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                in_string = False
            i += 1
            continue
        if char in {'"', "'"}:
            in_string = True
            quote = char
            result.append(char)
            i += 1
            continue
        if char == "/" and nxt == "/":
            while i < len(text) and text[i] not in "\r\n":
                i += 1
            continue
        if char == "/" and nxt == "*":
            i += 2
            while i + 1 < len(text) and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        result.append(char)
        i += 1
    return "".join(result)


def _remove_jsonc_trailing_commas(text: str) -> str:
    result: list[str] = []
    i = 0
    in_string = False
    quote = ""
    escaped = False
    while i < len(text):
        char = text[i]
        if in_string:
            result.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                in_string = False
            i += 1
            continue
        if char in {'"', "'"}:
            in_string = True
            quote = char
            result.append(char)
            i += 1
            continue
        if char == ",":
            j = i + 1
            while j < len(text) and text[j].isspace():
                j += 1
            if j < len(text) and text[j] in "]}":
                i += 1
                continue
        result.append(char)
        i += 1
    return "".join(result)


def _read_yaml(path: Path, warnings: list[str]) -> dict[str, Any] | None:
    if yaml is None:
        warnings.append("PyYAML unavailable; YAML managed-agent manifests were skipped")
        return None
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:  # type: ignore[attr-defined]
        warnings.append(f"{path}: YAML parse failed: {exc}")
        return None
    if not isinstance(data, dict):
        warnings.append(f"{path}: expected YAML mapping")
        return None
    return data


def _read_text(path: Path, warnings: list[str]) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        warnings.append(f"{path}: read failed: {exc}")
        return ""


def _parse_frontmatter(
    text: str,
    path: Path,
    warnings: list[str],
) -> dict[str, Any]:
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return {}
    if yaml is None:
        warnings.append("PyYAML unavailable; markdown frontmatter was skipped")
        return {}
    try:
        data = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:  # type: ignore[attr-defined]
        warnings.append(f"{path}: frontmatter parse failed: {exc}")
        return {}
    return data if isinstance(data, dict) else {}


def _coerce_tool_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return []


def _first_heading_or_line(text: str) -> str:
    for line in text.splitlines():
        clean = line.strip()
        if not clean or clean == "---":
            continue
        if clean.startswith("#"):
            return clean.lstrip("#").strip()
        if not clean.startswith(("name:", "description:", "tools:")):
            return clean[:180]
    return ""


def _count_assets(directory: Path) -> int:
    return sum(1 for path in directory.rglob("*") if path.is_file() and path.name != "SKILL.md")


def _read_readme_summary(directory: Path, warnings: list[str]) -> str:
    readme = directory / "README.md"
    if not readme.is_file():
        return ""
    text = _read_text(readme, warnings)
    for line in text.splitlines():
        clean = line.strip()
        if clean and not clean.startswith("#"):
            return clean[:240]
    return ""


def _strip_frontmatter(text: str) -> str:
    return _FRONTMATTER_RE.sub("", text, count=1)
