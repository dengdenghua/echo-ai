// Message builders for the realtime adapter (``realtime-adapter.ts``):
// terminal turn receipts (paused/cancelled/interrupted/failed), grounding
// attachment, tool-call timeline coordinates and user/error messages.
// Internal to the adapter.

import type {
  AIMessage,
  HumanMessage,
  Message,
  ToolCall,
} from "@/core/api/types";
import { isPrivateAgentGroundingSource } from "@/core/realtime/items";
import { sanitizeLegacyGuardDiagnostic } from "@/core/messages/utils";

import type {
  ErrorItem,
  GroundingSource,
  Item,
  Turn,
  UserMessageItem,
} from "@/core/realtime/items";

import {
  failedVerificationMessage,
  safeTurnItems,
} from "./realtime-adapter-turn-items";

export function appendPausedTurnReceipt(out: Message[], turn: Turn): void {
  if (turn.status !== "paused") return;
  if (
    out.some(
      (message) =>
        message.type === "ai" &&
        message.additional_kwargs?.response_state === "paused",
    )
  ) {
    return;
  }
  out.push({
    id: `${turn.id}-paused-receipt`,
    type: "ai",
    content: "",
    additional_kwargs: {
      response_state: "paused",
      message_kind: "answer",
      interrupt_reason: turn.interruptReason,
      outcome_reason: turn.outcomeReason,
      objective_id: turn.objectiveId,
      task_id: turn.taskId,
      checkpoint_id: turn.checkpointId,
    },
  });
}

export function appendCancelledTurnReceipt(out: Message[], turn: Turn): void {
  if (turn.status !== "cancelled") return;
  if (
    out.some(
      (message) =>
        message.type === "ai" &&
        message.additional_kwargs?.response_state === "cancelled",
    )
  ) {
    return;
  }
  out.push({
    id: `${turn.id}-cancelled-receipt`,
    type: "ai",
    content: "",
    additional_kwargs: {
      response_state: "cancelled",
      message_kind: "answer",
      interrupt_reason: turn.interruptReason,
    },
  });
}

/**
 * Preserve an assistant-owned terminal frame even when a turn is cancelled
 * before the provider emits its first reasoning or answer item. Without this
 * synthetic receipt, the transcript ends at the user's prompt: there is no
 * avatar, no interruption explanation, and no visible recovery affordance.
 */
export function appendInterruptedTurnReceipt(out: Message[], turn: Turn): void {
  if (turn.status !== "interrupted") return;
  if (
    out.some(
      (message) =>
        message.type === "ai" &&
        message.additional_kwargs?.response_state === "interrupted",
    )
  ) {
    return;
  }

  pushSyntheticInterruptedReceipt(out, turn);
}

function pushSyntheticInterruptedReceipt(out: Message[], turn: Turn): void {
  const additionalKwargs: Record<string, unknown> = {
    response_state: "interrupted",
    message_kind: "answer",
  };
  if (turn.interruptReason) {
    additionalKwargs.interrupt_reason = turn.interruptReason;
  }
  out.push({
    id: `${turn.id}-interrupted-receipt`,
    type: "ai",
    content: "",
    additional_kwargs: additionalKwargs,
  });
}

export function appendFailedTurnReceipt(out: Message[], turn: Turn): void {
  if (turn.status !== "failed") return;
  if (
    out.some(
      (message) =>
        message.type === "ai" &&
        typeof message.additional_kwargs?.error === "object" &&
        message.additional_kwargs.error !== null,
    )
  ) {
    return;
  }

  const verificationMessage = failedVerificationMessage(turn);
  const turnError =
    turn.error && typeof turn.error === "object" ? turn.error : null;
  const turnErrorMessage =
    typeof turnError?.message === "string" ? turnError.message.trim() : "";
  const turnErrorCode =
    typeof turnError?.code === "string" ? turnError.code.trim() : "";
  const disposition =
    typeof turnError?.disposition === "string" ? turnError.disposition : "";
  const failureKind =
    typeof turnError?.failure_kind === "string" ? turnError.failure_kind : "";
  const blockedOnUser = disposition === "blocked_on_user";
  const message = sanitizeLegacyGuardDiagnostic(
    verificationMessage || turnErrorMessage || "turn failed",
  );
  const verificationRequired = safeTurnItems(turn).some(
    (item) =>
      item.type === "verification" &&
      item.status === "failed" &&
      /verification required/i.test(item.command),
  );
  const code = verificationMessage
    ? verificationRequired
      ? "verification_required"
      : "verification_failed"
    : turnErrorCode || "turn_failed";

  out.push({
    id: `${turn.id}:failure-receipt`,
    type: "ai",
    content: "",
    additional_kwargs: {
      response_state: blockedOnUser ? "blocked" : "failed",
      error: {
        message,
        will_retry: false,
        info: {
          code,
          ...(disposition ? { disposition } : {}),
          ...(failureKind ? { failure_kind: failureKind } : {}),
        },
      },
    },
  });
}

export function toolCallTimelineCoordinates(
  item: Item,
): Pick<ToolCall, "timelineSequence" | "parentItemId" | "phaseId"> {
  return {
    timelineSequence: item.timelineSequence ?? null,
    parentItemId: item.parentItemId ?? null,
    phaseId: item.phaseId ?? null,
  };
}

// Fold the turn's codebase grounding (project docs/chunks it was grounded on)
// onto the first public checkpoint, which is the earliest conversational beat
// that can truthfully acknowledge those sources. This is structural: it does
// not classify prose into a hard-coded orient/investigate/synthesize ladder.
// Turns without public progress keep the legacy final-answer fallback.
export function attachGroundingToNarrativeAnchor(
  messages: Message[],
  grounding: GroundingSource[] | undefined,
): void {
  const safeGrounding = grounding?.filter(
    (source) => !isPrivateAgentGroundingSource(source),
  );
  if (!safeGrounding || safeGrounding.length === 0) return;
  let fallbackIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.type !== "ai") continue;
    fallbackIndex = index;
    if (message.additional_kwargs?.public_progress === true) {
      fallbackIndex = index;
      break;
    }
  }
  if (fallbackIndex < 0) return;
  const anchor = messages[fallbackIndex];
  if (!anchor || anchor.type !== "ai") return;
  // Copy-on-write: the message object may be an identity-cached one shared
  // with a previous mapping; mutating it would hide the change from React.memo.
  messages[fallbackIndex] = {
    ...anchor,
    additional_kwargs: {
      ...(anchor.additional_kwargs ?? {}),
      grounding: safeGrounding,
    },
  };
}

export function userMessageToHuman(item: UserMessageItem): HumanMessage {
  return {
    type: "human",
    id: item.id,
    content: item.text,
    additional_kwargs: {
      ...(item.attachments && item.attachments.length > 0
        ? { attachments: item.attachments }
        : {}),
      created_at: item.createdAt,
    },
  };
}

export function errorToAi(item: ErrorItem): AIMessage {
  const message = sanitizeLegacyGuardDiagnostic(item.message || "turn failed");
  return {
    type: "ai",
    id: item.id,
    // Error details belong to the terminal receipt rendered after the turn's
    // chronological work lane. Keeping this synthetic message body empty
    // prevents a failure sentence from appearing before tool events merely
    // because an agentMessage item was opened earlier in the stream.
    content: "",
    additional_kwargs: {
      error: {
        message,
        will_retry: item.willRetry,
        info: item.errorInfo,
      },
    },
  };
}
