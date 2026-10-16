"""Thread store boot-time replay of JSONL journals into memory."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ._state_mutation_lock import iter_jsonl_records_reverse
from ._store_records import _decoded_state_record


class ThreadLoadMixin:
    """Fold legacy and per-thread session files into the in-memory store."""

    # ─── load ────────────────────────────────────────────────

    def _load_from(
        self,
        path: Path,
        implied_agent: str | None = None,
        implied_team_id: str | None = None,
    ) -> None:
        """Read a single jsonl (legacy single-file OR one per-thread
        file) and fold its records into memory.

        ``implied_agent`` · when set and a record's thread has no
        explicit ``metadata.agent`` tag, tag it to this value. The
        caller (per-agent tree walker) passes the folder-derived
        agent id so legacy threads that predate the metadata tagging
        get retroactively attributed. This is the "migration" path
        for old history that was invisible under the agent filter.
        """

        # Scoped storage uses exactly one journal per thread. Its newest valid
        # operation fully determines the current state, while older checkpoints
        # remain available through ``get_history()``. Reading from the tail
        # avoids parsing every full snapshot during service startup.
        if self._per_agent_base is not None:
            for record in iter_jsonl_records_reverse(path):
                if record.get("thread_id") != path.stem:
                    continue
                if self._apply_loaded_record(
                    record,
                    implied_agent=implied_agent,
                    implied_team_id=implied_team_id,
                ):
                    return
            return

        # The legacy journal can interleave many thread ids, so it still needs
        # a forward fold. Stream it line by line to keep peak memory bounded.
        try:
            handle = path.open("r", encoding="utf-8")
        except OSError:
            return
        with handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(record, dict):
                    self._apply_loaded_record(
                        record,
                        implied_agent=implied_agent,
                        implied_team_id=implied_team_id,
                    )

    def _apply_loaded_record(
        self,
        record: dict[str, Any],
        *,
        implied_agent: str | None,
        implied_team_id: str | None,
    ) -> bool:
        """Fold one valid state operation and report whether it was applied."""

        if record.get("type") == "session_meta":
            return False
        thread_id = record.get("thread_id")
        if not isinstance(thread_id, str) or not thread_id:
            return False
        if record.get("op") == "delete":
            self._threads.pop(thread_id, None)
            self._history.pop(thread_id, None)
            return True
        thread = record.get("thread")
        if not isinstance(thread, dict):
            return False
        state = _decoded_state_record(record, thread)
        if state is None:
            return False
        # Retro-tag legacy threads that lived under a per-agent folder without
        # explicit metadata.agent. The folder name is the authoritative owner.
        if implied_agent and isinstance(thread.get("metadata"), dict):
            metadata = thread["metadata"]
            if not metadata.get("agent"):
                metadata["agent"] = implied_agent
        if implied_team_id and isinstance(thread.get("metadata"), dict):
            metadata = thread["metadata"]
            if not metadata.get("team_id"):
                metadata["team_id"] = implied_team_id
            if not metadata.get("mode"):
                metadata["mode"] = "team"
        self._threads[thread_id] = thread
        self._remember_state_locked(thread_id, state)
        return True

    def _load_from_per_agent_tree(self) -> None:
        """Scan team, agent, and misc session trees and load every thread."""
        assert self._per_agent_base is not None
        misc_dir = self._per_agent_base / "data" / "sessions" / "misc"
        if misc_dir.exists():
            for jsonl in self._canonical_session_files(misc_dir):
                self._load_from(jsonl)
        agents_root = self._per_agent_base / "agents"
        if agents_root.exists():
            for agent_dir in agents_root.iterdir():
                if not agent_dir.is_dir():
                    continue
                sess = agent_dir / "sessions"
                if not sess.exists():
                    continue
                implied = agent_dir.name
                for jsonl in self._canonical_session_files(sess):
                    self._load_from(jsonl, implied_agent=implied)
        teams_root = self._per_agent_base / "teams"
        if teams_root.exists():
            for team_dir in teams_root.iterdir():
                if not team_dir.is_dir():
                    continue
                sess = team_dir / "sessions"
                if not sess.exists():
                    continue
                implied_team_id = team_dir.name
                for jsonl in self._canonical_session_files(sess):
                    self._load_from(jsonl, implied_team_id=implied_team_id)

    @staticmethod
    def _latest_thread_from_file(path: Path) -> dict[str, Any] | None:
        for record in iter_jsonl_records_reverse(path):
            thread = record.get("thread") if isinstance(record, dict) else None
            if isinstance(thread, dict):
                return thread
        return None

    def _canonical_session_files(self, sess_root: Path) -> list[Path]:
        """Return one canonical jsonl per thread under a session root.

        Mirrors ``_resolve_thread_file`` for boot-time recovery: an existing
        flat file wins for flat→dated upgrades; otherwise the latest dated path
        wins. This keeps stale month shards from overwriting newer state during
        startup replay.
        """
        chosen: dict[str, Path] = {}
        for jsonl in sorted(sess_root.rglob("*.jsonl")):
            thread_id = jsonl.stem
            current = chosen.get(thread_id)
            if current is None:
                chosen[thread_id] = jsonl
                continue
            current_is_flat = current.parent == sess_root
            candidate_is_flat = jsonl.parent == sess_root
            if current_is_flat:
                continue
            if candidate_is_flat or jsonl > current:
                chosen[thread_id] = jsonl
        return sorted(chosen.values())
