/**
 * Boundary between wire notifications and the reducer's closed
 * ``ConversationEvent`` union. The reducer ignores methods it does not
 * know, so frames are passed through ``looseBody`` (fail-open) rather than
 * dropped; the guard records the envelope shape the reducer relies on.
 */
import { isRecord, isString } from "@/core/utils/guards";

import type { ConversationEvent } from "./reducer";

export function isConversationEvent(
  value: unknown,
): value is ConversationEvent {
  return isRecord(value) && isString(value.method) && isRecord(value.params);
}
