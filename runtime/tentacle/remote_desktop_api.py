"""Operator-only desktop settings. Phone signaling stays on the authenticated device socket."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


class RemotePermission(BaseModel):
    mode: str


def create_remote_desktop_router(host) -> APIRouter:
    router = APIRouter(prefix="/remote-desktop")

    def current():
        value = host() if callable(host) else host
        if value is None:
            raise HTTPException(503, "Device connections are not enabled")
        return value

    @router.get("/status")
    async def status() -> dict:
        return current().status()

    @router.put("/permissions/{device_id:path}")
    async def permission(device_id: str, body: RemotePermission) -> dict:
        try:
            await current().grant(device_id, body.mode)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return current().status()

    @router.post("/stop")
    async def stop() -> dict:
        for device_id in list(current().sessions):
            await current().stop(device_id, "operator_stopped")
        return current().status()

    return router
