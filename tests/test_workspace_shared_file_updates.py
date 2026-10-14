"""Real file writes and authorized live readers in independent Redis workers."""

import multiprocessing
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

import pytest

from tests import test_shared_collaboration_pubsub as shared

real_redis = shared.real_redis


def _workspace_worker(home, url, namespace, port, ready):
    import uvicorn
    from fastapi import FastAPI

    from runtime.platform.io.lease import LeaseStore
    from runtime.platform.process.invalidation_feed import InvalidationFeed
    from runtime.platform.process.shared_pubsub import RedisPubSub
    from runtime.safety.auth import Identity, IdentityStore
    from runtime.sensing.gateway.fs_router import create_fs_router
    from runtime.sensing.server.mount_backend import LocalMountBackend, MountBackendRegistry
    from runtime.workspace.store import WorkspaceStore

    identities = IdentityStore()
    for actor, tenant in (("alice", "tenant-a"), ("bob", "tenant-a"), ("outsider", "tenant-b")):
        identities.add(
            Identity(actor_id=actor, metadata={"tenant_id": tenant}),
            api_key_plaintext=f"key-{actor}",
        )
    registry = MountBackendRegistry()
    registry.register("local", LocalMountBackend)
    bus = RedisPubSub(url, namespace)
    app = FastAPI()
    app.router.add_event_handler("startup", bus.start)
    app.router.add_event_handler("shutdown", bus.close)
    app.include_router(
        create_fs_router(
            identity_store=identities,
            require_auth=True,
            workspace_store=WorkspaceStore(Path(home) / "workspaces.db"),
            lease_store=LeaseStore(Path(home) / "leases.db"),
            mount_registry=registry,
            file_updates=InvalidationFeed("workspace:changed", bus, scoped=True),
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
def _workspace_workers(home, url):
    context = multiprocessing.get_context("spawn")
    ports, processes, namespace = [shared._port(), shared._port()], [], uuid4().hex
    try:
        for port in ports:
            ready = context.Event()
            process = context.Process(
                target=_workspace_worker, args=(str(home), url, namespace, port, ready)
            )
            process.start()
            processes.append(process)
            assert ready.wait(20), "workspace worker startup failed"
        yield ports
    finally:
        for process in processes:
            if process.is_alive():
                process.terminate()
            process.join(10)


def test_other_worker_reader_observes_actual_file_commit_and_membership_revocation(
    real_redis, tmp_path
):
    import json

    import httpx
    from websockets.exceptions import ConnectionClosed, InvalidStatus
    from websockets.sync.client import connect

    from runtime.workspace.store import WorkspaceStore

    mount = tmp_path / "mount"
    mount.mkdir()
    store = WorkspaceStore(tmp_path / "workspaces.db")
    workspace = store.create_workspace(
        name="Shared",
        mount_type="local",
        mount_target=str(mount),
        owner_id="alice",
        tenant_id="tenant-a",
    )
    store.add_member(workspace.id, "bob", role="viewer")
    store.add_member(workspace.id, "outsider", role="editor")
    alice = {"Authorization": "Bearer key-alice"}
    bob = {"Authorization": "Bearer key-bob"}
    with (
        _workspace_workers(tmp_path, real_redis) as ports,
        httpx.Client(base_url=f"http://127.0.0.1:{ports[0]}", headers=alice, timeout=10) as writer,
        httpx.Client(base_url=f"http://127.0.0.1:{ports[1]}", headers=bob, timeout=10) as reader,
    ):
        socket_url = f"ws://127.0.0.1:{ports[1]}/api/fs/workspaces/{workspace.id}/updates"
        with (
            pytest.raises(InvalidStatus),
            connect(socket_url, additional_headers={"Authorization": "Bearer key-outsider"}),
        ):
            pass
        with connect(socket_url, additional_headers=bob) as socket:
            assert json.loads(socket.recv(timeout=5)) == {
                "type": "workspace:ready",
                "workspace_id": workspace.id,
            }
            written = writer.post(
                "/api/fs/write",
                json={
                    "path": f"{workspace.id}:/result.txt",
                    "content": "committed source",
                    "thread_id": "unrelated-private-thread",
                },
            )
            assert written.status_code == 200, written.text
            assert json.loads(socket.recv(timeout=5)) == {
                "type": "workspace:update",
                "workspace_id": workspace.id,
            }
            read = reader.get("/api/fs/read", params={"path": f"{workspace.id}:/result.txt"})
            assert read.status_code == 200
            assert read.json()["content"] == "committed source"
            store.remove_member(workspace.id, "bob")
            changed = writer.post(
                "/api/fs/write",
                json={"path": f"{workspace.id}:./result.txt", "content": "owner-only source"},
            )
            assert changed.status_code == 200, changed.text
            with pytest.raises(ConnectionClosed) as revoked:
                socket.recv(timeout=5)
            assert revoked.value.rcvd.code == 1008
            denied = reader.get("/api/fs/read", params={"path": f"{workspace.id}:/result.txt"})
            assert denied.status_code == 404
            assert (mount / "result.txt").read_text() == "owner-only source"
