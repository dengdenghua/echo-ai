"""Echo browser automation plugin, including headless and live browsers."""

from runtime.platform.plugins.bundled._automation import AutomationPlugin as _AutomationPlugin


class BrowserControlPlugin(_AutomationPlugin):
    name = "browser_control"
    version = "0.1.0"
    description = "浏览器控制：Playwright、内置浏览器与扩展 Relay"
    author = "Echo"
    groups = frozenset({"browser", "browser_act"})

    def collect_skills(self, registry, groups):
        if "browser" in groups:
            from runtime.execution.suckers.browser_skills import register_browser_skills

            # Registration can occur inside a live agent session. Golden tests
            # must run in the test suite, not against that session's browser.
            register_browser_skills(registry, verify_tests=False)
        if "browser_act" in groups:
            from runtime.execution.suckers.browser_act_skills import register_browser_act_skills

            register_browser_act_skills(registry)
