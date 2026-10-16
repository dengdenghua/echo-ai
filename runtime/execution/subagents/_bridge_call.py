"""Per-call state of one ``call_subagent`` dispatch and the worker it runs.

``call_subagent`` used to keep this state in closure cells shared by nested
functions; ``_SubagentCall`` holds the same values as attributes with the
same names, and the former closures are its methods.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from ._bridge_context import _inherit_parent_work_context
from ._bridge_result import _SubagentResultMixin
from ._bridge_run import _SubagentRunMixin
from ._bridge_trace import _attach_trace_fields, _safe_emit
from .artifact_handoff import ArtifactHandoffError
from .execution_context import child_execution_scope
from .schema_output import coerce_schema_output, schema_correction

_log = logging.getLogger("runtime.execution.subagents")


def _bridge_dispatch(**kwargs: Any) -> dict[str, Any]:
    """Call ``bridge._dispatch`` as looked up at call time.

    The worker used to reach ``_dispatch`` as a bridge global; resolving it on
    the bridge module keeps replacements of ``bridge._dispatch`` effective.
    """
    from . import bridge

    return bridge._dispatch(**kwargs)


@dataclass(eq=False, kw_only=True)
class _SubagentCall(_SubagentRunMixin, _SubagentResultMixin):
    """Everything one sub-agent dispatch shares between its phases.

    ``run`` (``_SubagentRunMixin``) also sets ``_child_source``,
    ``_retry_disabled`` and ``scoped_cancellation`` before the worker starts.
    """

    agent_id: Any
    prompt: Any
    role: Any
    context: Any
    timeout_s: Any
    timeout_seconds: Any
    event_emitter: Any
    session: Any
    use_cheap_model: Any
    extra_denied_paths: Any
    isolate: Any
    output_schema: Any
    input_files: Any
    output_files: Any
    schema_max_retries: Any
    runner: Any
    handoff: Any
    isolated_workspace: Any
    _requested_agent_id: Any
    _parent_tool_use_id: Any
    _child_depth: Any
    _subagent_root_id: Any
    _trace_context: Any
    _locked_root: Any
    _role_label: Any
    _codename: Any
    _avatar: Any
    _role_display_name: Any
    _role_description: Any
    _market_avatar_url: Any
    _identity_source: Any
    _spawn_started_at: Any
    _memory_thread_id: Any
    _session_turn_prompt: Any
    _active_session: Any

    # Track the highest round number seen via the emitter so we can
    # report rounds_completed on timeout.
    _rounds_state: dict[str, int] = field(default_factory=lambda: {"max_round": 0})
    # Track files the subagent wrote/edited (echo optimisation
    # lane H). The emitter sees ``sub_tool_end`` events with
    # ``skill`` and ``args`` payloads; when the skill is in the
    # write-tools set and the call succeeded, we extract its path.
    _files_touched: list[str] = field(default_factory=list)
    _files_seen: set[str] = field(default_factory=set)
    # Some coordinator roles intentionally deliver through the shared
    # blackboard instead of a final text reply. Keep that as valid completion
    # evidence while rejecting read-only children that silently return empty.
    _shared_output_state: dict[str, bool] = field(default_factory=lambda: {"written": False})
    _subagent_write_tools: frozenset[str] = field(
        default_factory=lambda: frozenset(
            {
                "write_text_file",
                "append_text_file",
                "edit_text_file",
                "edit_file",
                "multi_edit_file",
                "propose_patch",
            }
        )
    )

    def _tracking_emitter(self, event: dict) -> None:
        # Once the parent turn redirects, the old execution generation is
        # closed. A cooperative child may still emit its final bookkeeping
        # event while unwinding; suppress it so no late progress can appear
        # inside the new trajectory.
        if self._child_source.is_cancelled:
            return
        rnd = event.get("round")
        if isinstance(rnd, int) and rnd > self._rounds_state["max_round"]:
            self._rounds_state["max_round"] = rnd
        # Annotate per-tool events with the sub-agent identity so the
        # frontend timeline can group them under the same tile as the
        # spawn event.
        try:
            _attach_trace_fields(event, self._trace_context)
            if event.get("type") in {"sub_tool_start", "sub_tool_end"}:
                event.setdefault("agent_id", self.agent_id)
                event.setdefault("requested_agent_id", self._requested_agent_id)
                event.setdefault("parent_tool_use_id", self._parent_tool_use_id or None)
                event.setdefault("subagent_codename", self._codename)
                event.setdefault("subagent_avatar", self._avatar)
        except Exception:  # noqa: BLE001 — annotation is best-effort
            pass
        # File-touch tracking: best-effort, never breaks the call.
        try:
            if event.get("type") == "sub_tool_end" and event.get("status") == "success":
                name = event.get("skill") or event.get("name") or ""
                if name == "bb_write":
                    self._shared_output_state["written"] = True
                if name in self._subagent_write_tools:
                    args = event.get("args") or {}
                    path = args.get("path") if isinstance(args, dict) else None
                    if isinstance(path, str) and path and path not in self._files_seen:
                        self._files_seen.add(path)
                        self._files_touched.append(path)
        except Exception:  # noqa: BLE001 — telemetry must never crash subagent
            pass
        _safe_emit(self.event_emitter, event)

    def _do_call(self) -> dict[str, Any]:
        # Always pass _tracking_emitter so round counting works even when
        # the caller didn't supply an external event_emitter. The tracking
        # wrapper is a no-op for the external emitter when it's None.
        # Install the linked child token as the ambient cancellation
        # token for this worker thread so subagent code below polling
        # ``current_cancellation_token()`` sees parent-driven cancels.
        # Also layer ``extra_denied_paths`` onto the ambient denylist
        # for the duration of the sub-agent run so a parent can
        # tighten what its researcher / critic / explorer sub-agent
        # is allowed to read (e.g. "don't touch .env this turn").
        denylist_token = None
        if self.extra_denied_paths:
            try:
                from runtime.safety.auth.path_denylist import (
                    pop_turn_denylist,
                    push_turn_denylist,
                )

                denylist_token = push_turn_denylist(self.extra_denied_paths)
            except ImportError:
                denylist_token = None
        run_session = self.session
        # Sub-agent threading identity: resolve the lineage + coordination
        # roots (``root_thread_id`` for the event bus, ``blackboard_root_turn_id``
        # for blackboard continuity) and stamp them on the run Session. The
        # child KEEPS the parent's thread_id by default so journal/trace stays
        # attributed to the main conversation; the independent-thread identity
        # (flip_thread_id) is the explicit opt-in for full sub-agent threading.
        _flip_thread = bool((self.context or {}).get("flip_subagent_thread", False))
        _extra_meta: dict[str, Any] = {}
        if self._locked_root:
            _extra_meta["_locked_write_root"] = self._locked_root
        elif self.session is not None:
            # A realtime child may flip to its own thread id.  The default
            # chat/artifact scope is derived from ``Session.thread_id``, so a
            # flipped child would otherwise resolve relative file tools into
            # a fresh, empty child workspace instead of the parent's visible
            # ``output/final`` folder.  Pin the parent's artifact root before
            # changing identity; project sessions still use their inherited
            # ``workspace_path`` as the primary read root.
            try:
                from runtime.platform.process.scope import thread_artifact_root

                _parent_meta = getattr(self.session, "metadata", None) or {}
                _parent_artifact_root = _parent_meta.get("_artifact_output_root")
                if not (isinstance(_parent_artifact_root, str) and _parent_artifact_root.strip()):
                    _parent_thread_id = str(
                        getattr(self.session, "thread_id", None)
                        or getattr(self.session, "conversation_id", None)
                        or ""
                    ).strip()
                    if _parent_thread_id:
                        _parent_artifact_root = str(thread_artifact_root(_parent_thread_id))
                if isinstance(_parent_artifact_root, str) and _parent_artifact_root.strip():
                    _extra_meta["_artifact_output_root"] = _parent_artifact_root.strip()
            except (ImportError, OSError, ValueError) as exc:
                _log.debug("could not preserve parent artifact root", exc_info=exc)
        # Stamp the per-child codename onto the run Session so the typed
        # event-bus helpers (which key lanes by codename) can attribute tool /
        # conclude / fail events to the right sub-agent thread — even when
        # several parallel children share the same role. Ambient per-call
        # identity, read from ``session.metadata`` inside the child run.
        if self._codename:
            _extra_meta["subagent_codename"] = self._codename
        _extra_meta["subagent_agent_id"] = self._requested_agent_id
        _extra_meta["subagent_resolved_agent_id"] = self.agent_id
        if self._parent_tool_use_id:
            _extra_meta["_active_parent_tool_use_id"] = self._parent_tool_use_id
        _extra_meta["subagent_role"] = self._role_label
        _extra_meta["subagent_avatar"] = self._avatar
        _extra_meta["_subagent_depth"] = self._child_depth
        _extra_meta["_subagent_root_id"] = self._subagent_root_id
        from runtime.platform.process.session import Session

        binding = None
        if self.session is not None and isinstance(self.session, Session):
            from runtime.execution.subagents.threading import (
                bind_subagent_session,
                forge_subagent_thread,
            )

            binding = forge_subagent_thread(
                self.session,
                agent_id=self.agent_id,
                role=self.role,
                persist=_flip_thread,
            )
            if self.isolated_workspace is not None:
                self.isolated_workspace.producer_task_id = binding.child_thread_id
            run_session = bind_subagent_session(
                self.session,
                binding,
                extra_metadata=_extra_meta or None,
                flip_thread_id=_flip_thread,
            )
        elif self._locked_root:
            # No ambient Session but a locked write root was requested:
            # carry it on a bare Session so the ephemeral chokepoint still
            # confines writes (original behaviour).
            run_session = Session(metadata=dict(_extra_meta))
        scope_token = None
        if run_session is not None:
            # Bind on THIS worker thread so blackboard skills see the parent's
            # turn and the ephemeral chokepoint carries any locked write root.
            from runtime.platform.process.session import _current_session

            scope_token = _current_session.set(run_session)
        try:
            if self.handoff is not None:
                try:
                    if self._child_source.is_cancelled:
                        raise ArtifactHandoffError("artifact child was cancelled before assignment")
                    if binding is None:
                        raise ArtifactHandoffError("artifact handoff requires a child identity")
                    self.handoff.begin(binding.child_thread_id)
                except (
                    ArtifactHandoffError,
                    OSError,
                    ValueError,
                    PermissionError,
                    TimeoutError,
                ) as exc:
                    return {
                        "agent_id": self.agent_id,
                        "output": "",
                        "success": False,
                        "status": "artifact_handoff_failed",
                        "error": str(exc),
                    }
            with (
                self.scoped_cancellation(self._child_source.token),
                child_execution_scope(
                    self.session,
                    run_session,
                    child_id=binding.child_thread_id if binding is not None else "",
                    instruction=self.prompt,
                    artifacts=(
                        self.handoff.contract
                        if self.handoff is not None
                        else self.isolated_workspace.contract
                        if self.isolated_workspace is not None
                        else None
                    ),
                ),
            ):
                # Child→parent report lane (dsh ``tool-subagent-report``):
                # stamp the continuable session id into the dispatch context
                # so the in-process runner can expose the child's ``report``
                # tool. Only present when a durable session exists; one-shot
                # children and remote providers never see it.
                #
                # A react-driven child is the exception: the main react loop
                # cannot bind a per-session report handler (react_drive
                # refuses such dispatches), so stamping the id here would
                # silently force every react child onto the mini-loop and
                # starve the react-drive end-state model. React children run
                # on the main loop without the in-run report tool; explicit
                # report lanes (caller-supplied ``subagent_session_id`` /
                # ``subagent_report_delivery``) still take the mini-loop.
                dispatch_context = self.context
                _react_driven = bool(
                    (self.context or {}).get("react_loop_subagent")
                    and (self.context or {}).get("react_stack") is not None
                )
                if self._active_session["session_id"] and not _react_driven:
                    dispatch_context = {
                        **(self.context or {}),
                        "subagent_session_id": self._active_session["session_id"],
                    }
                from runtime.execution.subagents._ambient import (
                    subagent_root_scope,
                    subagent_session_scope,
                )

                with (
                    subagent_root_scope(self._subagent_root_id),
                    subagent_session_scope(self._active_session["session_id"]),
                ):
                    if self.handoff is not None and self._child_source.is_cancelled:
                        return {
                            "agent_id": self.agent_id,
                            "output": "",
                            "success": False,
                            "status": "cancelled",
                            "error": "artifact child was cancelled before execution",
                        }
                    return _bridge_dispatch(
                        agent_id=self.agent_id,
                        prompt=self.prompt,
                        context=dispatch_context,
                        timeout_s=self.timeout_s,
                        session=run_session,
                        event_emitter=self._tracking_emitter,
                        use_cheap_model=self.use_cheap_model,
                        runner=self.runner,
                    )
        finally:
            if scope_token is not None:
                from runtime.platform.process.session import _current_session

                _current_session.reset(scope_token)
            if denylist_token is not None:
                try:
                    from runtime.safety.auth.path_denylist import (
                        pop_turn_denylist,
                    )

                    pop_turn_denylist(denylist_token)
                except ImportError:  # noqa: BLE001 — denylist is optional, skip if missing
                    pass
            if self.handoff is not None and self.handoff.child_id is not None:
                self.handoff.finished = True

    def _do_call_with_retry(self) -> dict[str, Any]:
        first = self._do_call()
        if not isinstance(first, dict):
            return first
        # Only retry round-cap exhaustion with partial work
        if (
            self._retry_disabled
            or not first.get("round_cap_exceeded")
            or not (first.get("output") or "").strip()
        ):
            return first
        partial = str(first.get("output") or "").strip()
        original_rounds = int(first.get("rounds_completed") or 0)
        _log.info(
            "subagent auto-retry · agent_id=%s rounds_first=%d partial_chars=%d",
            self.agent_id,
            original_rounds,
            len(partial),
        )
        # Reset round tracking so the retry's iteration_count reflects
        # the second attempt only (caller's _augment uses _rounds_state).
        self._rounds_state["max_round"] = 0
        # Continuation prompt: include partial output and a clear "finish"
        # directive so the agent doesn't restart from scratch.
        original_prompt = self.prompt
        continuation_prompt = (
            f"{original_prompt}\n\n"
            "---\n\n"
            "## CONTINUATION\n\n"
            f"You ran out of rounds on the first attempt ({original_rounds} "
            "rounds). Your partial work is shown below. Finish the task — do "
            "NOT restart from scratch; build on what you have. Wrap up "
            "with a final answer rather than collecting more data unless "
            "absolutely necessary.\n\n"
            "### Partial output so far\n\n"
            f"{partial}\n\n"
            "### Finish from here:"
        )
        # Mutate the shared ``self.prompt`` for the retry call. We must
        # restore the original prompt before the function returns so the
        # `record_turn` invocation later sees the user's original ask, not
        # the synthetic continuation.
        self.prompt = continuation_prompt
        try:
            second = self._do_call()
        finally:
            self.prompt = original_prompt
        if not isinstance(second, dict):
            return first
        # Stitch: prefer the retry's output but mark that a retry happened.
        second.setdefault("output", "")
        if not str(second.get("output") or "").strip() and partial:
            # Retry produced nothing usable → keep first call's partial
            # but propagate the retry-attempted flag.
            second["output"] = partial
            second["success"] = first.get("success", False)
            second["error"] = first.get("error")
        second["retry_attempted"] = True
        second["original_rounds"] = original_rounds
        if not second.get("success") and second.get("output", "").strip():
            # Even if cap hit again, we have content — surface as
            # partial-success rather than total failure.
            second.setdefault("partial", True)
        return second

    def _do_call_with_schema(self) -> dict[str, Any]:
        """Run the call, then enforce ``output_schema`` on the reply.

        No-op when no schema was requested. Otherwise validate the reply and,
        on a mismatch, re-ask the model (a single ``_do_call`` per retry, so it
        stays bounded) with a correction prompt that names the error. The raw
        ``output`` is always preserved; ``parsed`` / ``schema_ok`` /
        ``schema_error`` describe the structured outcome.
        """
        result = self._do_call_with_retry()
        if not self.output_schema or not isinstance(result, dict):
            return result

        base_prompt = self.prompt
        attempts = 0
        try:
            while True:
                raw = str(result.get("output") or "")
                ok, parsed, err = coerce_schema_output(raw, self.output_schema)
                if ok:
                    result["parsed"] = parsed
                    result["schema_ok"] = True
                    result.pop("schema_error", None)
                    return result
                # Don't burn retries on a failed dispatch (router/tool error):
                # the empty/error output won't get better by re-asking.
                if attempts >= int(self.schema_max_retries) or not result.get("success"):
                    result["schema_ok"] = False
                    result["schema_error"] = err
                    _log.info(
                        "subagent %s schema mismatch after %d attempt(s): %s",
                        self.agent_id,
                        attempts,
                        err,
                    )
                    return result
                attempts += 1
                self.prompt = base_prompt + schema_correction(err, self.output_schema, raw)
                result = self._do_call()
                if not isinstance(result, dict):
                    return result
        finally:
            self.prompt = base_prompt

    def _execute_worker(self) -> dict[str, Any]:
        if not self.isolate:
            return self._do_call_with_schema()
        from .isolated_worktree import isolated_worktree_scope

        parent_session, parent_context, original_prompt = self.session, self.context, self.prompt
        original_root = self._locked_root
        try:
            with (
                self.scoped_cancellation(self._child_source.token),
                isolated_worktree_scope(
                    parent_session, input_files=self.input_files, output_files=self.output_files
                ) as workspace,
            ):
                self.isolated_workspace = workspace
                self.session = workspace.session
                self.context = _inherit_parent_work_context(self.context, self.session)
                self._locked_root = str(workspace.path)
                self.prompt += (
                    f"\n\nYour execution workspace is {workspace.path}. "
                    "Complete this task there. The host exports your changes as a candidate "
                    "patch for the parent task to verify and apply."
                )
                if workspace.contract.output_paths:
                    self.prompt += "\nRequired output files:\n" + "\n".join(
                        str(path) for path in workspace.contract.output_paths
                    )
                try:
                    result = self._do_call_with_schema()
                except asyncio.CancelledError:
                    result = {"success": False, "output": "", "error": "child was cancelled"}
                    return workspace.export(result, cancelled=True)
                except Exception as exc:  # noqa: BLE001 — export partial work before cleanup
                    result = {"success": False, "output": "", "error": str(exc)}
                return workspace.export(result, cancelled=self._child_source.is_cancelled)
        except Exception as exc:  # noqa: BLE001 — fail one lane, never run it unisolated
            return {
                "agent_id": self.agent_id,
                "success": False,
                "output": "",
                "error": f"{type(exc).__name__}: {exc}",
                "status": "isolation_failed",
                "retry_allowed": False,
                **(
                    {"retained_workspace": str(self.isolated_workspace.path)}
                    if self.isolated_workspace is not None and self.isolated_workspace.path.exists()
                    else {}
                ),
            }
        finally:
            self.session, self.context, self.prompt = (
                parent_session,
                parent_context,
                original_prompt,
            )
            self._locked_root = original_root
            self.isolated_workspace = None
