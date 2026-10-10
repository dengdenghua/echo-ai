import { useCallback, useEffect, useMemo } from "react";

import { workspaceFocusTabFromEvents } from "@/components/workspace/agent-workbench-panel";
import { screenBlocksForAgent } from "@/components/workspace/agent-workbench-snapshot";
import {
  FINAL_DELIVERABLE_PATTERN,
  finalOutputArtifactEntries,
} from "@/components/workspace/agent-workbench-utils";
import { convertToSteps } from "@/components/workspace/messages/message-group";
import { extractResultUrl } from "@/components/workspace/messages/message-output-summary";
import {
  latestPersistedTodoEventsFromMessages,
  restoredTodoEventsForDisplay,
} from "@/components/workspace/persisted-tool-events";
import { buildReplayFromBlocks } from "@/components/workspace/replay-from-blocks";
import {
  toWorkBlocks,
  workBlockLabelsFromShape,
} from "@/components/workspace/work-blocks";
import type { Message } from "@/core/api/types";
import { eventBus, type ThreadAttentionSignal } from "@/core/events";
import {
  assistantAnswerRequestsUserInput,
  extractContentFromMessage,
  extractTextFromMessage,
  isAssistantStopTerminalState,
  isSettledAssistantAnswer,
  latestAssistantTerminalState,
} from "@/core/messages/utils";
import { usePetAgentEvents } from "@/core/pet/use-pet-agent-events";
import { classifyPauseRequest } from "@/core/notification/attention";
import { buildReplayHtml } from "@/core/sharing/replay-html";
import { downloadTextFile, shareSlug } from "@/core/sharing/download";
import type { useTasks } from "@/core/tasks/hooks";
import { buildProgressOutline } from "@/core/threads/progress-outline";
import { liveEventIsReportLike } from "@/core/threads/report-deliverable";

import { latestArtifactFocusPathFromEvents } from "./page-utils";
import type {
  RealtimeThread,
  RealtimeToolEvents,
  RealtimeTranslations,
} from "./realtime-page-types";
import {
  collectConversationUserInput,
  latestTurnPreviewBlocks,
  messagesSinceLastHuman,
} from "./realtime-turn-utils";

export type SidebarRunState = "running" | "waiting" | "error" | null;

/** Projections of the current turn: previews, result URL, user input, outline. */
export function useLastTurnView(messages: Message[]) {
  const previewBlocks = useMemo(
    () => latestTurnPreviewBlocks(messages),
    [messages],
  );

  // Deployed preview URL (vercel/netlify/localhost/etc.) — when present and
  // no inline html blocks exist, we still treat the task as a "frontend
  // task" and auto-switch the workbench to the browser preview tab on
  // completion. The URL is also forwarded to LivePreviewPanel so it can
  // render the deployed site instead of falling back to srcDoc.
  // Only the current turn is scanned (messages after the last human message).
  const lastTurnMessages = useMemo(
    () => messagesSinceLastHuman(messages),
    [messages],
  );
  const lastTurnUserInput = useMemo(
    () => collectConversationUserInput(messages),
    [messages],
  );

  // A deploy URL from an earlier turn must not hijack every later completion.
  const resultPreviewUrl = useMemo(() => {
    return extractResultUrl(lastTurnMessages);
  }, [lastTurnMessages]);
  // 侧边栏「进展」面板的叙事大纲：按 iteration 分组（意图/执行计数/事实）。
  const progressOutline = useMemo(
    () => buildProgressOutline(convertToSteps(lastTurnMessages)),
    [lastTurnMessages],
  );
  return {
    previewBlocks,
    lastTurnMessages,
    lastTurnUserInput,
    resultPreviewUrl,
    progressOutline,
  };
}

/**
 * The tool events the workbench and composer show for this turn (live events
 * plus restored todo state), and the replay export built from them.
 */
