"""Auth status, current-user / logout, and login-provider routes for the meta router.

Pure structural split of ``meta_router.create_meta_router`` — no logic
changes. Each ``_register_*`` function attaches its endpoints to the
injected router, reading the factory's injected values and the
``_require_admin`` closure from ``MetaRouterDeps``; the factory still owns the
registration order.
"""

from __future__ import annotations

from typing import Any

try:
    from fastapi import APIRouter, HTTPException, Query, Request, Response

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover
    FASTAPI_AVAILABLE = False
    APIRouter = None  # type: ignore[assignment, misc]
    HTTPException = None  # type: ignore[assignment, misc]
    Query = None  # type: ignore[assignment, misc]
    Request = None  # type: ignore[assignment, misc]
    Response = None  # type: ignore[assignment, misc]

from runtime.sensing.gateway._meta_models import (
    AuthProvidersResponse,
)
from runtime.sensing.gateway._meta_router_deps import MetaRouterDeps


def _register_auth_routes(router: APIRouter, d: MetaRouterDeps) -> None:
    """Auth status, strict ``/api/auth/me`` + logout when enforcing, providers."""
    oct_config = d.oct_config
    local_auth_config = d.local_auth_config
    identity_store = d.identity_store
    jwt_secret = d.jwt_secret
    jwt_issuer = d.jwt_issuer
    jwt_audience = d.jwt_audience
    require_auth = d.require_auth

    # ─── Auth status ────────────────────────────────────────

    _oct_enabled = bool(oct_config is not None and getattr(oct_config, "enabled", False))
    _local_auth_enabled = bool(
        local_auth_config is not None and getattr(local_auth_config, "enabled", False)
    )
    _any_auth_enabled = _oct_enabled or _local_auth_enabled

    @router.get("/api/auth/status")
    def auth_status() -> dict[str, Any]:
        has_jwt = _oct_enabled or _local_auth_enabled
        return {
            "enabled": _any_auth_enabled,
            "jwt_available": has_jwt,
            "allow_registration": False,
            "exempt_paths": [],
        }

    def auth_me(request: Request) -> dict[str, Any]:
        """Return the authenticated actor from the real identity store.

        This endpoint used to exist only in the optional stub router. With
        production auth enabled the frontend therefore made a guaranteed 404
        request on every reload even though the bearer token was valid.
        """
        if identity_store is None:
            raise HTTPException(
                401,
                "authentication required",
                headers={"X-Echo-Auth-Expired": "1"},
            )

        from runtime.sensing.gateway.openai_gateway import _resolve_actor

        actor = _resolve_actor(
            request,
            identity_store,
            True,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )
        if not actor:
            raise HTTPException(
                401,
                "authentication required",
                headers={"X-Echo-Auth-Expired": "1"},
            )

        identity = identity_store.get(actor) if hasattr(identity_store, "get") else None
        metadata = dict(getattr(identity, "metadata", None) or {})
        roles = [str(role) for role in (getattr(identity, "roles", None) or ())]
        fallback_name = actor.split(":", 1)[-1] if ":" in actor else actor
        username = next(
            (
                str(metadata[key]).strip()
                for key in ("username", "display_name", "email", "mobile")
                if isinstance(metadata.get(key), str) and str(metadata[key]).strip()
            ),
            fallback_name,
        )
        permissions_raw = metadata.get("permissions")
        permissions = (
            [str(value) for value in permissions_raw]
            if isinstance(permissions_raw, (list, tuple))
            else []
        )
        response: dict[str, Any] = {
            "user_id": actor,
            "actor_id": actor,
            "username": username,
            "roles": roles,
            "permissions": permissions,
            "is_active": True,
        }
        for key in ("email", "mobile", "provider"):
            value = metadata.get(key)
            if isinstance(value, str) and value.strip():
                response[key] = value.strip()
        return response

    def auth_logout(request: Request, response: Response) -> None:
        """Revoke the presented JWT and clear the browser session cookie."""

        from runtime.safety.auth.principal import clear_session_cookie
        from runtime.safety.auth.session_revocation import revoke_request_session

        revoke_request_session(
            request, identity_store, secret=jwt_secret, issuer=jwt_issuer, audience=jwt_audience
        )
        clear_session_cookie(response, request)
        response.status_code = 204

    # Leave the route to the compatibility stub when auth is disabled
    # (require_auth=False). The stub returns anonymous on bad/missing JWT
    # instead of 401, which is the desired behavior in dev mode. Only
    # register the strict handler when the app is actually enforcing auth —
    # at that point stub_router is disabled, so there's no route conflict.
    if identity_store is not None and require_auth:
        router.add_api_route("/api/auth/me", auth_me, methods=["GET"])
        router.add_api_route(
            "/api/auth/logout",
            auth_logout,
            methods=["POST"],
            status_code=204,
        )

    # ─── Auth providers ─────────────────────────────────────

    @router.get(
        "/api/auth/providers",
        response_model=AuthProvidersResponse,
    )
    def auth_providers() -> dict[str, Any]:
        """Return the list of configured login methods.

        The frontend Login page hides tabs whose id isn't in the
        returned set — so an empty response means "no providers
        configured, don't show a broken form".
        """
        providers: list[dict[str, Any]] = []
        if oct_config is not None and getattr(oct_config, "enabled", False):
            providers.append(
                {
                    "id": "oct",
                    "label": "邮箱登录",
                    "mock_mode": bool(getattr(oct_config, "mock_mode", False)),
                    "endpoint_send": "/api/auth/oct/email/send",
                    "endpoint_verify": "/api/auth/oct/email/login",
                }
            )
        from runtime.adapters.integrations.local_auth.config import local_login_enabled

        if local_login_enabled(local_auth_config):
            pw_required = bool(getattr(local_auth_config, "users", {}))
            providers.append(
                {
                    "id": "local",
                    "label": (
                        "账号密码登录"
                        if pw_required
                        and not getattr(local_auth_config, "password_only_username", None)
                        else "开发者登录"
                    ),
                    "allow_any_username": bool(
                        getattr(local_auth_config, "allow_any_username", True),
                    ),
                    "password_required": pw_required,
                    "password_only_username": getattr(
                        local_auth_config, "password_only_username", None
                    ),
                    "endpoint": "/api/auth/local/login",
                }
            )
        return {"providers": providers}
