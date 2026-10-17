// Event, output and diagnostic types for the conversation reducer
// (``reducer.ts``). Re-exported from ``./reducer``; import from there.

import type {
  AgentPhaseSnapshot,
  Conversation,
  ExecutionSnapshot,
  FileHunk,
  GroundingSource,
  Item,
  ItemStatus,
  McpToolProgress,
  Turn,
  TurnStatus,
  WorkbenchSnapshotV2,
  WorkspaceFocus,
} from "./items";

// All events the reducer understands. The set is closed: anything not
// listed here is a no-op (useful — server adds new methods without
// breaking older clients), but the type unions a developer should
// review when bumping the protocol.

export type ConversationEvent =
  | { method: "thread/started"; params: { thread: { id: string } } }
  | {
      method: "thread/status/changed";
      params: {
        threadId: string;
        status: { type: string; activeFlags?: string[] };
      };
    }
  | {
      method: "thread/tokenUsage/updated";
      params: { threadId: string; tokenUsage: Record<string, unknown> };
    }
  | { method: "turn/started"; params: { threadId: string; turn: Turn } }
  | {
      method: "turn/execution/updated";
      params: {
        threadId: string;
        turnId: string;
        execution: ExecutionSnapshot;
      };
    }
  | {
      method: "turn/completed";
      params: { threadId: string; turn: Turn };
    }
  | {
      // Replay-only terminal patch. ``turn/completed`` carries a whole Turn
      // snapshot (live path), but the persisted event log records only
      // ``status/completedAt/error`` — mirroring the Python replay semantics
      // in ``runtime/memory/threads/event_log.py::_apply_event``. Synthesizing
      // a full Turn would clobber ``startedAt`` and other live fields via the
      // ``{...existing, ...incoming}`` merge, so replay emits this instead.
      method: "turn/finalized";
      params: {
        threadId: string;
        turnId: string;
        status: TurnStatus;
        completedAt: string | null;
        error?: Record<string, unknown> | null;
      };
    }
  | {
      // Compaction replaces a contiguous range of prior turns with a single
      // summary turn. Semantics mirror the Python replay exactly: the summary
      // slots into the position of the oldest superseded turn.
      method: "turn/compacted";
      params: {
        threadId: string;
        supersededTurnIds: string[];
        summaryTurn: Turn;
      };
    }
  | {
      method: "turn/interrupted";
      params: {
        threadId: string;
        turnId: string;
        completedAt?: string;
        reason?: string;
      };
    }
  | {
      method: "turn/diff/updated";
      params: { threadId: string; turnId: string; diff: unknown };
    }
  | {
      method: "turn/plan/updated";
      params: {
        threadId: string;
        turnId: string;
        // Optional: live senders always include phases, but replayed
        // ``turn_updated`` log events may carry only workspaceFocus /
        // workbenchSnapshot. Absent phases leave ``turn.phases`` untouched.
        phases?: AgentPhaseSnapshot[];
        workspaceFocus?: WorkspaceFocus | null;
        workbenchSnapshot?: WorkbenchSnapshotV2 | null;
      };
    }
  | {
      method: "workbench/snapshot";
      params: {
        threadId: string;
        turnId: string;
        snapshot: WorkbenchSnapshotV2;
      };
    }
  | {
      // Lightweight keepalive for long-running swarm/cluster roles.
      // The reducer doesn't need to track state from this event — its
      // purpose is to prevent the frontend's pong-timeout (70s) from
      // killing the WS during roles that don't produce text deltas.
      method: "turn/heartbeat";
      params: {
        threadId: string;
        turnId: string;
        role?: string;
        agentId?: string;
        elapsedS?: number;
      };
    }
  | {
      // Soft hand-off hint emitted at turn start when the user's
      // prompt strongly matches a 能力包 / Meta-Skill. Reducer
      // attaches the hint to the matching turn so the chat page
      // can render a dismissible chip linking to the catalog. The
      // hint is informational — ReAct still runs in parallel.
      method: "turn/metaSkill/hint";
      params: {
        threadId: string;
        turnId: string;
        name: string;
        description: string;
        kind: string;
        affinity: string[];
        stepCount: number;
      };
    }
  | {
      // Codebase grounding: the project docs/chunks a code/project turn
      // folded into its prompt. Reducer attaches them to the matching turn;
      // the realtime adapter bridges them onto the AI reply's
      // ``additional_kwargs.grounding`` so the chat shows a grounding chip.
      method: "turn/grounding";
      params: {
        threadId: string;
        turnId: string;
        sources: GroundingSource[];
      };
    }
  | {
      method: "item/started";
      params: { threadId: string; turnId: string; item: Item };
    }
  | {
      method: "item/completed";
      params: { threadId: string; turnId: string; item: Item };
    }
  | {
      method: "item/agentMessage/delta";
      params: {
        threadId: string;
        turnId: string;
        itemId: string;
        delta: string;
      };
    }
  | {
      method: "item/reasoning/textDelta";
      params: {
        threadId: string;
        turnId: string;
        itemId: string;
        delta: string;
        contentIndex: number;
      };
    }
  | {
      method: "item/plan/delta";
      params: {
        threadId: string;
        turnId: string;
        itemId: string;
        delta: string;
      };
    }
  | {
      method: "item/commandExecution/outputDelta";
      params: {
        threadId: string;
        turnId: string;
        itemId: string;
        delta: string;
      };
    }
  | {
      method: "item/fileChange/hunkDelta";
      params: {
        threadId: string;
        turnId: string;
        itemId: string;
        path: string;
        op: "create" | "update" | "delete";
        hunk: FileHunk;
        workspaceFocus?: WorkspaceFocus | null;
      };
    }
  | {
      method: "item/mcpToolCall/progress";
      params: {
        threadId: string;
        turnId: string;
        itemId: string;
        progress: McpToolProgress;
        workspaceFocus?: WorkspaceFocus | null;
      };
    }
  | {
      method: "item/fileChange/hunkDecision";
      params: {
        threadId: string;
        turnId: string;
        itemId: string;
        hunkId: string;
        decision: "accepted" | "rejected";
        path: string;
      };
    }
  | {
      // Workflow (multi-agent orchestration) completion notification.
      // Informational — the reducer records it on the conversation so the
      // UI can surface a completion banner/chip; nothing else depends on it.
      method: "workflow/completed";
      params: {
        threadId: string;
        workflowName: string;
        workflowDescription: string;
        runId: string;
        stopReason: string;
        success: boolean;
        agentsStarted: number;
        error?: string | null;
      };
    }
  | {
      method: "error";
      params: {
        threadId: string;
        turnId?: string;
        error: {
          message: string;
          code?: unknown;
          additionalDetails?: unknown;
          codexErrorInfo?: unknown;
          info?: unknown;
          [key: string]: unknown;
        };
        willRetry: boolean;
      };
    };