export function useAgentDisplayEvents({
  thread,
  lastTurnToolEvents,
  allToolEvents,
  lastTurnMessages,
  focusedWorkbenchTurnIndex,
  initialPrompt,
  t,
}: {
  thread: RealtimeThread;
  lastTurnToolEvents: RealtimeToolEvents;
  allToolEvents: RealtimeToolEvents;
  lastTurnMessages: Message[];
  focusedWorkbenchTurnIndex: number | null;
  initialPrompt: string;
  t: RealtimeTranslations;
}) {
  const latestPersistedTodoEvents = useMemo(
    () => latestPersistedTodoEventsFromMessages(lastTurnMessages),
    [lastTurnMessages],
  );
  const restoredTodoEvents = useMemo(
    () =>
      restoredTodoEventsForDisplay({
        isLoading: thread.isLoading,
        lastTurnToolEvents,
        latestPersistedTodoEvents,
      }),
    [lastTurnToolEvents, latestPersistedTodoEvents, thread.isLoading],
  );
  const agentDisplayEvents = useMemo(
    () => [...lastTurnToolEvents, ...restoredTodoEvents],
    [lastTurnToolEvents, restoredTodoEvents],
  );
  const workbenchDisplayEvents = useMemo(() => {
    if (focusedWorkbenchTurnIndex === null) return agentDisplayEvents;
    return allToolEvents.filter(
      (event) => event.turnIndex === focusedWorkbenchTurnIndex,
    );
  }, [agentDisplayEvents, allToolEvents, focusedWorkbenchTurnIndex]);
  const latestWorkspaceFocusTab = useMemo(
    () => workspaceFocusTabFromEvents(agentDisplayEvents),
    [agentDisplayEvents],
  );
  // Self-contained replay export, surfaced from the unified share menu.
  const replayBlocks = useMemo(
    () => screenBlocksForAgent(toWorkBlocks(agentDisplayEvents), null),
    [agentDisplayEvents],
  );
  const handleExportReplay = useCallback(() => {
    if (replayBlocks.length === 0) return;
    const title =
      thread?.values?.title || initialPrompt || t.realtime.replay.titleDefault;
    const html = buildReplayHtml(
      buildReplayFromBlocks(
        replayBlocks,
        {
          title,
          brand: "Echo · EchoOS",
          footer: `${new Date().toLocaleDateString()} · ${t.realtime.replay.footer}`,
        },
        workBlockLabelsFromShape(
          (t as unknown as { workBlocks?: unknown }).workBlocks,
        ),
      ),
    );
    downloadTextFile(html, `echo-replay-${shareSlug(title)}.html`);
  }, [replayBlocks, thread, initialPrompt, t]);
  const latestArtifactFocusPath = useMemo(
    () => latestArtifactFocusPathFromEvents(agentDisplayEvents),
    [agentDisplayEvents],
  );
  return {
    agentDisplayEvents,
    workbenchDisplayEvents,
    latestWorkspaceFocusTab,
    replayBlocks,
    handleExportReplay,
    latestArtifactFocusPath,
  };
}

interface AgentRunStateInput {
  threadId: string;
  isLoading: boolean;
  error: RealtimeThread["error"];
  streamingMessage: RealtimeThread["streamingMessage"];
  lastTurnToolEvents: RealtimeToolEvents;
  agentDisplayEvents: RealtimeToolEvents;
  lastTurnMessages: Message[];
  tasksData: ReturnType<typeof useTasks>["data"];
}

/**
 * Whether the current turn is running, waiting, blocked, interrupted,
 * settled with an answer/deliverable, or failed — and the sidebar badge.
 */
