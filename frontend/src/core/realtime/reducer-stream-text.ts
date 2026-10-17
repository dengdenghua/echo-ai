// Streaming text buffer for the conversation reducer (``reducer.ts``).
// ``itemStreamText`` and ``materializeStreamedItems`` are re-exported from
// ``./reducer``; import them from there.

import type { Conversation, Item } from "./items";

// ── Streaming append buffer ─────────────────────────────────
//
// The naive ``text: it.text + delta`` rebuilds the whole string on
// EVERY frame — quadratic copying for long outputs (each delta is
// small, the accumulated text is not). Instead, deltas for a
// streaming item accumulate in an immutable chunk chain (O(1)
// per delta) and are joined ONCE per animation frame when React reads
// the state. Reads of settled items never pay anything.
//
// Each item object owns a persistent buffer version. Appending never consumes
// the prior version: replay probes and React can safely fold the same state
// twice. Snapshot/turn-close objects materialize their wire fields. Weak maps
// let unused versions be collected without explicit eviction bookkeeping.
interface StreamChunk {
  readonly previous?: StreamChunk;
  readonly delta: string;
}
const streamChunks = new WeakMap<Item, StreamChunk>();

function joinStreamChunks(tail: StreamChunk): string {
  const chunks: string[] = [];
  for (let node: StreamChunk | undefined = tail; node; node = node.previous) {
    chunks.push(node.delta);
  }
  return chunks.reverse().join("");
}
// Joined text per item object, memoized: N components reading the same
// item within one frame share a single join.
const streamJoined = new WeakMap<Item, string>();

// Reasoning deltas carry a ``contentIndex`` so the server can stream
// multiple reasoning blocks (e.g. interleaved chain-of-thought +
// encrypted content) into the same item. Deltas are bucketed per
// contentIndex; the final text is the concatenation of buckets in
// ascending index order — mirroring the OpenAI Responses API
// ``reasoning.content[].index`` ordering.
const streamReasoningBuckets = new WeakMap<
  Item,
  ReadonlyMap<number, StreamChunk>
>();
const streamReasoningJoined = new WeakMap<Item, string>();

// Text-bearing wire fields that stream via deltas. Used by snapshot
// paths (item/completed, turn close) to materialize buffered chunks
// INTO the wire field so the item object is self-contained for
// persistence and for readers that bypass ``itemText``.
export type StreamTextField = "text" | "content" | "aggregatedOutput";

export const STREAM_TEXT_FIELDS: Partial<
  Record<Item["type"], StreamTextField>
> = {
  agentMessage: "text",
  reasoning: "content",
  plan: "text",
  commandExecution: "aggregatedOutput",
};

export function appendStreamText<T extends Item>(item: T, delta: string): T {
  const updated = { ...item };
  // React and the replay drift probe can reduce the same base more than
  // once. Keep the old buffer immutable and readable by every branch.
  streamChunks.set(updated, { previous: streamChunks.get(item), delta });
  return updated;
}

// Join reasoning buckets in ascending contentIndex order. Each bucket's
// chunks are concatenated first, then buckets are concatenated together.
function joinReasoningBuckets(
  buckets: ReadonlyMap<number, StreamChunk>,
): string {
  const indices = Array.from(buckets.keys()).sort((a, b) => a - b);
  let result = "";
  for (const idx of indices) {
    const chunks = buckets.get(idx);
    if (chunks) result += joinStreamChunks(chunks);
  }
  return result;
}

// Same immutable append semantics as ``appendStreamText``, but buckets the
// delta by ``contentIndex`` so interleaved multi-block reasoning streams
// reconstruct in the correct order.
export function appendReasoningStreamText<T extends Item>(
  item: T,
  delta: string,
  contentIndex: number,
): T {
  const buckets = new Map(streamReasoningBuckets.get(item));
  buckets.set(contentIndex, { previous: buckets.get(contentIndex), delta });
  const updated = { ...item };
  streamReasoningBuckets.set(updated, buckets);
  return updated;
}

// Resolve the current streamed text for an item. Settled items (and
// anything snapshot-loaded) read their wire field directly — zero
// overhead outside the streaming hot path. Exported for renderers
// that want the freshest in-flight text.
export function itemStreamText(item: Item): string {
  // Reasoning uses contentIndex buckets — the joined text is the
  // concatenation of all buckets (in index order) on top of the
  // wire field.
  if (item.type === "reasoning") {
    const buckets = streamReasoningBuckets.get(item);
    if (!buckets || buckets.size === 0) return streamWireText(item);
    const cached = streamReasoningJoined.get(item);
    if (cached !== undefined) return cached;
    const joined = streamWireText(item) + joinReasoningBuckets(buckets);
    streamReasoningJoined.set(item, joined);
    return joined;
  }
  const chunks = streamChunks.get(item);
  if (!chunks) return streamWireText(item);
  const cached = streamJoined.get(item);
  if (cached !== undefined) return cached;
  const joined = streamWireText(item) + joinStreamChunks(chunks);
  streamJoined.set(item, joined);
  return joined;
}

export function streamWireText(item: Item): string {
  switch (item.type) {
    case "agentMessage":
    case "plan":
      return item.text;
    case "reasoning":
      return item.content;
    case "commandExecution":
      return item.aggregatedOutput;
    default:
      return "";
  }
}

// Materialize buffered chunks into the item's own wire field. Called
// whenever an item leaves the streaming hot path (turn close) so the
// settled object is self-contained for persistence and for readers
// that bypass ``itemStreamText``.
export function withMaterializedStreamText(item: Item): Item {
  // Reasoning materializes from contentIndex buckets, not the flat
  // chunk list used by other streaming text types.
  if (item.type === "reasoning") {
    const buckets = streamReasoningBuckets.get(item);
    if (!buckets || buckets.size === 0) return item;
    const materialized: Item = {
      ...item,
      content: streamWireText(item) + joinReasoningBuckets(buckets),
    };
    return materialized;
  }
  const chunks = streamChunks.get(item);
  if (!chunks) return item;
  const field = STREAM_TEXT_FIELDS[item.type];
  if (!field) return item;
  return {
    ...item,
    [field]: streamWireText(item) + joinStreamChunks(chunks),
  };
}

/**
 * Materialize every in-flight stream buffer across the whole conversation.
 *
 * Replay (``replay.ts``) folds deltas through the same chunk buffer the
 * live path uses; before the rebuilt Conversation is handed to persistence
 * or non-streaming readers, the trailing buffered chunks (typically an
 * unfinished final turn) must land in the items' wire fields. Identity is
 * preserved for untouched items/turns so downstream memoization survives.
 */
export function materializeStreamedItems(
  conversation: Conversation,
): Conversation {
  let changed = false;
  const turns = conversation.turns.map((turn) => {
    let turnChanged = false;
    const items = turn.items.map((item) => {
      const materialized = withMaterializedStreamText(item);
      if (materialized !== item) turnChanged = true;
      return materialized;
    });
    if (!turnChanged) return turn;
    changed = true;
    return { ...turn, items };
  });
  return changed ? { ...conversation, turns } : conversation;
}
