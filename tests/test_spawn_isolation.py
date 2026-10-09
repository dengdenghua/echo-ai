"""Per-spawn filesystem isolation · the trusted ``isolate`` switch.

A fan-out that WROTE files used to have all lanes editing one checkout. The
industry position is uniform on this point: no vendor runs parallel writers
against a shared tree.

``_call_agent_parallel`` forwards ``isolate`` to ``call_subagent(isolate=True)``;
the bridge then creates the worktree on the trusted side
(``isolated_worktree_scope``), runs the child there, exports its patch before
the checkout is removed, and fails the lane closed when isolation is
unavailable. The end-to-end git behaviour lives in ``test_isolated_subagent``;
this file pins the fan-out contract around it.

``isolate`` is deliberately a BOOLEAN, not a path. ``workspace`` sits in
``MODEL_PROTECTED_CONTEXT_PREFIXES`` so a model cannot aim write-confinement at
a directory of its choosing; this switch must not become a way around that.
"""

from __future__ import annotations

import contextlib
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from runtime.execution.subagents import bridge
from runtime.execution.suckers import delegation_skills as ds


@pytest.fixture(autouse=True)
def _installed_roles(installed_hub_roles: Any) -> None:
    """Fan-out only targets installed HUB roles."""
    installed_hub_roles("researcher")


def _spec(**over: Any) -> dict[str, Any]:
    base = {"agent_id": "researcher", "prompt": "do it"}
    base.update(over)
    return base


def _counting_runner(monkeypatch: Any) -> list[str]:
    """Install a persistent runner so lanes travel the REAL ``call_subagent``."""
    prompts: list[str] = []

    def runner(prompt: str, *, subagent_name: str, context: dict[str, Any]) -> str:
        prompts.append(prompt)
        return "ok"

    monkeypatch.setattr(bridge, "_RUNNER", runner)
    return prompts


# ── the flag reaches the spawn as a bool, never as a path ──────────


def test_plain_spec_passes_no_workspace_path(monkeypatch: Any) -> None:
    """Unisolated lanes must be byte-for-byte unchanged: a worktree per read-only
    worker would cost a checkout for nothing.
    """
    seen: dict[str, Any] = {}

    def fake_call(**kw: Any) -> dict[str, Any]:
        seen.update(kw)
        return {"success": True, "output": "ok", "agent_id": "researcher"}

    monkeypatch.setattr("runtime.execution.subagents.call_subagent", fake_call)
    ds._call_agent_parallel(specs=[_spec()])
    assert seen, "the lane never reached call_subagent"
    assert "workspace_path" not in seen
    assert "isolate" not in seen


def test_isolated_spec_is_forwarded_to_the_bridge_as_a_bool(monkeypatch: Any) -> None:
    """The fan-out never picks a directory itself; the bridge creates the
    worktree on the trusted side. A truthy string must arrive as ``True``."""
    seen: dict[str, Any] = {}

    def fake_call(**kw: Any) -> dict[str, Any]:
        seen.update(kw)
        return {"success": True, "output": "ok", "agent_id": "researcher"}

    monkeypatch.setattr("runtime.execution.subagents.call_subagent", fake_call)

    ds._call_agent_parallel(specs=[_spec(isolate="/etc", bb_key="writer")])
    assert seen.get("isolate") is True
    assert "workspace_path" not in seen
    assert "/etc" not in str(seen.get("context") or {})


def test_the_diff_survives_the_envelope_projection(monkeypatch: Any) -> None:
    """Found live, not by a stub: ``_build_parallel_envelope`` is a WHITELIST
    projection, so ``isolated`` / ``diff`` were dropped on the way out. The
    worktree was created, written and cleaned up correctly, but the caller got
    nothing back - isolation silently meant "discard the work".

    ``files_touched`` masked it, because ``common`` already projected that one.
    So this asserts on the ENVELOPE entry, fed the bridge's export shape.
    """
    monkeypatch.setattr(
        "runtime.execution.subagents.call_subagent",
        lambda **_kw: {
            "success": True,
            "output": "edited",
            "agent_id": "researcher",
            "isolated": True,
            "retry_allowed": False,
            "diff": "diff --git a/probe b/probe\n+new line",
            "files_touched": ["probe"],
        },
    )

    env = ds._call_agent_parallel(specs=[_spec(isolate=True, bb_key="w")])
    succ = env["successes"][0]
    assert succ.get("isolated") is True, "isolation flag lost in the envelope"
    assert "diff --git" in str(succ.get("diff") or ""), "the diff never reached the caller"
    assert succ["files_touched"] == ["probe"]
    # Audit F-08: the worktree branch is deleted right after capture, so it
    # must NOT ride out in the envelope as a stale/misleading identifier.
    assert "branch" not in succ, "stale branch leaked into the envelope"


