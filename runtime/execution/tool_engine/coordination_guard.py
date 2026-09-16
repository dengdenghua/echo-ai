"""Host-wide exclusion for declared device resources, including direct tools."""

from __future__ import annotations

import threading
from contextlib import contextmanager
from contextvars import ContextVar
from uuid import uuid4

from runtime.platform.process.session import current_session

_service = ContextVar("coordination_service", default=None)


@contextmanager
def coordination_scope(service):
    token = _service.set(service)
    try:
        if service is not None:
            service.check_running()
        yield
    finally:
        _service.reset(token)


def invoke_coordinated(skill, args, *, service=None):
    """Use the ambient host guard for meta-tool and composite dispatch."""
    service = service or _service.get()
    if service is not None:
        service.check_running()
    with coordinated_resource(service, skill):
        return skill.handler(**args)


def resource_for_skill(skill):
    declared = getattr(skill, "exclusive_resource", None)
    if declared:
        return declared
    # Browser actions share a control connection; isolated read-only fetches
    # (web_search/web_fetch) are deliberately outside this resource.
    if getattr(skill, "name", "").startswith("browser_"):
        return "browser:control"
    return None


@contextmanager
def coordinated_resource(service, skill):
    resource = resource_for_skill(skill)
    if service is None or not resource or resource.endswith(":read"):
        yield
        return
    session = current_session()
    thread_id = (session.thread_id if session else None) or "local"
    task_id = (session.metadata.get("_coordination_task_id") if session else None) or (
        session.turn_id if session else "local"
    )
    if session and (
        session.metadata.get("_coordination_task_id")
        or (session.agent_id and service.groups.state(thread_id).member(session.agent_id))
    ):
        task = service.current()
        task_id, thread_id = task["id"], task["thread_id"]
    token = service.resource_token(task_id, resource)
    if not service.ledger.acquire(resource, thread_id, task_id, token):
        raise RuntimeError(f"协作资源正在使用：{resource}。请等待释放或先处理独立工作。")
    call_token = uuid4().hex
    call_resource = "call:" + resource
    if not service.ledger.acquire(call_resource, thread_id, task_id, call_token):
        raise RuntimeError(f"协作资源正在执行操作：{resource}。请串行调用。")
    stop = threading.Event()
    lost = threading.Event()

    def heartbeat():
        while not stop.wait(20):
            try:
                if not service.ledger.renew(resource, token):
                    lost.set()
                    return
                if not service.ledger.renew(call_resource, call_token):
                    lost.set()
                    return
            except Exception:
                lost.set()
                return

    worker = threading.Thread(target=heartbeat, daemon=True, name="coordination-resource")
    worker.start()
    try:
        yield
        if lost.is_set():
            raise RuntimeError("资源占用续期失败；请核对操作结果后再继续")
    finally:
        stop.set()
        worker.join(timeout=1)
        service.ledger.release(call_resource, call_token)
        record = service.ledger.get(task_id)
        if not service.ledger.is_held(resource, token) or (
            record and record["status"] in {"done", "failed", "cancelled"}
        ):
            service.ledger.release(resource, token)
