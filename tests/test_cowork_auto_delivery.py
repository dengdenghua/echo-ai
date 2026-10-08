from types import SimpleNamespace

import pytest

from runtime.memory.cowork.async_work import AsyncWorkStore
from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.coordination_service import CoordinationService
from runtime.memory.cowork.delivery import apply_delivery_context, delivery_scope
from runtime.memory.cowork.group import MemberEvent
from runtime.memory.cowork.group_store import GroupStore
from runtime.memory.threads.event_log import EventLog, thread_log_path
from runtime.platform.process.session import Session, session_scope
from runtime.protocol import AgentMessageItem, ItemStatus, Turn, TurnParams, TurnStatus


@pytest.fixture
def service(tmp_path):
    groups = GroupStore(tmp_path)
    for member in ("leader", "one", "two"):
        groups.append("group", MemberEvent(action="invite", actor="user", target_id=member))
    groups.append("group", MemberEvent(action="mode", actor="user", mode="cluster"))
    result = CoordinationService(
        groups, CollaborationStore(tmp_path), AsyncWorkStore(tmp_path, groups)
    )
    result.logs_root = tmp_path / "threads"
    return result


def assign(service):
    with session_scope(
        Session(
            thread_id="group",
            turn_id="original",
            actor="user",
            agent=SimpleNamespace(agent_id="leader"),
        )
    ):
        parent = service.current("分析两项产品")
        children = [
            service.delegate_agent(member, "分析 " + member)["task_id"] for member in ("one", "two")
        ]
    log = EventLog(thread_log_path(service.logs_root, "group"))
    log.turn_started("group", Turn(id="original", thread_id="group"))
    return parent, children, log


def complete(service, child, *, failed=False):
    task = service.queue.claim_execution(child)
    if failed:
        service.queue.fail(child, "超时", expected_attempt=task.attempts)
    else:
        service.queue.complete(
            child, "已核对的结果 " + task.assignee, expected_attempt=task.attempts
        )
    service.sync("group")


def answer_turn(turn_id="auto"):
    return Turn(
        id=turn_id,
        thread_id="group",
        status=TurnStatus.COMPLETED,
        items=[AgentMessageItem(text="汇总交付", status=ItemStatus.COMPLETED)],
    )


def test_wait_for_whole_batch_then_one_durable_delivery(service):
    parent, children, _ = assign(service)
    complete(service, children[0])
    assert list(service.delivery.ready("group")) == []
    assert service.delivery.waiting_for_turn("group", "original")
    complete(service, children[1])
    (batch,) = service.delivery.ready("group")
    assert batch["parent"]["id"] == parent["id"]
    assert len(batch["tasks"]) == 2
    assert service.delivery.claim(batch)
    assert not service.delivery.claim(batch)
    service.delivery.finish(batch, answer_turn())
    service.finish(children[0], "done", "duplicate callback")
    reopened = CoordinationService(service.groups, service.ledger.store, service.queue)
    reopened.logs_root = service.logs_root
    assert list(reopened.delivery.ready("group", recover=True)) == []


def test_explicit_stop_prevents_late_delivery_but_guard_interruption_does_not(service):
    _, children, log = assign(service)
    for child in children:
        complete(service, child)
    log.turn_updated("group", "original", outcome_reason="coordination_delivery_incomplete")
    log.turn_completed("group", "original", TurnStatus.INTERRUPTED)
    assert len(list(service.delivery.ready("group"))) == 1
    log.turn_interrupt_requested(
        "group", "original", claim_epoch="epoch", requested_by_actor="user", tenant_id=None
    )
    assert list(service.delivery.ready("group")) == []


def test_failed_member_is_reported_without_redispatch(service):
    _, children, _ = assign(service)
    complete(service, children[0], failed=True)
    complete(service, children[1])
    (batch,) = service.delivery.ready("group")
    intent = SimpleNamespace(user_context={})
    apply_delivery_context(intent, batch)
    assert "超时" in intent.user_context["mode_contract"]
    assert intent.user_context["cowork_responders"] == ["leader"]
    assert intent.user_context["team_pattern"]["execution"] == "focused"
    with session_scope(
        Session(
            thread_id="group",
            turn_id="auto",
            actor="user",
            agent=SimpleNamespace(agent_id="leader"),
            metadata={"_coordination_delivery_parent": batch["parent"]["id"]},
        )
    ):
        assert len(service.tool(action="inbox")["tasks"]) == 2
        with pytest.raises(PermissionError, match="自动交付"):
            service.delegate_agent("one", "重跑")
    assert len(service.queue.list("group")) == 2
    from runtime.execution.subagents.bridge import call_subagent

    with delivery_scope(batch), pytest.raises(PermissionError, match="自动交付"):
        call_subagent("one", "绕过队列重新执行")


