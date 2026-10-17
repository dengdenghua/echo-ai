"""
LSP (Language Server Protocol) integration skills.

Wraps one external LSP server per language and exposes 4 navigation skills:

    * ``lsp_definition``       — textDocument/definition
    * ``lsp_references``       — textDocument/references
    * ``lsp_hover``            — textDocument/hover
    * ``lsp_document_symbols`` — textDocument/documentSymbol

This speaks the standard JSON-RPC over stdio dialect that any
off-the-shelf language server can plug into. Out of scope
(intentionally): project-wide indexing, multi-root workspaces,
cross-language unification, refactor / format / code-actions.

Servers tried per language (first executable on PATH wins):

    python      pyright-langserver --stdio   (preferred)
                python -m pylsp              (fallback)
    typescript  typescript-language-server --stdio
    javascript  typescript-language-server --stdio
    rust        rust-analyzer
    go          gopls

If none of the candidates is on PATH at first call, the skill returns
``error_type="dependency_missing"`` with a hint about what to install.

LSP positions are 0-indexed; the public skills accept and emit 1-indexed
``line``/``column`` to match human / editor conventions, translating at
the boundary.
"""

from __future__ import annotations

import contextlib
import importlib.util
import logging
import os
import shutil
import sys
import threading
from pathlib import Path
from typing import Any

from ._lsp_candidates import MAX_CANDIDATE_FILES
from ._lsp_candidates import candidate_files as _candidate_files
from ._lsp_candidates import identifier_at as _identifier_at
from ._lsp_client import (
    _DependencyMissing,
    _LSPClient,
    _LSPError,
    _LSPRequestError,
    _LSPTimeoutError,
    _LSPTransportError,
    _path_to_uri,
    _uri_to_path,
)
from .registry import Skill, SkillRegistry

_log = logging.getLogger(__name__)

# ───────────────────────────── language detection ───────────────────────────


_EXT_TO_LANGUAGE: dict[str, str] = {
    ".py": "python",
    ".pyi": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".rs": "rust",
    ".go": "go",
}


def _detect_language(path: str) -> str | None:
    """Map a file extension to a known LSP language. None if unsupported."""
    ext = Path(path).suffix.lower()
    return _EXT_TO_LANGUAGE.get(ext)


# Candidate server argv per language. First whose ``argv[0]`` resolves on
# PATH wins. Each list entry is the raw argv to spawn — we don't shell out.
_SERVER_CANDIDATES: dict[str, list[list[str]]] = {
    "python": [
        ["pyright-langserver", "--stdio"],
        [sys.executable, "-m", "pylsp"],
    ],
    "typescript": [
        ["typescript-language-server", "--stdio"],
    ],
    "javascript": [
        ["typescript-language-server", "--stdio"],
    ],
    "rust": [
        ["rust-analyzer"],
    ],
    "go": [
        ["gopls"],
    ],
}

_INSTALL_HINTS: dict[str, str] = {
    "python": "Install pyright via 'pip install pyright' or 'npm i -g pyright', or 'pip install python-lsp-server'",
    "typescript": "Install via 'npm i -g typescript-language-server typescript'",
    "javascript": "Install via 'npm i -g typescript-language-server typescript'",
    "rust": "Install via 'rustup component add rust-analyzer'",
    "go": "Install via 'go install golang.org/x/tools/gopls@latest'",
}

# ───────────────────────────── symbol-kind lookup ───────────────────────────

# https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#symbolKind
_SYMBOL_KIND: dict[int, str] = {
    1: "File",
    2: "Module",
    3: "Namespace",
    4: "Package",
    5: "Class",
    6: "Method",
    7: "Property",
    8: "Field",
    9: "Constructor",
    10: "Enum",
    11: "Interface",
    12: "Function",
    13: "Variable",
    14: "Constant",
    15: "String",
    16: "Number",
    17: "Boolean",
    18: "Array",
    19: "Object",
    20: "Key",
    21: "Null",
    22: "EnumMember",
    23: "Struct",
    24: "Event",
    25: "Operator",
    26: "TypeParameter",
}


