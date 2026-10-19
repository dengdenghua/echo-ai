"""Deterministic multi-agent release benchmark.

This is intentionally not an LLM leaderboard.  It locks down the platform
properties that must hold regardless of model choice: addressing, context
economy, evidence envelopes, recovery, deduplication, and bounded latency.
"""

from __future__ import annotations

import json
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.evals.multi_agent_benchmark_scenarios import (  # noqa: F401  re-export: import sites stay stable
    _adaptive_recall_metrics as _adaptive_recall_metrics,
)
from runtime.evals.multi_agent_benchmark_scenarios import (
    _channel_ingress_metrics as _channel_ingress_metrics,
)
from runtime.evals.multi_agent_benchmark_scenarios import (
    _context_lifecycle_metrics as _context_lifecycle_metrics,
)
from runtime.evals.multi_agent_benchmark_scenarios import (
    _context_metrics as _context_metrics,
)
from runtime.evals.multi_agent_benchmark_scenarios import (
    _continuation_prompt_metrics as _continuation_prompt_metrics,
)
from runtime.evals.multi_agent_benchmark_scenarios import (
    _fanout_metrics as _fanout_metrics,
)
from runtime.evals.multi_agent_benchmark_scenarios import (
    _governance_metrics as _governance_metrics,
)
from runtime.evals.multi_agent_benchmark_scenarios import (
    _hybrid_context_metrics as _hybrid_context_metrics,
)
from runtime.evals.multi_agent_benchmark_scenarios import (
    _incremental_context_metrics as _incremental_context_metrics,
)
from runtime.evals.multi_agent_benchmark_scenarios import (
    _members as _members,
)
from runtime.evals.multi_agent_benchmark_scenarios import (
    _pluggable_context_metrics as _pluggable_context_metrics,
)
from runtime.evals.multi_agent_benchmark_scenarios import (
    _recovery_metrics as _recovery_metrics,
)
from runtime.evals.multi_agent_benchmark_scenarios import (
    _session_compaction_metrics as _session_compaction_metrics,
)
from runtime.evals.multi_agent_benchmark_scenarios import (
    _stale_goal_resurrection_metrics as _stale_goal_resurrection_metrics,
)
from runtime.evals.multi_agent_benchmark_scenarios import (
    _steering_metrics as _steering_metrics,
)
from runtime.evals.multi_agent_benchmark_scenarios import (
    _summary_grant_metrics as _summary_grant_metrics,
)
from runtime.execution.suckers._delegation_skills_graph import (
    _coerce_condition,
    _evaluate_condition,
)
from runtime.memory.cowork.async_runner import AsyncWorkRunner
from runtime.memory.cowork.async_work import AsyncWorkQueueFullError, AsyncWorkStore
from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.group_store import GroupStore
from runtime.sensing.gateway.cowork_group_router import create_cowork_group_router
from runtime.sensing.gateway.remote_transport import (
    RemoteBackend,
    SshTunnel,
    SshTunnelError,
    connect_remote_backend,
)

_THRESHOLDS = {
    "context_reduction_ratio": 0.60,
    "max_selected_context_tokens": 20_000,
    "addressing_precision": 1.0,
    "response_success_ratio": 1.0,
    "evidence_coverage_ratio": 1.0,
    "recovery_success_ratio": 1.0,
    "visible_duplicate_count": 0,
    "durable_subtree_concurrency": 1.0,
    "actual_usage_breaker": 1.0,
    "durable_collector": 1.0,
    "collector_retry_retention": 1.0,
    "collector_archive_retention": 1.0,
    "member_live_steering": 1.0,
    "member_targeted_cancel": 1.0,
    "member_incremental_context": 1.0,
    "persistent_member_projection": 1.0,
    "member_session_serialization": 1.0,
    "pluggable_context_engine": 1.0,
    "versioned_context_engine_lifecycle": 1.0,
    "continuation_prompt_ordering": 1.0,
    "hybrid_context_diversity": 1.0,
    "adaptive_long_horizon_recall": 1.0,
    "transactional_context_lifecycle": 1.0,
    "durable_session_compaction": 1.0,
    "summary_grant_context": 1.0,
    "stale_goal_resurrection_guard": 1.0,
    "collector_retry_dedup": 1.0,
    "bounded_retry_queue": 1.0,
    "fair_queue_scheduling": 1.0,
    "cross_run_batch_retry": 1.0,
    "cross_run_batch_cancel": 1.0,
    "bounded_decision_control": 1.0,
    "ssh_transport_fail_closed": 1.0,
    "channel_claim_winners": 1,
    "wall_time_ms": 2_000.0,
}


