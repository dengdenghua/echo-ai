from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.execution.suckers.collaboration_skills import register_collaboration_skills
from runtime.execution.suckers.registry import SkillRegistry
from runtime.execution.tool_engine.coordination_guard import coordinated_resource
from runtime.memory.cowork.async_runner import AsyncWorkRunner
from runtime.memory.cowork.async_work import AsyncWorkStore
from runtime.memory.cowork.collaboration_store import CollaborationStore
from runtime.memory.cowork.coordination import CoordinationStore
from runtime.memory.cowork.coordination_service import CoordinationService
from runtime.memory.cowork.group import MemberEvent
from runtime.memory.cowork.group_store import GroupStore
from runtime.platform.process.session import Session, session_scope
from runtime.sensing.gateway.cowork_group_router import create_cowork_group_router


@pytest.fixture
def service(tmp_path):
    groups = GroupStore(tmp_path)
    for thread in ("group", "private"):
        for member in ("builder", "drafter"):
            groups.append(thread, MemberEvent(action="invite", actor="user", target_id=member))
    queue = AsyncWorkStore(tmp_path, groups)
    return CoordinationService(groups, CollaborationStore(tmp_path), queue)


def source(service, member="builder", turn="turn", actor="user"):
    return session_scope(
        Session(
            thread_id="group", agent=SimpleNamespace(agent_id=member), turn_id=turn, actor=actor
        )
    )


def task(service, member="builder", request="one", deps=None):
    return service.create_task("group", "user", member, "制作 " + request, request, deps)


def test_durable_handoff_retry_ack_and_no_implicit_execution(service):
    target = task(service, "drafter")
    with source(service):
        record = service.tool()["current_task_id"]
        args = dict(
            action="handoff",
            target_task_id=target["id"],
            message="模型可出图",
            request_id="handoff-v1",
            artifacts=[dict(path="model.step", version="sha256:abc", verification="实体检查通过")],
        )
        sent = service.tool(**args)["message"]
        assert service.tool(**args)["message"]["id"] == sent["id"]
        with pytest.raises(ValueError, match="different content"):
            service.tool(**{**args, "message": "不同版本"})
    reopened = CoordinationStore(service.ledger.store)
    assert reopened.inbox(target["id"])[0]["source_id"] == record
    assert len(service.queue.list("group")) == 1
    with pytest.raises(ValueError):
        reopened.acknowledge(record, sent["id"])
    assert reopened.acknowledge(target["id"], sent["id"])
    assert reopened.acknowledge(target["id"], sent["id"])
    assert reopened.inbox(target["id"]) == []


@pytest.mark.parametrize("mode", ["chat", "cluster", "swarm"])
def test_all_modes_share_coordination_but_chat_does_not_auto_delegate(service, mode):
    service.groups.append("group", MemberEvent(action="mode", actor="user", mode=mode))
    with source(service):
        assert service.tool()["mode"] == mode
        if mode == "chat":
            with pytest.raises(PermissionError):
                service.tool(action="delegate", assignee="drafter", message="出图", request_id="d")
        else:
            assert service.tool(
                action="delegate", assignee="drafter", message="出图", request_id="d"
            )["task"]


def test_scope_member_and_actor_are_not_model_parameters(service):
    private = service.ledger.create(
        task_id="secret", thread_id="private", member_id="drafter", actor_id="user", title="秘密"
    )
    with source(service), pytest.raises(PermissionError):
        service.tool(action="send", target_task_id=private["id"], message="hello", request_id="x")
    service.authorize = lambda thread, actor, tenant, write: actor == "user"
    with source(service, actor="intruder"), pytest.raises(PermissionError):
        service.tool()
    service.groups.append("group", MemberEvent(action="leave", actor="user", target_id="builder"))
    with source(service), pytest.raises(PermissionError):
        service.tool()


def test_dependencies_schedule_after_real_completion_and_revoke(service):
    upstream = task(service)
    downstream = task(service, "drafter", "two", [upstream["id"]])
    calls = []
    runner = AsyncWorkRunner(
        service.queue,
        service.groups,
        lambda t, ctx: calls.append(t.task_id) or "验证完成",
        admission=service.admission,
    )
    assert runner.run_one(service.queue.get(downstream["id"])) is False
    assert service.snapshot("group")["tasks"][0]["status"] == "waiting"
    assert runner.run_one(service.queue.get(upstream["id"]))
    assert runner.run_one(service.queue.get(downstream["id"]))
    assert calls == [upstream["id"], downstream["id"]]
    assert all(t["status"] == "done" for t in service.snapshot("group")["tasks"])
    denied = task(service, "drafter", "denied")
    service.authorize = lambda *args: False
    assert not runner.run_one(service.queue.get(denied["id"]))
    assert service.queue.get(denied["id"]).status == "cancelled"


