"""Personal conversation-list preferences, separate from shared thread state."""

from __future__ import annotations

import sqlite3
import threading
from contextlib import closing
from pathlib import Path


class ThreadListVisibility:
    def __init__(self, base: Path | None = None) -> None:
        self._path = base / "thread-list-visibility.db" if base else None
        self._memory: set[tuple[str, str, str]] = set()
        self._lock = threading.RLock()

    def hidden_ids(self, tenant: str, actor: str) -> set[str]:
        with self._lock:
            if self._path is None:
                return {tid for t, a, tid in self._memory if (t, a) == (tenant, actor)}
            if not self._path.exists():
                return set()
            with closing(self._connect()) as conn:
                return {row[0] for row in conn.execute(
                    "SELECT thread_id FROM hidden_threads WHERE tenant=? AND actor=?",
                    (tenant, actor),
                )}

    def set_hidden(self, tenant: str, actor: str, thread_id: str, hidden: bool) -> None:
        with self._lock:
            key = (tenant, actor, thread_id)
            if self._path is None:
                if hidden:
                    self._memory.add(key)
                else:
                    self._memory.discard(key)
                return
            self._path.parent.mkdir(parents=True, exist_ok=True)
            with closing(self._connect()) as conn, conn:
                if hidden:
                    conn.execute("INSERT OR IGNORE INTO hidden_threads VALUES (?, ?, ?)", key)
                else:
                    conn.execute(
                        "DELETE FROM hidden_threads WHERE tenant=? AND actor=? AND thread_id=?", key
                    )

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path), timeout=10)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS hidden_threads ("
            "tenant TEXT NOT NULL, actor TEXT NOT NULL, thread_id TEXT NOT NULL, "
            "PRIMARY KEY (tenant, actor, thread_id))"
        )
        return conn
