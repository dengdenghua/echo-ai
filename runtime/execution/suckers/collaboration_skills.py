"""One shared tool surface for native, Codex and OpenCode group execution."""

from .registry import Skill


def register_collaboration_skills(registry, service) -> None:
    registry.coordination = service
    for name in registry.all_names():
        resource = getattr(registry.get(name), "exclusive_resource", None)
        if resource and not resource.endswith(":read"):
            service.resources.add(resource)
    registry.register(
        Skill(
            name="collaboration",
            summary="Group task discovery, messages and versioned handoffs.",
            description=service.tool.__doc__ or "Coordinate authorized group tasks.",
            affinity=["collaboration", "meta", "write"],
            trusted_source="builtin://collaboration",
            handler=service.tool,
        ),
        replace=True,
    )
