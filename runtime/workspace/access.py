"""Canonical tenant and membership checks shared by workspace read surfaces."""

from fastapi import HTTPException

from runtime.safety.auth.principal import CurrentPrincipal
from runtime.safety.auth.scope import scope_from_principal
from runtime.workspace.model import Workspace
from runtime.workspace.store import WorkspaceStore


def authorized_workspace(
    store: WorkspaceStore,
    workspace_id: str,
    principal: CurrentPrincipal | None,
    *,
    action: str = "read",
    operator_without_membership: bool = False,
) -> Workspace:
    operator = principal is not None and bool(principal.roles.intersection({"admin", "operator"}))
    scoped = (
        store.with_scope(scope_from_principal(principal, allow_cross_tenant=operator))
        if principal
        else store
    )
    workspace = scoped.get_workspace(workspace_id)
    if workspace is None:
        raise HTTPException(404, "workspace unavailable")
    if principal is None:
        return workspace
    explicit_tenant = any(
        value and not value.startswith("legacy:")
        for value in (workspace.tenant_id, principal.tenant_id)
    )
    if explicit_tenant and workspace.tenant_id != principal.tenant_id and not operator:
        raise HTTPException(404, "workspace unavailable")
    role = scoped.get_member_role(workspace_id, principal.actor_id)
    if role is None and not (operator and operator_without_membership):
        raise HTTPException(404, "workspace unavailable")
    if action == "write" and role not in {"owner", "editor"} and not operator:
        raise HTTPException(403, "workspace write membership required")
    if action == "admin" and role != "owner" and not operator:
        raise HTTPException(403, "workspace owner or operator role required")
    return workspace
