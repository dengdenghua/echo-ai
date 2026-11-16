import pytest

from runtime.core.cerebrum.capability_router import (
    activate_capabilities,
    filter_surface_compatible_skills,
)
from runtime.sensing.gateway.realtime_turn_routing import (
    looks_like_plain_chat,
    looks_like_tool_intent,
)

LIVE_REQUEST = (
    "AI qa7 截图返回验收：请只截取一次当前桌面区域 [300,100,900,500]，"
    "保存为当前工作区相对路径 ai-qa7-live.png。报告返回的完整路径、图片尺寸和文件字节数，"
    "再描述截图里实际可见的界面内容。不要操作鼠标键盘、修改文档或调用其他工具；"
    "图片看不到就如实说明。"
)


class Registry:
    def has(self, name):
        return name in {"screen_capture", "screen_info", "computer_uia_find"}

    def is_enabled(self, name):
        return True


@pytest.mark.parametrize("goal", [
    LIVE_REQUEST,
    "请截取一次当前桌面区域，只回答文件路径，不要操作键盘。",
    "帮我截图，不用浏览器。",
    "截取当前窗口保存到 test.png，不要执行其他工具。",
    "Capture the desktop screenshot. Do not use the browser.",
    "Take a screenshot and only reply with its path.",
])
def test_capture_request_stays_tool_capable_despite_unrelated_action_restrictions(goal):
    assert not looks_like_plain_chat(goal)
    assert looks_like_tool_intent(goal)
    activation = activate_capabilities(goal, registry=Registry())
    assert "desktop-ui" in activation.labels
    assert "screen_capture" in activation.priority_skills
    assert "screen_capture" in filter_surface_compatible_skills(
        ["screen_capture", "screen_info"], user_context={}, goal=goal,
    )


@pytest.mark.parametrize("goal", [
    "不要使用任何工具。请截取当前桌面。",
    "Do not use tools. Take a screenshot.",
    "不要截图，只回答一句话。",
    "桌面截图是什么意思？",
])
def test_global_tool_prohibition_and_explanatory_questions_remain_plain_chat(goal):
    assert looks_like_plain_chat(goal)
    assert not looks_like_tool_intent(goal)
