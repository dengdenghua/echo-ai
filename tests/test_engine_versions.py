import asyncio
import json
import multiprocessing
from pathlib import Path

import pytest

from runtime.execution.engine_packages import versions
from runtime.execution.engine_packages.lock import platform_key
from runtime.execution.engine_packages.store import MANIFEST_SCHEMA, read_installed


def release(root, number, engine="codex"):
    path = root / (engine + "-" + number)
    path.mkdir()
    (path / "engine").write_text(number)
    (path / "echo-engine.json").write_text(json.dumps({"schema": MANIFEST_SCHEMA, "engine": engine, "version": number, "platform": platform_key(), "entrypoint": "engine", "files": {"engine": {"size": len(number)}}}))
    return path


@pytest.mark.parametrize("engine", sorted(versions.IDS))
def test_tasks_delay_activation_and_rollback(tmp_path, engine):
    versions.publish(tmp_path, engine, release(tmp_path, "1", engine))
    with versions.task_lease(engine, tmp_path):
        versions.publish(tmp_path, engine, release(tmp_path, "2", engine))
        assert read_installed(engine, tmp_path).version == "1"
        with versions.task_lease(engine, tmp_path):
            assert versions.snapshot(tmp_path, engine)["active_tasks"] == 2
            assert read_installed(engine, tmp_path).version == "1"
        assert versions.snapshot(tmp_path, engine).get("pending")
    assert read_installed(engine, tmp_path).version == "2"
    with versions.task_lease(engine, tmp_path):
        versions.rollback(tmp_path, engine)
        assert read_installed(engine, tmp_path).version == "2"
    assert read_installed(engine, tmp_path).version == "1"
    assert versions.snapshot(tmp_path, engine)["revision"] == 3


def crashed_task(root, ready):
    with versions.task_lease("codex", Path(root)):
        ready.set()
        import time
        time.sleep(60)


def test_process_crash_releases_pending_update(tmp_path):
    versions.publish(tmp_path, "codex", release(tmp_path, "1"))
    ctx = multiprocessing.get_context("spawn")
    ready = ctx.Event()
    process = ctx.Process(target=crashed_task, args=(str(tmp_path), ready))
    process.start()
    try:
        assert ready.wait(15)
        versions.publish(tmp_path, "codex", release(tmp_path, "2"))
        assert read_installed("codex", tmp_path).version == "1"
    finally:
        process.terminate()
        process.join(10)
    assert read_installed("codex", tmp_path).version == "2"


def test_failed_publish_keeps_current(tmp_path):
    versions.publish(tmp_path, "codex", release(tmp_path, "1"))
    broken = release(tmp_path, "2")
    (broken / "engine").unlink()
    with pytest.raises(ValueError):
        versions.publish(tmp_path, "codex", broken)
    assert read_installed("codex", tmp_path).version == "1"


def test_legacy_rollback(tmp_path):
    release(tmp_path, "1").rename(tmp_path / "codex")
    versions.publish(tmp_path, "codex", release(tmp_path, "2"))
    versions.rollback(tmp_path, "codex")
    assert read_installed("codex", tmp_path).version == "1"


def test_close_generator_cleans_up_before_switch(tmp_path, monkeypatch):
    monkeypatch.setenv("ECHO_ENGINES_DIR", str(tmp_path))
    versions.publish(tmp_path, "codebuddy", release(tmp_path, "1", "codebuddy"))
    observed = []
    @versions.leased("codebuddy")
    async def stream():
        try:
            yield 1
        finally:
            observed.append(read_installed("codebuddy", tmp_path).version)
    async def run():
        events = stream()
        await anext(events)
        versions.publish(tmp_path, "codebuddy", release(tmp_path, "2", "codebuddy"))
        await events.aclose()
    asyncio.run(run())
    assert observed == ["1"]
    assert read_installed("codebuddy", tmp_path).version == "2"