def _collector_metrics(root: Path) -> dict[str, Any]:
    """Prove fan-out children converge after a coordinator restart."""

    store = CollaborationStore(root / "collector-cowork")
    store.create_collaboration_run(
        run_id="benchmark-collector",
        session_id="benchmark-thread",
        kind="group_fanout",
    )
    store.claim_collaboration_run("benchmark-collector", worker_id="benchmark-worker")
    store.create_collaboration_collector(
        run_id="benchmark-collector",
        child_ids=["architect", "coder", "reviewer"],
        completion_policy="all",
    )
    store.record_collaboration_collector_result(
        "benchmark-collector",
        child_id="architect",
        status="success",
        result={"answer": "A"},
    )
    restarted = CollaborationStore(root / "collector-cowork")
    restarted.record_collaboration_collector_result(
        "benchmark-collector",
        child_id="coder",
        status="failed",
        result={"error": "transient"},
    )
    restarted.record_collaboration_collector_result(
        "benchmark-collector",
        child_id="reviewer",
        status="success",
        result={"answer": "C"},
    )
    reopened = restarted.reopen_collaboration_collector("benchmark-collector")
    settled = restarted.record_collaboration_collector_result(
        "benchmark-collector",
        child_id="coder",
        status="success",
        result={"answer": "B"},
    )
    event_count = len(restarted.collaboration_run_events("benchmark-collector"))
    duplicate = restarted.record_collaboration_collector_result(
        "benchmark-collector",
        child_id="coder",
        status="success",
        result={"answer": "B"},
    )
    restarted.create_collaboration_run(
        run_id="benchmark-retry-race",
        session_id="benchmark-thread",
        kind="group_fanout",
    )
    restarted.claim_collaboration_run(
        "benchmark-retry-race",
        worker_id="benchmark-worker",
    )
    restarted.create_collaboration_collector(
        run_id="benchmark-retry-race",
        child_ids=["coder"],
    )
    restarted.record_collaboration_collector_result(
        "benchmark-retry-race",
        child_id="coder",
        status="failed",
        result={"error": "transient"},
    )
    retry_stores = [
        CollaborationStore(root / "collector-cowork"),
        CollaborationStore(root / "collector-cowork"),
    ]
    retry_barrier = Barrier(2)

    def bind_retry(index: int) -> str:
        retry_barrier.wait(timeout=5)
        try:
            retry_stores[index].bind_collaboration_collector_retry_task(
                "benchmark-retry-race",
                child_id="coder",
                task_id=f"benchmark-retry-task-{index}",
            )
        except ValueError:
            return "occupied"
        return "bound"

    with ThreadPoolExecutor(max_workers=2) as pool:
        retry_outcomes = list(pool.map(bind_retry, range(2)))
    for run_id in ("benchmark-retention-old", "benchmark-retention-new"):
        restarted.create_collaboration_run(
            run_id=run_id,
            session_id="benchmark-retention-thread",
            kind="group_fanout",
        )
        restarted.claim_collaboration_run(run_id, worker_id="benchmark-worker")
        restarted.create_collaboration_collector(run_id=run_id, child_ids=["reviewer"])
        restarted.record_collaboration_collector_result(
            run_id,
            child_id="reviewer",
            status="success",
            result={"reply": f"large result body for {run_id}"},
        )
        restarted.transition_collaboration_run(run_id, status="completed")
    retention = restarted.apply_collaboration_collector_retention(
        session_id="benchmark-retention-thread",
        ttl_seconds=0,
        max_collectors_per_session=1,
    )
    archived_retention = restarted.collaboration_collector("benchmark-retention-old")
    live_retention = restarted.collaboration_collector("benchmark-retention-new")
    return {
        "durable_collector": (
            1.0
            if settled["status"] == "completed"
            and settled["success_count"] == 3
            and settled["cancellation_requested_child_ids"] == []
            and duplicate == settled
            and len(restarted.collaboration_run_events("benchmark-collector")) == event_count
            else 0.0
        ),
        "collector_retry_retention": (
            1.0
            if reopened["active_retry_child_ids"] == ["coder"]
            and reopened["remaining_child_ids"] == ["coder"]
            and settled["attempt_count"] == 4
            and [
                (item["child_id"], item["attempt"], item["status"])
                for item in restarted.collaboration_collector_attempts("benchmark-collector")
            ]
            == [
                ("architect", 1, "success"),
                ("coder", 1, "failed"),
                ("coder", 2, "success"),
                ("reviewer", 1, "success"),
            ]
            else 0.0
        ),
        "collector_retry_dedup": (1.0 if sorted(retry_outcomes) == ["bound", "occupied"] else 0.0),
        "collector_archive_retention": (
            1.0
            if retention == {"archived": 1, "run_ids": ["benchmark-retention-old"]}
            and archived_retention is not None
            and archived_retention["archived"] is True
            and archived_retention["attempt_count"] == 1
            and archived_retention["results"][0]["result"] == {"archived": True}
            and live_retention is not None
            and live_retention["archived"] is False
            else 0.0
        ),
    }


