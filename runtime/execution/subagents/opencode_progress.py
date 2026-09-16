"""Translate member engine events into the existing sub-agent progress channel."""

import json
from types import SimpleNamespace

from runtime.execution.suckers._ephemeral_events import (
    _emit_sub_text_delta,
    _emit_sub_tool_event,
    _safe_ctx_emit,
)


def progress_emitter(role_id, context):
    tool_inputs = {}

    def emit(event):
        emitter = context.get("event_emitter")
        kind = event.get("type")
        if kind == "text_delta":
            _emit_sub_text_delta(role_id, 0, str(event.get("delta") or ""), emitter=emitter)
        elif kind in {"tool_start", "tool_end"}:
            sub_kind = "sub_tool_start" if kind == "tool_start" else "sub_tool_end"
            name = event.get("tool_name") or "tool"
            call_id = event.get("tool_call_id") or ""
            preview = event.get("input_preview")
            try:
                args = preview if isinstance(preview, dict) else json.loads(preview or "{}")
            except (ValueError, TypeError):
                args = {}
            if not isinstance(args, dict):
                args = {}
            if kind == "tool_start":
                tool_inputs[call_id] = args
            else:
                args = tool_inputs.pop(call_id, args)
            output = str(event.get("output_preview") or "")
            failed = kind == "tool_end" and event.get("success") is not True
            _emit_sub_tool_event(
                sub_kind, role_id=role_id,
                tool_call=SimpleNamespace(id=call_id, name=name, input=args),
                iteration=0, output=output if kind == "tool_end" else None, is_error=failed,
            )
            _safe_ctx_emit(emitter, {
                "type": sub_kind, "agent_id": role_id, "round": 0,
                "skill": name, "tool_call_id": call_id,
                "args": args, "execution_engine": "opencode",
                "status": "started",
                "args_preview": event.get("input_preview") or "",
                **({"status": "failed" if failed else "success", "output_preview": output[:1000]}
                   if kind == "tool_end" else {}),
            })
    return emit
