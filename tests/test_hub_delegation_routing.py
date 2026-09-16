import pytest

from runtime.protocol.items import TurnParams
from runtime.sensing.gateway._realtime_react_stream_helpers import _should_use_direct_text_path
from runtime.sensing.gateway.realtime_turn_routing import (
    looks_like_plain_chat,
    looks_like_tool_intent,
)


@pytest.mark.parametrize("text", [
    "请调用 echo_call_agent，agent_id=twin_health。子任务只返回结果，不要搜索或写文件。",
    "派生 HUB 已安装角色，只回复一句话，不需要搜索。",
    "请用原生工具 query_skill 查询 call_agent 的 installed_roles。",
    "Delegate a subagent; only reply with the result, no search.",
])
@pytest.mark.parametrize("mode", ["chat", "code", "react"])
def test_delegation_keeps_host_tools_with_child_reply_constraints(text, mode):
    params = TurnParams.model_validate({
        "threadId": "hub-routing-test",
        "input": [{"type": "text", "text": text, "metadata": {"context": {"mode": mode}}}],
    })
    assert not looks_like_plain_chat(text)
    assert looks_like_tool_intent(text)
    assert not _should_use_direct_text_path(text, params)


@pytest.mark.parametrize("text", [
    "不要调用 call_agent，只回复你好。",
    "不要委派子任务，直接回复结果。",
    "Do not delegate a subagent; only reply with hello.",
])
def test_explicit_no_delegation_stays_text_only(text):
    assert looks_like_plain_chat(text)
    assert not looks_like_tool_intent(text)
