import pytest
from runtime.core.cerebrum.capability_router import activate_capabilities

class Registry:
    def has(self, name):
        return name in {"computer_observe", "computer_uia_status", "screen_info"}
    def is_enabled(self, name):
        return True

@pytest.mark.parametrize("prompt", [
    "电脑控制连接验收，不执行鼠标键盘动作",
    "仅调用 computer_observe，capture=false、uia=false",
    "你操控下我的电脑测试一下",
    "只观察桌面状态，不截图",
])
def test_explicit_computer_requests_expose_observation_tools(prompt):
    result = activate_capabilities(prompt, registry=Registry())
    assert "desktop-ui" in result.labels
    assert "computer_observe" in result.priority_skills


def test_mouse_keyboard_limit_does_not_disable_observation_tools():
    from runtime.sensing.gateway.realtime_turn_routing import looks_like_plain_chat, looks_like_tool_intent
    prompt = "电脑控制连接验收：仅调用 computer_observe，参数 capture=false、uia=false。不要执行鼠标键盘动作。请报告工具返回的实际连接地址和 ok 状态。"
    assert not looks_like_plain_chat(prompt)
    assert looks_like_tool_intent(prompt)

@pytest.mark.parametrize("prompt", [
    "不要执行工具，请解释 computer_observe 的含义。",
    "不要调用外部工具，只回复一句话。",
    "Do not use tools. Explain computer_observe.",
])
def test_explicit_no_tool_request_still_stays_text_only(prompt):
    from runtime.sensing.gateway.realtime_turn_routing import looks_like_plain_chat
    assert looks_like_plain_chat(prompt)


@pytest.mark.parametrize("prompt", [
    "请点击中文输入框，执行时不需要每一步截图，最后统一 UIA 回读。",
    "不要截图，请用 computer_uia_find 查找输入框并预览单击。",
    "不用浏览器，读取本地 README.md。",
    "No screenshot, click the text field and press Tab.",
])
def test_scoped_surface_limit_does_not_remove_requested_action_tools(prompt):
    from runtime.sensing.gateway.realtime_turn_routing import looks_like_plain_chat, looks_like_tool_intent
    assert not looks_like_plain_chat(prompt)
    assert looks_like_tool_intent(prompt)


@pytest.mark.parametrize("prompt", [
    "不要使用任何工具，请解释点击输入框的步骤。",
    "Don't use any tools. Explain how to click the text field.",
    "不要截图。",
])
def test_global_prohibition_and_pure_negative_request_remain_text_only(prompt):
    from runtime.sensing.gateway.realtime_turn_routing import looks_like_plain_chat
    assert looks_like_plain_chat(prompt)


@pytest.mark.parametrize("mode", ["chat", "code", "react"])
def test_computer_observation_keeps_external_engine_tools(mode):
    from runtime.protocol.items import TurnParams
    from runtime.sensing.gateway._realtime_react_stream_helpers import _should_use_direct_text_path

    prompt = "电脑控制连接验收：仅调用 computer_observe，capture=false、uia=false。不要执行鼠标键盘动作。请报告工具返回的实际地址。"
    params = TurnParams.model_validate({
        "threadId": "computer-observe-routing",
        "input": [{"type": "text", "text": prompt, "metadata": {"context": {"mode": mode}}}],
    })
    assert not _should_use_direct_text_path(prompt, params)
