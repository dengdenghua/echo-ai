// Turn/item merge helpers for the conversation reducer (``reducer.ts``):
// shared no-op/replace helpers, turn start/completion merging, item upsert
// and timeline ordering. Internal to the reducer.

import type { Conversation, Item, Turn } from "./items";
import { mergeExecutionSnapshot } from "./items";
import {
  STREAM_TEXT_FIELDS,
  streamWireText,
  withMaterializedStreamText,
} from "./reducer-stream-text";
import type { ReducerOutput } from "./reducer-types";

// Shared no-op result: same state reference, nothing flagged as changed.
// Returning the *same* reference matters — callers (and React setters)
// use identity to skip re-renders, so dropped deltas must not allocate.
export function unchanged(state: Conversation): ReducerOutput {
  return { next: state, changedTurnIds: [], changedItemIds: [] };
}

// Copy ``arr`` with index ``idx`` replaced. Single allocation, no
// per-element predicate — the indexed counterpart of ``.map()`` for
// the hot single-item update paths below.
export function replaceAt<T>(arr: readonly T[], idx: number, value: T): T[] {
  const next = arr.slice();
  next[idx] = value;
  return next;
}

// Rebuild Conversation with one item of one turn swapped out. Every
// streaming delta lands here, so the work is two indexed copies —
// no full-array scans beyond the initial findIndex at the call site.
export function replaceTurnItem(
  state: Conversation,
  turn: Turn,
  turnIdx: number,
  itemIdx: number,
  item: Item,
  turnPatch?: Partial<Turn>,
): Conversation {
  const nextTurn: Turn = {
    ...turn,
    ...turnPatch,
    items: replaceAt(turn.items, itemIdx, item),
  };
  return { ...state, turns: replaceAt(state.turns, turnIdx, nextTurn) };
}

export function mergeCompletedTurn(existing: Turn, incoming: Turn): Turn {
  const incomingItems = Array.isArray(incoming.items) ? incoming.items : [];
  const incomingById = new Map(incomingItems.map((item) => [item.id, item]));
  const existingItems = existing.items.map((item) => {
    const replacement = incomingById.get(item.id);
    if (replacement) {
      return preserveCompletedStreamText(item, replacement);
    }
    // Still-open items (and buffered chunks against them) are closed by
    // ``closeItemsForTurn`` below.
    return item;
  });
  const existingIds = new Set(existing.items.map((item) => item.id));
  const appended = incomingItems.filter((item) => !existingIds.has(item.id));
  const items = closeItemsForTurn(
    orderTimelineItems([...existingItems, ...appended]),
    incoming.status,
  );
  return {
    ...existing,
    ...incoming,
    execution: mergeExecutionSnapshot(existing.execution, incoming.execution),
    items,
  };
}

/**
 * A duplicate/replayed turn start is never more authoritative than state we
 * already reduced from item deltas or a terminal turn snapshot. Preserve the
 * live copy, enrich missing timeline coordinates, and append genuinely new
 * items without allowing a stale start to erase text or reopen the turn.
 */
export function mergeStartedTurn(existing: Turn, incoming: Turn): Turn {
  if (existing.status !== "inProgress") return existing;

  const incomingById = new Map(incoming.items.map((item) => [item.id, item]));
  const existingIds = new Set(existing.items.map((item) => item.id));
  const existingItems = existing.items.map((item) => {
    const replayed = incomingById.get(item.id);
    if (!replayed) return item;
    const timelineSequence =
      item.timelineSequence ?? replayed.timelineSequence ?? null;
    const parentItemId = item.parentItemId ?? replayed.parentItemId ?? null;
    const phaseId = item.phaseId ?? replayed.phaseId ?? null;
    if (
      timelineSequence === item.timelineSequence &&
      parentItemId === item.parentItemId &&
      phaseId === item.phaseId
    ) {
      return item;
    }
    return {
      ...withMaterializedStreamText(item),
      timelineSequence,
      parentItemId,
      phaseId,
    };
  });
  const appended = incoming.items.filter((item) => !existingIds.has(item.id));
  if (
    appended.length === 0 &&
    existingItems.every((item, index) => item === existing.items[index])
  ) {
    return existing;
  }
  return {
    ...incoming,
    ...existing,
    items: orderTimelineItems([...existingItems, ...appended]),
  };
}

export function normalizeTerminalTurn(turn: Turn): Turn {
  return {
    ...turn,
    items: closeItemsForTurn(orderTimelineItems(turn.items), turn.status),
  };
}

/**
 * Reconcile item transport completion with the authoritative turn outcome.
 *
 * Older backends flushed an open public message as ``completed`` immediately
 * before publishing ``turn/interrupted``. The bytes arrived, but the final
 * message never became authoritative. Preserve earlier tools/checkpoints
 * while marking the last prose draft and every still-open item with the real
 * turn outcome. This also repairs persisted historical turns during replay.
 */
