"""Tool execution helpers for ephemeral sub-agent runs.

Split out from ``ephemeral_runner.py`` to keep that module under the
god-file line cap. Pure structural move — no behavior changes.

Contains:
    * ``_ephemeral_write_confine_block`` — scopes a sub-agent's filesystem
      tools to a locked worktree (replicates the executor's sandbox-arg
      injector for the ephemeral direct-dispatch path).
    * ``_execute_tool_in_subagent`` — runs one tool_use call inside an
      ephemeral sub-agent (mirrors ``tool_bridge._execute_tool_call`` but
      skips ``stack.executor`` so the sub-agent sees the SHARED session).
"""

from __future__ import annotations

from typing import Any

from runtime.execution.suckers.ephemeral_injection_gate import (
    ephemeral_injection_taint_block,
    scan_and_escalate_ephemeral_taint,
)
from runtime.execution.suckers.layers import EPHEMERAL_MEMORY_SKILLS

__all__ = [
    "_ephemeral_write_confine_block",
    "_execute_tool_in_subagent",
]


_LOCKED_DIR_PARAMS = ("cwd", "root")
_LOCKED_PATH_PARAMS = ("path", "file_path", "filepath")


def _confine_args_to_locked_root(
    call_input: dict[str, Any],
    params: Any,
    locked: Any,
) -> str | None:
    """Pin a locked-worktree call's directory/path arguments to ``locked``.

    Mutates ``call_input`` in place (the call model is frozen, its input dict
    is not). Returns an escape description when a model-supplied ``cwd`` /
    ``root`` / path resolves outside the locked root, else ``None``.

    * ``sandbox_dir`` is ALWAYS the locked root — a model-supplied value is
      overwritten, never trusted (it is the confinement boundary itself).
    * ``cwd`` / ``root`` default to the locked root; relative values resolve
      under it; absolute values must stay inside it.
    * absolute path params must stay inside the locked root; relative ones are
      anchored to it when the handler has no ``sandbox_dir`` to resolve them.
    """
    from pathlib import Path

    locked_text = str(locked)
    locked_root = Path(locked_text).expanduser()
    try:
        locked_resolved = locked_root.resolve(strict=False)
    except OSError:
        locked_resolved = locked_root

    def _anchor(value: Any) -> Path:
        candidate = Path(str(value)).expanduser()
        if not candidate.is_absolute():
            candidate = locked_root / candidate
        return candidate

    def _inside(candidate: Path) -> bool:
        try:
            resolved = candidate.resolve(strict=False)
        except OSError:
            return False
        try:
            resolved.relative_to(locked_resolved)
        except ValueError:
            return False
        return True

    if "sandbox_dir" in params or "sandbox_dir" in call_input:
        call_input["sandbox_dir"] = locked_text

    for key in _LOCKED_DIR_PARAMS:
        if key not in params and key not in call_input:
            continue
        supplied = call_input.get(key)
        if supplied in (None, "", ".", "./"):
            if key in params:
                call_input[key] = locked_text
            continue
        anchored = _anchor(supplied)
        if not _inside(anchored):
            return f"{key}={supplied!r} escapes the locked worktree"
        if not Path(str(supplied)).expanduser().is_absolute():
            call_input[key] = str(anchored)

    has_sandbox = "sandbox_dir" in params
    for key in _LOCKED_PATH_PARAMS:
        supplied = call_input.get(key)
        if not isinstance(supplied, str) or not supplied.strip():
            continue
        anchored = _anchor(supplied)
        if not _inside(anchored):
            return f"{key}={supplied!r} escapes the locked worktree"
        if not has_sandbox and not Path(supplied).expanduser().is_absolute():
            call_input[key] = str(anchored)
    return None