def _symbol_kind_name(kind: int) -> str:
    return _SYMBOL_KIND.get(int(kind), f"Kind({kind})")


# ───────────────────────────── client cache ─────────────────────────────────


_LSP_CLIENTS: dict[tuple[str, str], _LSPClient] = {}
_LSP_CLIENTS_LOCK = threading.Lock()


def _local_bin_dirs() -> list[str]:
    """Interpreter-adjacent script dirs, searched before PATH.

    A server pinned next to the interpreter running us is the one matching
    this project's dependencies. It is also, on this repo, not on PATH at
    all unless the venv was activated -- so PATH-only lookup made every
    Python LSP skill silently unavailable.
    """
    return [str(Path(sys.executable).parent)]


def _resolve_executable(exe: str) -> str | None:
    for directory in _local_bin_dirs():
        candidate = Path(directory) / exe
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return shutil.which(exe)


def _module_importable(module: str) -> bool:
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def _resolve_server_argv(language: str) -> list[str] | None:
    """First candidate that is actually runnable, in preference order.

    ``sys.executable`` used to count as always-usable, so a ``-m pylsp``
    candidate was selected whether or not pylsp was installed -- and being
    selected, it shadowed the pyright candidate behind it. The result was a
    server that spawned, died on ``No module named pylsp``, and reported the
    installed alternative as missing. Check the module, not the interpreter.
    """
    for candidate in _SERVER_CANDIDATES.get(language, []):
        exe = candidate[0]
        if exe == sys.executable:
            if (
                len(candidate) >= 3
                and candidate[1] == "-m"
                and not _module_importable(candidate[2])
            ):
                continue
            return list(candidate)
        resolved = _resolve_executable(exe)
        if resolved:
            return [resolved, *candidate[1:]]
    return None


def _get_or_start_client(
    language: str,
    workspace_root: str,
) -> _LSPClient:
    key = (language, str(Path(workspace_root).resolve()))
    with _LSP_CLIENTS_LOCK:
        existing = _LSP_CLIENTS.get(key)
        if existing is not None and existing.is_alive():
            return existing
        if existing is not None:
            # Stale; drop it.
            _LSP_CLIENTS.pop(key, None)

        argv = _resolve_server_argv(language)
        if argv is None:
            raise _DependencyMissing(
                _INSTALL_HINTS.get(language, f"no language server configured for {language}")
            )

        client = _LSPClient(language)
        client.start(argv, workspace_root)
        _LSP_CLIENTS[key] = client
        return client


def _reset_clients_for_test() -> None:
    """Test hook · drop every cached client (used by tests)."""
    with _LSP_CLIENTS_LOCK:
        clients = list(_LSP_CLIENTS.values())
        _LSP_CLIENTS.clear()
    for c in clients:
        with contextlib.suppress(_LSPError):
            c.shutdown()


# ───────────────────────────── shared validation ────────────────────────────


def _validate_path_and_language(
    path: str,
    sandbox_dir: str | None,
) -> tuple[Path | None, str | None, dict[str, Any] | None]:
    """Return (resolved_path, language, error_dict).

    ``error_dict`` is None on success; otherwise the caller returns it
    directly to the model.
    """
    from runtime.execution.suckers.write_skills import _ensure_sandbox

    if not path:
        return (
            None,
            None,
            {
                "ok": False,
                "error": "missing path",
                "error_type": "invalid_argument",
            },
        )

    resolved, err = _ensure_sandbox(path, sandbox_dir)
    if err:
        return (
            None,
            None,
            {
                "ok": False,
                "error": err,
                "error_type": "permission_denied",
            },
        )
    if not resolved.exists():
        return (
            None,
            None,
            {
                "ok": False,
                "error": f"not found: {resolved}",
                "error_type": "invalid_argument",
            },
        )

    language = _detect_language(str(resolved))
    if language is None:
        return (
            None,
            None,
            {
                "ok": False,
                "error": f"unsupported file type: {resolved.suffix}",
                "error_type": "unsupported",
            },
        )
    return resolved, language, None


