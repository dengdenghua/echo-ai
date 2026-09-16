"""Bind temporary roles to the configured host member engine."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any


def make_host_ephemeral_runner(stack: Any):
    from runtime.execution.parallel_agents.stack_runner import member_execution_backend

    if member_execution_backend(stack, None) == "native":

        def run_native(call):
            from runtime.execution.suckers.ephemeral_runner import make_llm_ephemeral_runner

            planner = getattr(stack, "planner", None)
            router = getattr(planner, "router", None)
            if router is None:
                raise RuntimeError("native temporary roles require a model router")

            runner = make_llm_ephemeral_runner(
                router,
                registry=stack.executor.registry,
                default_model=getattr(planner, "planner_model", None),
            )
            return runner(call)

        return run_native

    def run(call):
        from runtime.execution.opencode_roles import run_role_sync
        from runtime.execution.suckers.layers import EPHEMERAL_MEMORY_SKILLS, select_tool_specs
        from runtime.safety.approval.cancellation import current_cancellation_token

        context = dict(call.context or {})
        raw = context.get("tool_allowlist", call.role.tool_allowlist)
        allowlist = (
            tuple(str(name).strip() for name in raw) if isinstance(raw, (list, tuple, set)) else ()
        )
        # Reuse the temporary-role selector: empty means atomic inheritance,
        # blackboard tools are included, and read-only filtering happens last.
        specs = select_tool_specs(
            allowlist,
            [SimpleNamespace(name=name) for name in stack.executor.registry.list_enabled()],
            read_only=bool(context.get("tool_allowlist_read_only")),
        )
        ceiling = frozenset(spec.name for spec in specs) - EPHEMERAL_MEMORY_SKILLS
        agent = SimpleNamespace(
            agent_id=call.role.id,
            display_name=call.role.display_name,
            soul=call.composed_system_prompt,
            model=None,
            arms=(),
            extra_skills=tuple(ceiling),
            capabilities={"execution_backend": "opencode_server"},
        )
        cancellation = current_cancellation_token()
        from runtime.execution.subagents.opencode_progress import progress_emitter

        emit = progress_emitter(call.role.id, context)

        return run_role_sync(
            stack,
            agent,
            call.user_prompt,
            context=context,
            interrupted=lambda: cancellation.is_cancelled,
            tool_ceiling=ceiling,
            on_event=emit,
        )

    run.execution_backend = "opencode_server"
    return run
