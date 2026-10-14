/**
 * Hooks that keep MessageList's own body about rendering: how long the turn
 * has been silent, sidebar → conversation locating, and which answer can be
 * shadow-reviewed.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { Message } from "@/core/api/types";
import type { BaseStream } from "@/core/api/use-stream-types";
import {
  extractContentFromMessage,
  extractTextFromMessage,
} from "@/core/messages/utils";
import { streamVitalsOf } from "@/core/realtime/stream-vitals";
import type { AgentThreadState } from "@/core/threads";
import {
  findTimelineItemElement,
  getTimelineLinkageState,
  subscribeTimelineLinkage,
  TIMELINE_ITEM_HIGHLIGHT_CLASS,
} from "@/core/threads/timeline-linkage";
import { isRecord } from "@/core/utils/guards";

import { AGENT_WORKBENCH_LOCATE_EVENT } from "../agent-workbench-events";
import type { LiveToolEvent } from "../live-tool-timeline";
import {
  messageClipboardText,
  type ShadowReviewContext,
} from "./message-list-item";
import {
  cssEscape,
  MESSAGE_LIST_STALL_HINT_MS,
  MESSAGE_LIST_TIMEOUT_WARNING_MS,
  streamingMessageProgressKey,
  type TurnLocatorRunState,
} from "./message-list-turns";

/** How the running turn is doing: silence timers, fingerprints and run state. */
export function useTurnActivity({
  thread,
  messagesLength,
  liveToolEvents,
  lastTurnToolEvents,
  completedAgentOutput,
}: {
  thread: BaseStream<AgentThreadState>;
  messagesLength: number;
  liveToolEvents?: LiveToolEvent[];
  lastTurnToolEvents?: LiveToolEvent[];
  completedAgentOutput: boolean;
}) {
  const loadingProgressAtRef = useRef<number | null>(null);
  const [loadingAgeMs, setLoadingAgeMs] = useState(0);

  // Structural fingerprint: changes when the message list topology changes
  // (new messages, new/removed tool events). Used to gate scroll-listener
  // rebuilds — avoids re-attaching listeners on every streaming token.
  const structuralFingerprint = useMemo(() => {
    const liveEvents = [
      ...(liveToolEvents ?? []),
      ...(lastTurnToolEvents ?? []),
    ]
      .map((event) =>
        [event.id, event.name, event.status, event.finishedAt ?? ""].join(":"),
      )
      .join("|");
    return [
      thread.isLoading ? "loading" : "idle",
      thread.streamingMessage?.id ?? "",
      messagesLength,
      liveEvents,
    ].join("::");
  }, [
    lastTurnToolEvents,
    liveToolEvents,
    messagesLength,
    thread.isLoading,
    thread.streamingMessage,
  ]);

  // Content fingerprint: includes the tail of the streaming text so the
  // loading-age timer resets when new content arrives.
  const contentFingerprint = useMemo(() => {
    return [
      structuralFingerprint,
      streamingMessageProgressKey(thread.streamingMessage),
    ].join("::");
  }, [structuralFingerprint, thread.streamingMessage]);
  const hasStreamingAnswer = Boolean(
    thread.streamingMessage &&
    extractContentFromMessage(thread.streamingMessage).trim(),
  );
  const streamVitals = streamVitalsOf(thread);

  // A content delta is progress, so move the silence watermark without
  // restarting the per-turn timer. The previous combined effect tore down
  // and recreated an interval on every token, adding avoidable effect/timer
  // churn to the hottest rendering path.
  useEffect(() => {
    if (!thread.isLoading) return;
    loadingProgressAtRef.current = Date.now();
    setLoadingAgeMs((age) => (age === 0 ? age : 0));
  }, [thread.isLoading, contentFingerprint]);

  useEffect(() => {
    if (!thread.isLoading) {
      loadingProgressAtRef.current = null;
      setLoadingAgeMs(0);
      return;
    }
    loadingProgressAtRef.current ??= Date.now();
    const timer = window.setInterval(() => {
      const progressAt = loadingProgressAtRef.current ?? Date.now();
      setLoadingAgeMs(Date.now() - progressAt);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [thread.isLoading]);

  // Suppress the warning when at least one tool call is still in-progress
  // (e.g. the agent is writing a large file and producing no streaming text;
  // the tool event stays "in_progress" until completion, which is visible
  // in the live-tool timeline even if the text stream is silent).
  const hasActiveTool = (liveToolEvents ?? []).some(
    (e) => e.status === "running" || e.status === "waiting_approval",
  );
  const turnLocatorRunState = useMemo<TurnLocatorRunState>(() => {
    const events = [...(liveToolEvents ?? []), ...(lastTurnToolEvents ?? [])];
    if (completedAgentOutput && !thread.isLoading) return "done";
    if (thread.error && !thread.isLoading) return "error";
    if (events.some((event) => event.status === "waiting_approval")) {
      return "waiting";
    }
    if (
      thread.isLoading ||
      thread.streamingMessage ||
      events.some((event) => event.status === "running")
    ) {
      return "running";
    }
    if (events.some((event) => event.status === "error")) return "error";
    return "done";
  }, [
    lastTurnToolEvents,
    liveToolEvents,
    completedAgentOutput,
    thread.error,
    thread.isLoading,
    thread.streamingMessage,
  ]);
  const showTimeoutWarning =
    thread.isLoading &&
    loadingAgeMs >= MESSAGE_LIST_TIMEOUT_WARNING_MS &&
    !hasActiveTool;
  // Early, neutral "still working" hint for long silences: 5 minutes is far
  // too late for a user watching a dead-quiet stream. The watermark resets on
  // every content delta, so this only fires when the model is truly silent
  // (and no tool is visibly running). While the turn is waiting on its first
  // response, slow or reconnecting, the inline activity lane and the header
  // badge already name that state with the elapsed time; a third banner
  // saying the same thing is noise.
  const inlineLaneNamesSilence =
    streamVitals?.phase === "waiting" ||
    streamVitals?.phase === "slow" ||
    streamVitals?.phase === "disconnected";
  const showStallHint =
    thread.isLoading &&
    !showTimeoutWarning &&
    loadingAgeMs >= MESSAGE_LIST_STALL_HINT_MS &&
    !hasActiveTool &&
    !inlineLaneNamesSilence;

  return {
    structuralFingerprint,
    contentFingerprint,
    hasStreamingAnswer,
    streamVitals,
    loadingAgeMs,
    turnLocatorRunState,
    showTimeoutWarning,
    showStallHint,
  };
}

/** Scroll to and flash a conversation row another panel points at. */
export function useConversationLocate() {
  // 侧边栏 → 对话区联动：共享 linkage store 出现高亮条目时，滚动定位到同一
  // 时间线项并短暂高亮（≤2s）。高亮 class 随 store 的 2s 定时器清除
  // （highlightedTimelineItemId 归零触发本 effect 的清理函数），组件卸载时
  // 也会兜底移除；样式全程仅 CSS transition，无循环动画。两侧共用同一 id，
  // 因此查找时以 "chat" lane 限定只命中对话区行。
  const timelineLinkage = useSyncExternalStore(
    subscribeTimelineLinkage,
    getTimelineLinkageState,
    getTimelineLinkageState,
  );
  useEffect(() => {
    const itemId = timelineLinkage.highlightedTimelineItemId;
    if (!itemId) return;
    let row: HTMLElement | null = null;
    let frame = 0;
    let disposed = false;
    const locate = (): boolean => {
      row = findTimelineItemElement(itemId, "chat");
      if (!row) return false;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add(TIMELINE_ITEM_HIGHLIGHT_CLASS);
      return true;
    };
    // 命中聚合组子项时，MessageGroup 需先在本轮状态更新后渲染子项，首帧
    // 可能定位不到，按帧重试（上限 3 帧 ≈ 50ms，高亮总时长 2s 不受影响）。
    let attempts = 0;
    const retry = () => {
      if (disposed) return;
      if (locate()) return;
      attempts += 1;
      if (attempts < 3) frame = window.requestAnimationFrame(retry);
    };
    if (!locate()) frame = window.requestAnimationFrame(retry);
    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      row?.classList.remove(TIMELINE_ITEM_HIGHLIGHT_CLASS);
    };
  }, [timelineLinkage.highlightedTimelineItemId, timelineLinkage.nonce]);

  useEffect(() => {
    const handleLocate = (event: Event) => {
      const detail: unknown =
        event instanceof CustomEvent ? event.detail : undefined;
      const eventId =
        isRecord(detail) && typeof detail.eventId === "string"
          ? detail.eventId.trim()
          : "";
      if (!eventId) return;
      const row = document.querySelector<HTMLElement>(
        `[data-process-event-id="${cssEscape(eventId)}"]`,
      );
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.animate(
        [
          { backgroundColor: "transparent", boxShadow: "none" },
          {
            backgroundColor:
              "color-mix(in oklch, var(--primary) 12%, transparent)",
            boxShadow:
              "inset 2px 0 0 color-mix(in oklch, var(--primary) 70%, transparent)",
          },
          { backgroundColor: "transparent", boxShadow: "none" },
        ],
        { duration: 1100, easing: "ease-out" },
      );
    };
    window.addEventListener(AGENT_WORKBENCH_LOCATE_EVENT, handleLocate);
    return () =>
      window.removeEventListener(AGENT_WORKBENCH_LOCATE_EVENT, handleLocate);
  }, []);
}

/** The latest settled answer and the context to shadow-review it with. */
export function useShadowReview({
  messages,
  messageIndexByReference,
  lastMessage,
  lastMessageIsLoading,
  currentAgent,
  threadId,
  project,
}: {
  messages: Message[];
  messageIndexByReference: Map<Message, number>;
  lastMessage: Message | undefined;
  lastMessageIsLoading: boolean;
  currentAgent?: { execution_engine?: "echo" | "codex" | "opencode" } | null;
  threadId: string;
  project?: string | null;
}) {
  // Keep this eligibility check aligned with MessageListItem's assistant
  // action bar. Shadow review only appears there, so parsing every historical
  // answer into a context on each streamed frame is pure wasted work.
  const shadowReviewMessage = useMemo(() => {
    if (!lastMessage || lastMessage.type !== "ai" || lastMessageIsLoading) {
      return null;
    }
    const metadata = lastMessage.additional_kwargs;
    if (
      metadata?.message_kind === "commentary" ||
      metadata?.public_progress === true ||
      metadata?.response_state === "interrupted" ||
      metadata?.response_state === "failed" ||
      metadata?.run_status === "streaming"
    ) {
      return null;
    }
    return messageClipboardText(lastMessage).length > 0 ? lastMessage : null;
  }, [lastMessage, lastMessageIsLoading]);
  const shadowReviewGoalMessage = useMemo(() => {
    if (!shadowReviewMessage) return null;
    const messageIndex = messageIndexByReference.get(shadowReviewMessage);
    if (messageIndex === undefined) return null;
    for (let cursor = messageIndex - 1; cursor >= 0; cursor -= 1) {
      const candidate = messages[cursor];
      if (candidate?.type === "human") return candidate;
    }
    return null;
  }, [messageIndexByReference, messages, shadowReviewMessage]);
  const shadowReviewMessageIndex = shadowReviewMessage
    ? messageIndexByReference.get(shadowReviewMessage)
    : undefined;
  const actionableShadowReview = useMemo<
    ShadowReviewContext | undefined
  >(() => {
    if (!shadowReviewMessage || !shadowReviewGoalMessage) return undefined;
    const goal = extractTextFromMessage(shadowReviewGoalMessage).trim();
    const primaryOutput = extractTextFromMessage(shadowReviewMessage).trim();
    if (!goal || !primaryOutput) return undefined;
    const metadata = shadowReviewMessage.additional_kwargs;
    const metadataEngine = metadata?.execution_engine;
    if (
      metadataEngine === "opencode" ||
      (!metadataEngine && currentAgent?.execution_engine === "opencode")
    )
      return undefined;
    const primaryEngine =
      metadataEngine === "codex" || metadataEngine === "echo"
        ? metadataEngine
        : currentAgent?.execution_engine === "codex"
          ? "codex"
          : "echo";
    return {
      goal,
      primaryEngine,
      primaryOutput,
      threadId,
      messageId: String(
        shadowReviewMessage.id ??
          `${threadId}:${shadowReviewMessageIndex ?? messages.length - 1}`,
      ),
      workspacePath: project,
    };
  }, [
    currentAgent?.execution_engine,
    messages.length,
    project,
    shadowReviewGoalMessage,
    shadowReviewMessage,
    shadowReviewMessageIndex,
    threadId,
  ]);

  return { shadowReviewMessage, actionableShadowReview };
}
