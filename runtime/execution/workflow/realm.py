"""Workflow script realm: AST contract + restricted execution (dsh ``realm.ts``).

The model writes a Python orchestration script against a small hook
vocabulary (``agent`` / ``phase`` / ``log`` / ``parallel`` / ``pipeline``
plus the plain-data ``args`` global). The AST contract keeps the script
inside that vocabulary:

* imports, class definitions, generators and async iteration are rejected;
* attribute access is allowed ONLY for an allowlist of public plain-data names
  (``args.items()``, ``s.strip()``) — private/dunder attributes, the
  frame/code/coroutine/generator/traceback introspection surface
  (``cr_*``, ``gi_*``, ``ag_*``, ``f_*``, ``tb_*``, ``co_*``) and
  coroutine/future/loop methods and string-driven attribute lookup
  (``.format`` / ``.format_map``) are
  statically rejected, as are dunder-keyed subscripts and class-pattern
  attribute reads;
* the builtins table is a small allowlist with no ``open`` / ``import`` /
  ``eval`` / ``getattr`` / ``vars`` / ``globals`` / ``type``.

The script executes in a subprocess worker (``worker.py``), so the AST
layer is the contract, not the only boundary — like dsh, execution is
containment rather than a security boundary by itself.
"""

from __future__ import annotations

import ast
import builtins
from typing import Any

from .types import WorkflowError

# Small allowlist: data manipulation only. No I/O, no imports, no
# introspection, no attribute metaprogramming.
WORKFLOW_BUILTINS: dict[str, Any] = {
    name: getattr(builtins, name)
    for name in (
        "abs",
        "all",
        "any",
        "bin",
        "bool",
        "chr",
        "dict",
        "enumerate",
        "filter",
        "float",
        "frozenset",
        "hex",
        "int",
        "isinstance",
        "len",
        "list",
        "map",
        "max",
        "min",
        "oct",
        "ord",
        "range",
        "repr",
        "reversed",
        "round",
        "set",
        "slice",
        "sorted",
        "str",
        "sum",
        "tuple",
        "zip",
        # A script may raise its own errors; the worker maps them to an
        # ``error`` stop reason.
        "Exception",
        "ValueError",
        "TypeError",
        "KeyError",
        "IndexError",
        "RuntimeError",
        "NotImplementedError",
    )
}

_FORBIDDEN_NODES: dict[type[ast.AST], str] = {
    ast.Import: "imports are not supported",
    ast.ImportFrom: "imports are not supported",
    ast.ClassDef: "class definitions are not supported",
    ast.Yield: "generators are not supported",
    ast.YieldFrom: "generators are not supported",
    ast.AsyncFor: "async iteration is not supported",
    ast.AsyncWith: "async with is not supported",
}

_DUNDER = "__"

# Attribute prefixes that belong to CPython's frame / code / traceback /
# coroutine / generator introspection surface. A coroutine returned by a
# hook (``agent("x")``) exposes ``cr_frame`` → ``f_globals`` → the worker
# module globals, so these must be statically unreachable even though they
# are not dunders.
_FORBIDDEN_ATTR_PREFIXES: tuple[str, ...] = (
    "_",  # private / dunder: scripts only need public plain-data methods
    "cr_",
    "gi_",
    "ag_",
    "f_",
    "tb_",
    "co_",
    "func_",
    "im_",
)
# Named attributes that reach metaprogramming or string-driven attribute
# lookup (``"{0.__class__}".format(x)`` resolves attributes at runtime).
_FORBIDDEN_ATTRS: frozenset[str] = frozenset(
    {
        "mro",
        "format",
        "format_map",
        "vformat",
        "get_field",
        "with_traceback",
        "subclasses",
        "gettrace",
        "settrace",
        "setprofile",
        "modules",
        "builtins",
        "globals",
        "locals",
    }
)
# Hook coroutines expose public methods too: send(None) yields an asyncio
# Future, whose get_loop() exposes process/network APIs without any private
# attributes. Admit only names used by inert built-in data and exception args.
# Keep the existing introspection/format denylist as defense in depth.
_DATA_ATTRIBUTES: frozenset[str] = frozenset(
    name
    for data_type in (
        str,
        bytes,
        bytearray,
        list,
        tuple,
        dict,
        set,
        frozenset,
        int,
        float,
        complex,
        range,
        slice,
    )
    for name in dir(data_type)
    if not name.startswith("_")
) | {"args"}

# Builtin names that are not in the allowlist and would be escape
# primitives if ever reachable; rejected statically as defense in depth.
_FORBIDDEN_NAMES: frozenset[str] = frozenset(
    {
        "getattr",
        "setattr",
        "delattr",
        "hasattr",
        "vars",
        "globals",
        "locals",
        "dir",
        "type",
        "object",
        "super",
        "eval",
        "exec",
        "compile",
        "open",
        "input",
        "breakpoint",
        "help",
        "memoryview",
        "classmethod",
        "staticmethod",
        "property",
        "format",
    }
)


def _dunder(parts: tuple[str, ...]) -> bool:
    return any(p.startswith(_DUNDER) and p.endswith(_DUNDER) for p in parts)