def _queue_metrics(root: Path) -> dict[str, Any]:
    """Prove concurrent workers cannot overbook a retry queue."""

    queue_root = root / "queue-cowork"
    groups = GroupStore(base_dir=queue_root)
    stores = [
        AsyncWorkStore(
            base_dir=queue_root,
            group_store=groups,
            max_active_per_thread=2,
            max_active_total=2,
        )
        for _ in range(2)
    ]
    barrier = Barrier(2)

    def reserve(index: int) -> str:
        barrier.wait(timeout=5)
        try:
            stores[index].stage_batch(
                f"benchmark-thread-{index}",
                [
                    (f"benchmark-task-{index}-a", "architect", "verify capacity"),
                    (f"benchmark-task-{index}-b", "reviewer", "verify capacity"),
                ],
                actor="benchmark",
            )
        except AsyncWorkQueueFullError:
            return "full"
        return "reserved"

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(reserve, range(2)))
    health = stores[0].queue_health("benchmark-thread-0")
    return {
        "bounded_retry_queue": (
            1.0
            if sorted(outcomes) == ["full", "reserved"]
            and health["total_active"] == 2
            and health["total_available"] == 0
            else 0.0
        ),
        "retry_queue_claim_winners": outcomes.count("reserved"),
        "retry_queue_total_active": health["total_active"],
    }


def _scheduler_metrics(root: Path) -> dict[str, Any]:
    """Prove a large room cannot monopolize a bounded runner tick."""

    scheduler_root = root / "scheduler-cowork"
    groups = GroupStore(base_dir=scheduler_root)
    store = AsyncWorkStore(base_dir=scheduler_root, group_store=groups)
    heavy = [
        store.assign("benchmark-heavy", "architect", f"heavy-{index}", actor="benchmark")
        for index in range(3)
    ]
    light = store.assign(
        "benchmark-light",
        "reviewer",
        "light-0",
        actor="benchmark",
    )
    runner = AsyncWorkRunner(
        store,
        groups,
        lambda task, _context: task.prompt,
        max_concurrency=1,
        max_tasks_per_tick=2,
    )
    ran = runner.tick_once()
    heavy_statuses = [
        current.status if (current := store.get(task.task_id)) is not None else None
        for task in heavy
    ]
    light_task = store.get(light.task_id)
    light_status = light_task.status if light_task is not None else None
    return {
        "fair_queue_scheduling": (
            1.0
            if ran == 2
            and heavy_statuses == ["done", "pending", "pending"]
            and light_status == "done"
            else 0.0
        ),
        "scheduler_first_tick_completed": ran,
        "scheduler_last_concurrency": runner.status()["last_concurrency"],
    }


