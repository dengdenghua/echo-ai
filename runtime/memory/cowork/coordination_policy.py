"""Persist only server-derived grants for delayed group work."""

import time
from contextlib import nullcontext
from dataclasses import asdict
from pathlib import Path

from runtime.platform.process.scope import (
    ExecutionScope,
    execution_scope_ceiling,
    resolve_execution_scope,
)

_METADATA = (
    "mode",
    "permission_mode",
    "approval_policy",
    "sandbox_mode",
    "execution_environment",
    "workspace_path",
    "workspace_scope",
    "extra_workspaces",
    "attachment_read_roots",
    "team_id",
    "tenant_id",
    "tool_allowlist",
    "tool_denylist",
    "tool_allowlist_mode",
    "extra_tool_allowlist",
    "approval_risk_policy",
    "_inherited_injection_taint",
    "injection_taint",
    "model_name",
    "model",
    "thinking_enabled",
    "reasoning_effort",
    "coder_engine",
    "coder_model",
)


def capture_policy(session, *, parent=None):
    task = session.metadata.get("_execution_task")
    ceiling = (
        execution_scope_ceiling(task.permissions)
        if getattr(task, "permissions", None)
        else nullcontext()
    )
    with ceiling:
        scope = resolve_execution_scope(session)
    value = asdict(scope)
    for key in ("readable_roots", "writable_roots"):
        value[key] = [str(p) for p in value[key]]
    metadata = {k: session.metadata[k] for k in _METADATA if k in session.metadata}
    context = {
        "scope": value, "metadata": metadata, "turn_id": session.turn_id,
        "auto_delivery": True,
    }
    if task is not None and getattr(task, "resources", None) is not None:
        remaining = task.resources.remaining_seconds()
        if remaining is not None:
            context["expires_at"] = time.time() + remaining
    if parent:
        context["parent_task_id"] = parent["id"]
        context["root_id"] = parent.get("root_id") or parent["id"]
        context["depth"] = int(parent.get("depth", 0)) + 1
        if context["depth"] > 3:
            raise PermissionError("协作分派层级已达到上限，请汇总现有结果")
    return context


def restore_scope(context):
    value = dict(context["scope"])
    for key in ("readable_roots", "writable_roots"):
        value[key] = tuple(Path(p) for p in value[key])
    return ExecutionScope(**value)
