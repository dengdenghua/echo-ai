"""Read-only hints for authorized workspace readers, without paths or content."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress

from anyio import BrokenResourceError, ClosedResourceError, EndOfStream
from fastapi import APIRouter, HTTPException, WebSocket
from starlette.websockets import WebSocketDisconnect

from runtime.platform.process.invalidation_feed import InvalidationFeed
from runtime.safety.auth.websocket_auth import WebSocketAuthConfig, authenticate_websocket
from runtime.workspace.access import authorized_workspace

from ._fs_router_helpers import _FsContext, _resolve_remote_workspace


def create_workspace_file_updates_router(
    ctx: _FsContext, feed: InvalidationFeed, auth_config: WebSocketAuthConfig
) -> APIRouter:
    @asynccontextmanager
    async def lifespan(_app):
        try:
            feed.start()
            yield
        finally:
            await asyncio.to_thread(feed.close)

    router = APIRouter(tags=["fs"], lifespan=lifespan)

    @router.websocket("/api/fs/workspaces/{workspace_id}/updates")
    async def workspace_updates(websocket: WebSocket, workspace_id: str) -> None:
        loop = asyncio.get_running_loop()
        changed = asyncio.Event()

        def notify() -> None:
            loop.call_soon_threadsafe(changed.set)

        async def authorize() -> bool:
            current = await authenticate_websocket(websocket, config=auth_config)
            if current is None:
                return False
            try:
                workspace = await asyncio.to_thread(_resolve_remote_workspace, ctx, workspace_id)
                if workspace is None:
                    raise HTTPException(404, "workspace unavailable")
                await asyncio.to_thread(
                    authorized_workspace,
                    ctx.workspace_store,
                    workspace_id,
                    current.principal,
                    operator_without_membership=True,
                )
            except HTTPException:
                await websocket.close(code=1008, reason="workspace unavailable")
                return False
            return True

        auth = await authenticate_websocket(websocket, config=auth_config)
        if auth is None or not await authorize():
            return
        try:
            unsubscribe = feed.subscribe(notify, key=workspace_id)
        except (OverflowError, RuntimeError, ValueError):
            await websocket.close(code=1008, reason="workspace updates unavailable")
            return
        received = None
        waking = None
        transport_errors = (
            WebSocketDisconnect,
            BrokenResourceError,
            ClosedResourceError,
            EndOfStream,
        )
        try:
            await websocket.accept(subprotocol=auth.subprotocol)
            await websocket.send_json({"type": "workspace:ready", "workspace_id": workspace_id})
            received = asyncio.create_task(websocket.receive())
            while True:
                waking = asyncio.create_task(changed.wait())
                done, _ = await asyncio.wait(
                    {received, waking}, timeout=15, return_when=asyncio.FIRST_COMPLETED
                )
                if received in done:
                    message = received.result()
                    if message["type"] != "websocket.disconnect":
                        await websocket.close(code=1008, reason="workspace updates are read-only")
                    return
                if not waking.done():
                    waking.cancel()
                    with suppress(asyncio.CancelledError):
                        await waking
                changed.clear()
                if not await authorize():
                    return
                if received.done():
                    continue
                kind = "workspace:update" if waking in done else "workspace:heartbeat"
                await asyncio.wait_for(
                    websocket.send_json({"type": kind, "workspace_id": workspace_id}), timeout=2
                )
        except (*transport_errors, TimeoutError):
            return
        finally:
            unsubscribe()
            for task in (received, waking):
                if task is not None:
                    task.cancel()
                    with suppress(asyncio.CancelledError, *transport_errors):
                        await task

    return router