def test_path_escape_rejected(tmp_path):
    with versions.locked(tmp_path, "codex") as base:
        (base / "state.json").write_text('{"active":"../../../escape"}')
    with pytest.raises(ValueError):
        read_installed("codex", tmp_path)


def test_host_task_pins_across_verification_phases(tmp_path, monkeypatch):
    monkeypatch.setenv("ECHO_ENGINES_DIR", str(tmp_path))
    versions.publish(tmp_path, "codex", release(tmp_path, "1"))
    @versions.task_scope
    async def task():
        with versions.task_lease("codex"):
            pass
        versions.publish(tmp_path, "codex", release(tmp_path, "2"))
        await asyncio.sleep(0)
        assert read_installed("codex", tmp_path).version == "1"
        with versions.task_lease("codex"):
            assert read_installed("codex", tmp_path).version == "1"
    asyncio.run(task())
    assert read_installed("codex", tmp_path).version == "2"


def test_rollback_rejects_same_size_corruption(tmp_path):
    import hashlib
    first = release(tmp_path, "1")
    manifest = json.loads((first / "echo-engine.json").read_text())
    manifest["files"]["engine"]["sha256"] = hashlib.sha256(b"1").hexdigest()
    (first / "echo-engine.json").write_text(json.dumps(manifest))
    versions.publish(tmp_path, "codex", first)
    old = read_installed("codex", tmp_path).executable
    versions.publish(tmp_path, "codex", release(tmp_path, "2"))
    old.write_bytes(b"X")
    with pytest.raises(ValueError, match="hash mismatch"):
        versions.rollback(tmp_path, "codex")
    assert read_installed("codex", tmp_path).version == "2"


def test_update_and_rollback_require_authentication(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from runtime.sensing.gateway.engine_packages_router import create_engine_packages_router
    app = FastAPI()
    app.include_router(create_engine_packages_router(require_auth=True))
    with TestClient(app) as client:
        for action in ("update", "rollback"):
            assert client.post(f"/api/engines/codex/{action}").status_code == 401


def test_api_reports_delayed_rollback(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from runtime.sensing.gateway.engine_packages_router import create_engine_packages_router
    monkeypatch.setenv("ECHO_ENGINES_DIR", str(tmp_path))
    versions.publish(tmp_path, "codex", release(tmp_path, "1"))
    versions.publish(tmp_path, "codex", release(tmp_path, "2"))
    app = FastAPI()
    app.include_router(create_engine_packages_router())
    with TestClient(app) as client:
        with versions.task_lease("codex", tmp_path):
            result = client.post("/api/engines/codex/rollback")
            assert result.status_code == 200
            assert result.json()["state"] == "pending_activation"
            assert result.json()["installed_version"] == "2"
            assert result.json()["pending_version"] == "1"
        result = next(e for e in client.get("/api/engines").json()["engines"] if e["id"] == "codex")
        assert result["installed_version"] == "1"


def test_npm_dependency_inventory_larger_than_one_megabyte(tmp_path):
    path = release(tmp_path, "1", "codebuddy")
    manifest_path = path / "echo-engine.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["inventory_note"] = "x" * (1024 * 1024)
    manifest_path.write_text(json.dumps(manifest))
    versions.publish(tmp_path, "codebuddy", path)
    assert read_installed("codebuddy", tmp_path).version == "1"


def test_private_node_pointer_cannot_escape_store(tmp_path, monkeypatch):
    from runtime.execution.engine_packages import node_runtime
    monkeypatch.setenv("ECHO_ENGINES_DIR", str(tmp_path))
    monkeypatch.setattr(node_runtime.shutil, "which", lambda _: None)
    base = tmp_path / ".node"
    base.mkdir()
    outside = tmp_path / "outside"
    outside.write_text("not node")
    (base / "runtime.json").write_text('{"node":"../outside"}')
    assert node_runtime.node_executable() is None