def _validate_position(line: int, column: int) -> dict[str, Any] | None:
    try:
        line_i = int(line)
        col_i = int(column)
    except (TypeError, ValueError):
        return {
            "ok": False,
            "error": "line/column must be integers",
            "error_type": "invalid_argument",
        }
    if line_i < 1 or col_i < 1:
        return {
            "ok": False,
            "error": "line and column are 1-indexed; both must be >= 1",
            "error_type": "invalid_argument",
        }
    return None


def _workspace_root_for(resolved: Path, sandbox_dir: str | None) -> str:
    if sandbox_dir:
        try:
            return str(Path(sandbox_dir).resolve())
        except OSError:  # noqa: BLE001 — sandbox dir resolve is best-effort
            pass
    # Best-effort: walk up looking for a project marker, else use parent dir.
    markers = ("pyproject.toml", "package.json", "Cargo.toml", "go.mod", ".git")
    cur = resolved.parent
    for ancestor in [cur, *cur.parents]:
        for m in markers:
            if (ancestor / m).exists():
                return str(ancestor)
    return str(resolved.parent)


# ───────────────────────────── skill bodies ─────────────────────────────────


def _normalize_location(loc: dict[str, Any]) -> dict[str, Any]:
    """LSP Location → {path, line, column, uri} with 1-indexed coords."""
    uri = loc.get("uri") or loc.get("targetUri") or ""
    rng = loc.get("range") or loc.get("targetSelectionRange") or loc.get("targetRange") or {}
    start = rng.get("start") or {}
    line0 = int(start.get("line") or 0)
    char0 = int(start.get("character") or 0)
    return {
        "path": _uri_to_path(uri) if uri else "",
        "line": line0 + 1,
        "column": char0 + 1,
        "uri": uri,
    }


def _normalize_locations(result: Any) -> list[dict[str, Any]]:
    if result is None:
        return []
    if isinstance(result, dict):  # single Location | LocationLink
        return [_normalize_location(result)]
    if isinstance(result, list):
        return [_normalize_location(x) for x in result if isinstance(x, dict)]
    return []


def _lsp_definition(
    path: str = "",
    line: int = 0,
    column: int = 0,
    *,
    sandbox_dir: str | None = None,
    **_kw: Any,
) -> dict[str, Any]:
    err = _validate_position(line, column)
    if err:
        return err
    resolved, language, err = _validate_path_and_language(path, sandbox_dir)
    if err:
        return err
    assert resolved is not None and language is not None  # for mypy

    workspace = _workspace_root_for(resolved, sandbox_dir)
    try:
        client = _get_or_start_client(language, workspace)
        client.ensure_open(str(resolved))
        result = client.request(
            "textDocument/definition",
            {
                "textDocument": {"uri": _path_to_uri(str(resolved))},
                "position": {"line": int(line) - 1, "character": int(column) - 1},
            },
        )
    except _DependencyMissing as exc:
        return {
            "ok": False,
            "error": f"no LSP server installed for {language}",
            "error_type": "dependency_missing",
            "hint": str(exc),
        }
    except _LSPTimeoutError as exc:
        return {"ok": False, "error": str(exc), "error_type": "timeout"}
    except _LSPError as exc:
        return {"ok": False, "error": str(exc), "error_type": "transport"}

    return {
        "ok": True,
        "definitions": _normalize_locations(result),
    }


