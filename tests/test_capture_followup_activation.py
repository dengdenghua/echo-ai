import pytest

from runtime.core.cerebrum.capability_router import activate_capabilities


class Registry:
    def has(self, name):
        return name in {"computer_uia_find", "screen_capture", "computer_observe"}

    def is_enabled(self, name):
        return True


@pytest.mark.parametrize(
    "goal",
    [
        "独立回读验收，不再执行键鼠或修改文档。观察 Echo-Input-OS8.txt 的编辑区并调用 screen_capture，path=验收.png。",
        "请截取当前记事本窗口截图，核对中文输入结果",
        "桌面截图回读验收",
        "Capture a desktop screenshot of the test editor",
    ],
)
def test_screenshot_followup_keeps_desktop_observation_tools(goal):
    activation = activate_capabilities(goal, registry=Registry())
    assert "computer_uia_find" in activation.priority_skills
    assert "screen_capture" in activation.priority_skills


def test_capture_does_not_reenable_disabled_tool():
    class Disabled(Registry):
        def is_enabled(self, name):
            return name != "computer_uia_find"

    activation = activate_capabilities("screen_capture 截图回读", registry=Disabled())
    assert "computer_uia_find" not in activation.priority_skills


def test_desktop_mode_keeps_screen_tools_without_adding_browser_tools():
    from runtime.core.cerebrum.capability_router import filter_surface_compatible_skills

    names = ["screen_capture", "screen_info", "browser_click", "live_browser_navigate"]
    assert filter_surface_compatible_skills(
        names, user_context={"mode": "desktop"}, goal="continue"
    ) == ["screen_capture", "screen_info"]
    assert (
        filter_surface_compatible_skills(names, user_context={}, goal="summarize these documents")
        == []
    )
