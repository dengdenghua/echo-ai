"""Exceptions, delete leases, and scope helpers shared by :mod:`group_store`.

Extracted from ``group_store`` to keep the store class under the god-file
threshold; every name is re-exported from the original module so external
import points keep working unchanged.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path


class GroupRoomLinkConflict(RuntimeError):
    """A collaboration thread already reserved a different Team Room."""

    def __init__(self, thread_id: str, current_room_id: str, requested_room_id: str) -> None:
        self.thread_id = thread_id
        self.current_room_id = current_room_id
        self.requested_room_id = requested_room_id
        super().__init__(
            f"collaboration thread {thread_id!r} is already linked to room {current_room_id!r}"
        )


class GroupRoomLinkMigrationRequiredError(RuntimeError):
    """Legacy event rows claim one room for multiple collaboration threads."""

    def __init__(self, duplicates: dict[str, tuple[str, ...]]) -> None:
        self.duplicates = duplicates
        super().__init__("legacy room links require an explicit migration")


class GroupRoomLinkedError(RuntimeError):
    """A Team Room delete lost to a canonical collaboration reservation."""

    def __init__(self, room_id: str, thread_id: str) -> None:
        self.room_id = room_id
        self.thread_id = thread_id
        super().__init__(f"room is linked to collaboration thread: {room_id} -> {thread_id}")


class GroupRoomDeletingError(RuntimeError):
    """A collaboration link attempted to reuse a deleting/deleted room."""

    def __init__(self, room_id: str) -> None:
        self.room_id = room_id
        super().__init__(f"room delete in progress: {room_id}")


class GroupThreadLinkedError(RuntimeError):
    """A thread still owns canonical group state and cannot be deleted."""

    def __init__(self, thread_id: str, room_id: str | None = None) -> None:
        self.thread_id = thread_id
        self.room_id = room_id
        super().__init__(f"thread still owns collaboration group state: {thread_id}")


class GroupThreadDeletingError(RuntimeError):
    """A normal group writer targeted a deleting/deleted thread."""

    def __init__(self, thread_id: str) -> None:
        self.thread_id = thread_id
        super().__init__(f"group thread delete in progress: {thread_id}")


class GroupThreadActiveWorkError(RuntimeError):
    """A thread has pending or executing async work and cannot be deleted."""

    def __init__(self, thread_id: str) -> None:
        self.thread_id = thread_id
        super().__init__(f"group thread has active async work: {thread_id}")


@dataclass(slots=True, frozen=True)
class GroupRoomDeleteLease:
    room_id: str
    token: str
    resumed: bool
    finalized: bool
    tenant_id: str = ""
    owner_id: str = ""


@dataclass(slots=True, frozen=True)
class GroupThreadDeleteLease:
    thread_id: str
    token: str
    resumed: bool
    finalized: bool
    tenant_id: str = ""
    owner_id: str = ""


def _room_delete_scope_allowed(
    stored_tenant_id: object,
    stored_owner_id: object,
    *,
    tenant_id: str,
    owner_id: str,
) -> bool:
    if not tenant_id and not owner_id:
        return True
    return (
        str(stored_tenant_id or "").strip() == tenant_id
        and str(stored_owner_id or "").strip() == owner_id
    )


def _thread_delete_scope_allowed(
    stored_tenant_id: object,
    stored_owner_id: object,
    *,
    tenant_id: str,
    owner_id: str,
) -> bool:
    return _room_delete_scope_allowed(
        stored_tenant_id,
        stored_owner_id,
        tenant_id=tenant_id,
        owner_id=owner_id,
    )


def _thread_delete_exists(conn: sqlite3.Connection, thread_id: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM group_thread_delete_claims WHERE thread_id=? "
            "UNION ALL SELECT 1 FROM group_thread_delete_tombstones "
            "WHERE thread_id=? LIMIT 1",
            (thread_id, thread_id),
        ).fetchone()
        is not None
    )


def _default_dir() -> Path:
    from runtime.platform.process.paths import app_paths

    return app_paths().data_dir / "cowork"
