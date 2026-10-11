"""Read-only project invalidations with the same owner ACL as HTTP execution."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress

from anyio import BrokenResourceError, ClosedResourceError, EndOfStream
from fastapi import APIRouter, HTTPException, Request, WebSocket
from starlette.websockets import WebSocketDisconnect

from runtime.projectos.live_updates import ProjectChangeFeed
from runtime.safety.auth.websocket_auth import WebSocketAuthConfig, authenticate_websocket

from ._projects_router_deps import ProjectsDeps


def create_project_live_router(
    d: ProjectsDeps, feed: ProjectChangeFeed, auth_config: WebSocketAuthConfig
) -> APIRouter:
    @asynccontextmanager
    async def lifespan(_app):
        unsubscribe = d.project_store.bind_commit_listener(feed.notify)
        try:
            feed.start()
            yield
        finally:
            await asyncio.to_thread(unsubscribe)
            await asyncio.to_thread(feed.close)

    router = APIRouter(tags=["projectos"], lifespan=lifespan)

    @router.websocket("/api/projects/{project_id}/updates")
    async def project_updates(websocket: WebSocket, project_id: str) -> None:
        loop = asyncio.get_running_loop()
        changed = asyncio.Event()

        def notify() -> None:
            loop.call_soon_threadsafe(changed.set)

        async def authorize() -> bool:
            auth = await authenticate_websocket(websocket, config=auth_config)
            if auth is None:
                return False
            request = Request(
                {
                    **websocket.scope,
                    "type": "http",
                    "state": {"principal": auth.principal, "project_principal": auth.principal},
                }
            )
            try:
                await asyncio.to_thread(d.project_or_404, request, project_id)
            except HTTPException:
                await websocket.close(code=1008, reason="project unavailable")
                return False
            return True

        auth = await authenticate_websocket(websocket, config=auth_config)
        if auth is None or not await authorize():
            return
        try:
            unsubscribe = feed.subscribe(notify)
        except (OverflowError, RuntimeError):
            await websocket.close(code=1008, reason="project updates unavailable")
            return
        received = None
        waking = None
        try:
            await websocket.accept(subprotocol=auth.subprotocol)
            await websocket.send_json({"type": "project:ready", "project_id": project_id})
            received = asyncio.create_task(websocket.receive())
            while True:
                waking = asyncio.create_task(changed.wait())
                done, _ = await asyncio.wait(
                    {received, waking}, timeout=15, return_when=asyncio.FIRST_COMPLETED
                )
                if received in done:
                    message = received.result()
                    if message["type"] != "websocket.disconnect":
                        await websocket.close(code=1008, reason="project updates are read-only")
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
                # A heartbeat checks access but does not poll execution status.
                kind = "project:update" if waking in done else "project:heartbeat"
                await asyncio.wait_for(
                    websocket.send_json({"type": kind, "project_id": project_id}), timeout=2
                )
        except (
            WebSocketDisconnect,
            BrokenResourceError,
            ClosedResourceError,
            EndOfStream,
            TimeoutError,
        ):
            return
        finally:
            unsubscribe()
            for task in (received, waking):
                if task is not None:
                    task.cancel()
                    with suppress(
                        asyncio.CancelledError,
                        WebSocketDisconnect,
                        BrokenResourceError,
                        ClosedResourceError,
                        EndOfStream,
                    ):
                        await task

    return router
