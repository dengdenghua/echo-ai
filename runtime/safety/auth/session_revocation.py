"""Revoked session fingerprints; no raw bearer credentials are persisted."""

from __future__ import annotations

import hashlib
import logging
import sqlite3
import threading
from contextlib import closing
from pathlib import Path


class SessionRevocations:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path
        self._revoked: set[str] = set()
        self._lock = threading.Lock()

    @staticmethod
    def fingerprint(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def contains(self, token: str) -> bool:
        fingerprint = self.fingerprint(token)
        if self.path is None:
            with self._lock:
                return fingerprint in self._revoked
        if not self.path.exists():
            return False
        try:
            with closing(sqlite3.connect(self.path, timeout=10)) as conn:
                return (
                    conn.execute(
                        "SELECT 1 FROM revoked_sessions WHERE fingerprint=?", (fingerprint,)
                    ).fetchone()
                    is not None
                )
        except sqlite3.Error:
            logging.getLogger(__name__).error("session revocation store unavailable; refusing JWT")
            return True

    def add(self, token: str) -> None:
        fingerprint = self.fingerprint(token)
        if self.path is None:
            with self._lock:
                self._revoked.add(fingerprint)
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=10)) as conn, conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS revoked_sessions (fingerprint TEXT PRIMARY KEY)"
            )
            conn.execute("INSERT OR IGNORE INTO revoked_sessions VALUES (?)", (fingerprint,))


def revoke_request_session(request, identity_store, *, secret, issuer=None, audience=None) -> None:
    """Revoke a verified presented session, including legacy tokens without jti."""
    from runtime.safety.auth.principal import _request_token

    token = _request_token(request)
    if identity_store is None or not secret or not token or token.count(".") != 2:
        return
    try:
        identity_store.revoke_jwt(
            token, secret=secret, required_issuer=issuer, required_audience=audience
        )
    except (OSError, sqlite3.Error) as exc:
        from fastapi import HTTPException

        raise HTTPException(503, "session revocation unavailable; retry logout") from exc
