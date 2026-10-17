// Conversation reducer — applies server-pushed events to Conversation state.
//
// Pure function. No I/O. No React. Each call returns a new Conversation
// (never mutates the input) so React state setters trigger re-render
// only when the slice actually changes. The function is exported as the
// single recombinator the WebSocket client uses; tests target it
// directly without spinning up a server.

import type {
  Conversation,
  Item,
  McpToolProgress,
  Turn,
  WorkspaceFocus,
} from "./items";
import { mergeExecutionSnapshot } from "./items";
import {
  applyFileChangeHunkDelta,
  applyHunkDecision,
  applyPlanUpdate,
  applyWorkbenchSnapshot,
  interruptTimestamps,
  mergeDelta,
} from "./reducer-item-patches";
import {
  closeItemsForTurn,
  mergeCompletedTurn,
  mergeStartedTurn,
  normalizeTerminalTurn,
  orderTimelineItems,
  replaceAt,
  replaceTurnItem,
  unchanged,
  upsertItem,
} from "./reducer-turn-merge";
import type {
  ConversationEvent,
  ReduceOptions,
  ReducerDiagnosticHandler,
  ReducerOutput,
} from "./reducer-types";

export type {
  ConversationEvent,
  PendingApprovalRequest,
  ReduceOptions,
  ReducerDiagnostic,
  ReducerDiagnosticHandler,
  ReducerOutput,
} from "./reducer-types";
export {
  itemStreamText,
  materializeStreamedItems,
} from "./reducer-stream-text";

let errorItemSeq = 0;

function errorRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function parseEmbeddedError(message: string): Record<string, unknown> | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    return errorRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function conciseErrorMessage(message: string): string {
  return message
    .replace(/(?:,?\s+url:)\s+https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeRealtimeError(error: {
  message: string;
  [key: string]: unknown;
}): { message: string; info: Record<string, unknown> | null } {
  const embedded = parseEmbeddedError(error.message);
  const embeddedMessage =
    typeof embedded?.message === "string" ? embedded.message : null;
  const message =
    conciseErrorMessage(embeddedMessage ?? error.message) || "turn failed";
  const info: Record<string, unknown> = {};
  const structuredInfo = errorRecord(error.info) ?? errorRecord(embedded?.info);
  if (structuredInfo) Object.assign(info, structuredInfo);
  for (const key of [
    "code",
    "codexErrorInfo",
    "additionalDetails",
    "status",
  ] as const) {
    const value = error[key] ?? embedded?.[key];
    if (value !== undefined && value !== null && value !== "")
      info[key] = value;
  }
  if (message !== error.message.trim()) {
    info.rawMessage = error.message.slice(0, 8_000);
  }
  return {
    message,
    info: Object.keys(info).length > 0 ? info : null,
  };
}

export function reduce(
  state: Conversation,
  evt: ConversationEvent,
  onDiagnostic?: ReducerDiagnosticHandler,
  options?: ReduceOptions,
): ReducerOutput {
  const replayMode = options?.mode === "replay";
  switch (evt.method) {
    case "thread/started":
      return {
        next: { ...state, resumeState: "resumed" },
        changedTurnIds: [],
        changedItemIds: [],
      };
    case "thread/tokenUsage/updated":
      return {
        next: { ...state, tokenUsage: evt.params.tokenUsage },
        changedTurnIds: [],
        changedItemIds: [],
      };
    case "thread/status/changed":
      return { next: state, changedTurnIds: [], changedItemIds: [] };
    case "turn/started": {
      const incoming = {
        ...evt.params.turn,
        items: orderTimelineItems(evt.params.turn.items),
      };
      const idx = state.turns.findIndex((t) => t.id === incoming.id);
      if (idx !== -1) {
        const existing = state.turns[idx]!;
        const merged = mergeStartedTurn(existing, incoming);
        if (merged === existing) return unchanged(state);
        return {
          next: {
            ...state,
            turns: replaceAt(state.turns, idx, merged),
          },
          changedTurnIds: [incoming.id],
          changedItemIds: [],
        };
      }
      return {
        next: { ...state, turns: [...state.turns, incoming] },
        changedTurnIds: [incoming.id],
        changedItemIds: [],
      };
    }
    case "turn/completed": {
      const incoming = evt.params.turn;
      const existingIndex = state.turns.findIndex(
        (turn) => turn.id === incoming.id,
      );
      if (existingIndex === -1) {
        const completed = normalizeTerminalTurn(incoming);
        return {
          next: { ...state, turns: [...state.turns, completed] },
          changedTurnIds: [incoming.id],
          changedItemIds: completed.items.map((item) => item.id),
        };
      }
      const changedItemIds: string[] = [];
      const turns = state.turns.map((t) => {
        if (t.id !== incoming.id) return t;
        const merged = mergeCompletedTurn(t, incoming);
        for (const item of merged.items) {
          const previous = t.items.find((it) => it.id === item.id);
          if (previous && previous.status !== item.status) {
            changedItemIds.push(item.id);
          }
        }
        return merged;
      });
      return {
        next: { ...state, turns },
        changedTurnIds: [incoming.id],
        changedItemIds,
      };
    }
    case "turn/finalized": {
      // Persisted-log terminal patch (see the event-type comment). The turn
      // must already exist — replay started it via ``turn_started``. Python
      // replay only patches status/completedAt/error; the client additionally
      // closes still-open items and materializes their buffered stream text,
      // the same repair ``closeItemsForTurn`` performs on live completion.
      const { turnId, status, completedAt, error } = evt.params;
      const turnIdx = state.turns.findIndex((t) => t.id === turnId);
      const turn = state.turns[turnIdx];
      if (!turn) return unchanged(state);
      const items = closeItemsForTurn(turn.items, status);
      const changedItemIds: string[] = [];
      for (let index = 0; index < items.length; index += 1) {
        if (items[index] !== turn.items[index]) {
          changedItemIds.push(items[index]!.id);
        }
      }
      const nextTurn: Turn = {
        ...turn,
        status,
        completedAt: completedAt ?? turn.completedAt,
        ...(error !== undefined ? { error } : {}),
        items,
      };
      return {
        next: { ...state, turns: replaceAt(state.turns, turnIdx, nextTurn) },
        changedTurnIds: [turnId],
        changedItemIds,
      };
    }
    case "turn/compacted": {
      // Mirrors ``_apply_event(turn_compacted)`` in event_log.py: drop the
      // superseded turns and insert the summary where the oldest superseded
      // turn sat (append when no superseded turn is found). The summary is
      // additionally de-duplicated by id so a repeated compaction event
      // replaces rather than duplicates — replay is idempotent by log
      // construction, live delivery is at-least-once.
      const { supersededTurnIds, summaryTurn } = evt.params;
      const superseded = new Set(supersededTurnIds);
      const firstIdx = state.turns.findIndex((t) => superseded.has(t.id));
      const removed = (t: Turn) =>
        superseded.has(t.id) || t.id === summaryTurn.id;
      const keep = state.turns.filter((t) => !removed(t));
      let insertAt: number;
      if (firstIdx === -1) {
        insertAt = keep.length;
      } else {
        // Entries removed BEFORE firstIdx shift the insertion point left.
        const removedBefore = state.turns
          .slice(0, firstIdx)
          .filter((t) => removed(t)).length;
        insertAt = Math.min(firstIdx - removedBefore, keep.length);
      }
      const turns = [
        ...keep.slice(0, insertAt),
        summaryTurn,
        ...keep.slice(insertAt),
      ];
      return {
        next: { ...state, turns },
        changedTurnIds: [...supersededTurnIds, summaryTurn.id],
        changedItemIds: [],
      };
    }
    case "turn/interrupted": {
      interruptTimestamps.set(evt.params.turnId, Date.now());
      const changedItemIds: string[] = [];
      const completedAt = evt.params.completedAt ?? new Date().toISOString();
      const interruptReason = evt.params.reason ?? null;
      const turns = state.turns.map((t) => {
        if (t.id !== evt.params.turnId) return t;
        const items = closeItemsForTurn(t.items, "interrupted");
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          if (item && item !== t.items[index]) {
            changedItemIds.push(item.id);
          }
        }
        return {
          ...t,
          status: "interrupted" as const,
          completedAt,
          items,
          interruptReason: interruptReason ?? t.interruptReason,
        };
      });
      return {
        next: { ...state, turns },
        changedTurnIds: [evt.params.turnId],
        changedItemIds,
      };
    }
    case "turn/diff/updated":
      return {
        next: state,
        changedTurnIds: [evt.params.turnId],
        changedItemIds: [],
      };
    case "turn/execution/updated": {
      const { threadId, turnId } = evt.params;
      if (threadId !== state.threadId) return unchanged(state);
      const index = state.turns.findIndex((turn) => turn.id === turnId);
      const turn = state.turns[index];
      if (!turn) return unchanged(state);
      const execution = mergeExecutionSnapshot(
        turn.execution,
        evt.params.execution,
      );
      if (execution === turn.execution) return unchanged(state);
      return {
        next: {
          ...state,
          turns: replaceAt(state.turns, index, { ...turn, execution }),
        },
        changedTurnIds: [turnId],
        changedItemIds: [],
      };
    }
    case "turn/plan/updated":
      return applyPlanUpdate(
        state,
        evt.params.turnId,
        evt.params.phases,
        "phases" in evt.params,
        evt.params.workspaceFocus,
        "workspaceFocus" in evt.params,
        evt.params.workbenchSnapshot,
        "workbenchSnapshot" in evt.params,
      );
    case "workbench/snapshot":
      return applyWorkbenchSnapshot(
        state,
        evt.params.turnId,
        evt.params.snapshot,
      );
    case "turn/heartbeat":
      // No state change — purely a keepalive signal to prevent WS timeout.
      return { next: state, changedTurnIds: [], changedItemIds: [] };
    case "turn/metaSkill/hint": {
      // Attach the hint to the matching turn. If the turn isn't in
      // state yet (race against turn/started) we silently drop —
      // the hint is best-effort UX, not a contract.
      const { turnId, threadId, name, description, kind, affinity, stepCount } =
        evt.params;
      let touched = false;
      const turns = state.turns.map((t) => {
        if (t.id !== turnId) return t;
        touched = true;
        return {
          ...t,
          metaSkillHint: { name, description, kind, affinity, stepCount },
        };
      });
      if (!touched) {
        return { next: state, changedTurnIds: [], changedItemIds: [] };
      }
      void threadId;
      return {
        next: { ...state, turns },
        changedTurnIds: [turnId],
        changedItemIds: [],
      };
    }
    case "turn/grounding": {
      // Attach the consulted project docs/chunks to the matching turn.
      // Same race tolerance as the meta-skill hint: drop if the turn isn't
      // in state yet — grounding is best-effort UX, not a contract.
      const { turnId, threadId, sources } = evt.params;
      if (!Array.isArray(sources) || sources.length === 0) {
        return { next: state, changedTurnIds: [], changedItemIds: [] };
      }
      let touched = false;
      const turns = state.turns.map((t) => {
        if (t.id !== turnId) return t;
        touched = true;
        return { ...t, grounding: sources };
      });
      if (!touched) {
        return { next: state, changedTurnIds: [], changedItemIds: [] };
      }
      void threadId;
      return {
        next: { ...state, turns },
        changedTurnIds: [turnId],
        changedItemIds: [],
      };
    }
    case "item/started":
      return upsertItem(state, evt.params.turnId, evt.params.item, "started");
    case "item/completed":
      return upsertItem(state, evt.params.turnId, evt.params.item, "completed");
    case "item/agentMessage/delta":
      return mergeDelta(
        state,
        evt.params.turnId,
        evt.params.itemId,
        "agentMessage",
        evt.params.delta,
        onDiagnostic,
        replayMode,
      );
    case "item/reasoning/textDelta":
      return mergeDelta(
        state,
        evt.params.turnId,
        evt.params.itemId,
        "reasoning",
        evt.params.delta,
        onDiagnostic,
        replayMode,
        evt.params.contentIndex,
      );
    case "item/plan/delta":
      return mergeDelta(
        state,
        evt.params.turnId,
        evt.params.itemId,
        "plan",
        evt.params.delta,
        onDiagnostic,
        replayMode,
      );
    case "item/commandExecution/outputDelta":
      return mergeDelta(
        state,
        evt.params.turnId,
        evt.params.itemId,
        "commandOutput",
        evt.params.delta,
        onDiagnostic,
        replayMode,
      );
    case "item/fileChange/hunkDelta":
      return applyFileChangeHunkDelta(
        state,
        evt.params.turnId,
        evt.params.itemId,
        evt.params.path,
        evt.params.op,
        evt.params.hunk,
        evt.params.workspaceFocus,
        "workspaceFocus" in evt.params,
      );
    case "item/mcpToolCall/progress":
      return applyMcpToolProgress(
        state,
        evt.params.turnId,
        evt.params.itemId,
        evt.params.progress,
        evt.params.workspaceFocus,
        "workspaceFocus" in evt.params,
      );
    case "item/fileChange/hunkDecision":
      return applyHunkDecision(
        state,
        evt.params.turnId,
        evt.params.itemId,
        evt.params.hunkId,
        evt.params.decision,
      );
    case "error": {
      // Surface as a transient errorItem on the active turn (if any).
      // We do *not* mutate turn.status here — turn/completed authoritatively
      // sets that. Same convention as the server.
      const turnId =
        evt.params.turnId ?? state.turns[state.turns.length - 1]?.id;
      if (!turnId)
        return { next: state, changedTurnIds: [], changedItemIds: [] };
      const normalizedError = normalizeRealtimeError(evt.params.error);
      const errorItem: Item = {
        id: `err_${Date.now()}_${++errorItemSeq}`,
        type: "error",
        status: "failed",
        createdAt: new Date().toISOString(),
        message: normalizedError.message,
        willRetry: evt.params.willRetry,
        errorInfo: normalizedError.info,
      };
      return upsertItem(state, turnId, errorItem, "started");
    }
    case "workflow/completed": {
      const n = evt.params;
      const notification = {
        threadId: n.threadId,
        workflowName: n.workflowName,
        workflowDescription: n.workflowDescription,
        runId: n.runId,
        stopReason: n.stopReason,
        success: n.success,
        agentsStarted: n.agentsStarted,
        error: n.error ?? null,
        receivedAt: new Date().toISOString(),
      };
      const workflowNotifications = [
        ...state.workflowNotifications,
        notification,
      ].slice(-20);
      return {
        next: { ...state, workflowNotifications },
        changedTurnIds: [],
        changedItemIds: [],
      };
    }
    default:
      return { next: state, changedTurnIds: [], changedItemIds: [] };
  }
}

// ── Helpers ──────────────────────────────────────────────────

function applyMcpToolProgress(
  state: Conversation,
  turnId: string,
  itemId: string,
  progress: McpToolProgress,
  workspaceFocus: WorkspaceFocus | null | undefined,
  hasWorkspaceFocus: boolean,
): ReducerOutput {
  const turnIdx = state.turns.findIndex((t) => t.id === turnId);
  const turn = state.turns[turnIdx];
  if (!turn) {
    return unchanged(state);
  }
  const itemIdx = turn.items.findIndex(
    (item) => item.id === itemId && item.type === "mcpToolCall",
  );
  const existing = turn.items[itemIdx];
  if (!existing) {
    return unchanged(state);
  }
  const updated = { ...existing, progress } as Item;
  const turnPatch = hasWorkspaceFocus
    ? { workspaceFocus: workspaceFocus ?? null }
    : undefined;
  return {
    next: replaceTurnItem(state, turn, turnIdx, itemIdx, updated, turnPatch),
    changedTurnIds: [turnId],
    changedItemIds: [itemId],
  };
}
