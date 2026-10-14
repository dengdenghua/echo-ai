"""Revocable ownership for existing automation skill implementations."""

from __future__ import annotations

from functools import wraps
from threading import Event, RLock
from typing import Any

from runtime.execution.suckers.registry import Skill, SkillRegistry
from runtime.platform.plugins.automation import AUTOMATION_GROUPS
from runtime.platform.plugins.plugin_base import ModuleContext, ModulePlugin


class AutomationPlugin(ModulePlugin):
    groups: frozenset[str] = frozenset()

    def __init__(self) -> None:
        self._generation = Event()
        self._registration_lock = RLock()
        self._owned: dict[str, Skill] = {}

    @property
    def active(self) -> bool:
        return self._generation.is_set()

    def cancellation_check(self):
        """Capture this activation; reenabling never revives an old operation."""
        generation = self._generation
        return lambda: not generation.is_set() or not self.permitted_groups()

    def permitted_groups(self) -> frozenset[str]:
        from runtime.platform.runtime_policy.capabilities import load

        runtime = getattr(self.ctx.skill_registry, "automation_runtime", None)
        allowed = runtime.allowed_groups if runtime is not None else AUTOMATION_GROUPS
        return self.groups & allowed - load().disabled_skill_groups()

    def register_skills(self) -> None:
        with self._registration_lock:
            self._register_skills()

    def _register_skills(self) -> None:
        if self.active:
            return
        groups = self.permitted_groups()
        if not groups:
            raise RuntimeError(f"{self.name} is disabled by host automation settings")
        if self.ctx.skill_registry is None:
            raise RuntimeError("automation requires a host SkillRegistry")
        self._generation = Event()
        staging = SkillRegistry()
        self.collect_skills(staging, groups)
        try:
            for name in staging.all_names():
                self.add_skill(staging.get(name))
            self._generation.set()
        except Exception:
            self.on_stop(self.ctx)
            raise

    def collect_skills(self, registry: SkillRegistry, groups: frozenset[str]) -> None:
        raise NotImplementedError

    def add_skill(self, skill: Skill) -> None:
        if skill.name in self._owned:
            return
        generation = self._generation

        @wraps(skill.handler)
        def guarded(*args: Any, **kwargs: Any) -> Any:
            if not generation.is_set() or not self.permitted_groups():
                raise RuntimeError(f"{self.name} is disabled; this tool invocation was revoked")
            return skill.handler(*args, **kwargs)

        owned = skill.model_copy(update={"handler": guarded})
        registry = self.ctx.skill_registry
        registry.register(owned, verify_tests=False)
        self._owned[owned.name] = owned

        def dispose() -> None:
            # Do not delete a replacement installed by another owner.
            if registry.has(owned.name) and registry.get(owned.name) is owned:
                registry.unregister(owned.name)

        self.ctx.register_cleanup(dispose, capability_type="skill", name=owned.name)

    def on_start(self, ctx: ModuleContext) -> None:
        self.register_skills()

    def on_stop(self, ctx: ModuleContext) -> None:
        with self._registration_lock:
            self._generation.clear()
            ctx.cleanup_registrations()
            self._owned.clear()

    def on_unload(self, ctx: ModuleContext) -> None:
        self.on_stop(ctx)
