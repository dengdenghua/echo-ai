"""One set of existing workspace stores and live hints per application."""

from runtime.platform.io.lease import LeaseStore
from runtime.platform.process.invalidation_feed import InvalidationFeed
from runtime.sensing.server.mount_backend import default_registry
from runtime.workspace.store import WorkspaceStore

from ._app_context import AppContext


def ensure_workspace_services(ctx: AppContext) -> None:
    # Retain the existing stores' default paths; do not silently move leases.
    if ctx.workspace_store is None:
        ctx.workspace_store = WorkspaceStore()
    if ctx.workspace_leases is None:
        ctx.workspace_leases = LeaseStore()
    if ctx.workspace_mounts is None:
        ctx.workspace_mounts = default_registry
    if ctx.workspace_updates is None:
        ctx.workspace_updates = InvalidationFeed(
            "workspace:changed", ctx.shared_realtime, scoped=True
        )