export function useAgentRunState({
  threadId,
  isLoading,
  error,
  streamingMessage,
  lastTurnToolEvents,
  agentDisplayEvents,
  lastTurnMessages,
  tasksData,
}: AgentRunStateInput) {
  const hasRunningAgentEvents = lastTurnToolEvents.some(
    (event) =>
      event.status === "running" || event.status === "waiting_approval",
  );
  const hasActiveBackgroundTask = (tasksData?.active ?? []).some(
    (task) => task.thread_id === threadId,
  );
  const hasPausedBackgroundTask = (tasksData?.paused ?? []).some(
    (task) => task.thread_id === threadId,
  );
  const hasPendingBackgroundTask = (tasksData?.pending ?? []).some(
    (task) => task.thread_id === threadId,
  );
  const hasPausedOrPendingBackgroundTask =
    hasPausedBackgroundTask || hasPendingBackgroundTask;
  const backgroundPauseRequest = useMemo(
    () =>
      [...(tasksData?.paused ?? []), ...(tasksData?.pending ?? [])].find(
        (request) => request.thread_id === threadId,
      ) ?? null,
    [tasksData?.paused, tasksData?.pending, threadId],
  );
  const requiresReportDeliverable = useMemo(
    () =>
      agentDisplayEvents.some((event) => {
        // The stream mapping layer precomputes this flag once per event —
        // consuming it avoids re-stringifying payloads on every render.
        // undefined means the event bypassed that layer (e.g. restored
        // todo events), so fall back to matching here.
        if (event.isReportLike !== undefined) return event.isReportLike;
        return liveEventIsReportLike(event);
      }),
    [agentDisplayEvents],
  );
  const hasReportArtifact = useMemo(
    () =>
      lastTurnMessages.some(
        (message) =>
          isSettledAssistantAnswer(message, { allowToolCalls: true }) &&
          FINAL_DELIVERABLE_PATTERN.test(
            extractTextFromMessage(message) ||
              extractContentFromMessage(message),
          ),
      ),
    [lastTurnMessages],
  );
  const finalArtifactEntries = useMemo(
    () => finalOutputArtifactEntries(agentDisplayEvents),
    [agentDisplayEvents],
  );
  const hasFinalArtifact = finalArtifactEntries.length > 0;
  const lastTurnTerminalState = useMemo(
    () => latestAssistantTerminalState(lastTurnMessages),
    [lastTurnMessages],
  );
  const agentRunInterrupted = isAssistantStopTerminalState(
    lastTurnTerminalState,
  );
  const agentRunPaused = lastTurnTerminalState === "paused";
  const legacyBlockedOnUser = useMemo(
    () =>
      lastTurnTerminalState === null &&
      assistantAnswerRequestsUserInput(lastTurnMessages),
    [lastTurnMessages, lastTurnTerminalState],
  );
  const agentRunBlocked =
    lastTurnTerminalState === "blocked" || legacyBlockedOnUser;
  const hasAgentAnswer = useMemo(
    () =>
      lastTurnTerminalState === null &&
      !agentRunBlocked &&
      (hasFinalArtifact ||
        lastTurnMessages.some((message) =>
          // Realtime history folds a completed tool call and the concise
          // final answer into the same AI message. Tool presence therefore
          // cannot mean "still running" once the message is explicitly an
          // answer; commentary/streaming metadata is already rejected by the
          // helper. A short two-line answer is still a valid terminal answer.
          isSettledAssistantAnswer(message, { allowToolCalls: true }),
        )),
    [
      agentRunBlocked,
      hasFinalArtifact,
      lastTurnMessages,
      lastTurnTerminalState,
    ],
  );
  const canSettleStaleLiveEvents =
    !isLoading &&
    (!error || hasFinalArtifact) &&
    hasAgentAnswer &&
    (!requiresReportDeliverable || hasReportArtifact || hasFinalArtifact);
  const agentRunSettled =
    (lastTurnMessages.length > 0 || agentDisplayEvents.length > 0) &&
    !isLoading &&
    (!hasRunningAgentEvents ||
      canSettleStaleLiveEvents ||
      lastTurnTerminalState !== null ||
      agentRunBlocked) &&
    !hasActiveBackgroundTask &&
    (!hasPausedOrPendingBackgroundTask || agentRunPaused);
  const hasCompletedAgentOutput =
    hasAgentAnswer &&
    lastTurnTerminalState === null &&
    !agentRunBlocked &&
    (!error || hasFinalArtifact) &&
    agentRunSettled &&
    (!requiresReportDeliverable || hasReportArtifact || hasFinalArtifact);
  const agentRunFailed =
    agentRunSettled &&
    !agentRunInterrupted &&
    !agentRunBlocked &&
    !hasCompletedAgentOutput &&
    !hasPausedOrPendingBackgroundTask;
  const sidebarRunState = useMemo<SidebarRunState>(() => {
    if (hasPausedOrPendingBackgroundTask) return "waiting";
    if (agentRunInterrupted) return null;
    if (agentRunBlocked) return "waiting";
    if (agentRunFailed || (error && !isLoading)) return "error";
    if (agentRunSettled) return null;
    if (
      agentDisplayEvents.some((event) => event.status === "waiting_approval")
    ) {
      return "waiting";
    }
    if (
      hasActiveBackgroundTask ||
      isLoading ||
      Boolean(streamingMessage) ||
      agentDisplayEvents.some((event) => event.status === "running")
    ) {
      return "running";
    }
    return null;
  }, [
    agentDisplayEvents,
    agentRunInterrupted,
    agentRunBlocked,
    agentRunFailed,
    agentRunSettled,
    hasActiveBackgroundTask,
    hasPausedOrPendingBackgroundTask,
    error,
    isLoading,
    streamingMessage,
  ]);
  // Why the thread waits, for the attention notifier and the sidebar label.
  // Same precedence as ``sidebarRunState``'s waiting branches; kept as
  // primitives so the published object only changes when the cause does.
  const waitingOnApproval = useMemo(
    () =>
      agentDisplayEvents.some((event) => event.status === "waiting_approval"),
    [agentDisplayEvents],
  );
  const pauseSignal = backgroundPauseRequest
    ? (classifyPauseRequest(backgroundPauseRequest) ?? {
        kind: "paused" as const,
        reason: "user" as const,
      })
    : null;
  const attentionKind: ThreadAttentionSignal["kind"] | null =
    sidebarRunState !== "waiting"
      ? null
      : (pauseSignal?.kind ??
        (agentRunBlocked
          ? "blocked"
          : waitingOnApproval
            ? "approval"
            : "paused"));
  const attentionReason = attentionKind ? pauseSignal?.reason : undefined;
  const sidebarAttention = useMemo<ThreadAttentionSignal | null>(
    () =>
      attentionKind ? { kind: attentionKind, reason: attentionReason } : null,
    [attentionKind, attentionReason],
  );
  return {
    hasPausedOrPendingBackgroundTask,
    hasReportArtifact,
    finalArtifactEntries,
    hasFinalArtifact,
    agentRunInterrupted,
    agentRunBlocked,
    agentRunSettled,
    hasCompletedAgentOutput,
    agentRunFailed,
    sidebarRunState,
    sidebarAttention,
  };
}