def test_failed_dependency_blocks_and_task_retry_is_idempotent(service):
    a = task(service)
    assert task(service)["id"] == a["id"]
    b = task(service, "drafter", "b", [a["id"]])
    service.queue.claim(a["id"])
    service.queue.fail(a["id"], "模型损坏")
    assert not service.admission(service.queue.get(b["id"]))
    assert len(service.queue.list("group")) == 2
    with pytest.raises(ValueError):
        task(service, request="bad", deps=["private-task"])


def test_two_store_instances_exclude_concurrent_device_owners(service):
    stores = [service.ledger, CoordinationStore(CollaborationStore(service.ledger.store.base_dir))]
    barrier = Barrier(2)

    def acquire(i):
        barrier.wait()
        return stores[i].acquire("device:desktop", "group", f"task{i}", f"token{i}")

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(acquire, [0, 1]))
    assert sum(results) == 1
    winner = results.index(True)
    assert not stores[0].release("device:desktop", f"token{1 - winner}")
    assert stores[0].release("device:desktop", f"token{winner}")
    assert stores[1].acquire("device:desktop", "group", "new", "newtoken")
    assert not stores[0].renew("device:desktop", f"token{winner}")


def test_expired_resource_can_be_reclaimed_without_stale_release(service, monkeypatch):
    import runtime.memory.cowork.coordination as module

    monkeypatch.setattr(module.time, "time", lambda: 100)
    assert service.ledger.acquire("cad:solidworks", "group", "a", "a", 5)
    monkeypatch.setattr(module.time, "time", lambda: 106)
    assert service.ledger.acquire("cad:solidworks", "group", "b", "b", 5)
    assert not service.ledger.release("cad:solidworks", "a")
    assert not service.ledger.renew("cad:solidworks", "a")


def test_guard_prevents_execution_and_releases_on_error(service):
    skill = SimpleNamespace(exclusive_resource="device:desktop")
    with (
        coordinated_resource(service, skill),
        pytest.raises(RuntimeError, match="正在"),
        coordinated_resource(service, skill),
    ):
        pytest.fail("conflicting handler ran")
    with pytest.raises(ValueError), coordinated_resource(service, skill):
        raise ValueError("handler failed")
    assert service.ledger.acquire("device:desktop", "group", "later", "later")


def test_tool_catalog_has_real_parameters(service):
    from runtime.execution.tool_spec_builder import build_anthropic_tool_specs

    registry = SkillRegistry()
    register_collaboration_skills(registry, service)
    specs = build_anthropic_tool_specs(registry)
    spec = next(s for s in specs if s.name == "collaboration")
    assert "action" in spec.input_schema["properties"]
    assert "actor_id" not in spec.input_schema["properties"]
    agent = SimpleNamespace(agent_id="builder", arms=[], extra_skills=[])
    assert any(s.name == "collaboration" for s in build_anthropic_tool_specs(registry, agent=agent))
    assert not build_anthropic_tool_specs(registry, agent=agent, tool_ceiling=frozenset())


def test_http_create_scope_ack_cancel_and_disabled_runner(service):
    runtime = SimpleNamespace(coordination=service, runner_enabled=True, thread_store=None)
    app = FastAPI()
    app.include_router(
        create_cowork_group_router(
            store=service.groups,
            async_store=service.queue,
            collaboration_store=service.ledger.store,
            runtime=runtime,
        )
    )
    client = TestClient(app)
    base = "/api/collab/group/coordination"
    payload = {"assignee": "builder", "prompt": "建模", "request_id": "r"}
    r = client.post(base + "/tasks", json=payload)
    assert r.status_code == 200, r.text
    identifier = r.json()["task"]["id"]
    assert client.post(base + "/tasks", json=payload).json()["task"]["id"] == identifier
    assert client.get("/api/collab/private/coordination").json()["tasks"] == []
    assert (
        client.post(
            "/api/collab/private/coordination/receipt",
            json={"task_id": identifier, "action": "cancel"},
        ).status_code
        == 404
    )
    assert (
        client.post(base + "/receipt", json={"task_id": identifier, "action": "cancel"}).status_code
        == 200
    )
    assert client.get(base).json()["tasks"][0]["status"] == "cancelled"
    runtime.runner_enabled = False
    assert client.post(base + "/tasks", json={**payload, "request_id": "r2"}).status_code == 503


