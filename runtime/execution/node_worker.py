"""Outbound-only Echo execution worker, hosted by the existing Echo service."""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import replace
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx

from runtime.execution.host_boundary import create_host_execution_boundary
from runtime.execution.node_artifacts import collect_outputs
from runtime.execution.node_inputs import download_input, restore_input
from runtime.execution.request import execution_request_scope
from runtime.execution.subagents.bridge import call_subagent
from runtime.platform.io.atomic import atomic_write_json
from runtime.platform.process.scope import ExecutionScope
from runtime.platform.process.session import session_scope
from runtime.safety.approval.cancellation import CancellationSource, scoped_cancellation

_LOG = logging.getLogger(__name__)


class ExecutionNodeWorker:
    def __init__(
        self,
        *,
        node_id: str,
        label: str,
        workspaces: dict[str, str] | list[str],
        roles: list[str],
        client: Any,
        data_dir: Path,
        runner: Any,
    ):
        self.node_id, self.label = node_id, label
        # Stable project authorization, independent of a node's mount paths.
        # Existing path-map configurations remain accepted by using their keys.
        self.workspaces = frozenset(workspaces)
        self.roles, self.client, self.runner = roles, client, runner
        self.data_dir = Path(data_dir).expanduser().resolve()
        self.instance_id = uuid4().hex
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._active: CancellationSource | None = None

    def _request(self, path, body=None):
        response = self.client.get(path) if body is None else self.client.post(path, json=body)
        response.raise_for_status()
        return response.json()

    def advertise(self):
        self._request(
            "/api/execution/nodes",
            dict(
                node_id=self.node_id,
                label=self.label,
                workspace_ids=list(self.workspaces),
                roles=self.roles,
            ),
        )

    def run_once(self) -> bool:
        self.advertise()
        pending = self._request(f"/api/execution/nodes/{self.node_id}/pending")["tasks"]
        for run in pending:
            if self._stop.is_set():
                return False
            try:
                claimed = self._request(
                    f"/api/execution/tasks/{run['run_id']}/claim",
                    dict(node_id=self.node_id, instance_id=self.instance_id),
                )
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code in {403, 404, 409}:
                    continue
                raise
            self._execute(claimed)
            return True
        return False

    def _execute(self, run):
        run_id, spec = run["run_id"], run["input"]
        identity = dict(node_id=self.node_id, instance_id=self.instance_id, attempt=run["attempt"])
        attempt_root = self.data_dir / run_id / f"{run['attempt']}-{self.instance_id}"
        saved = attempt_root / "delivery.json"
        if saved.is_file():
            self._request(
                f"/api/execution/tasks/{run_id}/result",
                json.loads(saved.read_text(encoding="utf-8")),
            )
            return
        cancellation = CancellationSource()
        self._active = cancellation
        done = threading.Event()

        def heartbeat():
            while not done.wait(3):
                try:
                    self._request(f"/api/execution/tasks/{run_id}/heartbeat", identity)
                    self.advertise()
                except Exception as exc:
                    _LOG.warning(
                        "execution claim unavailable for %s: %s", run_id, type(exc).__name__
                    )
                    cancellation.cancel(reason="execution claim unavailable")
                    return

        pulse = threading.Thread(target=heartbeat, name="execution-node-heartbeat", daemon=True)
        pulse.start()
        work = attempt_root / "workspace"
        try:
            if spec["workspace_id"] not in self.workspaces or spec["role"] not in self.roles:
                raise PermissionError("local node configuration no longer permits this task")
            with scoped_cancellation(cancellation.token):
                descriptor = spec.get("input_snapshot")
                if not descriptor:
                    raise ValueError("legacy task has no pinned input; submit a new task")
                archive = attempt_root / "input.zip"
                download_input(
                    self.client,
                    f"/api/execution/tasks/{run_id}/input",
                    identity,
                    archive,
                    descriptor,
                )
                baseline = restore_input(archive, work, descriptor)
                cancellation.token.throw_if_cancelled()
                boundary = create_host_execution_boundary(
                    task_id=run_id,
                    thread_id=run_id,
                    goal=spec["goal"],
                    timeout_s=spec["timeout_s"],
                    actor_id=spec["actor_id"],
                    tenant_id=spec["tenant_id"],
                    metadata={"mode": "code", "workspace_path": str(work)},
                )
                permissions = ExecutionScope(
                    "code",
                    "code",
                    (work,),
                    (work,),
                    network_policy="deny",
                    browser_policy="deny",
                    shell_policy="deny",
                )
                resolve_backend = getattr(self.runner, "execution_backend_for", None)
                if callable(resolve_backend) and resolve_backend(spec["role"]) not in {
                    "native",
                    "echo",
                }:
                    raise PermissionError(
                        "remote snapshot jobs require the native engine's enforced tool contract"
                    )
                allowed_tools = frozenset(
                    {
                        "read_file",
                        "read_text_file",
                        "list_directory",
                        "list_cwd",
                        "grep_text",
                        "write_text_file",
                        "edit_text_file",
                        "edit_file",
                        "multi_edit_file",
                        "append_text_file",
                    }
                )
                task = replace(
                    boundary.request.task, permissions=permissions, allowed_tools=allowed_tools
                )
                boundary.session.metadata["_execution_task"] = task
                request = replace(boundary.request, task=task)
                with session_scope(boundary.session), execution_request_scope(request):
                    result = call_subagent(
                        spec["role"],
                        spec["goal"],
                        session=boundary.session,
                        runner=self.runner,
                        context={
                            "_require_installed_market_role": True,
                            "disable_auto_retry": True,
                        },
                        timeout_seconds=spec["timeout_s"],
                    )
                cancellation.token.throw_if_cancelled()
                if not result.get("success"):
                    raise RuntimeError(str(result.get("error") or "agent execution failed"))
                artifacts = collect_outputs(work, baseline, spec["output_files"])
                payload = dict(
                    **identity,
                    input_sha256=descriptor["sha256"],
                    success=True,
                    output=str(result.get("output") or "")[:64000],
                    artifacts=artifacts,
                )
        except Exception as exc:
            payload = dict(**identity, success=False, error=f"{type(exc).__name__}: {exc}"[:4000])
        try:
            # Persist before sending, so a lost response never loses the bytes.
            attempt_root.mkdir(parents=True, exist_ok=True)
            atomic_write_json(attempt_root / "delivery.json", payload)
            if not cancellation.token.is_cancelled:
                for retry in range(3):
                    try:
                        self._request(f"/api/execution/tasks/{run_id}/result", payload)
                        break
                    except httpx.TransportError:
                        if retry == 2 or done.wait(0.5):
                            raise
        finally:
            done.set()
            pulse.join(timeout=6)
            self._active = None

    def start(self):
        def serve():
            while not self._stop.is_set():
                try:
                    if self.run_once():
                        continue
                except Exception as exc:
                    _LOG.warning("execution node poll failed: %s", type(exc).__name__)
                self._stop.wait(5)

        self._thread = threading.Thread(target=serve, name="echo-execution-node", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._active is not None:
            self._active.cancel(reason="execution node stopping")
        if self._thread:
            self._thread.join(timeout=6)


def mount_execution_node_worker(ctx) -> None:
    """Opt in with an operator-owned JSON file; secrets come from an env var."""
    import os
    from urllib.parse import urlparse

    config_path = os.environ.get("ECHO_EXECUTION_NODE_CONFIG", "").strip()
    if not config_path:
        return
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    endpoint = str(config["controller_url"]).rstrip("/")
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
        raise ValueError("execution controller must be an HTTP(S) URL without embedded credentials")
    if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("non-loopback execution controller requires HTTPS")
    token = os.environ.get(str(config.get("token_env", "ECHO_EXECUTION_NODE_TOKEN")), "")
    if not token:
        raise ValueError("execution node token environment variable is missing")
    from runtime.execution.subagents.market_bridge import runnable_market_roles
    from runtime.platform.process.paths import app_paths

    installed = runnable_market_roles(ctx.subagent_runner)
    backend = getattr(ctx.subagent_runner, "execution_backend_for", None)
    roles = config["roles"]
    if not roles or any(
        role not in installed or (callable(backend) and backend(role) not in {"native", "echo"})
        for role in roles
    ):
        raise ValueError("execution node roles must be installed and use the native engine")
    workspaces = config.get("workspace_ids", config.get("workspaces"))
    if not isinstance(workspaces, (list, dict)) or not workspaces or len(workspaces) > 256:
        raise ValueError("execution node requires 1..256 authorized workspace IDs")
    from runtime.memory.cowork.ids import require_cowork_id

    for workspace_id in workspaces:
        require_cowork_id(workspace_id, label="workspace ID")

    client = httpx.Client(
        base_url=endpoint,
        headers={"Authorization": f"Bearer {token}"},
        timeout=5,
        follow_redirects=False,
    )
    worker = ExecutionNodeWorker(
        node_id=config["node_id"],
        label=config.get("label", config["node_id"]),
        workspaces=workspaces,
        roles=roles,
        client=client,
        data_dir=app_paths().data_dir / "execution-node",
        runner=ctx.subagent_runner,
    )
    ctx.app.state.execution_node_worker = worker
    ctx.app.router.add_event_handler("startup", worker.start)

    def stop():
        worker.stop()
        client.close()

    ctx.app.router.add_event_handler("shutdown", stop)
