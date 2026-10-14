"""A single lifecycle contract for host execution scopes across engines.

Domain queues still own planning and verification. This ledger records actual
engine invocations, not a claim that their business deliverables passed review.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any
from uuid import uuid4

from runtime.execution.claim_guard import ExecutionClaimGuard
from runtime.execution.environment import current_device_id
from runtime.memory.cowork.collaboration_store import CollaborationStore

_DEFAULT: ExecutionLifecycle | None = None
_INVOCATION: ContextVar[str] = ContextVar("execution_invocation", default="")


def set_execution_lifecycle(value: ExecutionLifecycle | None) -> None:
    global _DEFAULT
    _DEFAULT = value


def get_execution_lifecycle() -> ExecutionLifecycle | None:
    return _DEFAULT


class ExecutionLifecycle:
    def __init__(self, store: CollaborationStore, *, heartbeat_interval_s: float = 5):
        self.store = store
        self.heartbeat_interval_s = heartbeat_interval_s
        self.worker_id = f"host:{uuid4().hex}"

    @contextmanager
    def invoke(self, request: Any):
        task = request.task
        run_id = "invoke-" + uuid4().hex
        self.store.create_collaboration_run(
            run_id=run_id,
            session_id=task.thread_id,
            parent_run_id=_INVOCATION.get() or task.parent_task_id or "",
            kind="engine_invocation",
            input={
                "task_id": task.task_id,
                "parent_task_id": task.parent_task_id,
                "actor_id": task.actor_id or "local",
                "tenant_id": task.tenant_id or "local",
                "engine": task.execution_engine or "host",
                "goal": task.goal[:32000],
                "device_id": current_device_id(),
                "workspace": str(task.environment.workspace)
                if task.environment and task.environment.workspace
                else None,
            },
        )
        claimed = self.store.claim_collaboration_run(
            run_id, worker_id=self.worker_id, lease_seconds=30
        )

        def renew() -> bool:
            self.store.heartbeat_collaboration_run(
                run_id,
                worker_id=self.worker_id,
                expected_attempt=claimed["attempt"],
                lease_seconds=30,
            )
            return True

        guard = ExecutionClaimGuard(renew, interval_s=self.heartbeat_interval_s)
        context = _INVOCATION.set(run_id)
        failure: BaseException | None = None
        try:
            with guard.scope():
                guard.token.throw_if_cancelled()
                yield run_id
                guard.token.throw_if_cancelled()
        except BaseException as exc:
            failure = exc
            raise
        finally:
            _INVOCATION.reset(context)
            status = (
                "cancelled" if guard.token.is_cancelled else "failed" if failure else "completed"
            )
            try:
                self.store.transition_collaboration_run(
                    run_id,
                    status=status,
                    worker_id=self.worker_id,
                    expected_attempt=claimed["attempt"],
                    result={"execution_finished": failure is None, "delivery_verified": False},
                    error=str(failure)[:4000] if failure else None,
                )
            except (RuntimeError, ValueError):
                # A cancellation/reclaim already stored by the owner wins.
                if failure is None and not guard.token.is_cancelled:
                    raise
