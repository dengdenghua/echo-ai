"""Resume an authorized coordinator once its durable member batch settles."""

from __future__ import annotations

import asyncio
import logging

from runtime.memory.cowork.coordination_policy import restore_scope
from runtime.memory.cowork.delivery import delivery_scope
from runtime.memory.threads.event_log import EventLog, thread_log_path
from runtime.platform.process.scope import execution_scope_ceiling
from runtime.platform.process.thread_turn_claim import (
    ThreadTurnClaimConflict,
    ThreadTurnClaimUnavailable,
)

logger = logging.getLogger(__name__)


def delivery_service(gateway):
    service = getattr(gateway._runtime, "_cowork_coordination", None)
    return service.delivery if service is not None else None


def authorized_connection(gateway, batch):
    parent = batch["parent"]
    tenant = str(batch["policy"].get("metadata", {}).get("tenant_id") or "")
    for conn in list(gateway._connections):
        if getattr(conn, "_closed", False) or parent["thread_id"] not in conn.watched_threads:
            continue
        # A viewer (or another writer) must not lend their credentials to the
        # original actor's background task. Local auth-off uses actor 'user'.
        if (conn.actor_id or "user") != parent["actor_id"]:
            continue
        if tenant and tenant != (conn.tenant_id or ""):
            continue
        if not gateway._connection_can_access_thread(parent["thread_id"], conn, access="write"):
            continue
        try:
            service = batch["delivery"].service
            service.check_actor(parent["thread_id"], parent["actor_id"], tenant)
            service.check_member(parent["thread_id"], parent["member_id"])
        except PermissionError:
            continue
        return conn
    return None


async def maybe_deliver(gateway, thread):
    delivery = delivery_service(gateway)
    if delivery is None:
        return False
    if thread in gateway._active_turn_threads:
        return True
    # Don't touch claims or deserialize all results when nobody can receive
    # the continuation. Reconnect checks the same durable queue.
    if not any(thread in c.watched_threads for c in gateway._connections):
        return False
    try:
        claim = gateway._acquire_thread_turn_claim(thread)
    except (ThreadTurnClaimConflict, ThreadTurnClaimUnavailable):
        return True
    batch = None
    claimed = False
    turn = None
    try:
        async with gateway._turn_locks.hold(thread):
            if thread in gateway._active_turn_threads:
                return True
            candidates = await asyncio.to_thread(lambda: list(delivery.ready(thread, recover=True)))
            for candidate in candidates:
                conn = authorized_connection(gateway, candidate)
                if conn is not None:
                    batch = candidate
                    break
            if batch is None:
                return False
            from ._realtime_detached_turn import _DetachedTurnEmitter
            from ._realtime_thread_delete_probe import assert_thread_accepts_runtime_writes
            from .realtime_gateway import _ClaimAwareEmitter

            assert_thread_accepts_runtime_writes(
                gateway._runtime,
                thread,
                thread_access_resolver=gateway._thread_access_resolver,
            )
            metadata = batch["policy"].get("metadata", {})
            params = gateway._sanitize_turn_params(
                {
                    "threadId": thread,
                    "input": [
                        {
                            "type": "text",
                            "text": "成员任务已结束，请验收并汇总结果。",
                            "metadata": {"context": {**metadata, "auto_wake": True}},
                        }
                    ],
                },
                conn,
            )
            model = metadata.get("model_name") or metadata.get("model")
            if isinstance(model, str) and model:
                params["model"] = model
            if not delivery.claim(batch):
                return True
            claimed = True
            gateway._active_turn_threads.add(thread)
            emitter = _ClaimAwareEmitter(
                _DetachedTurnEmitter(gateway, thread, conn),
                claim,
                log=EventLog(thread_log_path(claim.path.parent.parent, thread)),
                runtime=gateway._runtime,
                thread_access_resolver=gateway._thread_access_resolver,
            )
            try:
                # Retain the original authority ceiling, even if thread settings
                # changed while the members were working.
                with delivery_scope(batch), execution_scope_ceiling(restore_scope(batch["policy"])):
                    turn = await gateway._runtime.start_turn(params, emitter)
                    gateway._prepare_terminal_turn_snapshot(thread, turn)
            finally:
                gateway._active_turn_threads.discard(thread)
                await asyncio.to_thread(delivery.finish, batch, turn)
        claim.release()
        await gateway._emit_turn_completed(conn, thread, turn)
        delivery.notify(thread)
        return True
    except Exception:
        if batch is not None and claimed:
            delivery.finish(batch, turn)
        logger.exception("coordinator auto delivery failed for %s; results remain saved", thread)
        return True
    finally:
        claim.release()
