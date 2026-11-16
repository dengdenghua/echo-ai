"""Optional knowledge application shared by Echo AI and Echo OS."""

from functools import wraps
from pathlib import Path
from threading import Event

from runtime.execution.suckers.registry import SkillRegistry
from runtime.execution.suckers.storage_skills import register_storage_skills
from runtime.platform.plugins.knowledge_storage import ManagedStorage
from runtime.platform.plugins.plugin_base import ModuleContext, ModulePlugin


class KnowledgeStoragePlugin(ModulePlugin):
    name = "knowledge_storage"
    display_name = "知识库"
    version = "0.2.0"
    description = "独立运行的本地知识库，授权目录、建立索引并按来源检索。"
    author = "Echo"

    def on_load(self, ctx: ModuleContext) -> None:
        self.ctx = ctx
        if not ctx.data_dir:
            raise RuntimeError("knowledge plugin requires a host-owned data directory")
        self.service = ManagedStorage(Path(ctx.data_dir))
        self._generation = Event()

    @property
    def active(self) -> bool:
        return self._generation.is_set()

    def on_start(self, ctx: ModuleContext) -> None:
        self.service.start()
        if self.active:
            return
        self._generation = Event()
        generation = self._generation
        staging = SkillRegistry()
        register_storage_skills(staging, requester=self.service.request)
        registry = ctx.skill_registry
        try:
            if registry is not None:
                skill = staging.get("search_documents")

                @wraps(skill.handler)
                def guarded(*args, **kwargs):
                    if not generation.is_set():
                        raise RuntimeError("知识库已停用，此工具调用已撤销")
                    return skill.handler(*args, **kwargs)

                owned = skill.model_copy(update={"handler": guarded})
                registry.register(owned, verify_tests=False, replace=True)

                def dispose():
                    if registry.has(owned.name) and registry.get(owned.name) is owned:
                        registry.unregister(owned.name)

                ctx.register_cleanup(dispose, capability_type="skill", name=owned.name)
            generation.set()
        except Exception:
            self.on_stop(ctx)
            raise

    def on_stop(self, ctx: ModuleContext) -> None:
        self._generation.clear()
        ctx.cleanup_registrations()
        self.service.stop()

    def on_unload(self, ctx: ModuleContext) -> None:
        self.on_stop(ctx)
