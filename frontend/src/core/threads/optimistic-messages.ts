import type { HumanMessage, Message } from "@/core/api/types";
import type { PromptInputMessage } from "@/core/uploads";

export const RETRY_PENDING_MESSAGE_EVENT =
  "echo:retry-pending-message" as const;

/** Retry the existing outbound item, including its original attachments. */
export function retryPendingMessage(
  threadId: string | null | undefined,
  clientMessageId: string,
): void {
  window.dispatchEvent(
    new CustomEvent(RETRY_PENDING_MESSAGE_EVENT, {
      detail: { threadId, clientMessageId },
    }),
  );
}

export type OutboundDeliveryState = "queued" | "sending" | "failed";

export interface PendingOutboundMessage {
  clientMessageId: string;
  threadId: string;
  intent: "start" | "steer";
  targetTurnId?: string;
  message: PromptInputMessage;
  displayText: string;
  createdAt: string;
  /** Last server message visible at send time; null means before the first. */
  afterMessageId?: string | null;
  deliveryState: OutboundDeliveryState;
  error?: string;
}

export type OptimisticMessageAction =
  | { type: "enqueue"; message: PendingOutboundMessage }
  | {
      type: "set-delivery";
      clientMessageId: string;
      deliveryState: OutboundDeliveryState;
      error?: string;
    }
  | { type: "transport-ready"; ready: boolean }
  | { type: "acknowledge"; clientMessageIds: ReadonlySet<string> }
  | { type: "reset" };

/**
 * Local-only delivery reducer. Realtime conversation state remains fully
 * server-authoritative; this lane exists solely to make an outbound user
 * message visible before its item/* receipt arrives.
 */
export function optimisticMessageReducer(
  state: PendingOutboundMessage[],
  action: OptimisticMessageAction,
): PendingOutboundMessage[] {
  switch (action.type) {
    case "enqueue": {
      const existingIndex = state.findIndex(
        (message) => message.clientMessageId === action.message.clientMessageId,
      );
      if (existingIndex === -1) return [...state, action.message];
      const next = [...state];
      next[existingIndex] = action.message;
      return next;
    }
    case "set-delivery":
      return state.map((message) =>
        message.clientMessageId === action.clientMessageId
          ? {
              ...message,
              deliveryState: action.deliveryState,
              ...(action.error
                ? { error: action.error }
                : { error: undefined }),
            }
          : message,
      );
    case "transport-ready":
      return state.map((message) => {
        if (message.deliveryState === "failed") return message;
        const deliveryState: OutboundDeliveryState = action.ready
          ? "sending"
          : "queued";
        return message.deliveryState === deliveryState
          ? message
          : { ...message, deliveryState };
      });
    case "acknowledge": {
      if (action.clientMessageIds.size === 0) return state;
      const next = state.filter(
        (message) => !action.clientMessageIds.has(message.clientMessageId),
      );
      // `filter` allocates even when it drops nothing, and acknowledge fires on
      // every server message batch — so returning it unconditionally hands the
      // list a new reference on each tick long after the queue has drained.
      // Match the identity discipline the other cases already keep.
      return next.length === state.length ? state : next;
    }
    case "reset":
      return state.length === 0 ? state : [];
  }
}

function messageClientId(message: Message): string | null {
  return message.type === "human" && typeof message.id === "string"
    ? message.id
    : null;
}

export function acknowledgedClientMessageIds(
  messages: readonly Message[],
): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.type !== "human") continue;
    const clientMessageId = messageClientId(message);
    if (clientMessageId) ids.add(clientMessageId);
  }
  return ids;
}

function optimisticAttachments(message: PromptInputMessage) {
  return message.files.map((part) => ({
    filename: part.filename,
    mediaType: part.mediaType,
    url: part.url,
    ...(part.uploaded?.artifact_url
      ? { artifact_url: part.uploaded.artifact_url }
      : {}),
  }));
}

function optimisticFiles(message: PromptInputMessage) {
  return message.files
    .filter((part) => !part.mediaType.toLowerCase().startsWith("image/"))
    .map((part) => ({
      filename: part.filename,
      size: part.uploaded?.size ?? part.file?.size ?? 0,
      ...(part.uploaded?.virtual_path || part.uploaded?.path
        ? { path: part.uploaded.virtual_path || part.uploaded.path }
        : {}),
      status: part.uploaded ? ("uploaded" as const) : ("uploading" as const),
    }));
}

export function pendingOutboundToHumanMessage(
  pending: PendingOutboundMessage,
): HumanMessage {
  const attachments = optimisticAttachments(pending.message);
  const files = optimisticFiles(pending.message);
  return {
    id: pending.clientMessageId,
    type: "human",
    content: pending.displayText,
    additional_kwargs: {
      delivery_state: pending.deliveryState,
      retryable: pending.deliveryState === "failed",
      thread_id: pending.threadId,
      created_at: pending.createdAt,
      ...(pending.error ? { delivery_error: pending.error } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(files.length > 0 ? { files } : {}),
    },
  };
}

/**
 * Server messages win as soon as their stable client item id is observed.
 * Keeping the same React key lets the optimistic bubble become the canonical
 * server bubble without a duplicate row or a visual jump.
 */
export function mergeOptimisticHumanMessages(
  serverMessages: Message[],
  pendingMessages: readonly PendingOutboundMessage[],
): Message[] {
  if (pendingMessages.length === 0) return serverMessages;
  const acknowledged = acknowledgedClientMessageIds(serverMessages);
  const pending = pendingMessages.filter(
    (message) => !acknowledged.has(message.clientMessageId),
  );
  if (pending.length === 0) return serverMessages;
  // Failed sends are local history too. Appending them on every update made
  // old errors follow the newest answer forever, even after a later retry.
  const positions = new Map(
    serverMessages.map((message, index) => [message.id, index]),
  );
  const slots = new Map<number, Message[]>();
  for (const message of pending) {
    const anchor = message.afterMessageId;
    const position =
      anchor === null
        ? 0
        : anchor === undefined
          ? serverMessages.length
          : (positions.get(anchor) ?? -1) + 1;
    const slot = slots.get(position) ?? [];
    slot.push(pendingOutboundToHumanMessage(message));
    slots.set(position, slot);
  }
  const merged: Message[] = [...(slots.get(0) ?? [])];
  serverMessages.forEach((message, index) => {
    merged.push(message, ...(slots.get(index + 1) ?? []));
  });
  return merged;
}

export function newClientMessageId(candidate?: string): string {
  // Keep the optimistic receipt coordinate only when the backend can accept
  // it as TurnParams.userItemId (8..96 chars in the itm_ namespace).
  if (candidate && candidate.length >= 8 && candidate.length <= 96 && /^itm_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(candidate)) return candidate;
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `itm_user_${suffix}`;
}
