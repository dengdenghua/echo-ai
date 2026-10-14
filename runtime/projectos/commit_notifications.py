"""Non-blocking wake-ups after a project transaction has actually committed.

Callbacks enqueue invalidations only. They must not read the store or publish
over the network: callers can still hold the store's write lock at this point.
The consumer reads canonical state after that lock is released.
"""

from __future__ import annotations

import logging
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Any

from runtime.platform.io.sqlite import ClosingConnection, connect_closing

_LOG = logging.getLogger(__name__)


class ProjectCommitConnection(ClosingConnection):
    notify_change: Callable[[], None]
    _notified_changes: int = 0

    def _notify(self, changes: int) -> None:
        self._notified_changes = changes
        try:
            self.notify_change()
        except Exception:  # noqa: BLE001 -- notification failure cannot undo a committed write
            _LOG.warning("project wake-up unavailable; canonical state remains committed")

    def commit(self) -> None:
        changed = self.in_transaction and self.total_changes != self._notified_changes
        super().commit()
        if changed:
            self._notify(self.total_changes)

    def rollback(self) -> None:
        super().rollback()
        self._notified_changes = self.total_changes

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> bool:
        changed = self.in_transaction and self.total_changes != self._notified_changes
        changes = self.total_changes
        # sqlite3.__exit__ commits internally, without calling our commit().
        # ClosingConnection then closes even when the commit itself fails.
        result = super().__exit__(exc_type, exc, traceback)
        if exc_type is None and changed:
            self._notify(changes)
        return result


def connect_project_changes(
    database: str, notify_change: Callable[[], None]
) -> ProjectCommitConnection:
    connection = sqlite3.connect(database, timeout=10.0, factory=ProjectCommitConnection)
    connection.notify_change = notify_change
    return connection


class ProjectCommitObserverMixin:
    """Scoped store views share listeners; unobserved stores use the old factory."""

    _db: Path
    _lock: Any
    _commit_listeners: list[Callable[[], None]]

    def bind_commit_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        with self._lock:
            self._commit_listeners.append(listener)

        def unsubscribe() -> None:
            with self._lock:
                if listener in self._commit_listeners:
                    self._commit_listeners.remove(listener)

        return unsubscribe

    def _notify_committed_change(self) -> None:
        for listener in tuple(self._commit_listeners):
            try:
                listener()
            except Exception:  # noqa: BLE001 -- each best-effort listener is isolated after commit
                _LOG.warning("project wake-up unavailable; canonical state remains committed")

    def _conn(self) -> sqlite3.Connection:
        if not self._commit_listeners:
            return connect_closing(str(self._db), timeout=10.0)
        return connect_project_changes(str(self._db), self._notify_committed_change)