def _ephemeral_write_confine_block(call: Any, skill: Any) -> str | None:
    """Scope a sub-agent's filesystem tools to a locked worktree.

    Ephemeral runs bypass the executor's sandbox-arg injector, so a write skill
    would otherwise run with ``sandbox_dir=None`` (no confinement → it can write
    anywhere, verified live). When the Session pins ``_locked_write_root`` (set
    by ``call_subagent(workspace_path=...)``), we replicate the injector here:
    FORCE the locked root as ``sandbox_dir`` (a model-supplied value is
    overwritten) so the skill's own ``check_path`` confines writes into the
    worktree, and reject a ``cwd`` / ``root`` / absolute path that resolves
    outside it (see ``_confine_args_to_locked_root``). A write skill
    that can't take a sandbox_dir is blocked (fail-closed) rather than allowed to
    escape. Shell/exec-class tools are blocked outright (audit F-02) — a cwd
    nudge is not a sandbox for a command interpreter. Returns a block message,
    or None to proceed.
    """
    from runtime.platform.process.session import current_session

    meta = getattr(current_session(), "metadata", None) or {}
    locked = meta.get("_locked_write_root")
    if not locked:
        return None
    name = (getattr(call, "name", "") or "").lower()
    affinity = [str(a).lower() for a in (getattr(skill, "affinity", None) or [])]
    call_input = getattr(call, "input", None)
    args = call_input if isinstance(call_input, dict) else {}
    # Audit F-02: shell/exec-class tools cannot be confined to the locked
    # worktree — injecting ``cwd`` is a nudge, not a sandbox (the command
    # can cd anywhere and write straight into the main tree). Fail closed
    # inside an isolated spawn instead of letting the sub-agent escape.
    shell_affinity = any(a in ("shell", "exec") for a in affinity)
    shell_name = any(tok in name for tok in ("exec_shell", "background_exec", "run_command"))
    if shell_affinity or shell_name:
        return (
            f"(blocked: '{getattr(call, 'name', '?')}' is a shell/exec tool and "
            f"cannot be confined to the locked worktree — isolated spawns run "
            f"without shell access. Do not retry shell tools here; use the "
            f"read-only retrieval tools instead: read_file, read_file_range, "
            f"grep_text, glob_files, list_cwd, tree, code_search. If a command "
            f"must really run, report it as a finding for the parent session.)"
        )
    path_payload = any(key in args for key in ("path", "file_path", "filepath", "root", "patch"))
    filesystem_affinity = any(
        a in ("file", "io", "filesystem", "file-read", "file-write", "write", "edit")
        for a in affinity
    )
    filesystem_name = name in {
        "list_cwd",
        "read_file",
        "file_stats",
        "glob_files",
        "grep_text",
        "tree",
        "read_file_range",
    } or (
        path_payload and any(tok in name for tok in ("write", "edit", "patch", "create", "append"))
    )
    try:
        import inspect

        params = inspect.signature(skill.handler).parameters
    except (TypeError, ValueError):
        params = {}
    # A handler that takes a directory base is scope-bearing whatever its
    # affinity says — leaving it unconfined would let the model point it
    # anywhere on disk from inside an isolated spawn.
    scope_params = any(p in params for p in ("sandbox_dir", "cwd", "root"))
    if not (filesystem_affinity or filesystem_name or scope_params):
        # Logical state writers such as bb_write / todo_write are not file
        # operations and must remain usable inside a locked worktree.
        return None
    if isinstance(call_input, dict):
        escape = _confine_args_to_locked_root(call_input, params, locked)
        if escape is not None:
            return (
                f"(blocked: '{getattr(call, 'name', '?')}' {escape} — this isolated "
                f"spawn is locked to the worktree {locked}. Use a path inside it.)"
            )

    is_write = any(tok in name for tok in ("write", "edit", "patch", "create", "append")) or any(
        a in ("write", "edit", "file-write") for a in affinity
    )
    if not is_write:
        return None
    if "sandbox_dir" not in params:
        return (
            f"(blocked: '{getattr(call, 'name', '?')}' can't be confined to the "
            f"locked worktree — refusing to write unsandboxed)"
        )
    return None


