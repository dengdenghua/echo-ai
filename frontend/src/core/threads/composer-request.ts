import { eventBus } from "@/core/events/event-bus";
import { isRecord } from "@/core/utils/guards";
import { newClientMessageId } from "./optimistic-messages";

export const MESSAGE_CONFIRMED_EVENT = "echo:message-confirmed";
export type ComposerRequestResult = "confirmed" | "failed" | "unknown";

/** Only persisted conversation items confirm a collaboration action. */
export function submitComposerRequest(
  threadId: string | undefined,
  text: string,
) {
  return new Promise<ComposerRequestResult>((resolve) => {
    if (!threadId || !eventBus.listenerCount("composer:submit-request")) {
      resolve("failed");
      return;
    }
    const clientMessageId = newClientMessageId();
    let settled = false;
    const finish = (result: ComposerRequestResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener(MESSAGE_CONFIRMED_EVENT, confirmed);
      window.removeEventListener("echo:send-failed", failed);
      eventBus.emit("composer:request-settled", {
        threadId,
        clientMessageId,
        result,
      });
      resolve(result);
    };
    const matches = (event: Event) => {
      const detail: unknown =
        event instanceof CustomEvent ? event.detail : null;
      return (
        isRecord(detail) &&
        detail.threadId === threadId &&
        detail.clientMessageId === clientMessageId
      );
    };
    const confirmed = (event: Event) => {
      if (matches(event)) finish("confirmed");
    };
    const failed = (event: Event) => {
      if (matches(event)) finish("failed");
    };
    const timer = window.setTimeout(() => finish("unknown"), 30_000);
    window.addEventListener(MESSAGE_CONFIRMED_EVENT, confirmed);
    window.addEventListener("echo:send-failed", failed);
    eventBus.emit("composer:submit-request", {
      threadId,
      text,
      clientMessageId,
      onResult: finish,
    });
  });
}
