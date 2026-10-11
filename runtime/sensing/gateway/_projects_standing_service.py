"""Opt-in standing grants resume through bounded, leased project workers."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from contextlib import asynccontextmanager, suppress
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, Request

from runtime.platform.process.task_supervisor import TaskLeaseConflict
from runtime.projectos.governance import phase_agents_of
from runtime.projectos.http_dispatcher import ProjectHTTPDispatcher
from runtime.projectos.owner_decisions import select_phase
from runtime.projectos.standing_authorization import GRANTED_KIND, REVOKED_KIND
from runtime.projectos.standing_execution import run_reviewed_project
from runtime.projectos.standing_review import standing_authorization_state
from runtime.safety.auth.principal import CurrentPrincipal

from ._projects_router_deps import ProjectsDeps

_LOG = logging.getLogger(__name__)


class StandingProjectService:
    def __init__(
        self,
        deps: ProjectsDeps,
        dispatcher: ProjectHTTPDispatcher,
        identities: Any,
        *,
        interval_seconds: float = 30,
    ):
        self.deps = deps
        self.dispatcher = dispatcher
        self.identities = identities
        self.interval_seconds = max(0.05, interval_seconds)
        self._seen: dict[str, str] = {}
        self._stop = asyncio.Event()

    def _principal(self, project: Any) -> CurrentPrincipal | None:
        if not self.deps.require_auth or not callable(getattr(self.identities, "get", None)):
            return None
        identity = self.identities.get(project.owner_id)
        if identity is None:
            return None
        metadata = identity.metadata or {}
        tenant = str(metadata.get("tenant_id") or f"legacy:{identity.actor_id}")
        if tenant != project.tenant_id or metadata.get("disabled") or metadata.get("suspended"):
            return None
        return CurrentPrincipal(
            actor_id=identity.actor_id,
            tenant_id=tenant,
            roles=frozenset(identity.roles),
            scopes=frozenset(metadata.get("scopes") or ()),
            authn_method="standing_owner_grant",
            request_id=f"standing:{uuid4().hex}",
        )

    def _request(self, app: Any, project: Any) -> Request | None:
        principal = self._principal(project)
        if principal is None:
            return None
        return Request(
            {
                "type": "http",
                "app": app,
                "headers": [],
                "state": {
                    "principal": principal,
                    "project_principal": principal,
                },
            }
        )

    def sweep(self, app: Any) -> int:
        """Read candidates; submit only runnable grants whose work state changed."""
        d = self.deps
        with d.project_store._lock, d.project_store._conn() as conn:
            rows = conn.execute(
                "SELECT e.project_id FROM project_events e WHERE e.kind=? AND e.seq=("
                "SELECT MAX(n.seq) FROM project_events n WHERE n.project_id=e.project_id "
                "AND n.kind IN (?,?))",
                (GRANTED_KIND, GRANTED_KIND, REVOKED_KIND),
            ).fetchall()
        candidates = {row[0] for row in rows}
        self._seen = {key: value for key, value in self._seen.items() if key in candidates}
        submitted = 0
        for project_id in candidates:
            project = d.project_store.get_project(project_id)
            if project is None or project.status not in {"planning", "running"}:
                continue
            request = self._request(app, project)
            if request is None:
                continue
            try:
                grant = standing_authorization_state(
                    d.scoped_store(request),
                    project_id,
                    actor_id=project.owner_id,
                    tenant_id=project.tenant_id,
                )
                if grant is None:
                    continue
                task = self.dispatcher.supervisor.store.get(self.dispatcher.task_id(project))
                if (
                    task
                    and task.metadata.get("http_cancel_requested")
                    and grant["grant_id"]
                    in {
                        task.metadata.get("standing_grant_id"),
                        task.metadata.get("http_cancel_standing_grant_id"),
                    }
                ):
                    continue
                d.require_execution_context(request, project_id)
                state = d.full_state(request, project_id)
                if state.get("governance", {}).get("blocked_reason"):
                    continue
                # Event/log churn and patrol notices must not re-trigger a
                # waiting project. Work state, budget and decisions do.
                observable = {
                    key: state.get(key) for key in ("project", "milestones", "tasks", "governance")
                }
                signature = hashlib.sha256(
                    json.dumps(
                        [grant["grant_id"], observable],
                        sort_keys=True,
                        default=str,
                    ).encode()
                ).hexdigest()
                if self._seen.get(project_id) == signature:
                    continue
                receipt = self.dispatcher.state(project)
                if receipt and receipt["status"] in {"queued", "running"}:
                    continue

                def execute(project=project, grant_id=grant["grant_id"]):
                    current = self._request(app, project)
                    if current is None:
                        raise RuntimeError("standing owner identity is no longer available")
                    d.project_or_404(current, project.id, allow_operator=False)
                    d.require_execution_context(current, project.id)

                    def still_permitted() -> bool:
                        job = self.dispatcher.supervisor.store.get(self.dispatcher.task_id(project))
                        if (
                            job is None
                            or job.metadata.get("standing_grant_id") != grant_id
                            or job.metadata.get("http_cancel_requested")
                            or job.lease is None
                            or job.lease.expired
                            or job.lease.holder_id != self.dispatcher.supervisor.holder_id
                        ):
                            return False
                        refreshed = self._request(app, project)
                        if refreshed is None:
                            return False
                        try:
                            latest = d.project_or_404(refreshed, project.id, allow_operator=False)
                            d.require_execution_context(refreshed, project.id)
                            active = select_phase(
                                latest, d.scoped_store(refreshed).milestones_for(project.id)
                            )
                            agents = phase_agents_of(active) if active is not None else []
                            if not agents or not set(agents).issubset(
                                d.project_roster(refreshed, project.id)
                            ):
                                return False
                        except (HTTPException, PermissionError, ValueError):
                            return False
                        return True

                    with d.project_execution_scope(current, project.id):
                        result = run_reviewed_project(
                            d.execution_engine(current, project.id),
                            project.id,
                            actor_id=project.owner_id,
                            tenant_id=project.tenant_id,
                            grant_id=grant_id,
                            validate_identity=still_permitted,
                        )
                    d.project_to_collaboration(
                        current,
                        project.id,
                        thread_id=d.scoped_store(current).thread_for_project(project.id) or "",
                    )
                    return result

                self.dispatcher.submit(
                    project,
                    execute,
                    thread_id=d.scoped_store(request).thread_for_project(project_id) or "",
                    standing_grant_id=grant["grant_id"],
                )
                self._seen[project_id] = signature
                submitted += 1
            except (HTTPException, PermissionError, ValueError, TaskLeaseConflict, OverflowError):
                # A pending owner decision, changed binding or another worker
                # is ordinary idle state, not a reason to start model work.
                continue
        return submitted

    async def _loop(self, app: Any) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.to_thread(self.sweep, app)
            except Exception:  # noqa: BLE001 — contain one sweep without suppressing its evidence
                _LOG.exception("standing project sweep failed")
            with suppress(TimeoutError):
                await asyncio.wait_for(self._stop.wait(), timeout=self.interval_seconds)

    @asynccontextmanager
    async def lifespan(self, app: Any):
        async with self.dispatcher.lifespan(app):
            task = asyncio.create_task(self._loop(app), name="project-standing-grants")
            try:
                yield
            finally:
                self._stop.set()
                await task
