import { currentActorScope } from "@/core/auth/api";
import type { CoworkRoomReplyReference } from "@/core/cowork/types";

export interface RoomMessage {
  message_id: string;
  client_message_id?: string;
  seq?: number;
  session_seq?: number;
  cursor_epoch?: string;
  thread_id?: string;
  participant_id: string;
  display_name: string;
  on_behalf_of?: string;
  text: string;
  reply_to?: CoworkRoomReplyReference | null;
  created_at: string;
  delivery_status?: "sending" | "sent" | "delivered" | "read" | "failed";
  error?: string;
}

export interface RoomMessageReceipt {
  room_id: string;
  message_id: string;
  participant_id: string;
  status: "delivered" | "read";
  seq?: number | null;
  updated_at?: string;
}

export function createClientMessageId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export interface QueuedRoomMessage {
  client_message_id: string;
  text: string;
  thread_id?: string;
  on_behalf_of?: string;
  created_at: string;
  reply_to?: CoworkRoomReplyReference | null;
}

const ROOM_OUTBOX_PREFIX = "echo:room-outbox:";

function roomOutboxScopePrefix(scope: string): string {
  return `${ROOM_OUTBOX_PREFIX}${encodeURIComponent(scope)}:`;
}

export function roomOutboxKey(
  teamId: string,
  participantId: string,
  scope = currentActorScope(),
): string {
  return `${roomOutboxScopePrefix(scope)}${teamId}:${participantId}`;
}

export function readRoomOutbox(
  teamId?: string | null,
  participantId?: string | null,
  scope = currentActorScope(),
): QueuedRoomMessage[] {
  if (!teamId || !participantId || typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(roomOutboxKey(teamId, participantId, scope)) ??
        "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is QueuedRoomMessage =>
        item &&
        typeof item === "object" &&
        typeof item.client_message_id === "string" &&
        typeof item.text === "string" &&
        typeof item.created_at === "string",
    );
  } catch {
    return [];
  }
}

export function writeRoomOutbox(
  teamId: string,
  participantId: string,
  messages: QueuedRoomMessage[],
  scope = currentActorScope(),
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      roomOutboxKey(teamId, participantId, scope),
      JSON.stringify(messages.slice(-100)),
    );
  } catch {
    // Storage may be disabled or full; in-memory delivery still works.
  }
}

/** Drop unsent room messages when their owner explicitly signs out. */
export function clearRoomOutboxForScope(scope = currentActorScope()): void {
  if (typeof window === "undefined") return;
  try {
    const prefix = roomOutboxScopePrefix(scope);
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable: no durable outbox to clear.
  }
}

export function enqueueRoomOutbox(
  teamId: string | null | undefined,
  participantId: string,
  message: Omit<QueuedRoomMessage, "created_at"> & { created_at?: string },
) {
  if (!teamId) return;
  const queued = readRoomOutbox(teamId, participantId).filter(
    (item) => item.client_message_id !== message.client_message_id,
  );
  queued.push({
    ...message,
    created_at: message.created_at ?? new Date().toISOString(),
  });
  writeRoomOutbox(teamId, participantId, queued);
}

export function removeRoomOutboxMessage(
  teamId: string | null | undefined,
  participantId: string,
  clientMessageId: string,
) {
  if (!teamId) return;
  const queued = readRoomOutbox(teamId, participantId).filter(
    (item) => item.client_message_id !== clientMessageId,
  );
  writeRoomOutbox(teamId, participantId, queued);
}

export function upsertRoomMessage(
  messages: RoomMessage[],
  incoming: RoomMessage,
): RoomMessage[] {
  const index = messages.findIndex(
    (message) =>
      message.message_id === incoming.message_id ||
      Boolean(
        incoming.client_message_id &&
        message.participant_id === incoming.participant_id &&
        message.client_message_id === incoming.client_message_id,
      ),
  );
  const next = [...messages];
  if (index < 0) next.push(incoming);
  else {
    const current = messages[index]!;
    const status = current.delivery_status;
    const keepStatus =
      status === "read" ||
      (status === "delivered" && incoming.delivery_status === "sent");
    next[index] = {
      ...current,
      ...incoming,
      ...(keepStatus ? { delivery_status: status } : {}),
    };
  }
  return next
    .sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity))
    .slice(-50);
}

export function upsertRoomMessageReceipt(
  receipts: RoomMessageReceipt[],
  incoming: RoomMessageReceipt,
): RoomMessageReceipt[] {
  const index = receipts.findIndex(
    (receipt) =>
      receipt.message_id === incoming.message_id &&
      receipt.participant_id === incoming.participant_id,
  );
  if (index < 0) return [...receipts, incoming].slice(-500);
  const current = receipts[index]!;
  const status =
    current.status === "read" || incoming.status === "read"
      ? "read"
      : "delivered";
  const next = [...receipts];
  next[index] = {
    ...current,
    ...incoming,
    status,
    seq: incoming.seq ?? current.seq ?? null,
  };
  return next.slice(-500);
}

export function markRoomMessageFailed(
  messages: RoomMessage[],
  clientMessageId: string,
  error: string,
): RoomMessage[] {
  return messages.map((message) =>
    !message.seq && message.client_message_id === clientMessageId
      ? { ...message, delivery_status: "failed", error }
      : message,
  );
}
