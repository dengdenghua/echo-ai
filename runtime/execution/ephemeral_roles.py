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
        from runtime.safety.approval.cancellation import current_cancellation_token

        context = dict(call.context or {})
        agent = SimpleNamespace(
            agent_id=call.role.id,
            display_name=call.role.display_name,
            soul=call.composed_system_prompt,
            model=None,
            arms=(),
            extra_skills=(),
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
            on_event=emit,
        )

    run.execution_backend = "opencode_server"
    return run
