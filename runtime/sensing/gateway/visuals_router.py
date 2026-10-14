"""Authenticated browser receipt endpoint; accepts no code or file paths."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from runtime.platform.visuals import report_visual
from runtime.safety.auth.principal import resolve_principal
from runtime.safety.auth.scope import scope_from_principal


class VisualReceipt(BaseModel):
    receipt_token: str = Field(min_length=16, max_length=128)
    status: Literal["rendered", "error"]
    detail: str = Field(default="", max_length=1000)


def create_visuals_router(
    *,
    identity_store: Any = None,
    require_auth: bool = False,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/api/visuals", tags=["visuals"])

    @router.post("/{visual_id}/receipt")
    def receipt(
        visual_id: str, body: VisualReceipt, request: Request, response: Response
    ) -> dict[str, bool]:
        principal = resolve_principal(
            request,
            identity_store,
            require_auth,
            jwt_secret=jwt_secret,
            jwt_issuer=jwt_issuer,
            jwt_audience=jwt_audience,
        )
        response.headers["Cache-Control"] = "no-store"
        if not report_visual(
            visual_id, body.receipt_token, scope_from_principal(principal), body.status, body.detail
        ):
            raise HTTPException(404, "Visual receipt expired or unavailable")
        return {"ok": True}

    return router
