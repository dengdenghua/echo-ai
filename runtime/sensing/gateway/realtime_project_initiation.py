"""Owner-approved staffing before a chat becomes a managed project."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from typing import Any
from uuid import uuid4

from runtime.platform.models.provider_errors import ModelProviderHTTPError
from runtime.projectos.initiation import ProjectProposal
from runtime.protocol import ServerMethod


def _conversation_message_text(message: dict[str, Any]) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text.strip())
        return "\n".join(parts)
    return ""


def _conversation_history(thread: dict[str, Any]) -> list[dict[str, str]]:
    values = thread.get("values")
    raw_messages = values.get("messages") if isinstance(values, dict) else []
    raw_messages = raw_messages if isinstance(raw_messages, list) else []
    # A trailing project control command ("/project run ...") is the current
    # request, not prior context — the planner already receives it separately
    # as ``goal`` / ``latest_request``.  Drop the trailing run so history ends
    # at the last real exchange.
    while raw_messages and isinstance(raw_messages[-1], dict):
        if not _conversation_message_text(raw_messages[-1]).strip().startswith("/project"):
            break
        raw_messages = raw_messages[:-1]
    selected: list[dict[str, str]] = []
    total_chars = 0
    for raw_message in reversed(raw_messages[-24:]):
        if not isinstance(raw_message, dict):
            continue
        role_by_type = {
            "human": "user",
            "ai": "assistant",
            "assistant": "assistant",
            "user": "user",
        }
        role = role_by_type.get(str(raw_message.get("type") or raw_message.get("role") or ""))
        if role is None:
            continue
        content = _conversation_message_text(raw_message)
        if not content:
            continue
        content = content[:1000]
        selected.append({"role": role, "content": content})
        total_chars += len(content)
        if total_chars >= 12000:
            break
    selected.reverse()
    while selected and total_chars > 12000:
        total_chars -= len(selected.pop(0)["content"])
    return selected


_NON_SUBSTANTIVE_REQUESTS = frozenset(
    {
        "?",
        "？",
        "继续",
        "立项",
        "立项啊",
        "按项目走",
        "开工",
        "开始",
        "run",
        "go",
        "jixu",
    }
)


def _is_non_substantive_request(text: str) -> bool:
    """Bare continuation commands ("立项啊", "继续", "?") carry no
    objective of their own; anything under 4 chars cannot describe a real
    project goal either."""
    stripped = str(text or "").strip()
    if not stripped:
        return True
    if len(stripped) < 4:
        return True
    return stripped.lower() in _NON_SUBSTANTIVE_REQUESTS


def _original_goal_from_history(
    previous: dict[str, Any], goal: str, history: list[dict[str, str]]
) -> str:
    original_goal = previous.get("original_goal") or previous.get("goal") or goal
    if original_goal.strip() and original_goal != goal:
        return original_goal
    for message in history:
        if message["role"] != "user":
            continue
        content = message["content"]
        if len(content) >= 4 and content != goal:
            return content
    return original_goal


async def initiate_project(
    runtime: Any,
    turn: Any,
    log: Any,
    emitter: Any,
    *,
    thread_id: str,
    goal: str,
    owner_id: str,
    tenant_id: str,
    leader: Any,
    prepare: Any,
    explicit_project_request: bool = False,
    review_id: str = "",
    refine_id: str = "",
    feedback: str = "",
) -> ProjectProposal | None:
    async def emit(message: str) -> None:
        await runtime._emit_agent_message(turn, log, emitter, message)

    store = runtime._thread_store
    thread = store.get(thread_id) if store else None
    if not thread or (not review_id and not callable(prepare)) or leader is None:
        import logging

        logging.getLogger(__name__).warning(
            "Project initiation unavailable: thread=%s planner=%s leader=%s",
            bool(thread),
            callable(prepare),
            leader is not None,
        )
        if thread is None:
            reason = "当前线程状态不可用"
        elif leader is None:
            reason = "当前项目领导角色不可用"
        else:
            reason = "当前会话缺少可用的项目规划模型"
        await emit(
            "我会先作为产品经理梳理立项方案。当前立项服务尚未就绪，"
            f"没有添加成员或启动执行。{reason}，请处理后重试。"
        )
        return None
    raw_previous = (thread.get("metadata") or {}).get("project_initiation") or {}
    # CAS baseline: the raw stored shape. ``previous`` below is augmented with
    # planning context (``conversation_history``, possibly a rewritten
    # ``original_goal``) that is never persisted, so comparing the store
    # against the augmented copy would always mismatch and make every save
    # look like a concurrent draft update.
    saved_version = deepcopy(raw_previous)
    conversation_history = _conversation_history(thread)
    previous = {
        **raw_previous,
        "conversation_history": conversation_history,
        "original_goal": _original_goal_from_history(raw_previous, goal, conversation_history),
    }
    # Restore the real objective for bare continuation requests so the
    # planner and HUB matching work on the user's actual goal instead of
    # drafting a vacuous clarification loop; the literal request is kept
    # as feedback below.
    continuation_request = ""
    if not review_id and not refine_id and _is_non_substantive_request(goal):
        restored = str(previous.get("original_goal") or "").strip()
        if restored and restored != goal:
            continuation_request = goal.strip()
            goal = restored
    if refine_id:
        if (
            previous.get("id") != refine_id
            or previous.get("leader_id") != leader.agent_id
            or previous.get("status")
            not in {
                "needs_input",
                "needs_review",
                "approval_expired",
                "needs_revision",
                "needs_roles",
                "pending_approval",
                "model_unavailable",
                "review_failed",
                "refining",
            }
            or not feedback.strip()
        ):
            await emit("草案已更新，请在最新草案上补充需求；本次未修改或启动项目。")
            return None
        goal = previous.get("goal") or goal
    if review_id:
        if (
            previous.get("id") != review_id
            or previous.get("status")
            not in {"approval_expired", "needs_revision", "needs_roles", "needs_review"}
            or previous.get("leader_id") != leader.agent_id
            or not previous.get("proposal", {}).get("name")
        ):
            await emit("这份方案已更新或暂不可重新审批。请查看最新方案；未添加成员或启动项目。")
            return None
        goal = previous.get("goal") or goal
    registry = runtime._agent_registry
    agents = list(registry.all_agents()) if registry is not None else []
    by_id = {a.agent_id: a for a in agents}
    by_id[leader.agent_id] = leader
    candidates = [
        {
            "agent_id": a.agent_id,
            "name": a.display_name,
            "description": a.description[:300],
            "source": "existing",
        }
        for a in by_id.values()
    ]
    names = {a.agent_id: a.display_name for a in by_id.values()}
    from runtime.projectos.recruitment import hub_candidates, provisioning_requests

    await emit(
        "正在核对已有角色并检索 HUB 候选，整理岗位职责和参与阶段；匹配结果会随立项方案交由你审批。"
    )
    try:
        hub_rows = await asyncio.to_thread(hub_candidates, goal)
    except (OSError, ValueError, RuntimeError):
        hub_rows = []
        await emit("HUB 候选检索暂时不可用，本次先核对已有角色；缺少的岗位会在方案中说明。")
    else:
        await emit(
            f"已核对 {len(by_id)} 个已有角色，检索到 {len(hub_rows)} 个 HUB 候选。产品经理将按职责匹配，不会全部加入项目。"
        )
    hub_names = {item["agent_id"]: item["name"] for item in hub_rows}
    candidates.extend(hub_rows)
    names.update(hub_names)
    proposal_id = uuid4().hex

    feedback_history = deepcopy(previous.get("user_feedback") or [])
    if refine_id:
        feedback_history.append(feedback.strip())
    elif not review_id and raw_previous and goal != raw_previous.get("goal"):
        feedback_history.append(goal)
    if continuation_request and continuation_request not in feedback_history:
        feedback_history.append(continuation_request)
    revisions = deepcopy(previous.get("revisions") or [])
    if previous.get("proposal", {}).get("name"):
        revisions.append(
            {
                key: deepcopy(previous.get(key))
                for key in (
                    "id",
                    "status",
                    "goal",
                    "proposal",
                    "revision",
                    "changes",
                )
            }
        )
    changes: list[str] = []
    open_questions = list(previous.get("open_questions") or [])

    def save(status: str, proposal: dict[str, Any]) -> bool:
        nonlocal saved_version
        next_version = {
            "id": proposal_id,
            "status": status,
            "goal": goal,
            "original_goal": previous.get("original_goal") or previous.get("goal") or goal,
            "leader_id": leader.agent_id,
            "proposal": proposal,
            "user_feedback": feedback_history,
            "revisions": revisions,
            "revision": int(previous.get("revision") or 0) + 1,
            "changes": changes,
            "open_questions": open_questions,
        }
        # Thread messages can advance unrelated state while the model or an
        # approval is pending. Retry those updates, but never replace a newer
        # proposal, even when an older request times out later.
        for _ in range(4):
            latest_thread = store.get(thread_id)
            if (
                not latest_thread
                or ((latest_thread.get("metadata") or {}).get("project_initiation") or {})
                != saved_version
            ):
                return False
            if (
                store.update_state_if_unchanged(
                    thread_id, latest_thread, metadata={"project_initiation": next_version}
                )
                is not None
            ):
                saved_version = deepcopy(next_version)
                return True
        return False

    if not review_id and not save("refining", previous.get("proposal") or {}):
        await emit("草案已被更新，本次旧请求停止。请继续最新版本。")
        return None
    await emit(
        "正在重新提交已保留的立项方案，核对候选角色后由你审批。"
        if review_id
        else f"{leader.display_name} 将先担任产品经理，分析目标、预算和人员需求，准备立项方案。"
    )
    try:
        raw = (
            previous["proposal"]
            if review_id
            else await asyncio.to_thread(
                prepare,
                goal=goal,
                leader=leader.agent_id,
                candidates=candidates,
                previous={**previous, "user_feedback": feedback_history},
                **(
                    {"model": turn.params.model}
                    if getattr(turn, "params", None) and turn.params.model
                    else {}
                ),
                explicit_project_request=explicit_project_request,
            )
        )
        proposal = ProjectProposal.model_validate(raw)
        provisions = provisioning_requests(proposal, thread_id, hub_names)
        names.update({item["key"]: item["name"] for item in provisions})
        ids = {need.agent_id for need in proposal.staffing if need.kind == "ai" and need.agent_id}
        if not ids.issubset(names) or leader.agent_id not in ids:
            raise ValueError("invalid staffing candidates")
        if any(p < 1 or p > len(proposal.milestones) for n in proposal.staffing for p in n.phases):
            raise ValueError("invalid staffing phase")
    except ModelProviderHTTPError as exc:
        # Named apart from the proposal ``status`` below: this one is an HTTP
        # status code, that one is a proposal lifecycle string.
        status_code, message = exc.public_failure()
        save(
            "model_unavailable",
            previous.get("proposal") or {"error": type(exc).__name__, "status_code": status_code},
        )
        await emit(f"立项规划暂未完成：{message}尚未添加成员或启动项目执行。")
        return None
    except (ValueError, TypeError) as exc:
        save("review_failed", previous.get("proposal") or {"error": type(exc).__name__})
        await emit("需求评审或方案校验尚未完成，已有草案和补充意见已保留；尚未提交审批或添加成员。")
        return None
    if proposal.sizing == "task":
        save("suggested_task", proposal.model_dump())
        await emit(proposal.render(names))
        await emit(
            "这项工作建议作为普通任务处理，可按需邀请助手协作。未创建项目或添加成员；可以继续当前任务。"
        )
        return None
    if (
        any(need.kind == "ai" and not need.agent_id for need in proposal.staffing)
        and not proposal.questions
    ):
        proposal.questions.append("尚有岗位未匹配，请确认由谁承担，或调整本期范围。")
    for key, label in (
        ("scope", "本期范围"),
        ("deliverables", "交付物"),
        ("acceptance_criteria", "验收标准"),
        ("assumptions", "暂定假设"),
        ("milestones", "阶段安排"),
        ("staffing", "人员安排"),
        ("budget", "预算说明"),
        ("deadline", "目标期限"),
    ):
        if previous.get("proposal") and previous["proposal"].get(key) != proposal.model_dump().get(
            key
        ):
            changes.append(label)
    questions = proposal.clarification_questions()
    if goal.strip() in {"?", "？"}:
        combined_question = "请补充：要解决什么问题、服务谁、第一期交付什么？"
        proposal.questions = [combined_question]
        if proposal.requirements_review is not None:
            proposal.requirements_review.blocking_questions = []
            proposal.requirements_review.ready = False
            proposal.requirements_review.reason = combined_question
        questions = proposal.clarification_questions()
    open_questions = questions
    status = "needs_input" if questions else "needs_review" if refine_id else "pending_approval"
    if not save(status, proposal.model_dump()):
        await emit("立项方案已更新，本次旧方案不再提交审批。请查看最新方案。")
        return None
    if changes:
        await emit("本轮草案已更新：" + "、".join(changes) + "。旧稿和补充意见已保留。")
    if questions:
        await emit(proposal.render_discovery())
        return None
    await emit(proposal.render(names))
    if refine_id:
        await emit(
            "本轮需求评审未发现阻塞问题。请审阅新版草案，也可以继续修改；提交立项审批后才会请求授权。"
        )
        return None
    await emit("审批通过后将添加上述 AI 成员并建立项目计划；此步骤不会启动任务执行或支付预算。")
    try:
        decision = await emitter.request_approval(
            ServerMethod.REQ_COMMAND_APPROVAL,
            {
                "threadId": thread_id,
                "turnId": turn.id,
                "itemId": proposal_id,
                "tool": "project_initiation",
                "argsPreview": proposal.render(names),
                "detail": "批准立项、添加所列 AI 成员并建立项目计划。预算仅为估算，不授权支付；不启动任务。",
                "roleProvisions": provisions,
                "staffingReview": [
                    {
                        "role": need.role,
                        "name": names.get(need.agent_id, need.role),
                        "source": ("hub" if need.agent_id.startswith("hub:") else need.source)
                        if need.kind == "ai"
                        else need.kind,
                        "responsibilities": need.responsibilities,
                        "phases": need.phases,
                    }
                    for need in proposal.staffing
                ],
                "timeoutMs": 600000,
            },
            timeout=600.0,
        )
    except Exception:
        if save("approval_expired", proposal.model_dump()):
            await emit("本次立项审批未完成，方案已保留，未添加成员或启动项目。")
        else:
            await emit("本次旧审批已结束；较新的立项方案保持不变。未添加成员或启动项目。")
        return None
    latest = store.get(thread_id) or {}
    current = (latest.get("metadata") or {}).get("project_initiation") or {}
    if current.get("id") != proposal_id:
        await emit("立项方案已经更新，本次审批不再应用，请审批最新方案。")
        return None
    if (decision or {}).get("action") != "accept":
        save("needs_revision", proposal.model_dump())
        await emit("立项未通过，方案已保留。可以继续修改范围、预算和岗位配置。")
        return None
    if emitter.is_turn_interrupted(turn.id):
        return None
    prepared = (decision or {}).get("preparedRoles") or {}
    for item in provisions:
        actual_id = prepared.get(item["key"])
        if not isinstance(actual_id, str) or registry is None or not registry.has(actual_id):
            save("needs_roles", proposal.model_dump())
            await emit("部分角色尚未准备完成，方案已保留；未把不可用角色加入项目。")
            return None
        if item["source"] == "hub" and not registry.matches_hub_source(
            item["expert_id"], actual_id
        ):
            save("needs_roles", proposal.model_dump())
            await emit(
                "准备的角色与审批中的 HUB 候选不一致或已变更，尚未添加成员。请重新准备并审批。"
            )
            return None
        if item["source"] == "new" and actual_id != item["agent_id"]:
            raise ValueError("created role does not match approved specification")
        for need in proposal.staffing:
            if need.agent_id == item["key"]:
                need.agent_id = actual_id
    ids = {need.agent_id for need in proposal.staffing if need.kind == "ai" and need.agent_id}
    # Revalidate access after the asynchronous approval, before mutations.
    if owner_id:
        from runtime.sensing.gateway.thread_access import ThreadAccessResolver

        access = ThreadAccessResolver(
            thread_store=store,
            group_store=runtime._cowork_group_store,
            collaboration_store=runtime._collaboration_store,
        ).resolve(thread_id, owner_id, tenant_id)
        if not access.can_manage:
            raise PermissionError("project initiation access changed")
    from runtime.memory.cowork.group import MemberEvent

    if registry is not None and any(not registry.has(agent_id) for agent_id in ids):
        save("needs_revision", proposal.model_dump())
        await emit("方案中的角色已发生变化，请重新匹配并审批；尚未添加成员。")
        return None
    if not save("approved", proposal.model_dump()):
        await emit("立项方案已更新，本次审批不再应用，未添加成员。请审批最新方案。")
        return None
    roster = runtime._cowork_group_store.state(thread_id).roster
    present = {
        member.id
        for member in roster
        if member.kind == "agent" and member.role == "participant" and not member.muted
    }
    initial_ids = {
        n.agent_id for n in proposal.staffing if n.kind == "ai" and 1 in n.phases and n.agent_id
    }
    initial_ids.add(leader.agent_id)
    for agent_id in sorted(initial_ids - present):
        runtime._cowork_group_store.append(
            thread_id,
            MemberEvent(action="invite", actor=owner_id or "project-os", target_id=agent_id),
        )
    await emit(
        "立项审批已通过，首阶段成员已就位："
        + "、".join(
            names.get(
                agent_id,
                next(
                    (item["name"] for item in provisions if prepared.get(item["key"]) == agent_id),
                    agent_id,
                ),
            )
            for agent_id in sorted(initial_ids)
        )
        + "。后续阶段成员按批准的阶段安排加入；开始执行仍需阶段审批。"
    )
    return proposal
