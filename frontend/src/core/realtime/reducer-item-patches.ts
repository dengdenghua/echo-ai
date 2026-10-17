// Per-item patch helpers for the conversation reducer (``reducer.ts``):
// streaming deltas, plan/workbench updates and file-change hunks. Internal
// to the reducer.

import type {
  AgentPhaseSnapshot,
  Conversation,
  FileHunk,
  Item,
  WorkbenchSnapshotV2,
  WorkspaceFocus,
} from "./items";
import {
  appendReasoningStreamText,
  appendStreamText,
} from "./reducer-stream-text";
import { replaceAt, replaceTurnItem, unchanged } from "./reducer-turn-merge";
import type {
  DeltaKind,
  ReducerDiagnosticHandler,
  ReducerOutput,
} from "./reducer-types";

// Tracks when each turn was locally interrupted so late-arriving deltas
// within a grace window are still accepted rather than silently dropped.
export const interruptTimestamps = new Map<string, number>();
const INTERRUPT_GRACE_MS = 5_000;

export function mergeDelta(
  state: Conversation,
  turnId: string,
  itemId: string,
  kind: DeltaKind,
  delta: string,
  onDiagnostic?: ReducerDiagnosticHandler,
  replayMode?: boolean,
  contentIndex = 0,
): ReducerOutput {
  const turnIdx = state.turns.findIndex((t) => t.id === turnId);
  const turn = state.turns[turnIdx];
  if (!turn) {
    return unchanged(state);
  }
  const itemIdx = turn.items.findIndex((x) => x.id === itemId);
  const it = turn.items[itemIdx];
  if (!it) {
    return unchanged(state);
  }
  // Drop deltas that arrive after the item is already completed.
  // Without this, deltas that slip past the client's ordered batch
  // would append to the already-final ``text`` — doubling content.
  // Status check is the simplest gate; the diagnostic keeps the drop
  // observable instead of silent.
  // Exception: deltas arriving within the interrupt grace window are
  // still accepted so the last few chunks before interruption are not lost.
  // Only applies when the turn itself was interrupted — a completed item
  // in a non-interrupted turn should still reject late deltas.
  // Replay mode bypasses the gate entirely: the persisted log is
  // authoritative and the Python replay applies deltas unconditionally,
  // so gating here would make the two replays diverge.
  if (it.status !== "inProgress" && !replayMode) {
    const interruptedAt = interruptTimestamps.get(turnId);
    const withinGrace =
      interruptedAt !== undefined &&
      Date.now() - interruptedAt < INTERRUPT_GRACE_MS;
    if (!withinGrace || turn.status !== "interrupted") {
      onDiagnostic?.({
        type: "lateDeltaDropped",
        turnId,
        itemId,
        kind,
        itemStatus: it.status,
        deltaLength: delta.length,
      });
      return unchanged(state);
    }
  }
  let updated: Item | null = null;
  if (kind === "agentMessage" && it.type === "agentMessage") {
    updated = appendStreamText(it, delta);
  } else if (kind === "reasoning" && it.type === "reasoning") {
    updated = appendReasoningStreamText(it, delta, contentIndex);
  } else if (kind === "plan" && it.type === "plan") {
    updated = appendStreamText(it, delta);
  } else if (kind === "commandOutput" && it.type === "commandExecution") {
    updated = appendStreamText(it, delta);
  }
  if (updated === null) {
    return unchanged(state);
  }
  return {
    next: replaceTurnItem(state, turn, turnIdx, itemIdx, updated),
    changedTurnIds: [turnId],
    changedItemIds: [itemId],
  };
}

export function applyPlanUpdate(
  state: Conversation,
  turnId: string,
  phases: AgentPhaseSnapshot[] | undefined,
  hasPhases: boolean,
  workspaceFocus: WorkspaceFocus | null | undefined,
  hasWorkspaceFocus: boolean,
  workbenchSnapshot: WorkbenchSnapshotV2 | null | undefined,
  hasWorkbenchSnapshot: boolean,
): ReducerOutput {
  let touched = false;
  const turns = state.turns.map((turn) => {
    if (turn.id !== turnId) return turn;
    touched = true;
    return {
      ...turn,
      ...(hasPhases ? { phases } : {}),
      ...(hasWorkspaceFocus ? { workspaceFocus: workspaceFocus ?? null } : {}),
      ...(hasWorkbenchSnapshot
        ? { workbenchSnapshot: workbenchSnapshot ?? null }
        : {}),
    };
  });
  if (!touched) {
    return { next: state, changedTurnIds: [], changedItemIds: [] };
  }
  return {
    next: { ...state, turns },
    changedTurnIds: [turnId],
    changedItemIds: [],
  };
}

