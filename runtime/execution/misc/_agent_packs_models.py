"""Public data types for agent-pack previews and imports."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


class AgentPackAgentNotFound(ValueError):
    """Raised when a requested agent is not present in a scanned pack."""


@dataclass(frozen=True)
class PackModule:
    id: str
    kind: str
    name: str
    path: str
    description: str = ""
    source_plugin: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AgentPackPreview:
    root: str
    marketplace: dict[str, Any] | None
    plugins: list[PackModule]
    apps: list[PackModule]
    agents: list[PackModule]
    skills: list[PackModule]
    commands: list[PackModule]
    mcp_servers: list[PackModule]
    managed_agents: list[PackModule]
    subagents: list[PackModule]
    warnings: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class AgentPackImportResult:
    agent_id: str
    agent_name: str
    agent_path: str
    copied_skills: list[str]
    skipped_skills: list[str]
    warnings: list[str]
    already_exists: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
