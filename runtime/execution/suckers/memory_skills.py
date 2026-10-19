"""
memory_skills · per-agent long-term memory / user-profile / diary skills.

Each skill resolves the "current agent" via the Session ContextVar
(`runtime.platform.process.session.current_session`). Without an active agent
session the skills raise — they can't know where to write.

Layout (per agent):

    agents/<agent_id>/agent-core/
        MEMORY.md           · long-term facts (remember / recall)
        USER.md             · user profile (note_user)
        SOUL.md             · agent persona + lessons (update_soul)
        diary/YYYY-MM-DD.md · daily diary (diary_write)

The four "write" skills target different scopes — pick the right
one based on WHAT you're recording:

    remember     · facts about THE WORLD or THE PROJECT (what's
                   the deadline, what's the API key location, etc).
    note_user    · facts about THE USER (likes terse answers,
                   prefers Chinese, uses vim, etc).
    update_soul  · LESSONS the agent learned about ITSELF (this
                   approach failed last time, that workaround
                   actually works, this skill has a quirky arg
                   format). The next session inherits these via
                   SOUL.md → system prompt.
    diary_write  · narrative log of "what happened today" — not
                   for retrieval, just for human inspection.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from runtime.memory.runtime_state.scope_paths import (
    normalize_memory_scope,
    scoped_memory_path,
    visible_memory_tier_paths,
)
from runtime.memory.semantics import memory_data_notice, model_note

# ═══════════════════════════════════════════════════════════
# Path resolution
# ═══════════════════════════════════════════════════════════

# Project root is the parent of `runtime/` — this file lives at
# runtime/execution/suckers/memory_skills.py so parents[3] = repo root.
_PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _agent_core_dir() -> Path:
    """Return `agents/<agent_id>/agent-core/` for the current session.

    Raises RuntimeError if no Session / no agent is active.
    """
    from runtime.platform.process.session import current_session

    sess = current_session()
    if sess is None or sess.agent is None:
        raise RuntimeError(
            "memory skills require an active agent session (no current_session or no agent bound)"
        )
    agent_id = sess.agent.agent_id
    if not agent_id:
        raise RuntimeError("memory skills: current agent has no agent_id")
    return _PROJECT_ROOT / "agents" / agent_id / "agent-core"


def _current_turn_score_scope() -> Any:
    """Return the exact score namespace bound to the active Session.

    A missing Session is already rejected by ``_agent_core_dir``.  A Session
    without ownership is the local legacy namespace; a partially populated or
    inconsistent authenticated Session raises instead of leaking legacy or a
    neighbouring tenant's quality history.
    """

    from runtime.platform.process.session import current_session
    from runtime.safety.evolution.tenant_scope import trusted_scope_from_session

    return trusted_scope_from_session(current_session())


def _current_agent_and_metadata() -> tuple[str, dict[str, Any]]:
    from runtime.platform.process.session import current_session

    sess = current_session()
    if sess is None or sess.agent is None:
        raise RuntimeError(
            "memory skills require an active agent session (no current_session or no agent bound)"
        )
    agent_id = sess.agent.agent_id
    if not agent_id:
        raise RuntimeError("memory skills: current agent has no agent_id")
    metadata = dict(sess.metadata or {})
    return agent_id, metadata


def _memory_path_for_scope(scope: str | None = None) -> tuple[str, Path]:
    agent_id, metadata = _current_agent_and_metadata()
    normalized = normalize_memory_scope(scope)
    path = scoped_memory_path(
        normalized,
        repo_root=_PROJECT_ROOT,
        agent_id=agent_id,
        metadata=metadata,
    )
    return normalized, path


def _visible_memory_paths(scope: str | None = None) -> list[tuple[str, Path]]:
    agent_id, metadata = _current_agent_and_metadata()
    normalized = normalize_memory_scope(scope)
    if normalized == "all":
        return visible_memory_tier_paths(
            repo_root=_PROJECT_ROOT,
            agent_id=agent_id,
            metadata=metadata,
        )
    label, path = _memory_path_for_scope(normalized)
    return [(label, path)]


def _append_memory_line(
    path: Path,
    *,
    fact: str,
    tags: list[str],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        existing = path.read_text(encoding="utf-8")
        if "_No memories yet._" in existing:
            cleaned = (
                "\n".join(
                    ln for ln in existing.splitlines() if ln.strip() != "_No memories yet._"
                ).rstrip()
                + "\n"
            )
            path.write_text(cleaned, encoding="utf-8")

    line = model_note(fact, recorded_at=_iso_now(), tags=[str(tag) for tag in tags])
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line)


def _iso_now() -> str:
    return datetime.now().isoformat(timespec="seconds")


# ═══════════════════════════════════════════════════════════
# Handlers
# ═══════════════════════════════════════════════════════════


def _remember(
    fact: str,
    tags: list[str] | None = None,
    scope: str = "agent",
    **_kw: Any,
) -> dict[str, Any]:
    """Append an explicitly unverified model note to a scoped MEMORY.md."""
    tags = tags or []
    resolved_scope, path = _memory_path_for_scope(scope)
    _append_memory_line(path, fact=fact, tags=tags)
    return {
        "ok": True,
        "scope": resolved_scope,
        "path": str(path),
        "appended": fact,
        "memory_type": "model_summary",
        "assurance": "unverified",
    }


def _recall(
    query: str = "",
    limit: int = 20,
    scope: str = "all",
    **_kw: Any,
) -> dict[str, Any]:
    """Read visible scoped memory tiers and return matching lines."""
    entries: list[str] = []
    paths: list[str] = []
    q = (query or "").lower()
    max_entries = max(0, int(limit) if limit else 20)

    for tier_name, path in _visible_memory_paths(scope):
        if not path.exists():
            continue
        paths.append(str(path))
        text = path.read_text(encoding="utf-8")
        lines = [ln.rstrip("\n") for ln in text.splitlines() if ln.strip()]
        if q:
            tier_entries = [ln for ln in lines if q in ln.lower()]
        else:
            tier_entries = lines[-max_entries:] if max_entries > 0 else []
        entries.extend(f"[{tier_name}] {line}" for line in tier_entries)

    if max_entries > 0 and len(entries) > max_entries:
        entries = entries[-max_entries:]
    return {
        "ok": True,
        "scope": normalize_memory_scope(scope),
        "paths": paths,
        "entries": entries,
        "count": len(entries),
        "assurance": "unverified",
        "notice": memory_data_notice(),
    }


_OBSERVATIONS_HEADER = "## Observations"


def _note_user(trait: str, **_kw: Any) -> dict[str, Any]:
    """Append a trait line under `## Observations` in USER.md."""
    core = _agent_core_dir()
    core.mkdir(parents=True, exist_ok=True)
    path = core / "USER.md"

    entry = model_note(trait, recorded_at=_iso_now(), tags=["user_observation"]).rstrip("\n")

    if not path.exists():
        path.write_text(
            f"{_OBSERVATIONS_HEADER}\n{entry}\n",
            encoding="utf-8",
        )
        return {"ok": True, "path": str(path)}

    text = path.read_text(encoding="utf-8")
    if _OBSERVATIONS_HEADER not in text:
        # Append a new section at the end
        sep = "" if text.endswith("\n") else "\n"
        new_text = f"{text}{sep}\n{_OBSERVATIONS_HEADER}\n{entry}\n"
        path.write_text(new_text, encoding="utf-8")
    else:
        # Append line at end of file (section already present).
        sep = "" if text.endswith("\n") else "\n"
        with path.open("a", encoding="utf-8") as fh:
            fh.write(f"{sep}{entry}\n")
    return {"ok": True, "path": str(path)}


from runtime.safety.evolution.soul_actions import (  # noqa: E402, F401
    _analyze_soul_impact,
    _auto_regression_check,
    _deep_evolve,
    _deep_reflect,
    _list_soul_history,
    _list_soul_snapshots,
    _recall_scores,
    _revert_soul,
    _snapshot_soul,
    _soul_history_dir,
    _update_soul,
)


def _diary_write(entry: str, **_kw: Any) -> dict[str, Any]:
    """Append a timestamped entry to today's diary file."""
    core = _agent_core_dir()
    diary_dir = core / "diary"
    diary_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now()
    path = diary_dir / f"{now.strftime('%Y-%m-%d')}.md"
    ts = now.strftime("%H:%M:%S")

    block = f"## {ts}\n\n{entry}\n"
    if path.exists() and path.stat().st_size > 0:
        existing = path.read_text(encoding="utf-8")
        sep = "" if existing.endswith("\n") else "\n"
        block = f"{sep}\n{block}"
    with path.open("a", encoding="utf-8") as fh:
        fh.write(block)

    return {"ok": True, "path": str(path)}


# ═══════════════════════════════════════════════════════════
# Registrar · moved to _memory_skills_handlers to keep this file
# under 1000 lines.  Re-exported below so public callers are
# unaffected.  The import MUST come after all handler definitions
# above so the submodule can resolve them at load time.
# ═══════════════════════════════════════════════════════════
from ._memory_skills_handlers import register_memory_skills  # noqa: E402  (after defs)

__all__ = ["register_memory_skills"]
