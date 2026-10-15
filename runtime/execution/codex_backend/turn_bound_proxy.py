"""A Responses proxy that outlives one turn and serves one turn at a time.

OpenCode with an Echo-routed model paid a full ``opencode serve`` start
(~2.7 s) on every turn: the proxy credential written into the process lived
for one turn, so the process could not either. This proxy keeps its loopback
port and bearer token for the life of a warm process and is bound to exactly
one turn at a time. ``bind_turn`` installs that turn's coordinates, trusted
session, request budget and expiry; ``release_turn`` refuses every request
(401) until the next turn is bound. Tenant, principal and model never change
for one proxy.
"""

from __future__ import annotations

import time
from collections.abc import Mapping
from typing import Any

from .responses_proxy import CodexResponsesScope, ResponsesProxyError, ScopedResponsesProxy


class TurnBoundResponsesProxy(ScopedResponsesProxy):
    def bind_turn(self, scope: CodexResponsesScope, trusted_session: Any) -> None:
        if self._server is None:
            raise ResponsesProxyError("Responses proxy is not running")
        if (scope.tenant_id, scope.principal_id, scope.model) != (
            self.scope.tenant_id,
            self.scope.principal_id,
            self.scope.model,
        ):
            raise ResponsesProxyError("a warm Responses proxy cannot change identity or model")
        if trusted_session is not None:
            metadata = trusted_session.metadata
            tenant = (
                str(metadata.get("tenant_id") or "").strip()
                if isinstance(metadata, Mapping)
                else ""
            )
            if (trusted_session.actor and trusted_session.actor != scope.principal_id) or (
                tenant and tenant != scope.tenant_id
            ):
                raise ResponsesProxyError("trusted session does not match proxy scope")
        self.release_turn()
        self.scope = scope
        self._trusted_session = trusted_session
        self._request_count = 0
        self._completed_request_bytes = 0
        self._expires_at = time.monotonic() + self._ttl_s
        self._active = True

    def release_turn(self) -> None:
        self._active = False
        for future in self._request_results.values():
            if not future.done():
                future.cancel()
        self._request_results.clear()


__all__ = ["TurnBoundResponsesProxy"]
