"""Shared closures for the evolution operator-console router.

Pure structural split of ``evolution_ops_router.create_evolution_ops_router``
— no logic changes. The factory still defines the auth, tenant-scope, journal
and suppression closures; this bundle hands those same objects to every
``_register_*`` endpoint group (so the per-router suppressed-proposal state
stays shared).
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class EvolutionOpsDeps:
    """Injected stores plus the factory's closures, shared by every group."""

    journal: Any
    registry: Any
    planner: Any
    planner_provider: Any
    get_planner: Callable[[], Any]
    require_forge_dependencies: Callable[[], Path]
    require_actor: Callable[[Any], str | None]
    tenant_scope: Callable[..., Any]
    request_journal: Callable[..., tuple[Any, Any]]
    projection_dependencies: Callable[[Any], tuple[Any, Any, Any]]
    journal_write_context: Callable[[Any], AbstractContextManager[Any]]
    suppressed_names: Callable[[Any], set[str]]
