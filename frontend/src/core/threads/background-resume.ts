import type { Message } from "@/core/api/types";
import { composerActionsCopy } from "@/core/i18n/locales/composer-actions";

const resumePrompts = new Set(
  ["zh-CN", "en-US", "ja-JP", "ko-KR"].map(
    (locale) => composerActionsCopy(locale).resumePrompt,
  ),
);

export function isBackgroundResumePrompt(text: string): boolean {
  return resumePrompts.has(text.trim());
}

/** Keep receipts/history for delivery and model context; hide only generated UI sends. */
export function backgroundResumeMessageId(): string {
  return `ui-resume-${crypto.randomUUID()}`;
}

export function visibleConversationMessages(
  messages: Message[],
  _resumeLabel: string,
): Message[] {
  return messages.filter((message) => {
    if (message.type !== "human") return true;
    // Keep the durable send/receipt intact, including failed delivery, but never
    // turn an internal continuation into a chat bubble. Recognize the exact
    // generated prompts from older releases that did not mark their item ids.
    return (
      !message.id?.startsWith("ui-resume-") &&
      !(
        typeof message.content === "string" &&
        isBackgroundResumePrompt(message.content)
      )
    );
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
