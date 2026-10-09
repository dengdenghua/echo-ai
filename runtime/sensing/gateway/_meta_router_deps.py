"""Shared inputs for the meta router's endpoint groups.

Pure structural split of ``meta_router.create_meta_router`` — no logic
changes. The factory builds one ``MetaRouterDeps`` from its keyword arguments
and its ``_require_admin`` closure and passes it to every register group.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class MetaRouterDeps:
    """The factory's injected values plus its admin-check closure."""

    registry: Any
    tool_registry: Any
    mobile_skills_root: Path | str | None
    oct_config: Any
    local_auth_config: Any
    identity_store: Any
    jwt_secret: str | None
    jwt_issuer: str | None
    jwt_audience: str | None
    require_auth: bool
    feedback_path: Path
    skill_library_dirs: list[Path]
    require_admin: Callable[..., None]
