"""Durable staffing proposals. Only the authenticated UI decision may invite."""

import hashlib
import json
import time

from .coordination import text


def proposals(service, thread):
    with service.ledger.store._lock, service.ledger.store._connect() as conn:
        rows = conn.execute(
            "SELECT id,status,payload FROM coordination_recruitment WHERE thread_id=? "
            "ORDER BY created_at DESC LIMIT 50",
            (thread,),
        ).fetchall()
    return [
        {**json.loads(payload), "id": identifier, "status": status}
        for identifier, status, payload in rows
    ]


def propose(service, source, member, reason, prompt, request_id):
    from runtime.execution.suckers.delegation_skills import _allowed_agent_ids
    from runtime.platform.process.session import current_session

    from .coordination_policy import capture_policy

    member = text(member, "candidate", 160)
    reason = text(reason, "why current group cannot cover this capability", 4000)
    prompt = text(prompt, "proposed assignment", 12000)
    request_id = text(request_id, "request_id", 160)
    if service.groups.state(source["thread_id"]).member(member):
        raise ValueError("candidate already belongs to this group; use existing members")
    if member not in _allowed_agent_ids():
        raise ValueError("candidate must be an installed, accessible role; search roles first")
    identifier = (
        "recruit-" + hashlib.sha256(f"{source['id']}:{request_id}".encode()).hexdigest()[:32]
    )
    policy = capture_policy(
        current_session(), parent={**service.ledger.context(source["id"]), "id": source["id"]}
    )
    payload = {
        "candidate_id": member,
        "reason": reason,
        "prompt": prompt,
        "actor_id": source["actor_id"],
        "parent_task_id": source["id"],
        "policy": policy,
        "roster": [m.id for m in service.groups.state(source["thread_id"]).roster],
    }
    with service.ledger.store._lock, service.ledger.store._connect() as conn:
        old = conn.execute(
            "SELECT payload FROM coordination_recruitment WHERE id=?", (identifier,)
        ).fetchone()
        if old:
            previous = json.loads(old[0])
            if any(previous[k] != payload[k] for k in ("candidate_id", "reason", "prompt")):
                raise ValueError("request_id already used for a different proposal")
        else:
            conn.execute(
                "INSERT INTO coordination_recruitment VALUES(?,?,'pending',?,?)",
                (identifier, source["thread_id"], json.dumps(payload), time.time()),
            )
    return {
        "proposal_id": identifier,
        "status": "awaiting_user_approval",
        "message": "已提交人才缺口审批；等待用户弹窗同意。尚未邀请、加入项目或执行。",
    }


def review(service, thread, identifier, actor, accept, invite):
    proposal = next((p for p in proposals(service, thread) if p["id"] == identifier), None)
    if proposal is None:
        raise KeyError("staffing proposal not found")
    if proposal["status"] in {"approved", "rejected"}:
        return {"status": proposal["status"]}
    with service.ledger.store._lock, service.ledger.store._connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        status = conn.execute(
            "SELECT status FROM coordination_recruitment WHERE id=?", (identifier,)
        ).fetchone()[0]
        if status in {"approved", "rejected"}:
            return {"status": status}
        if not accept:
            if status != "pending":
                raise ValueError("invitation has already been approved")
            conn.execute(
                "UPDATE coordination_recruitment SET status='rejected' WHERE id=?", (identifier,)
            )
            return {"status": "rejected"}
        conn.execute(
            "UPDATE coordination_recruitment SET status='inviting' WHERE id=?", (identifier,)
        )
    if accept:
        from runtime.execution.suckers.delegation_skills import _allowed_agent_ids

        if proposal["candidate_id"] not in _allowed_agent_ids():
            raise ValueError("candidate is no longer available")
        # The user approves membership and this exact assignment together.
        # Both calls are idempotent, so a retry recovers an interrupted commit.
        invite(proposal["candidate_id"])
        service.create_task(
            thread,
            actor,
            proposal["candidate_id"],
            proposal["prompt"],
            identifier,
            policy=proposal["policy"],
        )
    status = "approved" if accept else "rejected"
    with service.ledger.store._lock, service.ledger.store._connect() as conn:
        conn.execute(
            "UPDATE coordination_recruitment SET status=? WHERE id=? AND status='inviting'",
            (status, identifier),
        )
    return {"status": status}
