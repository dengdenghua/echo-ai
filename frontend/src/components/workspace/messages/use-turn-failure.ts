/**
 * The failure card of the latest turn: whether the turn failed, how to word
 * it, where it mounts and what the retry and audit actions need.
 */
import { useCallback, useMemo } from "react";

import type { Message } from "@/core/api/types";
import type { BaseStream } from "@/core/api/use-stream-types";
import type { Translations } from "@/core/i18n/locales/types";
import {
  engineSelectionFailureMessage,
  executionEngineCopy,
} from "@/core/i18n/locales/execution-engine";
import {
  extractPresentFilesFromMessage,
  hasPresentFiles,
  isSettledAssistantAnswer,
  type MessageGroup as CoreMessageGroup,
} from "@/core/messages/utils";
import type { AgentThreadState } from "@/core/threads";
import { publicExecutionErrorMessage } from "@/core/threads/errors";
import { turnFailureCopy } from "@/core/i18n/locales/turn-failure";
import { isNoModelFailure } from "./model-setup-actions";

import {
  failureKind,
  latestTurnMessages,
  structuredFailureFromMessages,
  type StructuredFailure,
} from "./message-list-failure";
import {
  assistantGroupContainsFailureMessage,
  hasVisibleAssistantText,
  turnMessagesForGroup,
} from "./message-list-turns";
import {
  extractRetryPrompt,
  hasMessageOutputSummary,
  type FailurePresentation,
} from "./message-output-summary";

