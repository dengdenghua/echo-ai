"""Persist one daily attention notice per project without driving execution."""

from __future__ import annotations

import logging
import sqlite3
from dataclasses import asdict
from datetime import datetime
from uuid import NAMESPACE_URL, uuid5

from runtime.projectos.daily_patrol import PatrolDigest, run_patrol
from runtime.projectos.store import ProjectStore

PATROL_ATTENTION_KIND = "project.daily_patrol_attention"
_LOG = logging.getLogger(__name__)


def patrol_event_id(project_id: str, day: str) -> str:
    return f"PATROL-{uuid5(NAMESPACE_URL, f'echo-project-patrol:{project_id}:{day}').hex}"


def record_daily_patrol(store: ProjectStore, *, now: datetime | None = None) -> PatrolDigest:
    now = now or datetime.now().astimezone()
    digest = run_patrol(store, now=now)
    day = now.date().isoformat()
    for item in digest.attention:
        try:
            store.append_event(
                item.project_id,
                kind=PATROL_ATTENTION_KIND,
                event_id=patrol_event_id(item.project_id, day),
                created_at=now.timestamp(),
                payload={
                    **asdict(item),
                    "day": day,
                    "reason": "；".join(item.reasons),
                    "resumed": False,
                },
            )
        except sqlite3.IntegrityError as exc:
            # The sealed event insert is transactional. Competing workers and
            # repeated startup scans lose only this deterministic primary key.
            if exc.sqlite_errorcode != sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY:
                raise
        except (PermissionError, ValueError, OSError, sqlite3.OperationalError):
            # A deleted project or unavailable store must not stop other notices.
            _LOG.warning("daily patrol could not record project %s", item.project_id, exc_info=True)
    return digest


def current_patrol_notices(store: ProjectStore, *, now: datetime | None = None) -> list[dict]:
    """Return today's recorded notices only while the project still needs attention."""
    now = now or datetime.now().astimezone()
    day = now.date().isoformat()
    attention = run_patrol(store, now=now).attention
    notices = []
    for item in attention:
        event_id = patrol_event_id(item.project_id, day)
        with store._lock, store._conn() as conn:
            row = conn.execute(
                "SELECT id FROM project_events WHERE id=? AND project_id=? AND kind=?",
                (event_id, item.project_id, PATROL_ATTENTION_KIND),
            ).fetchone()
        if row is not None:
            notices.append({"id": row[0], "project_id": item.project_id, "name": item.name})
    return notices
