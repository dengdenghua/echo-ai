"""ReAct loop stream driver.

Extracted from ``realtime_react_stream.py``: ``_drive_react`` pumps the
``react_loop`` iterator (or the protocol-native tool-loop fallback) on a
worker thread, marshals every yielded event onto an asyncio queue, and
dispatches them via ``_apply_react_event``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from runtime.sensing.gateway._realtime_react_stream_helpers import (  # noqa: F401  re-export: import sites stay stable
    _is_coalescable_delta as _is_coalescable_delta,
)
from runtime.sensing.gateway._realtime_subagent_journal_items import (  # noqa: F401  re-export: import sites stay stable
    _emit_subagent_lifecycle_item,
    _emit_subagent_progress_item,
    _parse_lifecycle_preview,
    _subagent_lifecycle_item_from_journal,
    _subagent_lifecycle_matches,
    _subagent_progress_item_from_journal,
    _subagent_tool_item_from_journal,
)
from runtime.sensing.gateway.realtime_react_stream_drive_steps import (  # noqa: F401  re-export: import sites stay stable
    _INTERRUPT_PRODUCER_DRAIN_TIMEOUT_S as _INTERRUPT_PRODUCER_DRAIN_TIMEOUT_S,
)
from runtime.sensing.gateway.realtime_react_stream_drive_steps import (
    _SUBAGENT_PROGRESS_EMIT_CHARS as _SUBAGENT_PROGRESS_EMIT_CHARS,
)
from runtime.sensing.gateway.realtime_react_stream_drive_steps import (
    _SUBAGENT_PROGRESS_EMIT_INTERVAL_S as _SUBAGENT_PROGRESS_EMIT_INTERVAL_S,
)
from runtime.sensing.gateway.realtime_react_stream_drive_steps import (
    _SUBAGENT_PROGRESS_PREVIEW_CHARS as _SUBAGENT_PROGRESS_PREVIEW_CHARS,
)
from runtime.sensing.gateway.realtime_react_stream_drive_steps import (
    _drive_react as _drive_react,
)
from runtime.sensing.gateway.realtime_react_stream_drive_steps import (
    _ReactBudgetKwargs as _ReactBudgetKwargs,
)
from runtime.sensing.gateway.realtime_react_stream_drive_steps import (
    _start_subagent_lifecycle_bridge as _start_subagent_lifecycle_bridge,
)

if TYPE_CHECKING:
    pass


# Give cooperative providers a brief chance to unwind their stream after an
# explicit Stop.  The user-visible turn must not remain hostage to an upstream
# iterator that ignores cancellation; after this grace period the asyncio
# wrapper is detached while the daemon/provider read finishes in the
# background.  ``consumer_closed`` below prevents that abandoned producer from
# applying events or crossing a tool side-effect boundary.

# Public sub-agent prose is a live tail, not a second full transcript.  The
# finish marker retains the bounded answer; keeping progress small and
# throttled prevents token-by-token item_delta rows from multiplying a short
# run into tens of megabytes of thread history.


# ── Sub-agent lifecycle journal → workbench bridge ────────────────────
# ``run_orchestration`` (the audit.ultracode fan-out) spawns its parallel
# sub-agents via ``_call_agent_parallel`` → ``call_subagent`` WITHOUT an
# in-memory ``event_emitter``, so their ``subagent_spawned`` /
# ``subagent_finished`` events never reach any live stream — only the
# journal mirror (``bridge._safe_journal_emit``) carries them, and only
# when the bound ``Session.metadata`` injects a journal. The realtime WS —
# the only stream the workbench reads — has no journal→WS consumer, so
# the audit's parallel sub-agents render as one opaque ``run_orchestration`` row.
#
# These helpers are that missing consumer: a per-turn journal subscription
# that lifts the marker events onto the turn as the same ``McpToolCallItem``
# the wired paths emit, which the frontend's ``mcpItemToLiveEvent`` already
# translates into lifecycle tiles (zero frontend changes).


# Note: background tool watchers (started by ``track_background_tool``)
# are intentionally NOT cancelled here. They're designed to outlive
# the current turn — the user starts a long-running shell command,
# the LLM finalises with ``react_completed``, and the watcher keeps
# streaming output deltas onto the open ``commandExecution`` item
# until the process exits. See ``test_background_tool_item_completes
# _after_turn_response``.