def _lsp_references(
    path: str = "",
    line: int = 0,
    column: int = 0,
    include_declaration: bool = True,
    *,
    sandbox_dir: str | None = None,
    **_kw: Any,
) -> dict[str, Any]:
    err = _validate_position(line, column)
    if err:
        return err
    resolved, language, err = _validate_path_and_language(path, sandbox_dir)
    if err:
        return err
    assert resolved is not None and language is not None

    workspace = _workspace_root_for(resolved, sandbox_dir)
    seeded = 0
    truncated = False
    try:
        client = _get_or_start_client(language, workspace)
        client.ensure_open(str(resolved))
        seeded, truncated = _seed_reference_candidates(
            client, resolved, Path(workspace), int(line), int(column)
        )
        result = client.request(
            "textDocument/references",
            {
                "textDocument": {"uri": _path_to_uri(str(resolved))},
                "position": {"line": int(line) - 1, "character": int(column) - 1},
                "context": {"includeDeclaration": bool(include_declaration)},
            },
        )
    except _DependencyMissing as exc:
        return {
            "ok": False,
            "error": f"no LSP server installed for {language}",
            "error_type": "dependency_missing",
            "hint": str(exc),
        }
    except _LSPTimeoutError as exc:
        return {"ok": False, "error": str(exc), "error_type": "timeout"}
    except _LSPError as exc:
        return {"ok": False, "error": str(exc), "error_type": "transport"}

    refs = _normalize_locations(result)
    payload: dict[str, Any] = {
        "ok": True,
        "count": len(refs),
        "references": refs,
    }
    if seeded:
        payload["searched_files"] = seeded
    if truncated:
        payload["incomplete"] = (
            f"candidate set capped at {MAX_CANDIDATE_FILES} files — results may be incomplete"
        )
    return payload


def _seed_reference_candidates(
    client: _LSPClient,
    target: Path,
    workspace: Path,
    line: int,
    column: int,
) -> tuple[int, bool]:
    """Open every file that mentions the symbol before asking for references.

    Servers that answer only from open documents otherwise report zero
    references for a symbol used across the whole project, and report it as a
    success. See ``_lsp_candidates`` for why the name is used as a filter
    rather than as the answer.
    """
    name = _identifier_at(target, line, column)
    if not name:
        return 0, False
    # TypeScript and JavaScript are one server but two language keys, so a
    # .ts definition must still seed .js callers.
    languages = (
        {"typescript", "javascript"}
        if client.language in ("typescript", "javascript")
        else {client.language}
    )
    extensions = frozenset(ext for ext, lang in _EXT_TO_LANGUAGE.items() if lang in languages)
    if not extensions:
        return 0, False
    files, truncated = _candidate_files(name, workspace, extensions)
    opened = 0
    for path in files:
        if path == target:
            continue
        try:
            client.ensure_open(str(path))
            opened += 1
        except _LSPError:
            # One unreadable candidate must not sink the whole query.
            continue
    return opened, truncated


def _extract_hover_contents(contents: Any) -> str:
    """LSP hover returns one of: MarkupContent | MarkedString | MarkedString[]."""
    if contents is None:
        return ""
    if isinstance(contents, str):
        return contents
    if isinstance(contents, dict):
        # MarkupContent: {kind, value} OR MarkedString: {language, value}
        if "value" in contents:
            return str(contents.get("value") or "")
        return ""
    if isinstance(contents, list):
        parts: list[str] = []
        for item in contents:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and "value" in item:
                parts.append(str(item.get("value") or ""))
        return "\n\n".join(p for p in parts if p)
    return ""