def test_foreground_review_and_answer_suppress_duplicate_auto_turn(service):
    parent, children, log = assign(service)
    for child in children:
        complete(service, child)
    service.delivery.observe(parent, "original")
    # Commentary before the final answer is not acceptance.
    log.item_completed(
        "group",
        "original",
        AgentMessageItem(text="稍后汇总", message_kind="commentary", status=ItemStatus.COMPLETED),
    )
    log.turn_completed("group", "original", TurnStatus.COMPLETED)
    assert len(list(service.delivery.ready("group"))) == 1
    log.item_completed("group", "original", answer_turn().items[0])
    assert list(service.delivery.ready("group")) == []


def test_crash_recovery_uses_durable_answer_and_bounds_retries(service):
    _, children, log = assign(service)
    for child in children:
        complete(service, child)
    (batch,) = service.delivery.ready("group")
    assert service.delivery.claim(batch)
    service.delivery.bind_turn(batch, "lost")
    (batch,) = service.delivery.ready("group", recover=True)
    assert service.delivery.claim(batch)
    service.delivery.bind_turn(batch, "auto")
    log.turn_started("group", answer_turn())
    log.item_completed("group", "auto", answer_turn().items[0])
    log.turn_completed("group", "auto", TurnStatus.COMPLETED)
    assert list(service.delivery.ready("group", recover=True)) == []


def test_summary_session_uses_original_policy_and_parent(service):
    from runtime.platform.models import ParsedIntent
    from runtime.sensing.gateway.realtime_execution_context import RealtimeExecutionContext

    parent, children, _ = assign(service)
    for child in children:
        complete(service, child)
    (batch,) = service.delivery.ready("group")
    ctx = RealtimeExecutionContext()
    runtime = SimpleNamespace(_stack=None, _workspaces=None)
    turn = Turn(thread_id="group", params=TurnParams(threadId="group", input=[]))
    intent = ParsedIntent(
        raw="汇总结果", normalized_goal="汇总结果", intent_type="task", user_context={}
    )
    with delivery_scope(batch):
        ctx._initialize(runtime, turn, SimpleNamespace(agent_id="leader"), intent)
    assert ctx.session.metadata["_coordination_delivery_parent"] == parent["id"]
    assert ctx.session.metadata.get("mode", "chat") == batch["policy"]["metadata"].get(
        "mode", "chat"
    )


def test_auto_delivery_requires_original_actor_and_write_permission(service):
    from runtime.sensing.gateway._realtime_cowork_delivery import authorized_connection

    _, children, _ = assign(service)
    for child in children:
        complete(service, child)
    (batch,) = service.delivery.ready("group")
    conn = SimpleNamespace(watched_threads={"group"}, actor_id="different-user", tenant_id=None)
    gateway = SimpleNamespace(
        _connections=[conn], _connection_can_access_thread=lambda *a, **k: True
    )
    assert authorized_connection(gateway, batch) is None
    conn.actor_id = None
    gateway._connection_can_access_thread = lambda *a, **k: False
    assert authorized_connection(gateway, batch) is None
    gateway._connection_can_access_thread = lambda *a, **k: True
    assert authorized_connection(gateway, batch) is conn


@pytest.mark.asyncio
async def test_gateway_does_not_start_competing_turn_and_delivers_once_when_idle(service, tmp_path):
    from runtime.memory.cowork.delivery import current_delivery
    from runtime.sensing.gateway._realtime_cowork_delivery import maybe_deliver
    from runtime.sensing.gateway.realtime_gateway import RealtimeGateway

    _, children, _ = assign(service)
    for child in children:
        complete(service, child)
    calls = []

    async def start(params, emitter):
        calls.append(current_delivery())
        return answer_turn()

    runtime = SimpleNamespace(
        _cowork_coordination=service, _logs_root=service.logs_root, start_turn=start
    )
    gateway = RealtimeGateway(runtime=runtime)
    conn = SimpleNamespace(watched_threads={"group"}, actor_id=None, tenant_id=None)
    gateway._connections = [conn]
    gateway._prepare_terminal_turn_snapshot = lambda *args: None

    async def emit(*args):
        pass

    gateway._emit_turn_completed = emit
    gateway._active_turn_threads.add("group")
    assert await maybe_deliver(gateway, "group")
    assert not calls
    gateway._active_turn_threads.clear()
    assert await maybe_deliver(gateway, "group")
    assert len(calls) == 1 and calls[0]["parent"]["member_id"] == "leader"
    assert not await maybe_deliver(gateway, "group")