def _batch_retry_metrics(root: Path) -> dict[str, Any]:
    """Prove failed lanes from multiple runs are reserved and activated together."""

    batch_root = root / "batch-retry-cowork"
    groups = GroupStore(base_dir=batch_root)
    queue = AsyncWorkStore(base_dir=batch_root, group_store=groups)
    collaborations = CollaborationStore(base_dir=batch_root)
    app = FastAPI()
    app.include_router(
        create_cowork_group_router(
            store=groups,
            async_store=queue,
            collaboration_store=collaborations,
            runtime=SimpleNamespace(runner=SimpleNamespace(wake=lambda: None)),
        )
    )
    for index in range(2):
        run_id = f"benchmark-batch-{index}"
        collaborations.create_collaboration_run(
            run_id=run_id,
            session_id="benchmark-batch-thread",
            kind="group_fanout",
            input={"message": f"verify lane {index}"},
        )
        collaborations.claim_collaboration_run(run_id, worker_id="benchmark-worker")
        collaborations.create_collaboration_collector(
            run_id=run_id,
            child_ids=["reviewer"],
        )
        collaborations.record_collaboration_collector_result(
            run_id,
            child_id="reviewer",
            status="failed",
            result={"error": "transient"},
        )
    with TestClient(app) as client:
        response = client.post(
            "/api/collab/benchmark-batch-thread/collectors/retry",
            json={
                "run_ids": ["benchmark-batch-0", "benchmark-batch-1"],
            },
        )
        before_cancel_tasks = [task.status for task in queue.list("benchmark-batch-thread")]
        before_cancel_collectors = [
            collaborations.collaboration_collector(f"benchmark-batch-{index}") for index in range(2)
        ]
        cancel_response = client.post(
            "/api/collab/benchmark-batch-thread/collectors/cancel",
            json={
                "run_ids": ["benchmark-batch-0", "benchmark-batch-1"],
                "reason": "benchmark stop",
            },
        )
    payload = response.json() if response.status_code == 200 else {}
    cancel_payload = cancel_response.json() if cancel_response.status_code == 200 else {}
    collectors = [
        collaborations.collaboration_collector(f"benchmark-batch-{index}") for index in range(2)
    ]
    return {
        "cross_run_batch_retry": (
            1.0
            if response.status_code == 200
            and payload.get("run_count") == 2
            and payload.get("count") == 2
            and before_cancel_tasks == ["pending", "pending"]
            and all(
                collector is not None
                and collector["generation"] == 2
                and collector["status"] == "collecting"
                for collector in before_cancel_collectors
            )
            else 0.0
        ),
        "cross_run_batch_cancel": (
            1.0
            if cancel_response.status_code == 200
            and cancel_payload.get("cancelled_run_count") == 2
            and cancel_payload.get("cancelled_task_count") == 2
            and [task.status for task in queue.list("benchmark-batch-thread")]
            == ["cancelled", "cancelled"]
            and all(
                collector is not None
                and collector["generation"] == 2
                and collector["status"] == "cancelled"
                for collector in collectors
            )
            else 0.0
        ),
        "batch_retry_run_count": payload.get("run_count", 0),
        "batch_retry_task_count": payload.get("count", 0),
    }