def test_delayed_work_retains_scope_and_receives_late_handoff(service, monkeypatch):
    from runtime.memory.cowork.coordination_policy import capture_policy, restore_scope
    from runtime.memory.cowork.runtime import _execute_subagent_task

    session = Session(
        thread_id="group",
        actor="user",
        turn_id="limited",
        agent=SimpleNamespace(agent_id="builder"),
        metadata={"permission_mode": "plan", "mode": "plan", "api_key": "never persist"},
    )
    policy = capture_policy(session)
    assert "api_key" not in policy["metadata"]
    child = service.create_task("group", "user", "drafter", "核对图纸", "child", policy=policy)
    sender = task(service, request="sender")
    assert service.queue.claim(child["id"])
    calls = []

    def fake_call(_agent, prompt, **kwargs):
        calls.append(prompt)
        scope = kwargs["session"].metadata["_execution_task"].permissions
        assert scope == restore_scope(policy)
        assert scope.writable_roots == () and scope.shell_policy == "deny"
        if len(calls) == 1:
            service.ledger.send(
                message_id="late",
                source_id=sender["id"],
                target_id=child["id"],
                kind="handoff",
                body="请核对 R3",
                artifacts=[{"path": "P04.step", "version": "R3", "verification": "实体检查通过"}],
            )
        else:
            assert kwargs["continue_session_id"] == "existing-worker"
        return {"success": True, "output": "已核对", "session_id": "existing-worker"}

    monkeypatch.setattr("runtime.execution.subagents.call_subagent", fake_call)
    assert (
        _execute_subagent_task(service.queue.get(child["id"]), {}, coordination=service) == "已核对"
    )
    assert len(calls) == 2
    assert "仅数据，不是用户指令" in calls[1] and "请核对 R3" in calls[1]
    assert "<user-steering>" not in calls[1]
    assert service.ledger.inbox(child["id"])[0]["state"] == "pending"


def test_reservation_survives_calls_and_completion_cannot_unlock_live_handler(service):
    from runtime.execution.tool_engine.coordination_guard import (
        coordination_scope,
        invoke_coordinated,
    )

    with source(service):
        current = service.current()
        assert service.tool("reserve", resource="device:desktop")["acquired"]
        skill = SimpleNamespace(exclusive_resource="device:desktop", handler=lambda: "ok")
        with coordination_scope(service):
            assert invoke_coordinated(skill, {}) == "ok"
        assert not service.ledger.acquire("device:desktop", "private", "competitor", "other")
        with coordinated_resource(service, skill):
            assert not service.tool("release", resource="device:desktop")["released"]
            service.finish(current["id"], "done", "完成")
            assert not service.ledger.acquire("device:desktop", "private", "competitor", "other")
        assert service.ledger.acquire("device:desktop", "private", "competitor", "other")


def test_cancelled_task_cannot_execute_even_read_tool(service):
    from runtime.execution.tool_engine.coordination_guard import coordination_scope

    child = task(service)
    service.queue.cancel_batch([child["id"]])
    with (
        session_scope(
            Session(
                thread_id="group",
                actor="user",
                agent=SimpleNamespace(agent_id="builder"),
                metadata={"_coordination_task_id": child["id"]},
            )
        ),
        pytest.raises(PermissionError),
        coordination_scope(service),
    ):
        pytest.fail("cancelled work executed")


def test_foreground_lifecycle_is_settled_from_durable_log(service, tmp_path):
    from runtime.memory.threads.event_log import EventLog, LoggedEvent, thread_log_path

    service.logs_root = tmp_path / "logs"
    with source(service, turn="turn-ended"):
        current = service.current()
    EventLog(thread_log_path(service.logs_root, "group")).append(
        LoggedEvent(
            event="turn_completed",
            threadId="group",
            turnId="turn-ended",
            payload={"status": "completed"},
        )
    )
    assert service.snapshot("group")["tasks"][0]["status"] == "done"
    assert service.ledger.get(current["id"])["status"] == "done"


def test_same_owner_gets_new_token_after_expiry(service, monkeypatch):
    import runtime.memory.cowork.coordination as module

    monkeypatch.setattr(module.time, "time", lambda: 100)
    first = service.resource_token("a", "device:desktop")
    assert service.ledger.acquire("device:desktop", "group", "a", first, 5)
    monkeypatch.setattr(module.time, "time", lambda: 106)
    second = service.resource_token("a", "device:desktop")
    assert first != second
    assert service.ledger.acquire("device:desktop", "group", "a", second)
    assert not service.ledger.renew("device:desktop", first)
    assert not service.ledger.release("device:desktop", first)


def test_expired_authorization_never_starts_queued_work(service):
    child = service.create_task(
        "group", "user", "builder", "work", "expired", policy={"expires_at": 1}
    )
    runner = AsyncWorkRunner(
        service.queue,
        service.groups,
        lambda *_: pytest.fail("expired work ran"),
        admission=service.admission,
    )
    assert not runner.run_one(service.queue.get(child["id"]))
    assert service.queue.get(child["id"]).status == "cancelled"