export function closeItemsForTurn(
  items: readonly Item[],
  turnStatus: Turn["status"],
): Item[] {
  let interruptedMessageId: string | null = null;
  if (
    turnStatus === "interrupted" ||
    turnStatus === "paused" ||
    turnStatus === "cancelled"
  ) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item?.type === "agentMessage") {
        interruptedMessageId = item.id;
        break;
      }
    }
  }

  const terminalStatus = itemTerminalStatus(turnStatus);
  return items.map((item) => {
    // Only streaming-capable items can carry buffered chunks; checking
    // the type first keeps this loop free of WeakMap lookups for the
    // common non-text items.
    if (STREAM_TEXT_FIELDS[item.type]) {
      item = withMaterializedStreamText(item);
    }
    const nextStatus =
      item.id === interruptedMessageId
        ? "interrupted"
        : item.status === "inProgress"
          ? terminalStatus
          : item.status;
    return nextStatus === item.status ? item : { ...item, status: nextStatus };
  });
}

function itemTerminalStatus(turnStatus: Turn["status"]): Item["status"] {
  if (turnStatus === "failed") return "failed";
  if (
    turnStatus === "interrupted" ||
    turnStatus === "paused" ||
    turnStatus === "cancelled"
  ) {
    return "interrupted";
  }
  return "completed";
}

export function upsertItem(
  state: Conversation,
  turnId: string,
  item: Item,
  phase: "started" | "completed",
): ReducerOutput {
  const turnIdx = state.turns.findIndex((t) => t.id === turnId);
  const turn = state.turns[turnIdx];
  if (!turn) {
    return unchanged(state);
  }
  const idx = turn.items.findIndex((it) => it.id === item.id);
  let nextItems: Item[];
  if (idx === -1) {
    // Avoid a full re-sort on every appended item. Items normally arrive in
    // timeline order, so appending at the tail keeps the array sorted and the
    // rendered cards stable (no position jump when a parallel command lands
    // out of delivery order). Only re-sort when the new item's sequence
    // actually precedes the current tail — a rare out-of-order arrival.
    const next = [...turn.items, item];
    const last = turn.items[turn.items.length - 1];
    if (
      Number.isFinite(item.timelineSequence) &&
      last &&
      Number.isFinite(last.timelineSequence) &&
      Number(item.timelineSequence) < Number(last.timelineSequence)
    ) {
      nextItems = orderTimelineItems(next);
    } else {
      nextItems = next;
    }
  } else {
    // ``completed`` snapshots replace; ``started`` after ``completed`` is
    // a no-op (out-of-order delivery from a buffered queue).
    const existing = turn.items[idx];
    if (!existing) return unchanged(state);
    if (phase === "completed" || existing.status === "inProgress") {
      nextItems = orderTimelineItems(
        replaceAt(turn.items, idx, preserveCompletedStreamText(existing, item)),
      );
    } else {
      return unchanged(state);
    }
  }
  const nextTurn: Turn = { ...turn, items: nextItems };
  return {
    next: { ...state, turns: replaceAt(state.turns, turnIdx, nextTurn) },
    changedTurnIds: [turnId],
    changedItemIds: [item.id],
  };
}

function preserveTimelineCoordinates(existing: Item, incoming: Item): Item {
  return {
    ...incoming,
    timelineSequence:
      incoming.timelineSequence ?? existing.timelineSequence ?? null,
    parentItemId: incoming.parentItemId ?? existing.parentItemId ?? null,
    phaseId: incoming.phaseId ?? existing.phaseId ?? null,
  };
}

function preserveCompletedStreamText(existing: Item, incoming: Item): Item {
  const merged = preserveTimelineCoordinates(existing, incoming);
  const field = STREAM_TEXT_FIELDS[merged.type];
  if (!field) return merged;
  // Server snapshots can lag the live delta stream. The buffer is keyed
  // on the REPLACED object identity, so materialize its chunks into the
  // snapshot's wire field — otherwise those chunks would be stranded
  // and the text would silently shrink on settle.
  const existingText = streamWireText(withMaterializedStreamText(existing));
  if (!existingText) return merged;
  const snapshotText = streamWireText(merged);
  // A nonempty terminal snapshot is the complete authoritative value, not
  // another delta. It must repair dropped/corrupted live chunks on replay.
  if (snapshotText && incoming.status !== "inProgress") return merged;
  // Prefix relationships for lagging in-progress snapshots:
  //   snapshot ⊇ existing → snapshot is authoritative, use it
  //   existing ⊇ snapshot → snapshot lagged, keep existing (longer) text
  //   otherwise           → snapshot corrects/replaces the live draft
  if (snapshotText.startsWith(existingText)) return merged;
  if (existingText.startsWith(snapshotText)) {
    return { ...merged, [field]: existingText };
  }
  return merged;
}

/**
 * Reorder only the slots that carry server-authored timeline coordinates.
 * Legacy/user items without coordinates keep their exact positions, so a
 * mixed old/new replay never moves the user's prompt behind assistant work.
 */
export function orderTimelineItems(items: readonly Item[]): Item[] {
  const sequenced = items
    .filter((item) => Number.isFinite(item.timelineSequence))
    .map((item, stableIndex) => ({ item, stableIndex }))
    .sort((left, right) => {
      const delta =
        Number(left.item.timelineSequence) -
        Number(right.item.timelineSequence);
      return delta || left.stableIndex - right.stableIndex;
    })
    .map(({ item }) => item);
  if (sequenced.length < 2) return items.slice();
  let cursor = 0;
  return items.map((item) =>
    Number.isFinite(item.timelineSequence) ? sequenced[cursor++]! : item,
  );
}