export function useTurnFailure({
  thread,
  messages,
  groupedMessages,
  t,
  locale,
}: {
  thread: BaseStream<AgentThreadState>;
  messages: Message[];
  groupedMessages: CoreMessageGroup[];
  t: Translations;
  locale: string;
}) {
  // The realtime hook wraps send failures in Error now, but other BaseStream
  // implementations may still surface raw strings — keep accepting both
  // shapes when extracting the message text.
  const rawThreadError: Error | string | undefined = thread.error;
  const threadErrorMessage =
    typeof rawThreadError === "string"
      ? rawThreadError
      : (rawThreadError?.message ?? "");
  const latestStructuredFailure = useMemo(
    () => structuredFailureFromMessages(latestTurnMessages(messages)),
    [messages],
  );
  const latestTurnHasSettledAnswer = useMemo(
    () =>
      latestTurnMessages(messages).some((message) =>
        isSettledAssistantAnswer(message),
      ),
    [messages],
  );
  const presentFailure = useCallback(
    (failure: StructuredFailure): FailurePresentation => {
      const kind = failureKind(
        failure.detail,
        failure.code,
        failure.disposition,
        failure.failure_kind,
      );
      const requiresWorkspaceWrite =
        /Code mode cannot finish this implementation task yet:\s*no successful file write\/edit execution is recorded/i.test(
          failure.detail,
        );
      const hasStructuredReadableDetail =
        Boolean(failure.code) &&
        failure.detail !== "turn failed" &&
        !/^[a-z][a-z0-9_.-]{1,80}$/i.test(failure.detail);
      // Environment / blocked hand-offs surface the readable reason from the
      // backend (``turn.error.message``) verbatim; the i18n strings are only
      // the fallback when no detail came through.
      const message =
        failure.code === "execution_unavailable"
          ? engineSelectionFailureMessage(
              executionEngineCopy(locale),
              failure.engine,
              failure.reason,
              failure.detail,
            )
          : kind === "blocked"
            ? failure.detail !== "turn failed"
              ? failure.detail
              : t.streaming.blockedOnUser
            : kind === "environment"
              ? failure.detail !== "turn failed"
                ? failure.detail
                : t.streaming.environmentBlocked
              : kind === "network"
                ? t.streaming.networkLost
                : kind === "auth"
                  ? t.streaming.modelAuthRequired
                  : kind === "capability"
                    ? t.streaming.subagentCapabilityMismatch
                    : kind === "rate-limit"
                      ? t.streaming.modelRateLimited
                      : kind === "backpressure"
                        ? t.streaming.eventStreamOverloaded
                        : kind === "verification"
                          ? t.streaming.verificationRequired
                          : kind === "verification-failed"
                            ? t.streaming.verificationRunFailed
                            : kind === "guard"
                              ? hasStructuredReadableDetail
                                ? failure.detail
                                : t.streaming.guardBlocked
                              : kind === "lifecycle"
                                ? t.streaming.lifecycleFailed
                                : requiresWorkspaceWrite
                                  ? t.streaming.workspaceWriteRequired
                                  : hasStructuredReadableDetail
                                    ? failure.detail
                                    : t.streaming.turnFailed;
      return {
        ...failure,
        kind,
        message:
          /refusing to clean (?:outside sidecar state_root|unsafe sidecar path|sidecar tree with invalid marker)/i.test(
            failure.detail,
          )
            ? t.streaming.sidecarCleanupBlocked
            : publicExecutionErrorMessage(message, locale),
      };
    },
    [
      t.streaming.blockedOnUser,
      t.streaming.environmentBlocked,
      t.streaming.networkLost,
      t.streaming.modelAuthRequired,
      t.streaming.subagentCapabilityMismatch,
      t.streaming.modelRateLimited,
      t.streaming.eventStreamOverloaded,
      t.streaming.guardBlocked,
      t.streaming.lifecycleFailed,
      t.streaming.turnFailed,
      t.streaming.verificationRequired,
      t.streaming.verificationRunFailed,
      t.streaming.workspaceWriteRequired,
      t.streaming.sidecarCleanupBlocked,
      locale,
    ],
  );
  const failureReceipt = useMemo<FailurePresentation | null>(() => {
    if (!thread.error || thread.isLoading) return null;
    // A provider can finish the visible answer and still close its transport
    // with a late/stale error. Do not contradict an already settled answer
    // with a generic "turn failed" banner. Explicit structured failures keep
    // their receipt because they are authoritative protocol state.
    if (
      latestTurnHasSettledAnswer &&
      !latestStructuredFailure &&
      failureKind(threadErrorMessage) === "error"
    ) {
      return null;
    }
    return presentFailure(
      latestStructuredFailure ?? {
        detail: threadErrorMessage.trim() || "turn failed",
      },
    );
  }, [
    latestStructuredFailure,
    latestTurnHasSettledAnswer,
    presentFailure,
    thread.error,
    thread.isLoading,
    threadErrorMessage,
  ]);
  const isNetworkError = failureReceipt?.kind === "network";
  const isBackpressureError = failureReceipt?.kind === "backpressure";
  // Environment blocks and "needs your input" hand-offs are not agent
  // failures — render them amber, not destructive red.
  // No model at all is a setup step, not a task failure.
  const noModelFailure = isNoModelFailure(failureReceipt);
  const isWarningFailure =
    noModelFailure ||
    isNetworkError ||
    failureReceipt?.kind === "auth" ||
    failureReceipt?.kind === "capability" ||
    failureReceipt?.kind === "rate-limit" ||
    isBackpressureError ||
    failureReceipt?.kind === "environment" ||
    failureReceipt?.kind === "blocked";
  const failureHeaderText = noModelFailure
    ? turnFailureCopy(locale).noModelTitle
    : failureReceipt?.kind === "blocked"
      ? t.streaming.blockedOnUser
      : failureReceipt?.kind === "environment"
        ? t.streaming.environmentBlocked
        : failureReceipt?.kind === "auth"
          ? t.streaming.modelAuthRequiredTitle
          : failureReceipt?.kind === "capability"
            ? t.streaming.subagentCapabilityMismatchTitle
            : failureReceipt?.kind === "rate-limit"
              ? t.streaming.modelRateLimitedTitle
              : isBackpressureError
                ? t.streaming.eventStreamOverloaded
                : isNetworkError
                  ? t.streaming.networkLost
                  : t.message.taskFailed;
  const isVerificationRequiredError = failureReceipt?.kind === "verification";
  const errorBannerText = failureReceipt?.message ?? null;
  const verificationAuditNotice =
    isVerificationRequiredError && errorBannerText ? errorBannerText : null;
  const fallbackRetryPrompt = useMemo(
    () => extractRetryPrompt(latestTurnMessages(messages), messages),
    [messages],
  );

  // Must mirror the exact mount predicate of `groupFailure` below (latest
  // group is a plain assistant group and the thread is idle). Anything looser
  // suppresses the fallback banner while the receipt has no group to mount
  // on, leaving the error text with no visible rendering at all.
  const failureReceiptAttachedToGroup = useMemo(() => {
    if (!failureReceipt || thread.isLoading) return false;
    const latestGroup = groupedMessages[groupedMessages.length - 1];
    if (!latestGroup || latestGroup.type !== "assistant") return false;
    const turnMessages = turnMessagesForGroup(groupedMessages, latestGroup);
    return (
      Boolean(structuredFailureFromMessages(turnMessages)) ||
      !hasVisibleAssistantText(latestGroup) ||
      hasMessageOutputSummary(turnMessages)
    );
  }, [failureReceipt, groupedMessages, thread.isLoading]);
  const failureAlreadyVisibleInAssistantText = useMemo(() => {
    if (!failureReceipt?.detail || thread.isLoading) return false;
    const latestGroup = groupedMessages[groupedMessages.length - 1];
    return latestGroup?.type === "assistant"
      ? assistantGroupContainsFailureMessage(latestGroup, failureReceipt.detail)
      : false;
  }, [failureReceipt, groupedMessages, thread.isLoading]);
  // Mirror the receipt mount rule: the audit actions attach to the last
  // plain assistant group of the latest turn, and receipt content is judged
  // on the whole turn slice — file changes usually live in the processing
  // group's messages, never in the plain assistant group's own.
  const auditNoticeGroupKey = useMemo(() => {
    if (!verificationAuditNotice) return null;
    for (let index = groupedMessages.length - 1; index >= 0; index -= 1) {
      const group = groupedMessages[index]!;
      if (group.type === "human") break;
      if (group.type !== "assistant") continue;
      return hasMessageOutputSummary(
        turnMessagesForGroup(groupedMessages, group),
      )
        ? `${group.type}:${group.id ?? `idx-${index}`}`
        : null;
    }
    return null;
  }, [groupedMessages, verificationAuditNotice]);
  const latestHumanGroupIndex = useMemo(() => {
    for (let index = groupedMessages.length - 1; index >= 0; index -= 1) {
      if (groupedMessages[index]?.type === "human") return index;
    }
    return -1;
  }, [groupedMessages]);
  // "Completed changes" badge on the failure banner: count only files
  // delivered in the failed turn, not the whole thread history.
  const failedCompletedFileCount = useMemo(() => {
    if (!thread.error || thread.isLoading) return 0;
    const turnGroups =
      latestHumanGroupIndex >= 0
        ? groupedMessages.slice(latestHumanGroupIndex)
        : groupedMessages;
    let count = 0;
    for (const group of turnGroups) {
      for (const msg of group.messages) {
        if (hasPresentFiles(msg)) {
          const files = extractPresentFilesFromMessage(msg);
          count += Array.isArray(files) ? files.length : 0;
        }
      }
    }
    return count;
  }, [groupedMessages, latestHumanGroupIndex, thread.error, thread.isLoading]);

  return {
    presentFailure,
    failureReceipt,
    isNetworkError,
    isWarningFailure,
    noModelFailure,
    failureHeaderText,
    errorBannerText,
    verificationAuditNotice,
    fallbackRetryPrompt,
    failureReceiptAttachedToGroup,
    failureAlreadyVisibleInAssistantText,
    auditNoticeGroupKey,
    latestHumanGroupIndex,
    failedCompletedFileCount,
  };
}