export function applyWorkbenchSnapshot(
  state: Conversation,
  turnId: string,
  snapshot: WorkbenchSnapshotV2,
): ReducerOutput {
  let touched = false;
  const turns = state.turns.map((turn) => {
    if (turn.id !== turnId) return turn;
    touched = true;
    return {
      ...turn,
      workbenchSnapshot: snapshot,
      phases: snapshot.phases,
      ...(snapshot.workspaceFocus !== undefined
        ? { workspaceFocus: snapshot.workspaceFocus ?? null }
        : {}),
    };
  });
  if (!touched) {
    return { next: state, changedTurnIds: [], changedItemIds: [] };
  }
  return {
    next: { ...state, turns },
    changedTurnIds: [turnId],
    changedItemIds: [],
  };
}

export function applyFileChangeHunkDelta(
  state: Conversation,
  turnId: string,
  itemId: string,
  path: string,
  op: "create" | "update" | "delete",
  hunk: FileHunk,
  workspaceFocus: WorkspaceFocus | null | undefined,
  hasWorkspaceFocus: boolean,
): ReducerOutput {
  const turnIdx = state.turns.findIndex((t) => t.id === turnId);
  const turn = state.turns[turnIdx];
  if (!turn) {
    return unchanged(state);
  }
  const itemIdx = turn.items.findIndex(
    (entry) => entry.id === itemId && entry.type === "fileChange",
  );
  const item = turn.items[itemIdx];
  if (!item || item.type !== "fileChange") {
    return unchanged(state);
  }
  const changeIndex = item.changes.findIndex((change) => change.path === path);
  const change = item.changes[changeIndex];
  let changes;
  if (!change) {
    changes = [...item.changes, { path, op, hunks: [hunk] }];
  } else {
    const hunks = change.hunks ?? [];
    const hunkIndex = hunks.findIndex((existing) => existing.id === hunk.id);
    const nextHunks =
      hunkIndex === -1 ? [...hunks, hunk] : replaceAt(hunks, hunkIndex, hunk);
    changes = replaceAt(item.changes, changeIndex, {
      ...change,
      op: change.op ?? op,
      hunks: nextHunks,
    });
  }
  const updated: Item = { ...item, changes };
  const turnPatch = hasWorkspaceFocus
    ? { workspaceFocus: workspaceFocus ?? null }
    : undefined;
  return {
    next: replaceTurnItem(state, turn, turnIdx, itemIdx, updated, turnPatch),
    changedTurnIds: [turnId],
    changedItemIds: [itemId],
  };
}

export function applyHunkDecision(
  state: Conversation,
  turnId: string,
  itemId: string,
  hunkId: string,
  decision: "accepted" | "rejected",
): ReducerOutput {
  const turnIdx = state.turns.findIndex((t) => t.id === turnId);
  const turn = state.turns[turnIdx];
  if (!turn) return unchanged(state);
  const itemIdx = turn.items.findIndex(
    (it) => it.id === itemId && it.type === "fileChange",
  );
  const item = turn.items[itemIdx];
  if (!item || item.type !== "fileChange") return unchanged(state);
  let hit = false;
  const changes = item.changes.map((ch) => {
    if (!ch.hunks) return ch;
    const hunkIndex = ch.hunks.findIndex((h) => h.id === hunkId);
    const target = ch.hunks[hunkIndex];
    if (!target) return ch;
    hit = true;
    return {
      ...ch,
      hunks: replaceAt(ch.hunks, hunkIndex, { ...target, decision }),
    };
  });
  if (!hit) return unchanged(state);
  const updated: Item = { ...item, changes };
  return {
    next: replaceTurnItem(state, turn, turnIdx, itemIdx, updated),
    changedTurnIds: [turnId],
    changedItemIds: [itemId],
  };
}
