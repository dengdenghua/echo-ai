"""Where a Codex sidecar's private state lives, and the layout check every
server-only operation runs before it trusts a provisioned context."""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING

from ._security_support import CodexSecurityError, _lock_down_directory, _opaque_id

if TYPE_CHECKING:
    from .security import CodexSecurityPolicy, CodexSidecarContext


def _sidecar_state_paths(
    state_root: Path, realm_key: str, tenant_key: str, thread_key: str, task_key: str
) -> tuple[Path, Path]:
    if os.name == "nt":
        # SQLite in the Windows App Server cannot open the old four-level
        # 64-character hash tree under packaged LOCALAPPDATA. Hash the full
        # identity tuple once per scope; retain all 256 bits and domain
        # separation, with the same private markers and cleanup boundary.
        identity = f"{realm_key}\0{tenant_key}\0{thread_key}"
        thread_root = state_root / "realms" / _opaque_id("thread-state", identity)
        task_root = state_root / "realms" / _opaque_id("task-state", f"{identity}\0{task_key}")
        return thread_root, task_root
    thread_root = (
        state_root / "realms" / realm_key / "tenants" / tenant_key / "threads" / thread_key
    )
    return thread_root, thread_root / "tasks" / task_key


def codex_home_path(
    state_root: Path,
    realm_key: str,
    tenant_key: str,
    thread_root: Path,
    home_scope_key: str | None,
) -> Path:
    """The sidecar's CODEX_HOME: its thread's own, or one shared scope's.

    A shared scope belongs to one realm and one (principal-scoped) tenant, so
    it never spans principals. Thread bindings stay under ``thread_root``,
    which keeps each conversation on its own inner Codex thread.
    """

    if home_scope_key is None:
        return thread_root / "codex-home"
    identity = f"{realm_key}\0{tenant_key}\0{home_scope_key}"
    return state_root / "realms" / _opaque_id("shared-codex-home", identity) / "codex-home"


def _validate_context_layout(
    context: CodexSidecarContext,
    policy: CodexSecurityPolicy,
) -> None:
    try:
        policy_root = policy.state_root.resolve(strict=True)
    except OSError as exc:
        raise CodexSecurityError("Codex sidecar state_root is unavailable") from exc
    if context.state_root != policy_root:
        raise CodexSecurityError("Codex sidecar context belongs to a different state_root")
    hashes = [
        ("realm", context.realm_key),
        ("tenant", context.tenant_key),
        ("thread", context.thread_key),
        ("task", context.task_key),
    ]
    if context.home_scope_key is not None:
        hashes.append(("CODEX_HOME scope", context.home_scope_key))
    for label, value in hashes:
        if len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
            raise CodexSecurityError(f"invalid {label} hash in Codex sidecar context")
    expected_thread_root, expected_task_root = _sidecar_state_paths(
        context.state_root,
        context.realm_key,
        context.tenant_key,
        context.thread_key,
        context.task_key,
    )
    if context.thread_root != expected_thread_root:
        raise CodexSecurityError("Codex sidecar thread_root does not match its identity hashes")
    if context.task_root != expected_task_root:
        raise CodexSecurityError("Codex sidecar task_root does not match its identity hashes")
    expected_home = codex_home_path(
        context.state_root,
        context.realm_key,
        context.tenant_key,
        expected_thread_root,
        context.home_scope_key,
    )
    if context.codex_home != expected_home:
        raise CodexSecurityError("Codex sidecar CODEX_HOME is not thread- or scope-bound")
    if context.binding_path != expected_thread_root / "binding.json":
        raise CodexSecurityError("Codex sidecar binding path is invalid")
    _lock_down_directory(context.thread_root)
    _lock_down_directory(context.codex_home)
