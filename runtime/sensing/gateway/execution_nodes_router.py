"""Authenticated task dispatch, node claims and verified result collection."""

from __future__ import annotations

import hashlib
from contextlib import ExitStack
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.responses import FileResponse

from runtime.execution.node_artifacts import (
    MAX_DELIVERY,
    apply_delivery,
    receive_artifact,
    relative_path,
)
from runtime.execution.node_control import ExecutionNodeControl
from runtime.execution.node_inputs import read_manifest, verify_archive
from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.platform.io.lease import LeaseStore
from runtime.safety.auth.principal import require_operator, resolve_principal
from runtime.workspace import WorkspaceStore
from runtime.workspace.execution_directory import execution_directory


class NodeAdvertisement(BaseModel):
    node_id: str = Field(min_length=1, max_length=64)
    label: str = Field(max_length=120)
    workspace_ids: list[str] = Field(max_length=256)
    roles: list[str] = Field(min_length=1, max_length=256)


class NodeTaskRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    workspace_id: str
    node_ids: list[str] = Field(min_length=1, max_length=16)
    goal: str = Field(min_length=1, max_length=32000)
    role: str
    output_files: list[str] = Field(default_factory=list, max_length=32)
    timeout_s: int = Field(default=900, ge=5, le=3600)


class NodeClaim(BaseModel):
    node_id: str = Field(min_length=1, max_length=64)
    instance_id: str = Field(min_length=1, max_length=64)
    attempt: int = Field(default=0, ge=0)


class NodeArtifact(BaseModel):
    path: str = Field(max_length=1024)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    baseline_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    content: str = Field(max_length=12 * 1024 * 1024)


class NodeResult(NodeClaim):
    input_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    success: bool
    output: str = Field(default="", max_length=64000)
    error: str = Field(default="", max_length=4000)
    artifacts: list[NodeArtifact] = Field(default_factory=list, max_length=32)


class TaskAction(BaseModel):
    action: Literal["pause", "resume", "cancel", "apply"]


