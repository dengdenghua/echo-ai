"""Thread store state updates: merge, compare-and-update and Project OS binding."""

from __future__ import annotations

from typing import Any

from ._state_mutation_lock import remove_stale_thread_copies, thread_mutation_lock
from ._store_records import (
    _PROJECT_BINDING_METADATA_KEYS,
    _PROJECT_BINDING_VALUE_KEYS,
    _deepcopy,
    _default_values,
    _utc_now_iso,
    _without_project_binding_fields,
)


class ThreadStateUpdateMixin:
    """Mutations of an existing thread's values, metadata and status."""

    def update_state(
        self,
        thread_id: str,
        *,
        values: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            self._assert_thread_writable_locked(thread_id)
            persisted = self._latest_persisted_locked(thread_id)
            current = persisted.thread if persisted.found else self._threads.get(thread_id)
            if current is None:
                raise KeyError(thread_id)
            thread = _deepcopy(current)
            merged_values = _default_values(thread.get("values"))
            if values:
                for key, value in _without_project_binding_fields(
                    values,
                    _PROJECT_BINDING_VALUE_KEYS,
                ).items():
                    merged_values[key] = _deepcopy(value)
            merged_metadata = _deepcopy(thread.get("metadata", {}))
            if metadata:
                merged_metadata.update(
                    _without_project_binding_fields(
                        metadata,
                        _PROJECT_BINDING_METADATA_KEYS,
                    )
                )
            # Persona is a thread-creation property, not mutable turn state.
            # Keeping it stable also keeps the append-only session in one
            # ``agents/<owner>/sessions`` shard. Role switching must create a
            # new thread instead of moving an existing conversation.
            owner_agent_id = self._agent_id_for(thread)
            if owner_agent_id:
                merged_metadata["agent"] = owner_agent_id
                for key in ("agent_name", "agent_id", "assistant_id"):
                    if key in merged_metadata:
                        merged_metadata[key] = owner_agent_id
            thread["values"] = merged_values
            thread["metadata"] = merged_metadata
            thread["updated_at"] = _utc_now_iso()
            if status is not None:
                thread["status"] = status
            state = self._make_state(thread)
            self._threads[thread_id] = thread
            self._remember_state_locked(thread_id, state)
            target = self._append_upsert(thread, state, revision=persisted.revision + 1)
            remove_stale_thread_copies(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
                keep_path=target,
            )
            return _deepcopy(state)

    def update_state_if_unchanged(
        self,
        thread_id: str,
        expected: dict[str, Any],
        *,
        values: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        status: str | None = None,
    ) -> dict[str, Any] | None:
        """Atomically update a thread only while it matches ``expected``.

        Managed-workspace deletion uses this transition to persist its
        retryable tombstone before moving any directory.  A concurrent owner,
        scope or state change therefore aborts deletion instead of applying a
        stale filesystem decision.
        """
        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            self._assert_thread_writable_locked(thread_id)
            persisted = self._latest_persisted_locked(thread_id)
            current = persisted.thread if persisted.found else self._threads.get(thread_id)
            if current is None or current != expected:
                return None
            thread = _deepcopy(current)
            merged_values = _default_values(thread.get("values"))
            if values:
                for key, value in _without_project_binding_fields(
                    values,
                    _PROJECT_BINDING_VALUE_KEYS,
                ).items():
                    merged_values[key] = _deepcopy(value)
            merged_metadata = _deepcopy(thread.get("metadata", {}))
            if metadata:
                merged_metadata.update(
                    _without_project_binding_fields(
                        metadata,
                        _PROJECT_BINDING_METADATA_KEYS,
                    )
                )
            owner_agent_id = self._agent_id_for(thread)
            if owner_agent_id:
                merged_metadata["agent"] = owner_agent_id
                for key in ("agent_name", "agent_id", "assistant_id"):
                    if key in merged_metadata:
                        merged_metadata[key] = owner_agent_id
            thread["values"] = merged_values
            thread["metadata"] = merged_metadata
            thread["updated_at"] = _utc_now_iso()
            if status is not None:
                thread["status"] = status
            state = self._make_state(thread)
            self._threads[thread_id] = thread
            self._remember_state_locked(thread_id, state)
            target = self._append_upsert(thread, state, revision=persisted.revision + 1)
            remove_stale_thread_copies(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
                keep_path=target,
            )
            return _deepcopy(thread)

    def set_project_binding_metadata(
        self,
        thread_id: str,
        project_id: str | None,
        *,
        expected_project_id: str | None = None,
        generation: int | None = None,
    ) -> dict[str, Any]:
        """Project the optional Project OS binding into thread metadata.

        This dedicated transition can *remove* keys, unlike ``update_state``'s
        merge semantics.  Conversation values and history are otherwise left
        untouched.  The compare guard prevents a stale detach from clearing a
        newer project binding.
        """

        desired = str(project_id or "").strip()
        expected = str(expected_project_id or "").strip()
        with (
            self._lock,
            thread_mutation_lock(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
            ),
        ):
            self._assert_thread_writable_locked(thread_id)
            persisted = self._latest_persisted_locked(thread_id)
            current = persisted.thread if persisted.found else self._threads.get(thread_id)
            if current is None:
                raise KeyError(thread_id)
            thread = _deepcopy(current)
            metadata = _deepcopy(thread.get("metadata") or {})
            values = _default_values(thread.get("values"))
            metadata_id = str(metadata.get("project_id") or "").strip()
            values_id = str(values.get("project_id") or "").strip()
            if metadata_id and values_id and metadata_id != values_id:
                raise RuntimeError("thread project metadata is inconsistent")
            current_id = metadata_id or values_id
            raw_generation = metadata.get("project_binding_generation")
            has_generation = isinstance(raw_generation, int)
            current_generation = max(0, raw_generation) if isinstance(raw_generation, int) else 0
            if generation is not None and (not isinstance(generation, int) or generation < 0):
                raise ValueError("project binding generation must be non-negative")
            incoming_generation = current_generation if generation is None else generation
            if incoming_generation < current_generation:
                raise RuntimeError("stale thread project binding generation")
            if incoming_generation == current_generation and has_generation:
                if desired != current_id:
                    raise RuntimeError("thread project binding generation conflict")
                return _deepcopy(thread)
            if generation is None:
                if expected and current_id and current_id != expected:
                    raise RuntimeError("thread project metadata changed")
                if desired and current_id and current_id != desired:
                    raise RuntimeError("thread is already projected to another project")

            if desired:
                metadata["project_id"] = desired
                metadata["project_home"] = True
                values["project_id"] = desired
                values["project_home"] = True
            else:
                metadata.pop("project_id", None)
                metadata.pop("project_home", None)
                values.pop("project_id", None)
                values.pop("project_home", None)
            if generation is not None:
                metadata["project_binding_generation"] = incoming_generation

            thread["metadata"] = metadata
            thread["values"] = values
            thread["updated_at"] = _utc_now_iso()
            state = self._make_state(thread)
            self._threads[thread_id] = thread
            self._remember_state_locked(thread_id, state)
            target = self._append_upsert(thread, state, revision=persisted.revision + 1)
            remove_stale_thread_copies(
                journal_path=self._path,
                per_agent_base=self._per_agent_base,
                thread_id=thread_id,
                keep_path=target,
            )
            return _deepcopy(thread)
