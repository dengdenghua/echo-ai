"""One-time tokens that bind a remote approval reply to one specific request.

A reply arriving over email or IM cannot be trusted on its face: senders are
forgeable and anyone who can post into the notified room can answer. A sender
allowlist narrows who may reply; it does not establish *what* they replied to.
Without that binding, one captured "approve" could be replayed against a later,
different tool call.

So every remote approval question carries a freshly minted token, and a reply is
only honoured when it presents that token. Properties, and why each one matters:

* **Bound to one request.** The token records the thread, tool and
  ``tool_call_id`` it was issued for. A token minted for an MCP query cannot
  approve a different call, even within the same turn.
* **Single use.** Consumption is atomic under the store lock, so a captured
  token cannot be replayed — the second attempt finds it spent.
* **Short-lived.** An unanswered question expires rather than leaving a valid
  approval credential lying in a mailbox indefinitely.
* **Stored hashed.** Only the SHA-256 of the token is persisted, following
  ``team_invitation_store``: a leaked database does not yield usable approvals.
* **Decision recorded at consumption.** ``approve`` and ``deny`` are distinct
  replies against the same token, so a denial is as attributable as an approval.

Fail-closed throughout: an unknown, expired, spent, or mismatched token yields
no decision, and no decision means the caller denies.

This module does not deliver notifications and does not decide who may be asked
— see ``remote_eligibility`` for the latter. It only answers "is this reply
genuinely a response to this question, and has it been used already".
"""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

# Long enough that guessing is hopeless; matches the invitation store.
_TOKEN_BYTES = 32

# An approval question is answered in minutes or not at all. A day-long window
# would leave a live approval credential sitting in a mailbox.
DEFAULT_TTL_SECONDS = 30 * 60
_MAX_TTL_SECONDS = 24 * 60 * 60

_SCHEMA = """
CREATE TABLE IF NOT EXISTS remote_approval_tokens (
    token_hash TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_call_id TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    decision TEXT,
    replied_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_remote_approval_call
    ON remote_approval_tokens(thread_id, tool_call_id);
"""


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True, slots=True)
class RemoteApprovalReply:
    """A verified reply: which request it answers and what it decided."""

    thread_id: str
    tool_name: str
    tool_call_id: str
    approved: bool
    replied_by: str


class RemoteApprovalTokenStore:
    """Mints and redeems one-time approval tokens.

    Thread-safe: ``ApprovalProvider`` implementations may be invoked from any
    worker thread, and consumption must stay atomic across them.
    """

    def __init__(
        self,
        db_path: Path | str,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._db = Path(db_path)
        self._db.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._clock = clock or _utc_now
        with self._lock, self._connect() as conn:
            conn.executescript(_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db), isolation_level=None)
        conn.row_factory = sqlite3.Row
        return conn

    def issue(
        self,
        *,
        thread_id: str,
        tool_name: str,
        tool_call_id: str,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
    ) -> str:
        """Mint a token for one request and return it once, in plaintext.

        Only its hash is stored, so the returned value is the only copy — the
        caller puts it in the notification and keeps nothing.
        """

        thread = str(thread_id or "").strip()
        tool = str(tool_name or "").strip()
        call_id = str(tool_call_id or "").strip()
        if not thread or not tool or not call_id:
            # An unbound token would approve anything; refuse to mint one.
            raise ValueError("a remote approval token must name its thread, tool and call")
        ttl = int(ttl_seconds)
        if not 1 <= ttl <= _MAX_TTL_SECONDS:
            raise ValueError(f"ttl_seconds must be between 1 and {_MAX_TTL_SECONDS}")

        token = secrets.token_urlsafe(_TOKEN_BYTES)
        now = self._clock()
        with self._lock, self._connect() as conn:
            conn.execute(
                "INSERT INTO remote_approval_tokens("
                "token_hash, thread_id, tool_name, tool_call_id, issued_at, expires_at"
                ") VALUES (?, ?, ?, ?, ?, ?)",
                (
                    _hash_token(token),
                    thread,
                    tool,
                    call_id,
                    now.isoformat(),
                    (now + timedelta(seconds=ttl)).isoformat(),
                ),
            )
        return token

    def consume(
        self,
        token: str,
        *,
        approved: bool,
        replied_by: str = "",
        expected_tool_call_id: str = "",
    ) -> RemoteApprovalReply | None:
        """Redeem ``token`` once, or return ``None`` if it cannot be redeemed.

        ``None`` covers every rejection — unknown, expired, already spent, or
        bound to a different call than ``expected_tool_call_id``. Callers must
        treat it as "no decision obtained", which degrades to denial.

        The UPDATE carries the single-use guarantee: it only matches a row whose
        ``consumed_at`` is still NULL, so two concurrent redemptions of the same
        token cannot both succeed regardless of lock granularity.
        """

        presented = str(token or "").strip()
        if not presented:
            return None
        token_hash = _hash_token(presented)
        now = self._clock()
        expected_call = str(expected_tool_call_id or "").strip()

        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT thread_id, tool_name, tool_call_id, expires_at, consumed_at "
                "FROM remote_approval_tokens WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()
            if row is None:
                return None
            if row["consumed_at"]:
                # Replay of a token that already answered its question.
                return None
            if datetime.fromisoformat(str(row["expires_at"])) <= now:
                return None
            if expected_call and str(row["tool_call_id"]) != expected_call:
                # A token captured from one question replayed against another.
                return None
            updated = conn.execute(
                "UPDATE remote_approval_tokens "
                "SET consumed_at = ?, decision = ?, replied_by = ? "
                "WHERE token_hash = ? AND consumed_at IS NULL",
                (
                    now.isoformat(),
                    "approved" if approved else "denied",
                    str(replied_by or ""),
                    token_hash,
                ),
            )
            if updated.rowcount != 1:
                # Lost the race to a concurrent redemption.
                return None
            return RemoteApprovalReply(
                thread_id=str(row["thread_id"]),
                tool_name=str(row["tool_name"]),
                tool_call_id=str(row["tool_call_id"]),
                approved=bool(approved),
                replied_by=str(replied_by or ""),
            )

    def revoke_for_call(self, *, thread_id: str, tool_call_id: str) -> int:
        """Spend any outstanding tokens for a call that was decided elsewhere.

        When the UI answers after a notification went out, the emailed token
        must stop working — otherwise a stale reply could contradict a decision
        the user already made in the app.
        """

        now = self._clock()
        with self._lock, self._connect() as conn:
            result = conn.execute(
                "UPDATE remote_approval_tokens "
                "SET consumed_at = ?, decision = 'revoked' "
                "WHERE thread_id = ? AND tool_call_id = ? AND consumed_at IS NULL",
                (now.isoformat(), str(thread_id or ""), str(tool_call_id or "")),
            )
        return int(result.rowcount or 0)