def _lsp_hover(
    path: str = "",
    line: int = 0,
    column: int = 0,
    *,
    sandbox_dir: str | None = None,
    **_kw: Any,
) -> dict[str, Any]:
    err = _validate_position(line, column)
    if err:
        return err
    resolved, language, err = _validate_path_and_language(path, sandbox_dir)
    if err:
        return err
    assert resolved is not None and language is not None

    workspace = _workspace_root_for(resolved, sandbox_dir)
    try:
        client = _get_or_start_client(language, workspace)
        client.ensure_open(str(resolved))
        result = client.request(
            "textDocument/hover",
            {
                "textDocument": {"uri": _path_to_uri(str(resolved))},
                "position": {"line": int(line) - 1, "character": int(column) - 1},
            },
        )
    except _DependencyMissing as exc:
        return {
            "ok": False,
            "error": f"no LSP server installed for {language}",
            "error_type": "dependency_missing",
            "hint": str(exc),
        }
    except _LSPTimeoutError as exc:
        return {"ok": False, "error": str(exc), "error_type": "timeout"}
    except _LSPError as exc:
        return {"ok": False, "error": str(exc), "error_type": "transport"}

    contents = (result or {}).get("contents") if isinstance(result, dict) else None
    return {
        "ok": True,
        "contents": _extract_hover_contents(contents),
    }


def _flatten_document_symbols(items: list[Any], container: str = "") -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in items or []:
        if not isinstance(raw, dict):
            continue
        # Hierarchical DocumentSymbol has 'children'/'range'/'selectionRange';
        # Flat SymbolInformation has 'location'/'containerName'.
        if "location" in raw:
            loc = raw.get("location") or {}
            rng = loc.get("range") or {}
            start = rng.get("start") or {}
            out.append(
                {
                    "name": raw.get("name") or "",
                    "kind": _symbol_kind_name(raw.get("kind") or 0),
                    "line": int(start.get("line") or 0) + 1,
                    "column": int(start.get("character") or 0) + 1,
                    "container": raw.get("containerName") or container or None,
                }
            )
            continue
        rng = raw.get("selectionRange") or raw.get("range") or {}
        start = rng.get("start") or {}
        name = raw.get("name") or ""
        entry = {
            "name": name,
            "kind": _symbol_kind_name(raw.get("kind") or 0),
            "line": int(start.get("line") or 0) + 1,
            "column": int(start.get("character") or 0) + 1,
            "container": container or None,
        }
        out.append(entry)
        children = raw.get("children")
        if isinstance(children, list) and children:
            out.extend(_flatten_document_symbols(children, container=name))
    return out


def _lsp_document_symbols(
    path: str = "",
    *,
    sandbox_dir: str | None = None,
    **_kw: Any,
) -> dict[str, Any]:
    resolved, language, err = _validate_path_and_language(path, sandbox_dir)
    if err:
        return err
    assert resolved is not None and language is not None

    workspace = _workspace_root_for(resolved, sandbox_dir)
    try:
        client = _get_or_start_client(language, workspace)
        client.ensure_open(str(resolved))
        result = client.request(
            "textDocument/documentSymbol",
            {"textDocument": {"uri": _path_to_uri(str(resolved))}},
        )
    except _DependencyMissing as exc:
        return {
            "ok": False,
            "error": f"no LSP server installed for {language}",
            "error_type": "dependency_missing",
            "hint": str(exc),
        }
    except _LSPTimeoutError as exc:
        return {"ok": False, "error": str(exc), "error_type": "timeout"}
    except _LSPError as exc:
        return {"ok": False, "error": str(exc), "error_type": "transport"}

    items: list[Any]
    items = result if isinstance(result, list) else []
    return {
        "ok": True,
        "symbols": _flatten_document_symbols(items),
    }


# ───────────────────────────── registration ─────────────────────────────────


