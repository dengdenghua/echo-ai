"""Verification evidence helpers for realtime turn outcomes.

Split out of :mod:`runtime.sensing.gateway.realtime_turn_outcome` so that module
stays under the 1000-line god-file ratchet. Every function here answers one
question about a finished turn: is there a code change, is there passing /
failing / environment-blocked verification for it, and do the two actually refer
to the same paths.

Pure functions over protocol items — no runtime state, no logging, no I/O.
"""

from __future__ import annotations

import os
from typing import Any

from runtime.platform.models import ParsedIntent
from runtime.protocol import (
    FileChangeItem,
    ItemStatus,
    Turn,
    VerificationItem,
)

_CODE_CHANGE_SUFFIXES = frozenset(
    {
        ".py",
        ".js",
        ".jsx",
        ".ts",
        ".tsx",
        ".mjs",
        ".cjs",
        ".go",
        ".rs",
        ".java",
        ".kt",
        ".kts",
        ".swift",
        ".cs",
        ".cpp",
        ".cc",
        ".cxx",
        ".c",
        ".h",
        ".hpp",
        ".rb",
        ".php",
        ".sh",
        ".ps1",
        ".sql",
        ".vue",
        ".svelte",
    }
)

_CODE_CHANGE_FILENAMES = frozenset(
    {
        "package.json",
        "pnpm-lock.yaml",
        "package-lock.json",
        "yarn.lock",
        "pyproject.toml",
        "pytest.ini",
        "ruff.toml",
        "tsconfig.json",
        "vite.config.ts",
        "vite.config.js",
        "next.config.js",
        "next.config.mjs",
        "go.mod",
        "go.sum",
        "cargo.toml",
        "cargo.lock",
        "dockerfile",
        "docker-compose.yml",
        "docker-compose.yaml",
    }
)


def _is_code_change_path(path: str) -> bool:
    normalized = path.replace("\\", "/").rsplit("/", 1)[-1].lower()
    if normalized in _CODE_CHANGE_FILENAMES:
        return True
    _, ext = os.path.splitext(normalized)
    return ext.lower() in _CODE_CHANGE_SUFFIXES


def _file_change_items(turn: Turn) -> list[FileChangeItem]:
    return [item for item in turn.items if isinstance(item, FileChangeItem)]


def _verification_items(turn: Turn) -> list[VerificationItem]:
    return [item for item in turn.items if isinstance(item, VerificationItem)]


def _code_change_paths(turn: Turn) -> list[str]:
    paths: list[str] = []
    for item in _file_change_items(turn):
        for change in item.changes:
            if _is_code_change_path(change.path) and change.path not in paths:
                paths.append(change.path)
    return paths


def _verification_plan_for_code_paths(
    paths: list[str],
    intent: ParsedIntent | None,
) -> dict[str, Any]:
    """Build targeted verifier commands for code changes.

    The realtime failure path needs concrete next commands, not a generic
    "run tests" nudge. This reuses the post-write regression matrix so
    executor diagnostics, failed-turn metadata, and operator views converge
    on one verifier selection policy.
    """

    commands: list[dict[str, Any]] = []
    seen: set[str] = set()
    cwd = _intent_cwd(intent)
    for path in paths:
        try:
            from runtime.safety.hooks.tool_edge_hooks import regression_matrix_for_path

            matrix = regression_matrix_for_path(path, workspace_path=cwd)
        except Exception:  # noqa: BLE001 - verification hints must never fail turns
            continue
        for check in matrix.checks:
            if check.command in seen:
                continue
            seen.add(check.command)
            commands.append(
                {
                    "kind": check.kind,
                    "command": check.command,
                    "reason": check.reason,
                    "priority": check.priority,
                    "target": matrix.target,
                }
            )
    return {
        "schema": "echo.verification_plan.v1",
        "workspace": cwd,
        "targets": list(paths),
        "commands": commands,
    }


