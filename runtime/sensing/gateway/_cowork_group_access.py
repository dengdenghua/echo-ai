"""Authorization helpers for the cowork group HTTP router."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import HTTPException, Request


class CoworkGroupAccess:
    """Apply canonical-thread and linked-room ACLs without cached membership."""

    def __init__(
        self,
        *,
        runtime: Any,
        identity_store: Any,
        require_auth: bool,
        jwt_secret: str | None,
        jwt_issuer: str | None,
        jwt_audience: str | None,
        thread_access: Any,
        team_rooms_router: Any,
        room_snapshot: Callable[[str], dict[str, Any] | None],
    ) -> None:
        self._runtime = runtime
        self._identity_store = identity_store
        self._require_auth = require_auth
        self._jwt_secret = jwt_secret
        self._jwt_issuer = jwt_issuer
        self._jwt_audience = jwt_audience
        self._thread_access = thread_access
        self._team_rooms_router = team_rooms_router
        self._room_snapshot = room_snapshot

    def principal(self, request: Request) -> Any:
        cached = getattr(getattr(request, "state", None), "cowork_principal", None)
        if cached is not None:
            return cached

        from runtime.safety.auth.principal import resolve_principal

        principal = resolve_principal(
            request,
            self._identity_store,
            self._require_auth,
            jwt_secret=self._jwt_secret,
            jwt_issuer=self._jwt_issuer,
            jwt_audience=self._jwt_audience,
        )
        if principal is not None:
            request.state.cowork_principal = principal
        return principal

    def require_owned_thread(
        self,
        thread_id: str,
        request: Request,
    ) -> dict[str, Any] | None:
        """Bind authenticated cowork state to the canonical managed thread."""

        if not self._require_auth:
            return None
        principal = self.principal(request)
        if principal is None:  # resolve_principal is fail-closed in auth mode
            raise HTTPException(401, "authentication required")
        if getattr(self._runtime, "thread_store", None) is None:
            raise HTTPException(503, "thread state unavailable")
        decision = self._thread_access.resolve(
            thread_id,
            principal.actor_id,
            principal.tenant_id,
        )
        if not decision.can_manage or decision.thread is None:
            raise HTTPException(404, "thread not found")
        request.state.cowork_thread = decision.thread
        request.state.cowork_thread_access = decision
        return decision.thread

    def require_collaborative_thread(
        self,
        thread_id: str,
        request: Request,
        *,
        write: bool = False,
    ) -> dict[str, Any] | None:
        """Allow the owner or an active linked-room participant."""

        if not self._require_auth:
            return None
        principal = self.principal(request)
        if principal is None:
            raise HTTPException(401, "authentication required")
        if getattr(self._runtime, "thread_store", None) is None:
            raise HTTPException(503, "thread state unavailable")
        decision = self._thread_access.resolve(
            thread_id,
            principal.actor_id,
            principal.tenant_id,
        )
        allowed = decision.can_write if write else decision.can_read
        if not allowed or decision.thread is None:
            # Hide denied threads, room links, and memberships from callers.
            raise HTTPException(404, "thread not found")
        request.state.cowork_thread = decision.thread
        request.state.cowork_thread_access = decision
        return decision.thread

    def require_room_member(self, room_id: str, request: Request) -> None:
        """Preserve Team Room membership when a cowork route projects room data."""

        if not self._require_auth:
            return
        principal = self.principal(request)
        if principal is None:
            raise HTTPException(401, "authentication required")

        participant_resolver = getattr(self._team_rooms_router, "get_room_participant", None)
        if callable(participant_resolver):
            try:
                participant = participant_resolver(
                    room_id,
                    principal.actor_id,
                    principal.tenant_id,
                )
            except TypeError:
                participant = participant_resolver(
                    room_id,
                    principal.actor_id,
                    tenant_id=principal.tenant_id,
                )
            if not isinstance(participant, dict):
                raise HTTPException(403, "not a member of the linked team room")
            return

        room = self._room_snapshot(room_id)
        if room is None:
            raise HTTPException(404, "team room not found")
        room_tenant = str(
            room.get("tenant_id")
            or (
                (room.get("metadata") or {}).get("tenant_id")
                if isinstance(room.get("metadata"), dict)
                else ""
            )
            or ""
        ).strip()
        if room_tenant and room_tenant != principal.tenant_id:
            raise HTTPException(403, "not a member of the linked team room")
        member_lister = getattr(self._team_rooms_router, "list_room_members", None)
        if callable(member_lister):
            allowed = {str(actor) for actor in member_lister(room_id) if str(actor)}
        else:
            allowed = {str(room.get("owner_id") or "").strip()}
            raw_participants = room.get("participants")
            participants = raw_participants if isinstance(raw_participants, list) else []
            allowed.update(
                str(participant.get("actor_id") or "").strip()
                for participant in participants
                if isinstance(participant, dict) and participant.get("status") != "removed"
            )
            allowed.discard("")
        if principal.actor_id not in allowed:
            raise HTTPException(403, "not a member of the linked team room")

    def actor(self, request: Request) -> str:
        principal = self.principal(request)
        return str(getattr(principal, "actor_id", "") or "user")

    def _caller_room_seats(
        self,
        room_id: str,
        actor_id: str,
        tenant_id: str,
    ) -> list[dict[str, Any]]:
        """The caller's own Team Room seats, the authoritative resolver's first."""

        seats: list[dict[str, Any]] = []
        participant_resolver = getattr(self._team_rooms_router, "get_room_participant", None)
        if callable(participant_resolver):
            try:
                participant = participant_resolver(room_id, actor_id, tenant_id)
            except TypeError:
                participant = participant_resolver(room_id, actor_id, tenant_id=tenant_id)
            if isinstance(participant, dict):
                seats.append(participant)
        room = self._room_snapshot(room_id) or {}
        raw_participants = room.get("participants")
        for participant in raw_participants if isinstance(raw_participants, list) else []:
            if (
                isinstance(participant, dict)
                and str(participant.get("actor_id") or "").strip() == actor_id
                and participant.get("status") != "removed"
            ):
                seats.append(participant)
        return seats

    def bind_caller_member(
        self,
        request: Request,
        claimed: str,
        *,
        room_id: str | None = None,
    ) -> tuple[str, str | None]:
        """Bind a self-scoped member id (sender, read marker, heartbeat) to the caller.

        Local no-auth mode keeps its historical contract: the single trusted
        local user names itself, so ``claimed`` is returned unchanged and the
        display name is left to the caller (``None``).

        In shared mode the id is derived from the authenticated principal, as
        the Team Room socket does: a client may only name an id it provably
        owns — its actor id or one of its own room seats (``actor-…`` /
        ``owner-…``) — and an empty claim means the actor id. Anything else is
        impersonation and is refused with 403. The display name then comes
        from the server-owned room seat, never from the request body.
        """

        if not self._require_auth:
            return str(claimed or ""), None
        claimed = str(claimed or "").strip()
        principal = self.principal(request)
        actor_id = str(getattr(principal, "actor_id", "") or "").strip()
        if principal is None or not actor_id:
            raise HTTPException(401, "authentication required")
        seats = self._caller_room_seats(room_id, actor_id, principal.tenant_id) if room_id else []
        owned = {actor_id, *(str(seat.get("id") or "").strip() for seat in seats)}
        owned.discard("")
        member_id = claimed or actor_id
        if member_id not in owned:
            raise HTTPException(403, "member id does not belong to the authenticated caller")
        seat = next((s for s in seats if str(s.get("id") or "").strip() == member_id), None)
        seat = seat or (seats[0] if seats else None)
        display_name = str((seat or {}).get("display_name") or "").strip() or member_id
        return member_id, display_name

    def can_moderate(self, thread_id: str, request: Request) -> bool:
        """Thread owner or linked-room owner/admin; the sole local user in no-auth mode."""

        if not self._require_auth:
            return True
        decision = getattr(getattr(request, "state", None), "cowork_thread_access", None)
        if decision is None:
            principal = self.principal(request)
            if principal is None:
                return False
            decision = self._thread_access.resolve(
                thread_id,
                principal.actor_id,
                principal.tenant_id,
            )
        # ``admin`` room roles are normalized to ``owner`` by the resolver.
        return bool(decision.can_manage or decision.room_role == "owner")


__all__ = ["CoworkGroupAccess"]
