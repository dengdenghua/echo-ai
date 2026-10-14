"""Independent HTTP/WS workers observing committed source through real Redis."""

import multiprocessing
import threading
import time
from contextlib import contextmanager
from uuid import uuid4

import pytest

from tests import test_shared_collaboration_pubsub as shared

real_redis = shared.real_redis


def _project_worker(home, url, namespace, port, ready):
    import uvicorn
    from fastapi import FastAPI

    from runtime.platform.process.shared_pubsub import RedisPubSub
    from runtime.projectos.store import ProjectStore
    from runtime.safety.auth import Identity, IdentityStore
    from runtime.sensing.gateway.projects_router import create_projects_router

    identities = IdentityStore()
    for actor, tenant in (("alice", "tenant-a"), ("bob", "tenant-a"), ("outsider", "tenant-b")):
        identities.add(
            Identity(actor_id=actor, metadata={"tenant_id": tenant}),
            api_key_plaintext=f"key-{actor}",
        )
    bus = RedisPubSub(url, namespace)
    app = FastAPI()
    app.router.add_event_handler("startup", bus.start)
    app.router.add_event_handler("shutdown", bus.close)
    app.include_router(
        create_projects_router(
            store=ProjectStore(home), identity_store=identities, require_auth=True, shared_bus=bus
        )
    )
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))

    def signal_ready():
        deadline = time.monotonic() + 15
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        if server.started:
            ready.set()

    threading.Thread(target=signal_ready, daemon=True).start()
    server.run()


@contextmanager
def _project_workers(home, url, namespace):
    context = multiprocessing.get_context("spawn")
    ports, processes = [shared._port(), shared._port()], []
    try:
        for port in ports:
            ready = context.Event()
            process = context.Process(
                target=_project_worker, args=(str(home), url, namespace, port, ready)
            )
            process.start()
            processes.append(process)
            assert ready.wait(20), "project worker startup failed"
        yield ports
    finally:
        for process in processes:
            if process.is_alive():
                process.terminate()
            process.join(10)


def test_actual_other_worker_project_hint_after_authorized_http_commit(real_redis, tmp_path):
    import json

    import httpx
    from websockets.exceptions import InvalidStatus
    from websockets.sync.client import connect

    headers = {"Authorization": "Bearer key-alice"}
    with (
        _project_workers(tmp_path, real_redis, uuid4().hex) as ports,
        httpx.Client(
            base_url=f"http://127.0.0.1:{ports[0]}", headers=headers, timeout=10
        ) as writer,
        httpx.Client(
            base_url=f"http://127.0.0.1:{ports[1]}", headers=headers, timeout=10
        ) as reader,
    ):
        created = writer.post("/api/projects", json={"name": "Shared", "goal": "No execution"})
        assert created.status_code == 200, created.text
        project_id = created.json()["project"]["id"]
        socket_url = f"ws://127.0.0.1:{ports[1]}/api/projects/{project_id}/updates"
        for actor in ("bob", "outsider"):
            with (
                pytest.raises(InvalidStatus),
                connect(socket_url, additional_headers={"Authorization": f"Bearer key-{actor}"}),
            ):
                pass
        with connect(socket_url, additional_headers=headers) as socket:
            ready = json.loads(socket.recv(timeout=5))
            assert ready == {"type": "project:ready", "project_id": project_id}
            cancelled = writer.post(
                f"/api/projects/{project_id}/cancel", json={"reason": "fixture"}
            )
            assert cancelled.status_code == 200, cancelled.text
            hint = json.loads(socket.recv(timeout=5))
            assert hint == {"type": "project:update", "project_id": project_id}
            state = reader.get(f"/api/projects/{project_id}")
            assert state.status_code == 200
            assert state.json()["project"]["status"] == "failed"
