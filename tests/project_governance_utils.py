"""Owner decisions a governed project needs before it executes (test helpers).

Projects created over REST wait for the owner: initiation approval, then a
phase authorization before each phase runs, then acceptance of its delivery.
Tests that exercise execution rather than governance use these helpers to make
those decisions through the same HTTP endpoints the project page calls.
"""

from __future__ import annotations

from typing import Any


def owner_decides_via_api(
    client: Any,
    project_id: str,
    *,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Approve whatever the project currently waits on; return its governance."""

    kwargs = {"headers": headers} if headers else {}
    state = client.get(f"/api/projects/{project_id}", **kwargs)
    assert state.status_code == 200, state.text
    governance = state.json()["governance"]
    for _ in range(4):
        initiation = governance["initiation"]
        phase = governance["phase"]
        if initiation["required"]:
            response = client.post(
                f"/api/projects/{project_id}/initiation/approve",
                json={"expected_fingerprint": initiation["fingerprint"]},
                **kwargs,
            )
        elif governance["acceptance"]:
            item = governance["acceptance"][0]
            response = client.post(
                f"/api/projects/{project_id}/milestones/{item['milestone_id']}/accept",
                json={"expected_fingerprint": item["fingerprint"]},
                **kwargs,
            )
        elif phase is not None and not phase["authorized"]:
            response = client.post(
                f"/api/projects/{project_id}/phases/{phase['milestone_id']}/authorize",
                json={"expected_fingerprint": phase["fingerprint"]},
                **kwargs,
            )
        else:
            return governance
        assert response.status_code == 200, response.text
        governance = response.json()["governance"]
    return governance


def run_governed_to_done(
    client: Any,
    project_id: str,
    *,
    max_rounds: int = 10,
    max_ticks: int = 20,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Alternate owner decisions and runs until the project finishes."""

    kwargs = {"headers": headers} if headers else {}
    result: dict[str, Any] = {}
    for _ in range(max_rounds):
        owner_decides_via_api(client, project_id, headers=headers)
        response = client.post(
            f"/api/projects/{project_id}/run", json={"max_ticks": max_ticks}, **kwargs
        )
        assert response.status_code == 200, response.text
        result = response.json()
        if result["final_status"] in {"done", "failed", "blocked"}:
            return result
    return result


def owner_decides(
    store: Any,
    project_id: str,
    *,
    roster: list[str] | None = None,
    actor: str = "owner",
) -> dict[str, Any]:
    """Store-level twin of :func:`owner_decides_via_api` for engine tests."""

    from runtime.projectos.owner_decisions import (
        accept_delivery,
        approve_initiation,
        authorize_phase,
        governance_view,
    )

    governance: dict[str, Any] = {}
    for _ in range(4):
        governance = governance_view(store, store.get_project(project_id), roster=roster)
        initiation = governance["initiation"]
        phase = governance["phase"]
        if initiation["required"]:
            approve_initiation(
                store,
                project_id,
                actor=actor,
                expected_fingerprint=initiation["fingerprint"],
                roster=roster,
            )
        elif governance["acceptance"]:
            item = governance["acceptance"][0]
            accept_delivery(
                store,
                project_id,
                item["milestone_id"],
                actor=actor,
                expected_fingerprint=item["fingerprint"],
            )
        elif phase is not None and not phase["authorized"]:
            authorize_phase(
                store,
                project_id,
                phase["milestone_id"],
                actor=actor,
                expected_fingerprint=phase["fingerprint"],
            )
        else:
            break
    return governance
