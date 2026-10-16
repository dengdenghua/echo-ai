"""Result envelope of a ``call_subagent`` dispatch: artifact reconciliation and finish."""

from __future__ import annotations

import logging
import time
from typing import Any

from ._bridge_trace import (
    _attach_trace_fields,
    _publish_bus_lifecycle,
    _safe_emit,
    _safe_journal_emit,
)
from .artifact_handoff import ArtifactHandoffError

_log = logging.getLogger("runtime.execution.subagents")


class _SubagentResultMixin:
    """Turn a raw runner result into the caller-facing envelope (``_SubagentCall``)."""

    def _reconcile_handoff(self, result: dict[str, Any] | None = None) -> None:
        if self.handoff is None:
            return
        try:
            receipt = self.handoff.abort_unchanged()
        except (ArtifactHandoffError, OSError, ValueError, PermissionError) as exc:
            # Partial outputs remain owned by the child. A failed journal is
            # also fail-closed; neither case is permission to rerun the task.
            if result is not None:
                result["artifact_reconciliation_error"] = str(exc)
            else:
                _log.debug("artifact handoff retained for reconciliation: %s", exc)
        else:
            if result is not None and receipt is not None:
                result["artifact_handoff"] = receipt

    def _augment(self, result: dict[str, Any]) -> dict[str, Any]:
        """Attach context-isolation telemetry to the subagent result.

        Adds ``iteration_count`` (rounds the subagent ran), and
        ``files_touched`` (paths it wrote to). These give the caller
        a structured envelope without leaking the subagent's
        intermediate steps into the parent's message history.

        Also injects the spawn-time codename / avatar / role so a
        downstream caller (e.g. ``call_agent_parallel``) can include
        them in the synthesised reply. The frontend already received
        these via the ``subagent_spawned`` event, but having them on
        the return value makes synchronous testing + transcripts
        self-describing.
        """
        if not isinstance(result, dict):
            return result
        if self.handoff is not None:
            # Overwrite any model-provided manifest. Only completed, live
            # children with valid schemas can transfer ownership to the parent.
            result.pop("artifact_handoff", None)
            result.pop("artifacts", None)
            result.pop("artifact_reconciliation_error", None)
            result["retry_allowed"] = False
            if result.get("success") and not result.get("error"):
                try:
                    if self._child_source.is_cancelled or result.get("schema_ok") is False:
                        raise ArtifactHandoffError(
                            "child was cancelled or its result schema failed"
                        )
                    receipt = self.handoff.accept()
                    result["artifact_handoff"] = receipt
                    result["artifacts"] = receipt["artifacts"]
                    self._files_touched[:] = list(
                        dict.fromkeys(
                            [*self._files_touched, *[item["path"] for item in receipt["artifacts"]]]
                        )
                    )
                except (
                    ArtifactHandoffError,
                    OSError,
                    ValueError,
                    PermissionError,
                    TimeoutError,
                ) as exc:
                    result.update(success=False, status="artifact_handoff_failed", error=str(exc))
            if not self.handoff.accepted:
                self._reconcile_handoff(result)
        output = result.get("output")
        has_output = isinstance(output, str) and bool(output.strip())
        has_structured_output = result.get("parsed") is not None
        has_shared_output = bool(self._files_touched) or self._shared_output_state["written"]
        reported_success = bool(result.get("success", result.get("ok", True)))
        if (
            reported_success
            and not result.get("error")
            and not has_output
            and not has_structured_output
            and not has_shared_output
        ):
            # A successful runner return with no answer and no shared artifact
            # is not a usable sub-agent result. Mark it explicitly so the
            # parent can recover or re-dispatch instead of treating an empty
            # tile as completed work.
            result["success"] = False
            result["status"] = "empty_output"
            result["error"] = "subagent completed without usable output"
        _attach_trace_fields(result, self._trace_context)
        result.setdefault("iteration_count", self._rounds_state["max_round"])
        result.setdefault("files_touched", list(self._files_touched))
        result.setdefault("codename", self._codename)
        result.setdefault("avatar", self._avatar)
        result.setdefault("role", self._role_label)
        result.setdefault("requested_agent_id", self._requested_agent_id)
        result.setdefault("subagent_depth", self._child_depth)
        result.setdefault("subagent_root_id", self._subagent_root_id)
        try:
            from runtime.execution.subagents.governance import governance_store

            result.setdefault("governance", governance_store().snapshot(self._subagent_root_id))
        except Exception:  # noqa: BLE001 — result delivery survives telemetry failure
            pass
        # Lifecycle: finish. Mirrors the spawn event so the frontend
        # can mark the tile complete + show duration / iteration /
        # files-touched stats. ``ok`` is the canonical success flag;
        # we infer it from the result envelope when not explicit.
        elapsed = max(0.0, time.time() - self._spawn_started_at)
        ok = bool(result.get("success", result.get("ok", True))) and not result.get("error")
        # Structured log so operators can see subagent outcomes without
        # tailing a generic INFO firehose. Includes round_cap_exceeded
        # so the log surface differentiates "ran out of rounds" from
        # "tool failure" / "router error".
        _log.info(
            "subagent finish · agent_id=%s role=%s ok=%s rounds=%d files=%d duration=%.2fs%s%s",
            self.agent_id,
            self._role_label,
            ok,
            self._rounds_state["max_round"],
            len(self._files_touched),
            elapsed,
            " · ROUND_CAP_EXCEEDED" if result.get("round_cap_exceeded") else "",
            f" · error={result.get('error')!r}" if result.get("error") else "",
        )
        # Record this turn into the per-thread, per-role memory bucket so
        # the next call to the same role in this thread can reference it
        # ("researcher, dig deeper on that patent" sees what "researcher,
        # find Eight Sleep patents" produced). Only fires when a thread_id
        # is present; stateless callers stay stateless.
        if self._memory_thread_id:
            from runtime.execution.subagents.memory import record_turn

            record_turn(
                thread_id=self._memory_thread_id,
                role_id=self.agent_id,
                prompt=self._session_turn_prompt,
                output=result.get("output", ""),
                success=ok,
                rounds=self._rounds_state["max_round"],
                error=result.get("error", ""),
            )
        # Durable session: attach the session id to every augmented result
        # (so the caller can continue even after a rejection) and append the
        # turn for calls that actually ran.
        if self._active_session["session_id"]:
            result["session_id"] = self._active_session["session_id"]
            if result.get("status") != "rejected":
                from runtime.execution.subagents.sessions import (
                    get_subagent_session_store,
                )

                _session_store = get_subagent_session_store()
                if _session_store is not None:
                    updated_session = _session_store.append_turn(
                        self._active_session["session_id"],
                        prompt=self._session_turn_prompt,
                        output=result.get("output", ""),
                        success=ok,
                        rounds=self._rounds_state["max_round"],
                        error=result.get("error", ""),
                    )
                    if updated_session is not None:
                        result["session_compaction"] = _session_store.compaction_stats(
                            updated_session
                        )
                    # Journal the turn's completion (dsh session-log
                    # invariant): a resume path can report the session's
                    # effort/outcome without replaying every chunk. Best-
                    # effort — telemetry loss never breaks the bridge.
                    try:
                        from runtime.execution.suckers._ephemeral_events import (
                            _emit_sub_session_summary,
                        )

                        _emit_sub_session_summary(
                            self._active_session["session_id"],
                            agent_id=self.agent_id,
                            rounds=self._rounds_state["max_round"],
                            success=ok,
                            error=result.get("error", "") or "",
                        )
                    except Exception:  # noqa: BLE001
                        pass
                    # Child→parent report lane (dsh ``tool-subagent-report``):
                    # a continuable child's transcript is NOT automatically
                    # visible to the parent, so undelivered reports are
                    # attached to the result and acked once delivered.
                    _pending = _session_store.pending_reports(self._active_session["session_id"])
                    if _pending:
                        result["pending_reports"] = [
                            {
                                "index": index,
                                "content": report.content,
                                "delivery": report.delivery,
                            }
                            for index, report in _pending
                        ]
                        _report_session = _session_store.get(self._active_session["session_id"])
                        if _report_session is not None:
                            result["reports_prompt"] = _session_store.reports_prompt(
                                _report_session
                            )
                        _session_store.mark_reports_delivered(self._active_session["session_id"])
        try:
            from runtime.memory.learning.subagent_review import (
                queue_subagent_review_candidate,
            )

            result["review_candidate"] = queue_subagent_review_candidate(
                agent_id=self.agent_id,
                role=self._role_label,
                prompt=self.prompt,
                result=result,
                context=self.context,
                session=self.session,
            )
        except Exception as exc:  # noqa: BLE001
            _log.debug(
                "subagent review candidate queue skipped · agent_id=%s error=%s",
                self.agent_id,
                exc,
            )
        _finish_event = {
            "type": "subagent_finished",
            "agent_id": self.agent_id,
            "requested_agent_id": self._requested_agent_id,
            "parent_tool_use_id": self._parent_tool_use_id or None,
            "role": self._role_label,
            "codename": self._codename,
            "avatar": self._avatar,
            "avatar_url": self._market_avatar_url,
            "identity_source": self._identity_source,
            "ok": ok,
            "duration_s": round(elapsed, 2),
            "iteration_count": self._rounds_state["max_round"],
            "files_touched": list(self._files_touched),
            "error": result.get("error"),
            "status": result.get("status"),
            # Carry the sub-agent's actual answer text so the workbench can
            # render a readable final message instead of dumping the whole
            # result envelope as JSON.
            "output": result.get("output", ""),
        }
        _attach_trace_fields(_finish_event, self._trace_context)
        _safe_emit(self.event_emitter, _finish_event)
        _safe_journal_emit(_finish_event)
        _publish_bus_lifecycle("subagent_finished", _finish_event, self.session)
        try:
            from runtime.safety.hooks import dispatch_subagent_stop

            dispatch_subagent_stop(
                thread_id=self._memory_thread_id,
                agent_id=self.agent_id,
                subagent_type=self._role_label or self.agent_id,
                session_id=str(self._active_session.get("session_id") or ""),
                ok=bool(ok),
                duration_ms=round(float(elapsed) * 1000),
                output_preview=(
                    result.get("output", "")[:500] if isinstance(result.get("output"), str) else ""
                ),
            )
        except Exception:  # noqa: BLE001 — hooks are best-effort, never break the call
            pass
        return result