def _execute_tool_in_subagent(
    registry: Any,
    call: Any,
) -> tuple[str, bool]:
    """Run one tool_use call inside an ephemeral sub-agent.

    Mirrors the simpler shape of ``tool_bridge._execute_tool_call``
    but doesn't go through ``stack.executor`` — sub-agents already
    inherit the parent's Session via ContextVar, and we want their
    skill calls to see the SHARED ``current_session()`` so blackboard
    + memory skills resolve to the parent's turn_id / agent. Going
    through executor would re-set Session and break this.

    Returns ``(output_text, is_error)``.
    """
    import json

    try:
        if not registry.has(call.name):
            return (f"(skill not found: {call.name})", True)
        skill = registry.get(call.name)
    except Exception as exc:  # noqa: BLE001
        return (f"(registry error: {exc})", True)

    # Injection-taint gate — ephemeral runs bypass the executor chokepoint, so
    # enforce here, fail-closed (block, since there's no approval channel).
    _taint_block = ephemeral_injection_taint_block(call, call.name)
    if _taint_block is not None:
        return (_taint_block, True)

    # Memory / SOUL skills require a bound Session; ephemeral sub-agents run
    # without one (current_session() is not propagated into the dispatch thread),
    # so calling them raises RuntimeError and surfaces as a failed tool call the
    # model keeps retrying. Block with a clean error instead — a sub-agent must
    # not mutate the parent agent's durable memory anyway. This is the ultimate
    # fallback: advertised-list stripping (ephemeral_agents) is the polite layer.
    if str(call.name) in EPHEMERAL_MEMORY_SKILLS:
        return (
            "(unavailable: long-term memory / SOUL skills (remember, recall, "
            "note_user, diary_write, and the self-evolution tools) are disabled "
            "inside sub-agents — a sub-agent runs without a bound Session and "
            "must not mutate the parent agent's durable memory. Report any "
            "memory-worthy fact as a finding for the parent session instead.)",
            True,
        )

    _confine_block = _ephemeral_write_confine_block(call, skill)
    if _confine_block is not None:
        return (_confine_block, True)

    # The mini-loop intentionally bypasses ``executor.execute_step`` so child
    # memory/blackboard calls stay on the shared Session.  It must still reuse
    # the executor's Session-derived path preparation: otherwise relative
    # ``read_file`` / ``list_cwd`` calls fall back to the server process cwd.
    # That made personal-workspace children search the entire repository even
    # though the parent had a precise artifact root.  Keep the direct dispatch,
    # but apply the same trusted cwd/sandbox injection before the safety gate.
    # In worktree-locked mode ``_ephemeral_write_confine_block`` has already
    # pinned sandbox_dir/cwd/root/path to the locked root (stricter than the
    # session scope, which may not even contain the worktree), so the
    # scope-based preparation is intentionally not re-run there.
    try:
        from runtime.platform.process.session import current_session

        _scope_meta = getattr(current_session(), "metadata", None) or {}
    except (ImportError, AttributeError, LookupError):
        _scope_meta = {}
    if isinstance(getattr(call, "input", None), dict) and not _scope_meta.get("_locked_write_root"):
        from runtime.execution.tool_engine._executor_helpers import (
            _prepare_scoped_args,
        )
        from runtime.platform.models import SkillId

        try:
            _scoped_input = _prepare_scoped_args(
                skill,
                SkillId(str(call.name)),
                dict(call.input),
            )
        except PermissionError as exc:
            return (f"(blocked: {exc})", True)
        call.input.clear()
        call.input.update(_scoped_input)

    # Direct-dispatch hardening — ephemeral runs bypass the executor
    # chokepoint, so apply the same pre-execution safety gates here (SEC-1/2).
    if isinstance(getattr(call, "input", None), dict):
        from runtime.execution.tool_engine.skill_gate import gate_inner_dispatch
        from runtime.safety.auth import MODEL_FORBIDDEN_ARGS

        # Drop model-controllable privilege flags (allow_sensitive /
        # allow_private) the model must never set — same as the executor.
        # ``call`` is a frozen model, so mutate the input dict in place rather
        # than rebinding the attribute (cf. the sandbox_dir injection above).
        for _forbidden in MODEL_FORBIDDEN_ARGS:
            call.input.pop(_forbidden, None)
        # Capability denylist + immunity (when a TrustEngine is ambiently
        # bound) + credential-file denylist (check_file_write). Without these
        # an unsandboxed sub-agent could write ./.env / ./id_rsa, or run an
        # operator-disabled tool — the executor blocks both. Reuse the shared
        # primitive the other direct-dispatch points already use so this path
        # stays in lock-step with the executor instead of re-implementing gates.
        _gate = gate_inner_dispatch(skill, call.input, caller="ephemeral_subagent")
        if _gate is not None:
            return (f"(blocked: {_gate.message})", True)

    try:
        from runtime.execution.tool_engine.coordination_guard import invoke_coordinated

        output = invoke_coordinated(
            skill, call.input, service=getattr(registry, "coordination", None)
        )
    except TypeError as exc:
        return (f"(TypeError: {exc})", True)
    except Exception as exc:  # noqa: BLE001
        return (f"(skill error: {type(exc).__name__}: {exc})", True)

    output_is_error = isinstance(output, dict) and (
        output.get("ok") is False or output.get("success") is False
    )
    if isinstance(output, str):
        rendered = output
    else:
        try:
            rendered = json.dumps(output, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            rendered = repr(output)

    # If this tool ingested untrusted content carrying injection markers,
    # escalate the turn taint so a LATER risky tool in the same ephemeral run
    # is gated too — mirrors the executor chokepoint's post-success scan.
    scan_and_escalate_ephemeral_taint(
        call.name,
        getattr(skill, "affinity", None),
        rendered,
    )
    # Same 4kB cap as parent agentic loop · keeps sub-agent context
    # from blowing up on a single huge tool result (e.g. a full-page
    # web_search output).
    if len(rendered) > 4000:
        rendered = rendered[:4000] + f"\n\n...(truncated, {len(rendered) - 4000} more chars)"
    return (rendered, output_is_error)
