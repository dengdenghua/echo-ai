"""``POST /api/codex/prewarm``: warm the App Server for the next Codex chat reply."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import Request

from runtime.execution.codex_backend.role_runner import prewarm_codex_chat
from runtime.platform.process.session import Session
from runtime.safety.auth.scope import scope_from_request
from runtime.sensing.gateway._config_models import CodexPrewarmResponse

_logger = logging.getLogger(__name__)


def register_codex_prewarm(router: Any, stack: Any) -> None:
    @router.post("/api/codex/prewarm", response_model=CodexPrewarmResponse, tags=["config"])
    async def api_codex_prewarm(request: Request) -> CodexPrewarmResponse:
        """Start the App Server the caller's next Codex chat reply will use.

        A conversation's first reply otherwise paid a cold App Server start
        (6.5 s to the first word, measured 2026-10-17). Best effort, like the
        OpenCode prewarm: any account, engine or model problem answers
        ``warm: false`` and is left for the turn itself to report.
        """

        # Usually None: turns resolve their agent per thread. The App Server
        # command and warm-pool key do not depend on it (codex_app_server_command).
        gateway = getattr(request.app.state, "realtime_gateway", None)
        agent = getattr(getattr(gateway, "_runtime", None), "_default_agent", None)
        # The same principal the realtime gateway stamps on a turn.
        scope = scope_from_request(request)
        session = None
        if scope is not None and scope.actor_id:
            tenant = scope.tenant_id or f"legacy:{scope.actor_id}"
            session = Session(actor=scope.actor_id, agent=agent, metadata={"tenant_id": tenant})
        try:
            warm = await prewarm_codex_chat(stack, agent, trusted_session=session)
        except Exception as exc:  # noqa: BLE001 - best effort; the turn reports real failures
            _logger.debug("Codex chat prewarm skipped: %s", type(exc).__name__)
            return CodexPrewarmResponse(warm=False)
        return CodexPrewarmResponse(warm=warm)