def test_graph_node_surfaces_its_isolated_diff(monkeypatch: Any) -> None:
    """The graph's per-node result dict is a whitelist projection too."""

    def fake_parallel(specs: Any = None, **_kw: Any) -> dict[str, Any]:
        return {
            "ok": True,
            "successes": [
                {
                    "bb_key": specs[0]["bb_key"],
                    "spec_index": 0,
                    "agent_id": "implementer",
                    "output": "done",
                    "isolated": True,
                    "branch": "octo/wt-spawn-w",
                    "diff": "diff --git a/f b/f",
                    "files_touched": ["f"],
                }
            ],
            "failures": [],
        }

    monkeypatch.setattr(ds, "_call_agent_parallel", fake_parallel)
    out = ds._run_agent_graph(nodes=[{"id": "w", "prompt": "edit it", "isolate": True}])
    node = out["nodes"]["w"]
    assert node.get("isolated") is True
    assert "diff --git" in str(node.get("diff") or "")
    assert node.get("files_touched") == ["f"]


def test_diff_is_captured_before_the_worktree_is_removed(monkeypatch: Any) -> None:
    """The isolated scope DELETES the tree on exit. Exporting the patch after the
    scope would silently turn isolation into "discard the work".
    """
    order: list[str] = []
    prompts = _counting_runner(monkeypatch)

    def export(result: dict[str, Any], *, cancelled: bool) -> dict[str, Any]:
        order.append("capture")
        return {**result, "isolated": True, "diff": "diff --git a/f b/f", "files_touched": ["f"]}

    @contextlib.contextmanager
    def fake_scope(_parent: Any, **_kw: Any) -> Any:
        order.append("enter")
        try:
            yield SimpleNamespace(
                path=Path("wt-probe"),
                session=None,
                contract=SimpleNamespace(output_paths=()),
                export=export,
            )
        finally:
            order.append("exit")

    monkeypatch.setattr(
        "runtime.execution.subagents.isolated_worktree.isolated_worktree_scope", fake_scope
    )

    env = ds._call_agent_parallel(specs=[_spec(isolate=True)])
    assert order == ["enter", "capture", "exit"]
    assert len(prompts) == 1 and "wt-probe" in prompts[0]
    assert env["successes"][0]["isolated"] is True


# ── fail closed, never silently unisolated ─────────────────────────


def test_unavailable_isolation_fails_the_lane_instead_of_writing_live(
    monkeypatch: Any,
) -> None:
    """Running unisolated because a worktree was unavailable would do the exact
    opposite of what the caller asked for. With no host-scoped task to own a
    worktree, the real bridge must refuse to spawn at all.
    """
    prompts = _counting_runner(monkeypatch)

    env = ds._call_agent_parallel(specs=[_spec(isolate=True)])
    assert prompts == [], "spawned into the live tree despite isolate"
    assert env["successes"] == []
    failure = env["failures"][0]
    assert failure["status"] == "isolation_failed"
    assert failure["retry_allowed"] is False


def test_isolation_failure_degrades_one_lane_not_the_batch(monkeypatch: Any) -> None:
    """A git/filesystem OSError in one lane must leave siblings' results intact."""
    prompts = _counting_runner(monkeypatch)

    def boom(_parent: Any, **_kw: Any) -> Any:
        raise OSError("git worktree add failed: disk full")

    monkeypatch.setattr(
        "runtime.execution.subagents.isolated_worktree.isolated_worktree_scope", boom
    )

    env = ds._call_agent_parallel(specs=[_spec(isolate=True), _spec(prompt="read only")])
    assert env["ok"] is True, "one isolation failure sank the whole batch"
    assert len(env["successes"]) == 1
    assert len(env["failures"]) == 1
    assert "disk full" in env["failures"][0]["error"]
    assert len(prompts) == 1 and "read only" in prompts[0]


# ── the security boundary this must not weaken ─────────────────────


def test_model_supplied_workspace_path_is_still_stripped() -> None:
    """The reason ``isolate`` is a bool: a model naming its own confinement dir
    would defeat the point. That guard must keep holding.
    """
    from runtime.safety.auth.arg_guard import is_model_protected_context_key

    assert is_model_protected_context_key("workspace_path") is True


@pytest.mark.parametrize("key", ["workspace_path", "workspaceRoot", "workspace"])
def test_workspace_keys_remain_protected(key: str) -> None:
    from runtime.safety.auth.arg_guard import is_model_protected_context_key

    assert is_model_protected_context_key(key) is True


def test_isolate_is_coerced_to_bool_not_passed_through() -> None:
    """A truthy string must not become a path-like value downstream."""
    from runtime.execution.suckers._delegation_skills_parallel import (
        _coerce_parallel_specs,
    )

    specs = _coerce_parallel_specs([{"agent_id": "researcher", "prompt": "x", "isolate": "/etc"}])
    assert specs is not None
    # The cleaner runs inside _call_agent_parallel; here we only assert the raw
    # spec survives coercion so the bool() at the cleaning site is what decides.
    assert specs[0]["isolate"] == "/etc"