def _forbidden_attr(attr: str) -> bool:
    return (
        attr not in _DATA_ATTRIBUTES
        or attr in _FORBIDDEN_ATTRS
        or attr.startswith(_FORBIDDEN_ATTR_PREFIXES)
    )


def _dunder_string(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value.startswith(_DUNDER)
        and node.value.endswith(_DUNDER)
        and len(node.value) > 4
    )


class _ContractVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.violations: list[str] = []

    def _reject(self, node: ast.AST, message: str) -> None:
        self.violations.append(f"line {getattr(node, 'lineno', '?')}: {message}")

    def visit(self, node: ast.AST) -> None:
        for node_type, message in _FORBIDDEN_NODES.items():
            if isinstance(node, node_type):
                self._reject(node, message)
                return
        if isinstance(node, ast.Attribute) and _dunder((node.attr,)):
            self._reject(node, 'attribute access to "__..." dunder names is not supported')
            return
        if isinstance(node, ast.Attribute) and _forbidden_attr(node.attr):
            self._reject(
                node,
                f'attribute access to "{node.attr}" is not supported '
                "(only plain-data attributes are allowed)",
            )
            return
        if isinstance(node, ast.Name) and node.id.startswith(_DUNDER):
            self._reject(node, 'bare "__..." dunder names are not supported')
            return
        if isinstance(node, ast.Name) and node.id in _FORBIDDEN_NAMES:
            self._reject(node, f'the name "{node.id}" is not supported')
            return
        if isinstance(node, ast.MatchClass):
            # Class patterns read attributes by keyword (``case C(attr=x)``)
            # without an ``ast.Attribute`` node — apply the same rule.
            for attr in node.kwd_attrs:
                if _forbidden_attr(attr) or _dunder((attr,)):
                    self._reject(node, f'pattern attribute "{attr}" is not supported')
                    return
        if isinstance(node, ast.Subscript) and _dunder_string(node.slice):
            self._reject(node, 'subscripting with a "__..." dunder key is not supported')
            return
        super().visit(node)


def validate_script(body: str, *, name: str = "workflow") -> None:
    """Parse and contract-check a workflow script body.

    Raises :class:`WorkflowError` (``SCRIPT_PARSE``) with every violation.
    This is the host-side pre-parse so ``start()`` can throw synchronously
    before a run exists; the worker re-validates defensively.
    """
    try:
        tree = ast.parse(body, filename=f"workflow:{name}")
    except SyntaxError as exc:
        raise WorkflowError(
            f"workflow script does not parse: {exc.msg} (line {exc.lineno})",
            "SCRIPT_PARSE",
            cause=exc,
        ) from exc
    visitor = _ContractVisitor()
    visitor.visit(tree)
    if visitor.violations:
        raise WorkflowError(
            "workflow script violates the supported subset: " + "; ".join(visitor.violations),
            "SCRIPT_PARSE",
        )


def check_meta_statement(body: str, *, name: str = "workflow") -> None:
    """Reject a top-level ``meta = {...}`` assignment with a pointed error.

    dsh's model-facing tool carries ``export const meta`` in the body
    instead of the request field; our analog is a top-level ``meta``
    assignment. The meta block rides the tool's ``meta`` parameter.
    """
    try:
        tree = ast.parse(body, filename=f"workflow:{name}")
    except SyntaxError:
        return  # validate_script reports the real parse error
    for node in tree.body:
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Name) and target.id == "meta":
                    raise WorkflowError(
                        "workflow meta rides the `meta` request field, not the "
                        "script: remove the top-level `meta = {...}` statement "
                        "from the body",
                        "SCRIPT_PARSE",
                    )


def wrap_body(body: str) -> str:
    """Wrap the body so top-level ``return`` and ``await`` are legal.

    Execution reports line numbers shifted by +1 (the wrapper line).
    """
    indented = "\n".join(f"    {line}" if line.strip() else line for line in body.splitlines())
    return f"async def __workflow_main():\n{indented}"


def build_globals(hooks: dict[str, Any], args: Any) -> dict[str, Any]:
    """Restricted globals for one script execution.

    ``__builtins__`` is pinned to the allowlist — CPython injects the real
    builtins when the key is absent, which would defeat the contract.
    """
    globals_dict: dict[str, Any] = dict(hooks)
    if args is not None:
        globals_dict["args"] = args
    globals_dict["__builtins__"] = dict(WORKFLOW_BUILTINS)
    return globals_dict


def materialize_json(value: Any) -> Any:
    """Best-effort JSON materialization check for a script return value.

    Raises :class:`WorkflowError` (``RESULT_UNSERIALIZABLE``) when the
    value is not plain JSON data.
    """
    import json

    try:
        json.dumps(value, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise WorkflowError(
            "the workflow's return value is not plain JSON data — "
            f"{exc}. Return only JSON-serializable objects/arrays/scalars.",
            "RESULT_UNSERIALIZABLE",
            cause=exc,
        ) from exc
    return value


__all__ = [
    "WORKFLOW_BUILTINS",
    "build_globals",
    "check_meta_statement",
    "materialize_json",
    "validate_script",
    "wrap_body",
]
