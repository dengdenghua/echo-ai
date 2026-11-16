"""Exercise the async client-to-sync approval outcome bridge."""
import asyncio

import pytest

from runtime.safety.approval.approval_gate import ApprovalRequest
from runtime.sensing.gateway.realtime_approval import GatewayApprovalProvider


@pytest.mark.asyncio
@pytest.mark.parametrize("action,reason,approved,expected", [
    ("decline", "timeout", False, "timeout"),
    ("decline", "connection_lost", False, "connection_lost"),
    ("decline", "untrusted custom reason", False, "decline"),
    ("decline", {"invalid": True}, False, "decline"),
    ("accept", "timeout", True, "accept"),
])
async def test_client_lifecycle_reason_is_preserved(action, reason, approved, expected):
    class Emitter:
        async def request_approval(self, method, params, *, timeout):
            return {"action": action, "reason": reason}

    records = []
    class Trace:
        def record_approval(self, **kwargs):
            records.append(kwargs)

    provider = GatewayApprovalProvider(Emitter(), asyncio.get_running_loop(),
        thread_id="qa-thread", turn_id="qa-turn", trace_store=Trace())
    request = ApprovalRequest(thread_id="qa-thread", tool_name="computer_uia_find",
        tool_call_id="qa-call", args_preview="test editor", detail="QA only")
    decision = await asyncio.to_thread(provider.request, request)
    assert decision.approved is approved
    assert decision.reason == expected
    assert records[0]["reason"] == expected
    assert records[0]["decision"] == (expected if not approved and expected != "decline" else "approved" if approved else "rejected")
