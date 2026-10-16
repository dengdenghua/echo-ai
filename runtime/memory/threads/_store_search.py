"""Thread store Echo Native session search, Markdown export and message feedback."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ._state_mutation_lock import thread_mutation_lock
from .feedback import FeedbackType, MessageFeedback
from .session_export import export_thread_to_markdown
from .session_search import SearchResult


class ThreadSearchFeedbackMixin:
    """Full-text search index upkeep, export and evaluation feedback."""

    # ─── Echo Native session search and export ───────────

    def _update_search_index(self, thread: dict[str, Any]) -> None:
        """Update the FTS5 search index for a thread."""
        if self._search is None:
            return

        thread_id = thread.get("thread_id")
        if not isinstance(thread_id, str):
            return

        values = thread.get("values", {})
        title = values.get("title", "Untitled")
        messages = values.get("messages", [])

        agent_id = self._agent_id_for(thread)
        team_id = self._team_id_for(thread)
        created_at = thread.get("created_at")
        updated_at = thread.get("updated_at")

        self._search.index_thread(
            thread_id=thread_id,
            title=str(title),
            messages=messages,
            agent_id=agent_id,
            team_id=team_id,
            created_at=created_at,
            updated_at=updated_at,
        )

    @property
    def search_enabled(self) -> bool:
        """Whether the Echo full-text session-search index is active.

        The router uses this to return 501 instead of silently empty results
        when the operator disabled search.
        """
        return self._search is not None

    @property
    def feedback_enabled(self) -> bool:
        """Whether the Echo message-feedback store is active."""
        return self._feedback is not None

    def search_threads(
        self,
        query: str,
        *,
        agent_id: str | None = None,
        team_id: str | None = None,
        after: str | None = None,
        before: str | None = None,
        limit: int = 50,
    ) -> list[SearchResult]:
        """Search Echo threads by content.

        Args:
            query: Search query (supports FTS5 syntax)
            agent_id: Filter by agent
            team_id: Filter by team
            after: ISO date, threads updated after this
            before: ISO date, threads updated before this
            limit: Max results (default 50)

        Returns:
            List of SearchResult, ordered by relevance
        """
        if self._search is None:
            return []

        results = self._search.search(
            query,
            agent_id=agent_id,
            team_id=team_id,
            after=after,
            before=before,
            limit=limit,
        )
        with self._lock:
            return [
                result
                for result in results
                if self._thread_delete_record_locked(result.thread_id) is None
            ]

    def export_thread_markdown(self, thread_id: str) -> str | None:
        """Export an Echo thread to Markdown.

        Args:
            thread_id: Thread identifier

        Returns:
            Markdown string with YAML frontmatter, or None if thread not found
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
            thread = self._threads.get(thread_id)
            if thread is None:
                return None

            values = thread.get("values", {})
            title = values.get("title", "Untitled")
            messages = values.get("messages", [])

            agent_id = self._agent_id_for(thread)
            team_id = self._team_id_for(thread)
            created_at = thread.get("created_at")
            updated_at = thread.get("updated_at")

            return export_thread_to_markdown(
                thread_id=thread_id,
                title=str(title),
                messages=messages,
                agent_id=agent_id,
                team_id=team_id,
                created_at=created_at,
                updated_at=updated_at,
            )

    def delete_thread(self, thread_id: str) -> None:
        """Delete a thread and clean up its session-search index rows.

        Removes from in-memory cache, session index, and search index.
        The on-disk JSONL file is left intact for audit/recovery.
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
            if thread_id in self._threads:
                del self._threads[thread_id]
            if thread_id in self._history:
                del self._history[thread_id]

            if self._index is not None:
                self._index.delete(thread_id)

            if self._search is not None:
                self._search.delete_thread(thread_id)

    # ─── Echo Native message feedback ──────────────

    def add_message_feedback(
        self,
        thread_id: str,
        message_index: int,
        feedback_type: FeedbackType,
        *,
        tags: list[str] | None = None,
        comment: str = "",
        user_id: str | None = None,
    ) -> MessageFeedback | None:
        """Add Echo evaluation feedback for a message.

        Args:
            thread_id: Thread identifier
            message_index: Zero-based index of the message
            feedback_type: "thumbs_up" or "thumbs_down"
            tags: Optional list of tags (e.g., ["helpful"], ["inaccurate", "too_verbose"])
            comment: Optional free-form comment
            user_id: Optional user identifier

        Returns:
            The recorded MessageFeedback, or None if feedback is disabled
        """
        if self._feedback is None:
            return None

        return self._feedback.add_feedback(
            thread_id=thread_id,
            message_index=message_index,
            feedback_type=feedback_type,
            tags=tags,
            comment=comment,
            user_id=user_id,
        )

    def get_message_feedback(
        self, thread_id: str, message_index: int | None = None
    ) -> list[MessageFeedback]:
        """Get feedback for an Echo thread or specific message.

        Args:
            thread_id: Thread identifier
            message_index: Optional message index to filter by

        Returns:
            List of MessageFeedback, in chronological order
        """
        if self._feedback is None:
            return []

        if message_index is not None:
            return self._feedback.get_message_feedback(thread_id, message_index)

        return self._feedback.get_feedback(thread_id)

    def get_feedback_stats(self, thread_id: str) -> dict[str, Any]:
        """Get feedback statistics for an Echo thread.

        Returns:
            Dictionary with counts:
            - total: Total feedback count
            - thumbs_up: Positive feedback count
            - thumbs_down: Negative feedback count
            - tags: Dict of tag -> count
            - messages_with_feedback: List of message indices with any feedback
        """
        if self._feedback is None:
            return {
                "total": 0,
                "thumbs_up": 0,
                "thumbs_down": 0,
                "tags": {},
                "messages_with_feedback": [],
            }

        return self._feedback.get_stats(thread_id)

    def export_rlhf_dataset(
        self,
        output_path: str | Path,
        *,
        min_feedback_count: int = 1,
        feedback_type_filter: FeedbackType | None = None,
    ) -> int:
        """Export all feedback as an evaluation/training dataset.

        Args:
            output_path: Path to write JSONL dataset
            min_feedback_count: Only include threads with at least this many feedbacks
            feedback_type_filter: Only include specific feedback type (optional)

        Returns:
            Number of feedback entries exported
        """
        if self._feedback is None:
            return 0

        return self._feedback.export_rlhf_dataset(
            output_path,
            min_feedback_count=min_feedback_count,
            feedback_type_filter=feedback_type_filter,
        )
