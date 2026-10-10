/**
 * Boundary between wire notifications and the reducer's closed
 * ``ConversationEvent`` union. The reducer ignores methods it does not
 * know, so frames are passed through ``looseBody`` (fail-open) rather than
 * dropped; the guard records the envelope shape the reducer relies on.
 */
import { isRecord, isString, isUnknownArray } from "@/core/utils/guards";

import type { Item, Turn } from "./items";
import type { ConversationEvent } from "./reducer";

export function isConversationEvent(
  value: unknown,
): value is ConversationEvent {
  return isRecord(value) && isString(value.method) && isRecord(value.params);
}

/** A replayed item: the reducer keys items by ``id`` and dispatches on ``type``. */
export function isItemRecord(value: unknown): value is Item {
  return isRecord(value) && isString(value.id) && isString(value.type);
}

/** A replayed turn: an ``id`` and its ``items`` list. */
export function isTurnRecord(value: unknown): value is Turn {
  return isRecord(value) && isString(value.id) && isUnknownArray(value.items);
}
