"""Read-only registration diagnostics; this is not an execution/credential test."""

from __future__ import annotations

from typing import Any

from runtime.execution.misc.skill_policy import FULL_ACCESS_MARKERS, dedupe_skill_names

from .dependencies import normalize_role_dependencies


def inspect_role_registration(agent: Any, skill_registry: Any) -> dict[str, Any]:
    """Inspect the loaded role's explicitly configured skills without calling tools.

    A prompt skill being registered does not prove that tools mentioned in its
    instructions exist. Model credentials and per-turn permissions are also
    deliberately outside this snapshot's scope.
    """
    declared = dedupe_skill_names(getattr(agent, "extra_skills", ()) or ())
    names = [name for name in declared if name.lower() not in FULL_ACCESS_MARKERS]
    checks: list[dict[str, str]] = []
    for name in names:
        item = {"name": name, "status": "unknown"}
        if skill_registry is not None:
            try:
                skill = skill_registry.get(name)
                # Never disclose a tenant-owned skill in this shared catalog
                # endpoint. Task-scoped discovery checks it with its own actor.
                if getattr(skill, "tenant_id", None):
                    checks.append(item)
                    continue
                item["status"] = (
                    "registered" if skill_registry.is_enabled(skill.name) else "disabled"
                )
            except KeyError:
                item["status"] = "missing"
        checks.append(item)
    statuses = {item["status"] for item in checks}
    if statuses & {"missing", "disabled"}:
        status = "needs_attention"
    elif skill_registry is None or "unknown" in statuses:
        status = "unknown"
    else:
        status = "checked"
    return {
        "agent_id": agent.agent_id,
        "scope": "configured_skill_registration",
        "status": status,
        "checks": checks,
        "dependencies": normalize_role_dependencies(getattr(agent, "dependencies", None)),
        "unchecked": ["model_credentials", "connector_auth", "task_permissions", "execution"],
    }
