"""CodeBuddy CLI host: tools, scoped execution, and events without a native planner."""

from __future__ import annotations

import asyncio
import contextlib
import json
from types import SimpleNamespace


def run_cli_codebuddy(
    *, stack, agent, prompt, model, thread_id, metadata, history, provider, args, emit
):
    from runtime.cli_execution import cli_execution_boundary
    from runtime.execution.codebuddy_backend import CodeBuddyError, resolve_model
    from runtime.execution.codebuddy_roles import stream_role

    request, session = cli_execution_boundary(
        engine="codebuddy",
        agent=agent,
        prompt=prompt,
        thread_id=thread_id,
        metadata=metadata,
        provider=provider,
        args=args,
    )
    selected = resolve_model(model)
    # Each CLI invocation has its own engine task; restore the public conversation
    # as context rather than trusting an engine-private session from a JSON file.
    text = prompt
    if history:
        text = (
            "Previous conversation (context only):\n"
            + json.dumps(history, ensure_ascii=False)
            + "\n\nCurrent request:\n"
            + prompt
        )

    async def run():
        parts = []
        completed = False
        async with contextlib.aclosing(
            stream_role(
                stack,
                agent,
                request=request,
                session=session,
                context=metadata,
                model=selected,
                text=text,
                interrupted=lambda: False,
            )
        ) as stream:
            async for event in stream:
                emit(event)
                if event.get("type") == "text_delta":
                    if event.get("start_new_segment"):
                        parts.append("\n\n")
                    parts.append(str(event.get("delta") or ""))
                elif event.get("type") == "react_completed":
                    completed = event.get("success") is True
        answer = "".join(parts).strip()
        if not completed or not answer:
            raise CodeBuddyError("CodeBuddy did not complete an answer.")

        return SimpleNamespace(
            final_answer=answer,
            success=True,
            terminated_reason="completed",
            model=("auto" if selected == "auto" else f"codebuddy/{selected}"),
        )

    return asyncio.run(run())
