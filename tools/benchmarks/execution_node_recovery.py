"""Real HTTP/process/lease fault experiment; deterministic agent, no LLM calls.

Run from the repository root with the project Python:
  python -m tools.benchmarks.execution_node_recovery --output report.json
Never connects to a user's Echo service. All mutations are in a fresh temp root.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import httpx


def worker_main(args) -> None:
    from runtime.execution.node_worker import ExecutionNodeWorker
    from runtime.execution.subagents import market_bridge
    from runtime.execution.suckers import Skill, SkillRegistry
    from runtime.execution.suckers.builtins import _read_file
    from runtime.execution.suckers.write_skills import _write_text_file
    from runtime.execution.tool_engine import ToolExecutor
    from runtime.memory.journal import InMemoryJournal
    from runtime.platform.io.atomic import atomic_write_json
    from runtime.platform.models import ArmId, Budget, BudgetLimits, SkillId, TaskId
    from runtime.platform.process.session import current_session
    from runtime.safety.auth import TrustEngine

    registry = SkillRegistry()
    registry.register(
        Skill(
            name="read_file",
            description="read benchmark input",
            affinity=["read"],
            trusted_source="skill://public/benchmark",
            handler=_read_file,
        )
    )
    registry.register(
        Skill(
            name="write_text_file",
            description="write benchmark result",
            affinity=["write"],
            trusted_source="skill://public/benchmark",
            handler=_write_text_file,
        )
    )
    executor = ToolExecutor(
        registry=registry,
        immunity=TrustEngine(trusted_sources=["skill://public/*"]),
        journal=InMemoryJournal(),
    )
    root = Path(args.data_dir)
    root.mkdir(parents=True, exist_ok=True)

    def runner(*_args, **_kwargs):
        work = Path(current_session().metadata["workspace_path"])
        task_id = TaskId(uuid4())
        budget = Budget(task_id=task_id, limits=BudgetLimits(tokens=1000, usd=1))
        read = executor.execute_step(
            step_id=1,
            node_id="read",
            sucker_id=SkillId("read_file"),
            args={"path": str(work / "input.txt")},
            caller="benchmark",
            task_id=task_id,
            arm_id=ArmId("benchmark"),
            budget=budget,
        )
        if not read.success:
            raise RuntimeError(str(read.result))
        observed = (work / "input.txt").read_text()
        atomic_write_json(
            root / "started.json",
            dict(
                node_id=args.node_id,
                instance_id=worker.instance_id,
                observed=observed,
                pid=os.getpid(),
            ),
        )
        if args.crash_target:
            # The controller terminates this process, including the real bridge
            # worker thread, after seeing the start marker. No fake clock.
            threading.Event().wait(120)
            raise RuntimeError("fault injector failed to terminate worker")
        result = executor.execute_step(
            step_id=2,
            node_id="write",
            sucker_id=SkillId("write_text_file"),
            args={
                "path": str(work / "input.txt"),
                "content": "processed:" + observed,
                "overwrite": True,
            },
            caller="benchmark",
            task_id=task_id,
            arm_id=ArmId("benchmark"),
            budget=budget,
        )
        if not result.success:
            raise RuntimeError(str(result.result))
        return "deterministic file transformation completed"

    # Test-only role installation isolates the fixture from the user's roster.
    identity = market_bridge.MarketIdentity(
        "benchmark", "Benchmark", "", "Deterministic fault fixture"
    )
    market_bridge.market_identity_index = lambda agents_root=None: {"benchmark": identity}
    runner.agent_registry = SimpleNamespace(has=lambda role: role == "benchmark")
    with httpx.Client(
        base_url=args.controller,
        headers={"Authorization": "Bearer " + os.environ["ECHO_EXECUTION_BENCH_TOKEN"]},
        timeout=10,
    ) as client:
        actual_post = client.post
        lost = False

        def lose_first_result_response(url, **kwargs):
            nonlocal lost
            response = actual_post(url, **kwargs)
            if url.endswith("/result") and response.is_success and not lost:
                lost = True
                atomic_write_json(root / "lost-response.json", {"after_commit": True})
                raise httpx.ReadError("injected response loss after controller commit")
            return response

        if not args.crash_target:
            client.post = lose_first_result_response
        worker = ExecutionNodeWorker(
            node_id=args.node_id,
            label=args.node_id,
            workspaces={args.workspace_id: args.workspace},
            roles=["benchmark"],
            client=client,
            data_dir=root,
            runner=runner,
        )
        deadline = time.monotonic() + 100
        while time.monotonic() < deadline:
            if worker.run_once():
                return
            time.sleep(5)
        raise TimeoutError("worker did not obtain a task")


def wait_for(probe, description: str, timeout: float = 60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = probe()
        if value:
            return value
        time.sleep(0.1)
    raise TimeoutError(description)


def experiment(root: Path) -> dict:
    import uvicorn
    from fastapi import FastAPI

    from runtime.memory.cowork.collaboration_store import CollaborationStore
    from runtime.platform.io.lease import LeaseStore
    from runtime.safety.auth import Identity, IdentityStore
    from runtime.sensing.gateway.execution_nodes_router import create_execution_nodes_router
    from runtime.workspace import WorkspaceStore

    project = root / "project"
    project.mkdir()
    (project / "input.txt").write_text("version-one")
    spaces = WorkspaceStore(root / "spaces.db")
    workspace = spaces.create_workspace(
        name="Benchmark",
        mount_type="local",
        mount_target=str(project),
        mount_options={},
        owner_id="bench",
        tenant_id="bench",
    )
    identities = IdentityStore()
    token = "sk-" + secrets.token_hex(24)
    identities.add(
        Identity(actor_id="bench", roles=["operator"], metadata={"tenant_id": "bench"}),
        api_key_plaintext=token,
    )
    store = CollaborationStore(root / "controller")
    app = FastAPI()
    app.include_router(
        create_execution_nodes_router(
            collaboration_store=store,
            workspace_store=spaces,
            lease_store=LeaseStore(root / "leases.db"),
            identity_store=identities,
            require_auth=True,
        )
    )
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    endpoint = f"http://127.0.0.1:{sock.getsockname()[1]}"
    server = uvicorn.Server(uvicorn.Config(app, log_level="error", lifespan="off"))
    thread = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True)
    thread.start()
    children = []
    logs = []
    started = time.monotonic()
    try:
        wait_for(lambda: server.started, "controller did not start", 10)
        with httpx.Client(
            base_url=endpoint, headers={"Authorization": "Bearer " + token}, timeout=15
        ) as client:
            for node in ("worker-a", "worker-b"):
                client.post(
                    "/api/execution/nodes",
                    json=dict(
                        node_id=node, label=node, workspace_ids=[workspace.id], roles=["benchmark"]
                    ),
                ).raise_for_status()
            run_response = client.post(
                "/api/execution/tasks",
                json=dict(
                    request_id="recovery",
                    workspace_id=workspace.id,
                    node_ids=["worker-a", "worker-b"],
                    role="benchmark",
                    goal="Transform input.txt",
                    output_files=["input.txt"],
                ),
            )
            run_response.raise_for_status()
            run = run_response.json()
            task_url = f"/api/execution/tasks/{run['run_id']}"

            def launch(node: str, crash: bool):
                node_root = root / node
                node_root.mkdir()
                mount = node_root / "mount"
                mount.mkdir()
                (mount / "input.txt").write_text("divergent device copy")
                log = (node_root / "process.log").open("w", encoding="utf-8")
                logs.append(log)
                command = [
                    sys.executable,
                    "-m",
                    "tools.benchmarks.execution_node_recovery",
                    "--worker",
                    "--controller",
                    endpoint,
                    "--node-id",
                    node,
                    "--data-dir",
                    str(node_root / "data"),
                    "--workspace",
                    str(mount),
                    "--workspace-id",
                    workspace.id,
                ]
                if crash:
                    command.append("--crash-target")
                env = {
                    **os.environ,
                    "ECHO_EXECUTION_BENCH_TOKEN": token,
                    "ECHO_DATA_DIR": str(node_root / "runtime"),
                }
                process = subprocess.Popen(
                    command,
                    env=env,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                children.append(process)
                return process, node_root / "data"

            dead, first_root = launch("worker-a", True)
            wait_for(lambda: (first_root / "started.json").exists(), "first worker did not start")
            first = json.loads((first_root / "started.json").read_text())
            (project / "input.txt").write_text("human edit after submission")
            killed_at = time.monotonic()
            dead.terminate()
            dead.wait(timeout=10)
            replacement, second_root = launch("worker-b", False)

            def completed():
                response = client.get(task_url)
                response.raise_for_status()
                value = response.json()
                if value["status"] == "failed":
                    raise RuntimeError(value.get("error"))
                return value if value["status"] == "completed" else None

            final = wait_for(completed, "replacement failed to deliver", 60)
            recovery_seconds = time.monotonic() - killed_at
            replacement.wait(timeout=20)
            second = json.loads((second_root / "started.json").read_text())
            stale = client.post(
                task_url + "/result",
                json=dict(
                    node_id="worker-a",
                    instance_id=first["instance_id"],
                    attempt=1,
                    success=True,
                    input_sha256=run["input"]["input_snapshot"]["sha256"],
                    output="obsolete",
                ),
            )
            conflict = client.post(task_url + "/actions", json={"action": "apply"})
            preserved = (project / "input.txt").read_text() == "human edit after submission"
            (project / "input.txt").write_text("version-one")
            applied = client.post(task_url + "/actions", json={"action": "apply"})
            events = store.collaboration_run_events(run["run_id"])
            commits = sum(event["status"] == "completed" for event in events)
            checks = dict(
                lease_reclaimed=final["attempt"] == 2,
                pinned_input_on_both_workers=first["observed"]
                == second["observed"]
                == "version-one",
                stale_result_rejected=stale.status_code == 409,
                lost_response_replayed=(second_root / "lost-response.json").exists()
                and replacement.returncode == 0,
                one_committed_delivery=commits == 1,
                human_edit_preserved=conflict.status_code == 409 and preserved,
                verified_apply=applied.status_code == 200
                and (project / "input.txt").read_text() == "processed:version-one",
            )
            return dict(
                schema="echo.execution_recovery_benchmark.v1",
                created_at=datetime.now(UTC).isoformat(),
                platform=platform.platform(),
                python=platform.python_version(),
                transport="real loopback HTTP",
                isolation="two OS worker processes; same physical host",
                model="deterministic runner, real subagent bridge and file tool; no LLM",
                clock="wall clock; production 15-second lease, no time mocking",
                worker_poll_seconds=5,
                checks=checks,
                passed=all(checks.values()),
                recovery_seconds=round(recovery_seconds, 3),
                elapsed_seconds=round(time.monotonic() - started, 3),
                claimed_attempts=final["attempt"],
                committed_deliveries=commits,
                input_snapshot=run["input"]["input_snapshot"],
                ax_comparison="not run; this report is not a cross-product score",
            )
    finally:
        for process in children:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
        for log in logs:
            log.close()
        server.should_exit = True
        thread.join(timeout=5)
        sock.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    for name in ("controller", "node-id", "data-dir", "workspace", "workspace-id"):
        parser.add_argument("--" + name, help=argparse.SUPPRESS)
    parser.add_argument("--crash-target", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        worker_main(args)
        return 0
    with tempfile.TemporaryDirectory(prefix="echo-recovery-bench-") as temporary:
        prior_data_dir = os.environ.get("ECHO_DATA_DIR")
        os.environ["ECHO_DATA_DIR"] = str(Path(temporary) / "controller-runtime")
        try:
            result = experiment(Path(temporary))
        except Exception as exc:
            result = {
                "passed": False,
                "error": str(exc),
                "worker_logs": {
                    str(path.relative_to(temporary)): path.read_text(
                        encoding="utf-8", errors="replace"
                    )[-6000:]
                    for path in Path(temporary).glob("*/process.log")
                },
            }
        finally:
            if prior_data_dir is None:
                os.environ.pop("ECHO_DATA_DIR", None)
            else:
                os.environ["ECHO_DATA_DIR"] = prior_data_dir
    encoded = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, ensure_ascii=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
