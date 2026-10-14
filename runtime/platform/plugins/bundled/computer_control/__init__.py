"""Echo desktop control plugin; retains the public computer_* tool names."""

from runtime.platform.plugins.bundled._automation import AutomationPlugin as _AutomationPlugin


class ComputerControlPlugin(_AutomationPlugin):
    name = "computer_control"
    version = "0.1.0"
    description = "电脑控制：截图、鼠标键盘、语义 UI 自动化与视觉循环"
    author = "Echo"
    groups = frozenset({"computer"})

    def collect_skills(self, registry, groups):
        from runtime.execution.suckers.computer_skills import register_computer_skills

        register_computer_skills(registry, verify_tests=False)
        runtime = getattr(self.ctx.skill_registry, "automation_runtime", None)
        if runtime is not None and runtime.vision_planner is not None:
            from runtime.execution.suckers.computer_use_loop import register_computer_use_loop

            register_computer_use_loop(
                registry,
                runtime.vision_planner,
                journal=runtime.journal,
                cancellation_check=self.loop_cancellation_check(),
            )

    def loop_cancellation_check(self):
        generation = self._generation
        return lambda: not generation.is_set() or not self.permitted_groups()

    def register_vision_loop(self):
        from runtime.execution.suckers.computer_use_loop import make_computer_use_loop_skill

        with self._registration_lock:
            runtime = self.ctx.skill_registry.automation_runtime
            if self.active and self.permitted_groups() and runtime.vision_planner is not None:
                self.add_skill(
                    make_computer_use_loop_skill(
                        runtime.vision_planner,
                        journal=runtime.journal,
                        cancellation_check=self.loop_cancellation_check(),
                    )
                )