def _verification_plan_stdout_tail(plan: dict[str, Any]) -> str:
    commands = plan.get("commands") if isinstance(plan, dict) else None
    if not isinstance(commands, list) or not commands:
        return (
            "Run an appropriate test, lint, typecheck, or build command and retry the final answer."
        )
    lines = ["Recommended verification commands:"]
    for command in commands[:5]:
        if not isinstance(command, dict):
            continue
        kind = str(command.get("kind") or "check")
        cmd = str(command.get("command") or "").strip()
        reason = str(command.get("reason") or "").strip()
        if not cmd:
            continue
        suffix = f" :: {reason}" if reason else ""
        lines.append(f"- [{kind}] {cmd}{suffix}")
    if len(lines) == 1:
        return (
            "Run an appropriate test, lint, typecheck, or build command and retry the final answer."
        )
    return "\n".join(lines)


def _intent_cwd(intent: ParsedIntent | None) -> str:
    context = intent.user_context if intent is not None else {}
    if isinstance(context, dict):
        cwd = context.get("cwd") or context.get("workspace_path")
        if isinstance(cwd, str) and cwd.strip():
            return cwd.strip()
    return os.getcwd()


def _file_change_item_ids(turn: Turn) -> list[str]:
    return [item.id for item in _file_change_items(turn)]


def _normalized_path_key(path: str) -> str:
    return path.replace("\\", "/").lower()


def _verification_matches_code_changes(
    item: VerificationItem,
    *,
    code_paths: list[str],
    change_item_ids: list[str],
) -> bool:
    if not code_paths:
        return False

    code_path_keys = {_normalized_path_key(path) for path in code_paths}
    change_id_set = set(change_item_ids)
    related_ids = set(item.related_change_item_ids)
    if related_ids:
        return bool(related_ids & change_id_set)

    related_path_keys = {
        _normalized_path_key(path)
        for path in item.related_files
        if isinstance(path, str) and path.strip()
    }
    if related_path_keys:
        return bool(related_path_keys & code_path_keys)

    # No explicit relationship means a completed verification command is
    # a turn-level check. Once relationship metadata exists, it must match.
    return True


def _turn_has_passing_code_verification(turn: Turn) -> bool:
    code_paths = _code_change_paths(turn)
    if not code_paths:
        return True
    change_item_ids = _file_change_item_ids(turn)
    return any(
        item.status == ItemStatus.COMPLETED
        and _verification_matches_code_changes(
            item,
            code_paths=code_paths,
            change_item_ids=change_item_ids,
        )
        for item in _verification_items(turn)
    )


def _turn_has_failed_code_verification(turn: Turn) -> bool:
    code_paths = _code_change_paths(turn)
    change_item_ids = _file_change_item_ids(turn)
    for item in _verification_items(turn):
        if item.status != ItemStatus.FAILED:
            continue
        if _verification_matches_code_changes(
            item,
            code_paths=code_paths,
            change_item_ids=change_item_ids,
        ):
            return True
        if not code_paths and any(_is_code_change_path(path) for path in item.related_files):
            return True
    return False


# Environment-blocked verification markers: the verifier itself could not
# run because the sandbox blocks the toolchain at a level the agent cannot
# self-repair — no network, corepack unable to download itself, DNS/SSL
# failures, pnpm's strict node_modules layout breaking direct `node` calls.
# Deliberately EXCLUDES "command not found" / "npx: not found" / "winerror
# 2" / "no module named": a missing CLI is something the agent can usually
# fix by selecting an installed equivalent (the failure classifier routes
# those to environment_missing_tool + repair), so they keep hard-failing.
_ENV_BLOCKED_VERIFICATION_MARKERS = (
    # corepack / package-manager self-download
    "corepack is about to download",
    "error when performing the request",
    "err_module_not_found",
    "cannot find package",
    # network / DNS / proxy
    "network is unreachable",
    "getaddrinfo failed",
    "temporary failure in name resolution",
    "name or service not known",
    "failed to connect",
    "unable to access",
    "socket hang up",
    "proxyconnect",
    "connection refused",
    # TLS / cert
    "unexpected_eof_while_reading",
    "ssl: unexpected_eof",
    "certificate verify failed",
    "self-signed certificate",
    # fd exhaustion
    "emfile",
)