def _decision_control_metrics() -> dict[str, Any]:
    """Prove graph branches are expressive but cannot escape declared dataflow."""

    condition, error = _coerce_condition(
        {
            "all": [
                {"ref": "judge.output.approved", "op": "eq", "value": True},
                {"ref": "judge.output.score", "op": "gte", "value": 80},
            ]
        },
        node_id="ship",
        dependencies=["judge"],
    )
    selected, evaluation_error = (
        _evaluate_condition(condition, {"judge": {"approved": True, "score": 91}})
        if condition is not None
        else (False, "missing condition")
    )
    _, undeclared_error = _coerce_condition(
        {"ref": "secret.output.value", "op": "truthy"},
        node_id="escape",
        dependencies=["judge"],
    )
    return {
        "bounded_decision_control": (
            1.0
            if not error
            and selected
            and not evaluation_error
            and "explicit dependency" in undeclared_error
            else 0.0
        )
    }


def _remote_transport_metrics() -> dict[str, Any]:
    """Prove configured SSH transport is used and cannot fall back to direct."""

    backend = RemoteBackend(
        id="benchmark-remote",
        name="private-runtime",
        url="http://127.0.0.1:8000",
        ssh=SshTunnel(host="bastion.example.test", user="ops"),
    )
    events: list[str] = []

    class _Forwarder:
        def __init__(self, configured: RemoteBackend) -> None:
            assert configured is backend

        def start(self) -> RemoteBackend:
            events.append("start")
            raise SshTunnelError("fixture refused tunnel")

        def close(self) -> None:
            events.append("close")

    blocked = False
    try:
        with connect_remote_backend(backend, forwarder_factory=_Forwarder):
            events.append("direct-fallback")
    except SshTunnelError:
        blocked = True
    public = backend.to_dict()
    return {
        "ssh_transport_fail_closed": (
            1.0
            if blocked
            and events == ["start", "close"]
            and public["transport"] == "ssh_tunnel"
            and public["capabilities"]["realtime"] is True
            else 0.0
        )
    }


