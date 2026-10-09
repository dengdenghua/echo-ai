import hashlib
import json
import zipfile
from pathlib import Path

import pytest

from runtime.execution.node_inputs import capture_input, restore_input
from runtime.execution.node_worker import ExecutionNodeWorker
from tests import test_execution_nodes as node_tests
from tests.test_execution_nodes import artifact, submit

setup = node_tests.setup


def test_capture_restore_and_archive_corruption(tmp_path):
    source = tmp_path / "project"
    source.mkdir()
    (source / "data.bin").write_bytes(bytes(range(256)) * 1024)
    (source / ".env").write_text("excluded")
    archive = tmp_path / "inputs" / "input.zip"
    descriptor = capture_input(source, archive)
    assert descriptor["skipped_count"] == 1
    baseline = restore_input(archive, tmp_path / "restored", descriptor)
    assert baseline == {"data.bin": hashlib.sha256((source / "data.bin").read_bytes()).hexdigest()}
    assert (tmp_path / "restored" / "data.bin").read_bytes() == (source / "data.bin").read_bytes()
    assert not (tmp_path / "restored" / ".env").exists()
    archive.write_bytes(archive.read_bytes()[:-1] + b"!")
    with pytest.raises(ValueError, match="digest"):
        restore_input(archive, tmp_path / "corrupt", descriptor)
    assert not (tmp_path / "corrupt").exists()


@pytest.mark.parametrize(
    "name", ["../escape", "/escape", "C:/escape", "a/../escape", "a:stream", "CON"]
)
def test_malformed_archives_never_extract_outside_target(tmp_path, name):
    archive = tmp_path / "malicious.zip"
    manifest = {
        "schema": "echo.execution_input.v1",
        "files": {name: {"sha256": hashlib.sha256(b"evil").hexdigest(), "size": 4}},
    }
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("manifest.json", json.dumps(manifest))
        bundle.writestr("files/" + name, b"evil")
    descriptor = dict(
        sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
        archive_bytes=archive.stat().st_size,
        file_count=1,
        content_bytes=4,
    )
    with pytest.raises(ValueError):
        restore_input(archive, tmp_path / "target", descriptor)
    assert not (tmp_path / "target").exists()


@pytest.mark.parametrize("use_path_map", [True, False])
def test_new_attempt_uses_submitted_version_despite_both_mounts_changing(
    setup, tmp_path, monkeypatch, use_path_map
):
    from datetime import UTC, datetime, timedelta

    user, node, _, _, ws, project = setup
    run, _ = submit(setup)
    url = f"/api/execution/tasks/{run['run_id']}"
    first = dict(node_id="nas-a", instance_id="dead", attempt=1)
    node.post(url + "/claim", json=first).raise_for_status()
    (project / "input.txt").write_text("new human version")
    other_mount = tmp_path / "other-mount"
    other_mount.mkdir()
    (other_mount / "input.txt").write_text("outdated device copy")
    later = datetime.now(UTC) + timedelta(seconds=20)
    monkeypatch.setattr("runtime.memory.cowork.collaboration_runs._now", lambda: later)
    seen = []

    def execute(_role, _goal, **kwargs):
        root = Path(kwargs["session"].metadata["workspace_path"])
        seen.append((root / "input.txt").read_text())
        (root / "input.txt").write_text("derived from original")
        return {"success": True, "output": "done"}

    monkeypatch.setattr("runtime.execution.node_worker.call_subagent", execute)
    worker = ExecutionNodeWorker(
        node_id="nas-b",
        label="B",
        workspaces={ws.id: str(other_mount)} if use_path_map else [ws.id],
        roles=["coder"],
        client=node,
        data_dir=tmp_path / "worker",
        runner=None,
    )
    assert worker.run_once()
    result = user.get(url).json()
    assert result["status"] == "completed", result
    assert result["attempt"] == 2
    assert seen == ["original"]
    assert (
        result["result"]["artifacts"][0]["baseline_sha256"]
        == hashlib.sha256(b"original").hexdigest()
    )
    assert user.post(url + "/actions", json={"action": "apply"}).status_code == 409
    assert (project / "input.txt").read_text() == "new human version"
    assert node.post(url + "/input", json=first).status_code == 409


