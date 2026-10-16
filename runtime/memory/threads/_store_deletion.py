"""Thread store permanent-deletion fence: durable leases and tombstones."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from ._permanent_deletion import (
    ThreadPermanentDeleteLease,
    ThreadPermanentlyDeletedError,
    deletion_record_path,
    deletion_scope_allowed,
    read_deletion_record,
    write_deletion_record,
)
from ._state_mutation_lock import remove_stale_thread_copies, thread_mutation_lock
from ._store_records import _deepcopy, _utc_now_iso


class ThreadDeletionMixin:
    """Fence every normal reader and writer once a permanent delete begins."""

    def _thread_delete_record_locked(
        self,
        thread_id: str,
    ) -> ThreadPermanentDeleteLease | None:
        path = deletion_record_path(
            journal_path=self._path,
            per_agent_base=self._per_agent_base,
            thread_id=thread_id,
        )
        if path is None:
            return self._memory_thread_deletions.get(thread_id)
        record = read_deletion_record(path)
        if record is not None and record.thread_id != thread_id:
            raise RuntimeError("thread deletion record id mismatch")
        return record

    def _write_thread_delete_record_locked(self, lease: ThreadPermanentDeleteLease) -> None:
        path = deletion_record_path(
            journal_path=self._path,
            per_agent_base=self._per_agent_base,
            thread_id=lease.thread_id,
        )
        if path is None:
            self._memory_thread_deletions[lease.thread_id] = lease
            return
        write_deletion_record(path, lease)

    def _assert_thread_writable_locked(self, thread_id: str) -> None:
        if self._thread_delete_record_locked(thread_id) is not None:
            raise ThreadPermanentlyDeletedError(thread_id)

    def _prune_permanently_deleted_threads_locked(self) -> None:
        """Drop stale snapshots whose durable delete fence already exists."""

        for thread_id in tuple(self._threads):
            if self._thread_delete_record_locked(thread_id) is None:
                continue
            self._threads.pop(thread_id, None)
            self._history.pop(thread_id, None)

    def is_permanently_deleted(self, thread_id: str) -> bool:
        """Return whether normal readers and writers are permanently fenced."""

        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            return self._thread_delete_record_locked(thread_id) is not None

    def assert_not_permanently_deleted(self, thread_id: str) -> None:
        """Fail closed when a permanent delete is in progress or finalized."""

        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            self._assert_thread_writable_locked(thread_id)

    def thread_delete_lease(
        self,
        thread_id: str,
        *,
        tenant_id: str = "",
        owner_id: str = "",
    ) -> ThreadPermanentDeleteLease | None:
        """Read an authorized durable permanent-deletion claim or tombstone."""

        tenant_id = str(tenant_id or "").strip()
        owner_id = str(owner_id or "").strip()
        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            lease = self._thread_delete_record_locked(thread_id)
            if lease is not None and not deletion_scope_allowed(
                lease,
                tenant_id=tenant_id,
                owner_id=owner_id,
            ):
                raise PermissionError("thread deletion belongs to another principal")
            return lease

    def thread_for_permanent_delete(
        self,
        thread_id: str,
        token: str,
    ) -> dict[str, Any] | None:
        """Read the deletion snapshot through the exact durable lease token.

        This is the narrow retry path for filesystem cleanup after a process
        restart. Normal readers remain fenced as soon as deletion begins.
        """

        token = str(token or "").strip()
        if not token:
            raise ValueError("thread delete token is required")
        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            lease = self._thread_delete_record_locked(thread_id)
            if lease is None or lease.token != token:
                raise ThreadPermanentlyDeletedError(thread_id)
            if lease.finalized:
                return None
            persisted = self._latest_persisted_locked(thread_id)
            current = persisted.thread if persisted.found else self._threads.get(thread_id)
            return _deepcopy(current) if current is not None else None

    def begin_permanent_delete(
        self,
        thread_id: str,
        *,
        tenant_id: str = "",
        owner_id: str = "",
        expected: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        status: str = "deleting",
    ) -> ThreadPermanentDeleteLease:
        """Irreversibly fence every normal state writer for ``thread_id``."""

        tenant_id = str(tenant_id or "").strip()
        owner_id = str(owner_id or "").strip()
        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            existing = self._thread_delete_record_locked(thread_id)
            if existing is not None:
                if not deletion_scope_allowed(
                    existing,
                    tenant_id=tenant_id,
                    owner_id=owner_id,
                ):
                    raise PermissionError("thread deletion belongs to another principal")
                return existing
            persisted = self._latest_persisted_locked(thread_id)
            current = persisted.thread if persisted.found else self._threads.get(thread_id)
            if expected is not None and current != expected:
                raise RuntimeError("thread state changed before permanent deletion")
            if current is not None:
                thread = _deepcopy(current)
                merged_metadata = _deepcopy(thread.get("metadata") or {})
                if metadata:
                    merged_metadata.update(_deepcopy(metadata))
                thread["metadata"] = merged_metadata
                thread["status"] = status
                thread["updated_at"] = _utc_now_iso()
                state = self._make_state(thread)
                target = self._append_upsert(
                    thread,
                    state,
                    revision=persisted.revision + 1,
                )
                remove_stale_thread_copies(
                    journal_path=self._path,
                    per_agent_base=self._per_agent_base,
                    thread_id=thread_id,
                    keep_path=target,
                )
                self._threads[thread_id] = thread
                self._remember_state_locked(thread_id, state)
            lease = ThreadPermanentDeleteLease(
                thread_id=thread_id,
                token=f"TD-{uuid4().hex}",
                resumed=False,
                finalized=False,
                tenant_id=tenant_id,
                owner_id=owner_id,
            )
            self._write_thread_delete_record_locked(lease)
            return lease

    def finalize_permanent_delete(self, thread_id: str, token: str) -> bool:
        """Delete the snapshot and retain a permanent writer tombstone."""

        token = str(token or "").strip()
        if not token:
            raise ValueError("thread delete token is required")

        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            lease = self._thread_delete_record_locked(thread_id)
            if lease is None or lease.token != token:
                raise ThreadPermanentlyDeletedError(thread_id)
            return self._finalize_permanent_delete_locked(lease)

    def permanently_delete(self, thread_id: str, token: str) -> bool:
        """Permanently fence and delete a thread using an idempotency token.

        The fence is durable before any snapshot/index removal starts. A retry
        with the exact token completes or confirms the delete; a different
        token can never take over an existing deletion.
        """

        token = str(token or "").strip()
        if not token:
            raise ValueError("thread delete token is required")
        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            lease = self._thread_delete_record_locked(thread_id)
            if lease is None:
                lease = ThreadPermanentDeleteLease(
                    thread_id=thread_id,
                    token=token,
                    resumed=False,
                    finalized=False,
                )
                self._write_thread_delete_record_locked(lease)
            elif lease.token != token:
                raise ThreadPermanentlyDeletedError(thread_id)
            return self._finalize_permanent_delete_locked(lease)

    def _finalize_permanent_delete_locked(self, lease: ThreadPermanentDeleteLease) -> bool:
        if lease.finalized:
            return True
        thread_id = lease.thread_id
        persisted = self._latest_persisted_locked(thread_id)
        current = persisted.thread if persisted.found else self._threads.get(thread_id)
        target = self._append_delete(
            thread_id,
            _deepcopy(current) if current is not None else None,
            revision=persisted.revision + 1,
        )
        remove_stale_thread_copies(
            journal_path=self._path,
            per_agent_base=self._per_agent_base,
            thread_id=thread_id,
            keep_path=target,
        )
        self._threads.pop(thread_id, None)
        self._history.pop(thread_id, None)
        self._write_thread_delete_record_locked(
            ThreadPermanentDeleteLease(
                thread_id=thread_id,
                token=lease.token,
                resumed=True,
                finalized=True,
                tenant_id=lease.tenant_id,
                owner_id=lease.owner_id,
            )
        )
        return True