def _verification_item_is_environment_blocked(item: VerificationItem) -> bool:
    """True when a failed verification item failed because the environment
    (network / package-manager / sandbox) blocked the verifier at a level
    the agent cannot self-repair, not because the code under test is
    broken."""
    haystack = "\n".join(
        str(part)
        for part in (item.summary, item.stdout_tail, item.stderr_tail)
        if isinstance(part, str) and part.strip()
    )
    lowered = haystack.lower()
    return any(marker in lowered for marker in _ENV_BLOCKED_VERIFICATION_MARKERS)


def _command_execution_environment_blocked(item: Any) -> bool:
    """True when a failed shell command's output shows an environment-level
    blockage (network / package-manager self-download / TLS) rather than a
    code error. Used to catch verification attempts the agent ran via
    ``exec_shell`` that never produced a ``VerificationItem``."""
    output = str(getattr(item, "aggregated_output", "") or "")
    lowered = output.lower()
    return any(marker in lowered for marker in _ENV_BLOCKED_VERIFICATION_MARKERS)


def _turn_verification_environment_blocked(turn: Turn) -> bool:
    """True when every failed verification attempt for this turn is
    environment-blocked (no network / package-manager self-download / TLS),
    so the turn can degrade to a manual-confirmation state instead of a
    hard failure.

    Covers both ``VerificationItem`` failures AND failed shell commands the
    agent ran as verification attempts (their ``aggregated_output`` shows
    the environment blockage). A turn with at least one real code failure
    (test assertion, syntax error) is NOT treated as blocked.
    """
    failed_verifications = [
        item for item in _verification_items(turn) if item.status == ItemStatus.FAILED
    ]
    if failed_verifications:
        # At least one recorded verification failure is a real code error.
        if not all(
            _verification_item_is_environment_blocked(item) for item in failed_verifications
        ):
            return False
        # All recorded verification items are environment-blocked — only
        # degrade when no shell command carried a real code failure either.
        return not _turn_has_real_code_failure(turn)

    # No recorded VerificationItem failures — inspect failed shell commands
    # the agent ran as verification attempts.
    failed_commands = [
        item
        for item in turn.items
        if getattr(item, "type", None) == "commandExecution"
        and getattr(item, "status", None) == ItemStatus.FAILED
    ]
    if not failed_commands:
        return False
    if any(_command_is_real_code_failure(item) for item in failed_commands):
        return False
    return all(_command_execution_environment_blocked(item) for item in failed_commands)


def _command_is_real_code_failure(item: Any) -> bool:
    """True when a failed shell command's output shows a real code problem
    (test assertion, syntax error, lint violation, type error) rather than
    an environment blockage. Used to keep hard-failing turns whose
    verifier genuinely found broken code."""
    code_failure_markers = (
        "assert",
        "syntaxerror",
        "invalid syntax",
        "e999",
        "failed tests",
        "failures =",
        "error: cannot find",
        "type error",
        "tsc",
        "mypy",
    )
    output = str(getattr(item, "aggregated_output", "") or "").lower()
    return any(marker in output for marker in code_failure_markers)


def _turn_has_real_code_failure(turn: Turn) -> bool:
    """True when the turn carries any failed shell command whose output is a
    real code problem (test assertion, syntax error, lint violation) rather
    than an environment blockage."""
    return any(
        _command_is_real_code_failure(item)
        for item in turn.items
        if getattr(item, "type", None) == "commandExecution"
        and getattr(item, "status", None) == ItemStatus.FAILED
    )


def _turn_has_unverified_code_changes(turn: Turn) -> bool:
    return bool(_code_change_paths(turn)) and not _turn_has_passing_code_verification(turn)