def register_lsp_skills(registry: SkillRegistry) -> int:
    """Register the 4 LSP navigation skills. Returns the count registered."""
    registry.register(
        Skill(
            name="lsp_definition",
            description=(
                "用途: 通过 LSP 跳转到符号定义 (file/line/column → 真正的定义位置)，比 code_search 的正则更精确，能跨文件跨包解析。\n"
                "何时不用: 不知道符号在哪一行/哪一列时先用 code_search/grep 定位坐标；只想看文件结构用 lsp_document_symbols；项目里没装对应语言的 language server 时会返回 dependency_missing。\n"
                "关键参数: path (必填, 文件路径)；line (必填, 1-indexed 行号)；column (必填, 1-indexed 列号, 通常指向标识符的第一个字符)。\n"
                '示例: lsp_definition({"path": "runtime/foo.py", "line": 42, "column": 11})'
            ),
            affinity=["code", "intelligence", "lsp"],
            cost_profile="mid",
            trusted_source="builtin://lsp_definition",
            handler=_lsp_definition,
            tests=[],
        )
    )
    registry.register(
        Skill(
            name="lsp_references",
            description=(
                "用途: 通过 LSP 列出符号的所有引用/使用点 (谁调用了 foo / 谁读写了这个变量)，跨文件查找比 code_search 更准。\n"
                "何时不用: 只想看一个文件内的 grep 结果用 code_search；不知道坐标时先 code_search 找到再 lsp_references；没安装 language server 时回 dependency_missing。\n"
                "关键参数: path (必填)；line (必填, 1-indexed)；column (必填, 1-indexed)；include_declaration (可选, 默认 True, 结果是否包含定义位置本身)。\n"
                '示例: lsp_references({"path": "runtime/foo.py", "line": 42, "column": 11, "include_declaration": false})'
            ),
            affinity=["code", "intelligence", "lsp"],
            cost_profile="mid",
            trusted_source="builtin://lsp_references",
            handler=_lsp_references,
            tests=[],
        )
    )
    registry.register(
        Skill(
            name="lsp_hover",
            description=(
                "用途: 通过 LSP 获取某个位置的悬停信息 (类型签名、docstring、推断的表达式类型)，相当于 IDE 里把鼠标悬停的效果。\n"
                "何时不用: 想读整个文件用 read_file；想列出文件里所有符号用 lsp_document_symbols；没装 language server 时回 dependency_missing。\n"
                "关键参数: path (必填)；line (必填, 1-indexed)；column (必填, 1-indexed, 指向标识符)。\n"
                '示例: lsp_hover({"path": "runtime/foo.py", "line": 42, "column": 11})'
            ),
            affinity=["code", "intelligence", "lsp"],
            cost_profile="mid",
            trusted_source="builtin://lsp_hover",
            handler=_lsp_hover,
            tests=[],
        )
    )
    registry.register(
        Skill(
            name="lsp_document_symbols",
            description=(
                "用途: 通过 LSP 列出一个文件里所有符号 (类、函数、方法、变量) 及其行列坐标和容器关系，相当于 IDE 大纲面板。\n"
                "何时不用: 只想找一个具体名字用 code_search 或 lsp_definition；想跨文件查询用 code_search；没装 language server 时回 dependency_missing。\n"
                "关键参数: path (必填, 要分析的文件路径)。\n"
                '示例: lsp_document_symbols({"path": "runtime/foo.py"})'
            ),
            affinity=["code", "intelligence", "lsp"],
            cost_profile="mid",
            trusted_source="builtin://lsp_document_symbols",
            handler=_lsp_document_symbols,
            tests=[],
        )
    )
    return 4


# Re-export for tests · keep these names stable.
__all__ = [
    "_LSPClient",
    "_LSP_CLIENTS",
    "_DependencyMissing",
    "_LSPError",
    "_LSPRequestError",
    "_LSPTimeoutError",
    "_LSPTransportError",
    "_detect_language",
    "_extract_hover_contents",
    "_flatten_document_symbols",
    "_get_or_start_client",
    "_lsp_definition",
    "_lsp_document_symbols",
    "_lsp_hover",
    "_lsp_references",
    "_normalize_location",
    "_normalize_locations",
    "_path_to_uri",
    "_reset_clients_for_test",
    "_resolve_server_argv",
    "_symbol_kind_name",
    "_uri_to_path",
    "_validate_path_and_language",
    "_validate_position",
    "register_lsp_skills",
]
