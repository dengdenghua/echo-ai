"""A shared CODEX_HOME scope for one principal's tool-free chat turns."""

from __future__ import annotations

import uuid
from dataclasses import replace
from pathlib import Path

import pytest

from runtime.execution.codex_backend.chat_warm import chat_workspace, home_scope
from runtime.execution.codex_backend.security import (
    CodexSecurityError,
    CodexSecurityPolicy,
    CodexSidecarContext,
    CodexSidecarSecurity,
)


def _manager(tmp_path: Path) -> tuple[CodexSidecarSecurity, Path]:
    state_root = tmp_path / "codex_backend"
    workspace = chat_workspace(state_root)
    manager = CodexSidecarSecurity(
        CodexSecurityPolicy(state_root=state_root, allowed_workspace_roots=(workspace,))
    )
    return manager, workspace


def _prepare(
    manager: CodexSidecarSecurity,
    workspace: Path,
    *,
    tenant_id: str = "tenant-a",
    thread_id: str = "thread-a",
    task_id: str = "task-a",
    scope: str | None = "chat",
) -> CodexSidecarContext:
    return manager.prepare(
        realm_id="realm/codex-tool-free-v2",
        tenant_id=tenant_id,
        thread_id=thread_id,
        task_id=task_id,
        workspace=workspace,
        sandbox_mode="read-only",
        codex_home_scope=scope,
    )


def test_conversations_of_one_principal_share_a_home_but_bind_their_own_threads(
    tmp_path: Path,
) -> None:
    manager, workspace = _manager(tmp_path)
    first = _prepare(manager, workspace, thread_id="conversation-1")
    second = _prepare(manager, workspace, thread_id="conversation-2", task_id="task-b")

    assert first.codex_home == second.codex_home
    assert first.codex_home.is_dir() and first.home_scope_key is not None
    assert first.thread_root != second.thread_root
    assert first.binding_path != second.binding_path
    assert first.codex_home.parent != first.thread_root

    first_inner = str(uuid.uuid4())
    manager.write_server_binding(first, inner_thread_id=first_inner, authority="server")
    assert manager.read_server_binding(second, authority="server") is None
    assert manager.read_server_binding(first, authority="server").inner_thread_id == first_inner


def test_a_shared_home_never_spans_principals_or_scopes(tmp_path: Path) -> None:
    manager, workspace = _manager(tmp_path)
    alice = _prepare(manager, workspace, tenant_id="tenant-a/alice")
    bob = _prepare(manager, workspace, tenant_id="tenant-a/bob")
    other_provider = _prepare(manager, workspace, tenant_id="tenant-a/alice", scope="chat-2")
    thread_owned = _prepare(manager, workspace, tenant_id="tenant-a/alice", scope=None)

    homes = {alice.codex_home, bob.codex_home, other_provider.codex_home, thread_owned.codex_home}
    assert len(homes) == 4
    assert thread_owned.codex_home == thread_owned.thread_root / "codex-home"
    assert thread_owned.home_scope_key is None


def test_a_context_pointing_at_another_home_fails_layout_validation(tmp_path: Path) -> None:
    manager, workspace = _manager(tmp_path)
    alice = _prepare(manager, workspace, tenant_id="tenant-a/alice")
    bob = _prepare(manager, workspace, tenant_id="tenant-a/bob")
    forged = replace(alice, codex_home=bob.codex_home)

    with pytest.raises(CodexSecurityError, match="CODEX_HOME"):
        manager.read_server_binding(forged, authority="server")
    with pytest.raises(CodexSecurityError, match="CODEX_HOME"):
        manager.read_server_binding(replace(alice, home_scope_key=None), authority="server")


def test_chat_workspace_is_a_sibling_of_the_state_root(tmp_path: Path) -> None:
    state_root = tmp_path / "codex_backend"
    workspace = chat_workspace(state_root)

    assert workspace.is_dir()
    assert workspace.parent == state_root.parent.resolve()
    assert state_root.resolve() not in workspace.parents
    assert chat_workspace(state_root) == workspace


def test_only_tool_free_requests_get_a_shared_scope() -> None:
    class Profile:
        provider_id = "echo"
        model = "m"

    class Request:
        tool_free = True
        provider_profile = None

    assert home_scope(Request()) is not None
    Request.provider_profile = Profile()
    with_provider = home_scope(Request())
    assert with_provider is not None and "echo" in with_provider
    Request.tool_free = False
    assert home_scope(Request()) is None