def create_execution_nodes_router(
    *,
    collaboration_store=None,
    workspace_store=None,
    lease_store=None,
    identity_store=None,
    require_auth=False,
    jwt_secret=None,
    jwt_issuer=None,
    jwt_audience=None,
) -> APIRouter:
    store = collaboration_store or CollaborationStore()
    spaces = workspace_store or WorkspaceStore()
    leases = lease_store or LeaseStore()
    control = ExecutionNodeControl(store)
    router = APIRouter(prefix="/api/execution", tags=["execution"])
    auth_options = dict(jwt_secret=jwt_secret, jwt_issuer=jwt_issuer, jwt_audience=jwt_audience)

    def principal(request, *, operator=False):
        resolver = require_operator if operator else resolve_principal
        value = resolver(request, identity_store, require_auth, **auth_options)
        return (value.tenant_id, value.actor_id) if value else ("local", "local")

    def workspace(workspace_id, tenant, actor):
        ws = spaces.get_workspace(workspace_id)
        if ws is None or (
            require_auth
            and (
                ws.tenant_id != tenant
                or spaces.get_member_role(ws.id, actor) not in {"owner", "editor"}
            )
        ):
            raise HTTPException(404, "writable workspace not found")
        return ws

    def owned_run(request, run_id, kind="execution_node"):
        tenant, actor = principal(request)
        run = store.collaboration_run(run_id)
        if (
            not run
            or run["kind"] != kind
            or (run["input"]["tenant_id"], run["input"]["actor_id"]) != (tenant, actor)
        ):
            raise HTTPException(404, "execution task not found")
        return run

    def worker_run(request, run_id, body):
        tenant, actor = principal(request, operator=True)
        node = control.verify_node(body.node_id, tenant, actor)
        run = store.collaboration_run(run_id)
        if (
            not run
            or run["kind"] != "execution_node"
            or run["input"]["tenant_id"] != tenant
            or body.node_id not in run["input"]["node_ids"]
        ):
            raise HTTPException(404, "execution task not found")
        spec = run["input"]
        if spec["workspace_id"] not in node["workspace_ids"] or spec["role"] not in node["roles"]:
            raise PermissionError("node no longer provides this workspace and role")
        workspace(spec["workspace_id"], tenant, spec["actor_id"])
        return run, node

    def conflict(exc):
        return HTTPException(409, str(exc))

    @router.post("/nodes")
    def advertise(request: Request, body: NodeAdvertisement):
        tenant, actor = principal(request, operator=True)
        try:
            control.advertise(
                node_id=body.node_id,
                tenant_id=tenant,
                actor_id=actor,
                label=body.label,
                workspaces=body.workspace_ids,
                roles=body.roles,
            )
            return {"registered": True}
        except (ValueError, PermissionError) as exc:
            raise conflict(exc) from exc

    @router.get("/nodes")
    def nodes(request: Request, workspace_id: str):
        tenant, actor = principal(request)
        workspace(workspace_id, tenant, actor)
        return {"nodes": [n for n in control.nodes(tenant) if workspace_id in n["workspace_ids"]]}

    @router.post("/tasks")
    def submit(request: Request, body: NodeTaskRequest):
        tenant, actor = principal(request)
        ws = workspace(body.workspace_id, tenant, actor)
        probe = execution_directory(ws)
        try:
            return control.submit(
                tenant_id=tenant,
                actor_id=actor,
                snapshot_source=Path(probe["filesystem_path"]) if probe["ready"] else None,
                **body.model_dump(),
            )
        except (ValueError, RuntimeError, OSError) as exc:
            raise conflict(exc) from exc

    @router.get("/tasks")
    def tasks(request: Request):
        tenant, actor = principal(request)
        return {"tasks": control.runs(tenant_id=tenant, actor_id=actor)}

    @router.get("/invocations")
    def invocations(request: Request):
        tenant, actor = principal(request)
        return {
            "invocations": control.runs(tenant_id=tenant, actor_id=actor, kind="engine_invocation")
        }

    @router.post("/invocations/{run_id}/cancel")
    def cancel_invocation(request: Request, run_id: str):
        owned_run(request, run_id, kind="engine_invocation")
        try:
            return store.transition_collaboration_run(
                run_id, status="cancelled", event_type="cancel"
            )
        except (ValueError, RuntimeError) as exc:
            raise conflict(exc) from exc

    @router.get("/tasks/{run_id}")
    def task(request: Request, run_id: str):
        run = owned_run(request, run_id)
        return {**run, "events": store.collaboration_run_events(run_id)}

    @router.get("/nodes/{node_id}/pending")
    def pending(request: Request, node_id: str):
        tenant, actor = principal(request, operator=True)
        try:
            node = control.verify_node(node_id, tenant, actor)
        except PermissionError as exc:
            raise HTTPException(404, "execution node not found") from exc
        runs = control.pending(tenant_id=tenant, node=node)
        authorized = []
        for run in runs:
            try:
                workspace(run["input"]["workspace_id"], tenant, run["input"]["actor_id"])
            except HTTPException:
                continue
            authorized.append(run)
        return {
            "tasks": [
                r
                for r in authorized
                if r["status"] in {"queued", "interrupted", "running"}
                and node_id in r["input"]["node_ids"]
                and r["input"]["workspace_id"] in node["workspace_ids"]
            ]
        }

    @router.post("/tasks/{run_id}/claim")
    def claim(request: Request, run_id: str, body: NodeClaim):
        try:
            _, node = worker_run(request, run_id, body)
            return control.claim(run_id, node=node, instance_id=body.instance_id)
        except (ValueError, RuntimeError, PermissionError, KeyError) as exc:
            raise conflict(exc) from exc

    @router.post("/tasks/{run_id}/heartbeat")
    def heartbeat(request: Request, run_id: str, body: NodeClaim):
        try:
            worker_run(request, run_id, body)
            return store.heartbeat_collaboration_run(
                run_id,
                worker_id=f"{body.node_id}:{body.instance_id}",
                expected_attempt=body.attempt,
                lease_seconds=15,
            )
        except (ValueError, RuntimeError, PermissionError) as exc:
            raise conflict(exc) from exc

    @router.post("/tasks/{run_id}/result")
    def result(request: Request, run_id: str, body: NodeResult):
        try:
            run, _ = worker_run(request, run_id, body)
            descriptor = run["input"].get("input_snapshot")
            if descriptor and body.success and body.input_sha256 != descriptor["sha256"]:
                raise ValueError("result must acknowledge the pinned execution input")
            delivery_hash = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
            if run["status"] in {"completed", "failed"}:
                previous = run.get("result") or {}
                if (
                    previous.get("delivery_id")
                    == f"{body.node_id}:{body.instance_id}:{body.attempt}"
                    and previous.get("delivery_sha256") == delivery_hash
                ):
                    return run
                raise RuntimeError("task already finished by another attempt")
            store.heartbeat_collaboration_run(
                run_id,
                worker_id=f"{body.node_id}:{body.instance_id}",
                expected_attempt=body.attempt,
                lease_seconds=15,
            )
            root = store.base_dir / "execution-artifacts" / run_id / str(body.attempt)
            if descriptor and body.success:
                verify_archive(control.input_archive(run_id), descriptor)
                manifest = read_manifest(control.input_archive(run_id))
                for artifact in body.artifacts:
                    expected = manifest.get(relative_path(artifact.path), {}).get("sha256")
                    if artifact.baseline_sha256 != expected:
                        raise ValueError("delivery baseline does not match pinned execution input")
            if sum(len(a.content) for a in body.artifacts) > (MAX_DELIVERY * 4 // 3 + 128):
                raise ValueError("delivery exceeds 32 MiB")
            names = [relative_path(a.path).casefold() for a in body.artifacts]
            if len(names) != len(set(names)):
                raise ValueError("duplicate delivery paths")
            if (
                root.exists()
                and sum(p.stat().st_size for p in root.iterdir() if p.is_file()) > MAX_DELIVERY
            ):
                raise ValueError("delivery storage limit reached")
            artifacts = (
                [receive_artifact(root, a.model_dump()) for a in body.artifacts]
                if body.success
                else []
            )
            payload = dict(
                output=body.output,
                artifacts=artifacts,
                delivery_sha256=delivery_hash,
                delivery_id=f"{body.node_id}:{body.instance_id}:{body.attempt}",
            )
            return store.transition_collaboration_run(
                run_id,
                status="completed" if body.success else "failed",
                result=payload,
                error=body.error,
                worker_id=f"{body.node_id}:{body.instance_id}",
                expected_attempt=body.attempt,
            )
        except (ValueError, RuntimeError, PermissionError, OSError) as exc:
            raise conflict(exc) from exc

    @router.post("/tasks/{run_id}/input")
    def input_snapshot(request: Request, run_id: str, body: NodeClaim):
        try:
            run, _ = worker_run(request, run_id, body)
            store.heartbeat_collaboration_run(
                run_id,
                worker_id=f"{body.node_id}:{body.instance_id}",
                expected_attempt=body.attempt,
                lease_seconds=15,
            )
            descriptor = run["input"].get("input_snapshot")
            if not descriptor:
                raise ValueError("legacy task has no pinned input; submit a new task")
            archive = control.input_archive(run_id)
            verify_archive(archive, descriptor)
            return FileResponse(archive, media_type="application/zip", filename="input.zip")
        except (ValueError, RuntimeError, PermissionError, OSError) as exc:
            raise conflict(exc) from exc

    @router.post("/tasks/{run_id}/actions")
    def action(request: Request, run_id: str, body: TaskAction):
        run = owned_run(request, run_id)
        try:
            if body.action != "apply":
                target = {"pause": "waiting", "resume": "queued", "cancel": "cancelled"}[
                    body.action
                ]
                return store.transition_collaboration_run(
                    run_id, status=target, event_type=body.action
                )
            if run["status"] != "completed":
                raise ValueError("only completed deliveries can be applied")
            spec = run["input"]
            ws = workspace(spec["workspace_id"], spec["tenant_id"], spec["actor_id"])
            probe = execution_directory(ws)
            if not probe["ready"]:
                raise ValueError(
                    "workspace must be mounted on the controller to apply; download artifacts otherwise"
                )
            artifacts = (run.get("result") or {}).get("artifacts", [])
            with ExitStack() as release:
                for artifact in artifacts:
                    old = leases.get_by_path(ws.id, artifact["path"])
                    acquired = leases.acquire(ws.id, artifact["path"], spec["actor_id"])
                    if old is None or old.lease_id != acquired.lease_id:
                        release.callback(leases.release, acquired.lease_id)
                apply_delivery(
                    Path(probe["filesystem_path"]),
                    store.base_dir / "execution-artifacts" / run_id / str(run["attempt"]),
                    artifacts,
                )
            return {"applied": True, "files": len(artifacts)}
        except Exception as exc:
            if isinstance(exc, HTTPException):
                raise
            raise conflict(exc) from exc

    @router.get("/tasks/{run_id}/artifacts/{index}")
    def download(request: Request, run_id: str, index: int):
        run = owned_run(request, run_id)
        artifacts = (run.get("result") or {}).get("artifacts", [])
        if index < 0 or index >= len(artifacts):
            raise HTTPException(404, "artifact not found")
        artifact = artifacts[index]
        return FileResponse(
            store.base_dir
            / "execution-artifacts"
            / run_id
            / str(run["attempt"])
            / artifact["sha256"],
            filename=Path(artifact["path"]).name,
        )

    return router