/**
 * Publishes the run state to the sidebar thread list, the attention notifier
 * and the desktop pet; the sidebar badge is cleared again when this thread
 * view goes away.
 */
export function useSidebarRunStatus({
  sidebarThreadId,
  threadRouteFor,
  sidebarRunState,
  sidebarAttention = null,
  agentRunSettled,
  agentRunFailed,
  hasCompletedAgentOutput,
  thread,
}: {
  sidebarThreadId: string;
  threadRouteFor: (id: string) => string;
  sidebarRunState: SidebarRunState;
  sidebarAttention?: ThreadAttentionSignal | null;
  agentRunSettled: boolean;
  agentRunFailed: boolean;
  hasCompletedAgentOutput: boolean;
  thread: Pick<RealtimeThread, "streamingMessage" | "values">;
}) {
  const streaming = Boolean(thread.streamingMessage);
  const threadTitle = thread.values?.title;
  // Forward the derived run state to the Godot desktop pet (no-op in browser).
  // The in-page sprite pet was removed — the desktop sidecar is the only pet
  // now, so the returned mood is unused and the call is kept for its effect.
  usePetAgentEvents({
    runState: sidebarRunState,
    settled: agentRunSettled,
    failed: agentRunFailed,
    streaming,
  });
  const runStatus =
    hasCompletedAgentOutput && !agentRunFailed ? "done" : sidebarRunState;
  useEffect(() => {
    eventBus.emit("thread:run-status", {
      href: threadRouteFor(sidebarThreadId),
      state: runStatus,
      threadId: sidebarThreadId,
      attention: sidebarAttention,
      title: threadTitle,
    });
  }, [
    runStatus,
    sidebarAttention,
    sidebarThreadId,
    threadRouteFor,
    threadTitle,
  ]);
  // Clear only when this thread view goes away (unmount / thread switch).
  // Clearing on every state change made each transition look like the page
  // detaching and re-attaching, which hides the transition itself from the
  // attention notifier.
  useEffect(() => {
    const href = threadRouteFor(sidebarThreadId);
    return () => {
      eventBus.emit("thread:run-status", {
        href,
        state: null,
        threadId: sidebarThreadId,
      });
    };
  }, [sidebarThreadId, threadRouteFor]);
}
