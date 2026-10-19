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
