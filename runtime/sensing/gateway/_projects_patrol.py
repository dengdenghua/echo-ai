"""Owner-scoped daily project attention, backed by scheduled sealed events."""

import json
from datetime import datetime
from uuid import NAMESPACE_URL, uuid5

from fastapi import APIRouter, Request
from pydantic import BaseModel

from runtime.projectos.patrol_service import current_patrol_notices
from runtime.safety.auth.scope import TenantScope

from ._projects_router_deps import ProjectsDeps


class ProjectPatrolNotice(BaseModel):
    id: str
    project_id: str
    name: str


class ProjectPatrolResponse(BaseModel):
    day: str
    digest_id: str
    notices: list[ProjectPatrolNotice]


def register_project_patrol(router: APIRouter, d: ProjectsDeps) -> None:
    @router.get("/api/project-attention")
    def project_attention(request: Request) -> ProjectPatrolResponse:
        principal = d.principal(request)
        # Operator access elsewhere is intentionally broader; personal notices
        # are always restricted to this actor in this tenant.
        store = d.project_store
        audience = "local"
        if principal is not None:
            store = store.with_scope(
                TenantScope(tenant_id=principal.tenant_id, actor_id=principal.actor_id)
            )
            audience = json.dumps([principal.tenant_id, principal.actor_id])
        now = datetime.now().astimezone()
        day = now.date().isoformat()
        return ProjectPatrolResponse(
            day=day,
            digest_id=uuid5(NAMESPACE_URL, f"echo-patrol-digest:{audience}:{day}").hex,
            notices=current_patrol_notices(store, now=now),
        )
