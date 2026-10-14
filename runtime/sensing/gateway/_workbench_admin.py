"""Admin gate for machine-wide workbench and cloud plugin lifecycle changes.

Workbench packages and cloud plugins install into the instance data root and
serve every account on this machine. Installing, updating, enabling, disabling,
rolling back or removing one is therefore an instance-admin action, including
on the local desktop posture that lets any signed-in account manage agents and
skills. With authentication off (single-user loopback) the gate is a no-op,
exactly like :func:`runtime.safety.auth.principal.require_roles`.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import HTTPException, Request

from runtime.safety.auth.principal import require_roles

WORKBENCH_ADMIN_REQUIRED = "只有管理员可以安装或移除工作台，请联系本机管理员。"


def require_workbench_admin(
    request: Any,
    identity_store: Any,
    require_auth: bool,
    *,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
) -> None:
    """Require the ``admin`` role, answering a refusal with a sentence people can act on.

    Roles come from the same credential authentication reads (bearer header,
    WebSocket bearer or the HttpOnly session cookie), so a browser signed in
    with the cookie alone is judged by its real roles.
    """
    try:
        require_roles(
            request,
            identity_store,
            require_auth,
            ("admin",),
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )
    except HTTPException as exc:
        if exc.status_code != 403:
            raise
        raise HTTPException(403, WORKBENCH_ADMIN_REQUIRED) from exc


def workbench_admin_dependency(
    identity_store: Any,
    require_auth: bool,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
) -> Callable[[Request], None]:
    """A FastAPI dependency bound to one router's auth configuration."""

    def _dependency(request: Request) -> None:
        require_workbench_admin(
            request,
            identity_store,
            require_auth,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )

    return _dependency


__all__ = [
    "WORKBENCH_ADMIN_REQUIRED",
    "require_workbench_admin",
    "workbench_admin_dependency",
]
