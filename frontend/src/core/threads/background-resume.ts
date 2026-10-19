import type { Message } from "@/core/api/types";

/** Keep receipts/history for delivery and model context; hide only generated UI sends. */
export function backgroundResumeMessageId(): string {
  return `ui-resume-${crypto.randomUUID()}`;
}

export function visibleConversationMessages(
  messages: Message[],
  resumeLabel: string,
): Message[] {
  return messages.flatMap((message) => {
    if (message.type !== "human" || !message.id?.startsWith("ui-resume-"))
      return [message];
    // A failed outbound send must retain its retry control without revealing
    // the internal continuation instruction as a user-authored paragraph.
    return message.additional_kwargs?.delivery_state === "failed"
      ? [{ ...message, content: resumeLabel }]
      : [];
  });
}

/** Fork/feedback offsets refer to the full journal, including hidden resumes. */
export function conversationMessageIndexes(
  source: Message[],
  visible: Message[],
): Map<Message, number> {
  const result = new Map<Message, number>();
  const byId = new Map<string, number>();
  source.forEach((message, index) => {
    if (!result.has(message)) result.set(message, index);
    if (message.id && !byId.has(message.id)) byId.set(message.id, index);
  });
  for (const message of visible) {
    const index = message.id ? byId.get(message.id) : undefined;
    if (!result.has(message) && index !== undefined) result.set(message, index);
  }
  return result;
}