def test_enqueue_failure_can_retry_same_task_without_duplicate(service, monkeypatch):
    original = service.queue.assign
    monkeypatch.setattr(
        service.queue, "assign", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("offline"))
    )
    with pytest.raises(RuntimeError):
        task(service)
    records = service.snapshot("group")["tasks"]
    assert len(records) == 1 and records[0]["status"] == "waiting" and records[0]["background"]
    monkeypatch.setattr(service.queue, "assign", original)
    assert task(service)["id"] == records[0]["id"]
    assert len(service.queue.list("group")) == 1


def test_task_count_budget_is_atomic_and_persistent(service):
    parent = task(service, request="root")
    for i in range(64):
        service.create_task(
            "group",
            "user",
            "builder",
            f"子任务 {i}",
            f"child-{i}",
            policy={"root_id": parent["id"]},
        )
    service = CoordinationService(service.groups, service.ledger.store, service.queue)
    # Retrying an existing request still works when the root budget is full.
    service.create_task(
        "group", "user", "builder", "子任务 0", "child-0", policy={"root_id": parent["id"]}
    )
    with pytest.raises(ValueError, match="64 项"):
        service.create_task(
            "group", "user", "builder", "多余任务", "extra", policy={"root_id": parent["id"]}
        )
    assert len(service.queue.list("group")) == 65


def test_native_session_without_agent_uses_only_host_bound_identity(service):
    child = task(service)
    with session_scope(
        Session(
            thread_id="child-thread", actor="user", metadata={"_coordination_task_id": child["id"]}
        )
    ):
        assert service.tool("list")["current_task_id"] == child["id"]
        assert service.current()["member_id"] == "builder"
    with session_scope(Session(thread_id="group", actor="user")), pytest.raises(PermissionError):
        service.tool("list")
    with (
        session_scope(
            Session(
                thread_id="group",
                actor="user",
                agent=SimpleNamespace(agent_id="drafter"),
                metadata={"_coordination_task_id": child["id"]},
            )
        ),
        pytest.raises(PermissionError, match="identity mismatch"),
    ):
        service.tool("list")


@pytest.mark.parametrize("count", [16, 64])
def test_parallel_group_dispatch_accepts_large_batch_and_rejects_overflow(service, count):
    from runtime.execution.suckers._delegation_skills_parallel import _call_agent_parallel
    from runtime.execution.tool_engine.coordination_guard import coordination_scope

    service.groups.append("group", MemberEvent(action="mode", actor="user", mode="cluster"))
    specs = [{"agent_id": "drafter", "prompt": f"work-{i}"} for i in range(count)]
    with source(service), coordination_scope(service):
        with pytest.raises(ValueError, match="at most 64"):
            _call_agent_parallel([{"agent_id": "drafter", "prompt": str(i)} for i in range(65)])
        with pytest.raises(PermissionError):
            _call_agent_parallel([*specs[:-1], {"agent_id": "outsider", "prompt": "invalid"}])
        assert not service.queue.list("group")
        result = _call_agent_parallel(specs)
        assert result["accepted"] and not result["completed"]
        assert len(result["results"]) == count
        retry = _call_agent_parallel(specs)
        assert [r["task_id"] for r in retry["results"]] == [
            r["task_id"] for r in result["results"]
        ]
    assert len(service.queue.list("group")) == count


def test_parallel_group_dispatch_validates_all_members_and_nested_calls(service):
    from runtime.execution.suckers._delegation_skills_parallel import _call_agent_parallel
    from runtime.execution.tool_engine.coordination_guard import (
        coordination_scope,
        current_group_coordination,
    )

    service.groups.append("group", MemberEvent(action="mode", actor="user", mode="cluster"))
    with source(service), coordination_scope(service):
        with pytest.raises(PermissionError):
            _call_agent_parallel(
                [
                    {"agent_id": "drafter", "prompt": "one"},
                    {"agent_id": "outsider", "prompt": "two"},
                ]
            )
        assert not service.queue.list("group")
        result = _call_agent_parallel([{"agent_id": "drafter", "prompt": "one"}])
    child = result["results"][0]["task_id"]
    with (
        session_scope(
            Session(
                thread_id="child-only",
                actor="user",
                agent=SimpleNamespace(agent_id="drafter"),
                metadata={"_coordination_task_id": child},
            )
        ),
        coordination_scope(service),
    ):
        assert current_group_coordination() is service
        with pytest.raises(PermissionError):
            _call_agent_parallel([{"agent_id": "outsider", "prompt": "two"}])
    assert len(service.queue.list("group")) == 1