def run_multi_agent_benchmark(*, workspace: Path | str | None = None) -> dict[str, Any]:
    """Run the fixed suite and return a machine-readable release verdict."""

    if workspace is None:
        with tempfile.TemporaryDirectory(prefix="echo-multi-agent-benchmark-") as temp:
            return run_multi_agent_benchmark(workspace=Path(temp))
    root = Path(workspace)
    root.mkdir(parents=True, exist_ok=True)
    metrics = {
        **_context_metrics(),
        **_pluggable_context_metrics(),
        **_continuation_prompt_metrics(),
        **_stale_goal_resurrection_metrics(),
        **_hybrid_context_metrics(),
        **_adaptive_recall_metrics(),
        **_context_lifecycle_metrics(root),
        **_session_compaction_metrics(root),
        **_summary_grant_metrics(),
        **_incremental_context_metrics(root),
        **_fanout_metrics(),
        **_recovery_metrics(root),
        **_governance_metrics(root),
        **_collector_metrics(root),
        **_steering_metrics(root),
        **_queue_metrics(root),
        **_scheduler_metrics(root),
        **_batch_retry_metrics(root),
        **_decision_control_metrics(),
        **_remote_transport_metrics(),
        **_channel_ingress_metrics(root),
    }
    checks = {
        "context_reduction": metrics["context_reduction_ratio"]
        >= _THRESHOLDS["context_reduction_ratio"],
        "context_budget": metrics["selected_context_tokens"]
        <= _THRESHOLDS["max_selected_context_tokens"]
        and metrics["member_budget_violations"] == 0,
        "addressing": metrics["addressing_precision"] >= _THRESHOLDS["addressing_precision"],
        "response_success": metrics["response_success_ratio"]
        >= _THRESHOLDS["response_success_ratio"],
        "evidence": metrics["evidence_coverage_ratio"] >= _THRESHOLDS["evidence_coverage_ratio"]
        and metrics["semantic_review_ready"],
        "recovery": metrics["recovery_success_ratio"] >= _THRESHOLDS["recovery_success_ratio"],
        "deduplication": metrics["visible_duplicate_count"]
        <= _THRESHOLDS["visible_duplicate_count"],
        "durable_subtree_concurrency": metrics["durable_subtree_concurrency"]
        >= _THRESHOLDS["durable_subtree_concurrency"],
        "actual_usage_breaker": metrics["actual_usage_breaker"]
        >= _THRESHOLDS["actual_usage_breaker"],
        "durable_collector": metrics["durable_collector"] >= _THRESHOLDS["durable_collector"],
        "collector_retry_retention": metrics["collector_retry_retention"]
        >= _THRESHOLDS["collector_retry_retention"],
        "collector_archive_retention": metrics["collector_archive_retention"]
        >= _THRESHOLDS["collector_archive_retention"],
        "member_live_steering": metrics["member_live_steering"]
        >= _THRESHOLDS["member_live_steering"],
        "member_targeted_cancel": metrics["member_targeted_cancel"]
        >= _THRESHOLDS["member_targeted_cancel"],
        "member_incremental_context": metrics["member_incremental_context"]
        >= _THRESHOLDS["member_incremental_context"],
        "persistent_member_projection": metrics["persistent_member_projection"]
        >= _THRESHOLDS["persistent_member_projection"],
        "member_session_serialization": metrics["member_session_serialization"]
        >= _THRESHOLDS["member_session_serialization"],
        "pluggable_context_engine": metrics["pluggable_context_engine"]
        >= _THRESHOLDS["pluggable_context_engine"],
        "versioned_context_engine_lifecycle": metrics["versioned_context_engine_lifecycle"]
        >= _THRESHOLDS["versioned_context_engine_lifecycle"],
        "continuation_prompt_ordering": metrics["continuation_prompt_ordering"]
        >= _THRESHOLDS["continuation_prompt_ordering"],
        "hybrid_context_diversity": metrics["hybrid_context_diversity"]
        >= _THRESHOLDS["hybrid_context_diversity"],
        "adaptive_long_horizon_recall": metrics["adaptive_long_horizon_recall"]
        >= _THRESHOLDS["adaptive_long_horizon_recall"],
        "transactional_context_lifecycle": metrics["transactional_context_lifecycle"]
        >= _THRESHOLDS["transactional_context_lifecycle"],
        "durable_session_compaction": metrics["durable_session_compaction"]
        >= _THRESHOLDS["durable_session_compaction"],
        "summary_grant_context": metrics["summary_grant_context"]
        >= _THRESHOLDS["summary_grant_context"],
        "stale_goal_resurrection_guard": metrics["stale_goal_resurrection_guard"]
        >= _THRESHOLDS["stale_goal_resurrection_guard"],
        "collector_retry_dedup": metrics["collector_retry_dedup"]
        >= _THRESHOLDS["collector_retry_dedup"],
        "bounded_retry_queue": metrics["bounded_retry_queue"] >= _THRESHOLDS["bounded_retry_queue"],
        "fair_queue_scheduling": metrics["fair_queue_scheduling"]
        >= _THRESHOLDS["fair_queue_scheduling"],
        "cross_run_batch_retry": metrics["cross_run_batch_retry"]
        >= _THRESHOLDS["cross_run_batch_retry"],
        "cross_run_batch_cancel": metrics["cross_run_batch_cancel"]
        >= _THRESHOLDS["cross_run_batch_cancel"],
        "bounded_decision_control": metrics["bounded_decision_control"]
        >= _THRESHOLDS["bounded_decision_control"],
        "ssh_transport_fail_closed": metrics["ssh_transport_fail_closed"]
        >= _THRESHOLDS["ssh_transport_fail_closed"],
        "channel_ingress_dedup": metrics["channel_claim_winners"]
        == _THRESHOLDS["channel_claim_winners"]
        and metrics["channel_duplicate_executions"] == 0,
        "latency": metrics["wall_time_ms"] <= _THRESHOLDS["wall_time_ms"],
    }
    return {
        "schema": "echo.multi_agent_benchmark.v1",
        "passed": all(checks.values()),
        "checks": checks,
        "metrics": metrics,
        "thresholds": dict(_THRESHOLDS),
    }


def main() -> int:
    result = run_multi_agent_benchmark()
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
