import type { Message } from "@/core/api/types";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import {
  RETRY_PENDING_MESSAGE_EVENT,
  type OutboundDeliveryState,
} from "@/core/threads/optimistic-messages";
import { cn } from "@/lib/utils";

export function outboundDeliveryState(
  message: Message,
): OutboundDeliveryState | null {
  if (message.type !== "human") return null;
  const state = message.additional_kwargs?.delivery_state;
  return state === "queued" || state === "sending" || state === "failed"
    ? state
    : null;
}

export function HumanMessageDeliveryStatus({
  message,
  threadId,
}: {
  message: Message;
  threadId?: string | null;
}) {
  const { t } = useI18n();
  const state = outboundDeliveryState(message);
  if (!state) return null;
  const clientMessageId = message.id;
  const canRetry =
    state === "failed" &&
    typeof clientMessageId === "string" &&
    clientMessageId.length > 0;
  const label =
    state === "queued"
      ? t.conversation.messageQueued
      : state === "sending"
        ? t.conversation.messageSending
        : t.conversation.messageSendFailed;
  const error = message.additional_kwargs?.delivery_error;
  return (
    <div
      className={cn(
        "mt-1 flex items-center justify-end gap-1.5 text-xs leading-4",
        state === "failed" ? "text-destructive/80" : "text-muted-foreground",
      )}
      data-testid="human-message-delivery-status"
      data-delivery-state={state}
      role="status"
      title={typeof error === "string" ? error : undefined}
    >
      {state === "sending" ? (
        <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
      ) : (
        <span
          className={cn(
            "size-1.5 rounded-full",
            state === "failed" ? "bg-destructive/70" : "bg-current/45",
          )}
          aria-hidden="true"
        />
      )}
      <span>{label}</span>
      {canRetry ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
          data-testid="retry-pending-message"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent(RETRY_PENDING_MESSAGE_EVENT, {
                detail: { threadId, clientMessageId },
              }),
            );
          }}
        >
          <RefreshCwIcon className="size-3" aria-hidden="true" />
          {t.conversation.retry}
        </button>
      ) : null}
    </div>
  );
}