def test_retry_same_submission_keeps_snapshot_and_rejects_forged_baseline(setup):
    user, node, _, _, _, project = setup
    run, body = submit(setup)
    (project / "input.txt").write_text("human edit")
    retry = user.post("/api/execution/tasks", json=body).json()
    assert retry["input"]["input_snapshot"] == run["input"]["input_snapshot"]
    url = f"/api/execution/tasks/{run['run_id']}"
    identity = dict(node_id="nas-a", instance_id="worker", attempt=1)
    node.post(url + "/claim", json=identity).raise_for_status()
    assert user.post(url + "/input", json=identity).status_code == 403
    assert node.post(url + "/result", json=dict(**identity, success=True)).status_code == 409
    forged = artifact("input.txt", b"overwrite", hashlib.sha256(b"human edit").hexdigest())
    rejected = node.post(
        url + "/result",
        json=dict(
            **identity,
            success=True,
            input_sha256=run["input"]["input_snapshot"]["sha256"],
            artifacts=[forged],
        ),
    )
    assert rejected.status_code == 409
    assert "pinned" in rejected.text
    assert user.get(url).json()["status"] == "running"


def test_capture_failure_never_publishes_a_claimable_job(setup, monkeypatch):
    user, node, _, _, ws, _ = setup

    def unstable(*args):
        raise ValueError("project changed while capturing execution input")

    monkeypatch.setattr("runtime.execution.node_inputs.capture_input", unstable)
    response = user.post(
        "/api/execution/tasks",
        json=dict(
            request_id="unstable", workspace_id=ws.id, node_ids=["nas-a"], goal="work", role="coder"
        ),
    )
    assert response.status_code == 409
    assert node.get("/api/execution/nodes/nas-a/pending").json()["tasks"] == []


def test_partial_network_transfer_retries_same_pinned_bytes(tmp_path):
    import httpx

    from runtime.execution.node_inputs import download_input

    source = tmp_path / "source"
    source.mkdir()
    (source / "file.txt").write_text("durable input")
    archive = tmp_path / "server.zip"
    descriptor = capture_input(source, archive)
    content = archive.read_bytes()
    calls = []

    class Interrupted(httpx.SyncByteStream):
        def __iter__(self):
            yield content[:32]
            raise httpx.ReadError("mid-transfer disconnect")

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(200, stream=Interrupted())
        return httpx.Response(200, content=content)

    with httpx.Client(
        transport=httpx.MockTransport(handler), base_url="http://localhost"
    ) as client:
        downloaded = tmp_path / "worker" / "input.zip"
        download_input(client, "/input", {"attempt": 2}, downloaded, descriptor)
    assert len(calls) == 2
    assert downloaded.read_bytes() == content
    restore_input(downloaded, tmp_path / "work", descriptor)
    assert (tmp_path / "work" / "file.txt").read_text() == "durable input"


def test_collect_outputs_canonicalizes_relative_workspace(tmp_path, monkeypatch):
    from runtime.execution.node_artifacts import collect_outputs

    (tmp_path / "project").mkdir()
    (tmp_path / "project" / "result.txt").write_text("output")
    monkeypatch.chdir(tmp_path)
    files = collect_outputs(Path("project"), {}, ["result.txt"])
    assert files[0]["sha256"] == hashlib.sha256(b"output").hexdigest()


def test_node_configuration_accepts_project_ids_without_local_mounts(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from fastapi import FastAPI

    from runtime.execution.node_worker import mount_execution_node_worker
    from tests.test_isolated_subagent import _installed_coder

    def runner(*args, **kwargs):
        return "unused"

    _installed_coder(monkeypatch, runner)
    config = tmp_path / "node.json"
    config.write_text(
        json.dumps(
            dict(
                controller_url="http://127.0.0.1:1",
                node_id="node",
                workspace_ids=["authorized-project"],
                roles=["coder"],
            )
        )
    )
    monkeypatch.setenv("ECHO_EXECUTION_NODE_CONFIG", str(config))
    monkeypatch.setenv("ECHO_EXECUTION_NODE_TOKEN", "sk-test-only")
    ctx = SimpleNamespace(app=FastAPI(), subagent_runner=runner)
    mount_execution_node_worker(ctx)
    worker = ctx.app.state.execution_node_worker
    try:
        assert worker.workspaces == {"authorized-project"}
        assert worker._thread is None  # Registration alone does not start polling.
    finally:
        worker.client.close()