export interface PendingApprovalRequest {
  requestId: string | number;
  method: string;
  params: Record<string, unknown>;
}

// Event flag set returned alongside a reduced state so callers know what
// just happened without diffing the entire conversation. Avoids
// re-running expensive selectors when only a token landed.
export interface ReducerOutput {
  next: Conversation;
  changedTurnIds: string[];
  changedItemIds: string[];
}

// Behaviour switches for the two event sources that feed the reducer.
// ``live`` (default) keeps every realtime safeguard — interrupt grace
// windows, late-delta drops. ``replay`` trusts the persisted event log as
// authoritative: deltas apply regardless of item status (mirroring the
// Python ``_merge_delta``), and no wall-clock heuristics are consulted, so
// replaying the same log twice yields identical state.
export interface ReduceOptions {
  mode?: "live" | "replay";
}

export type DeltaKind = "agentMessage" | "reasoning" | "plan" | "commandOutput";

// Anomalies the reducer wants to surface without owning a logger.
// ``lateDeltaDropped``: a delta arrived for an item that already left
// ``inProgress``. Since the client batches ``item/completed`` together
// with deltas (preserving arrival order), this should be ~zero — a
// sustained nonzero count means the wire protocol drifted (e.g.
// ``item/completed`` stopped carrying full text) and text is being
// silently lost.
export interface ReducerDiagnostic {
  type: "lateDeltaDropped";
  turnId: string;
  itemId: string;
  kind: DeltaKind;
  itemStatus: ItemStatus;
  deltaLength: number;
}

export type ReducerDiagnosticHandler = (diagnostic: ReducerDiagnostic) => void;
