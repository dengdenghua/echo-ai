import { builtinPersonaDisplayName } from "@/core/agents/persona-display";
import { isAIMessage, type AIMessage, type Message } from "@/core/api/types";
import { isRecord } from "@/core/utils/guards";
import type { BaseStream } from "@/core/api/use-stream-types";
import type { ReactNode } from "react";
import { AlertTriangleIcon, Loader2Icon, XCircleIcon } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { useLocalSettings } from "@/core/settings";
import { useI18n } from "@/core/i18n/hooks";
import {
  engineSelectionFailureMessage,
  executionEngineCopy,
} from "@/core/i18n/locales/execution-engine";
import { emitOpenSettings } from "@/core/events/event-bus";
import {
  extractContentFromMessage,
  extractPresentFilesFromMessage,
  extractTextFromMessage,
  groupMessages,
  hasContent,
  hasPresentFiles,
  hasReasoning,
  isSettledAssistantAnswer,
} from "@/core/messages/utils";
import { useRehypeSplitWordsIntoSpans } from "@/core/rehype";
import type { StreamVitals } from "@/core/realtime/stream-vitals";
import { useUpdateSubtask } from "@/core/tasks/context";
import type { AgentThreadState } from "@/core/threads";
import {
  findTimelineItemElement,
  getTimelineLinkageState,
  subscribeTimelineLinkage,
  TIMELINE_ITEM_HIGHLIGHT_CLASS,
} from "@/core/threads/timeline-linkage";
import { cn } from "@/lib/utils";

import { ArtifactFileList } from "../artifacts/artifact-file-list";
import { AGENT_WORKBENCH_LOCATE_EVENT } from "../agent-workbench-events";
import type { LiveToolEvent } from "../live-tool-timeline";
import { PublicThinkingStatus } from "../public-thinking-status";
import { ExecutionEngineBadge } from "../execution-engine-picker";

import { withAgentAvatarVersion } from "@/core/agents/avatar";
import { publicExecutionErrorMessage } from "@/core/threads/errors";
import {
  MemberProfilePopover,
  summarizeAgentCapabilities,
} from "@/components/workspace/member-profile-popover";

import { AgentAvatar } from "./agent-message-header";
import { ClarificationChoiceCard } from "./clarification-choice-card";
import { MarkdownContent } from "./markdown-content";
import { extractClarificationQuestionnaire } from "../clarification-questionnaire";
import { hasVisibleMessageGroupContent, MessageGroup } from "./message-group";
import { latestClarificationToolContent } from "./message-grouping";
import {
  MessageListItem,
  messageClipboardText,
  type MessageListProjectActions,
  type ShadowReviewContext,
} from "./message-list-item";
import {
  type FailurePresentation,
  hasMessageOutputSummary,
  MessageOutputSummary,
  extractRetryPrompt,
} from "./message-output-summary";
import { MessageListSkeleton } from "./skeleton";
import { ParallelSubtasksGrid } from "./parallel-subtasks-grid";
import { SubtaskCard } from "./subtask-card";
import { FollowUpSuggestions } from "./follow-up-suggestions";
import {
  deriveSubagentsFromMessages,
  deriveSubagentMissionFromMessages,
  type InlineSubagentInfo,
} from "./inline-subagent-cards";
import {
  MESSAGE_LIST_DEFAULT_PADDING_BOTTOM,
  MESSAGE_LIST_TIMEOUT_WARNING_MS,
  MESSAGE_LIST_STALL_HINT_MS,
  takeUnseenTaskIds,
  sameTurnMarker,
  EMPTY_AGENT_ROSTER,
  TURN_SCROLL_VIEWPORT_CLASS,
  HISTORY_TURN_KEEP_MOUNTED,
  HistoricalTurnBoundary,
  cssEscape,
  placeTimelineEntries,
  messageCreatedAt,
  partitionMessageGroupsIntoTurns,
  buildTurnMarkers,
  streamingMessageProgressKey,
  cleanIdentityText,
  identityKey,
  agentIdForRosterEntry,
  displayNameForRosterEntry,
  fallbackAgentAvatarUrl,
  buildAgentRosterMap,
  findRosterEntry,
  nearestTurnKeyByViewportCenter,
  getTurnScrollViewport,
  turnMessagesForGroup,
  isLastAssistantGroupOfTurn,
  hasLaterProcessActivity,
  isLatestMessageGroup,
  hasVisibleAssistantText,
  assistantGroupContainsFailureMessage,
} from "./message-list-turns";
import type {
  SubtaskUpdate,
  TurnMarker,
  TurnLocatorRunState,
  MessageListAgentRosterEntry,
  AgentIdentity,
  MessageListTimelineEntry,
  GroupTurnRenderInfo,
} from "./message-list-turns";
import {
  structuredFailureFromMessages,
  latestTurnMessages,
  failureKind,
} from "./message-list-failure";
import type { StructuredFailure } from "./message-list-failure";
import { MemoizedGroup } from "./message-list-group";
import { TurnLocatorRail } from "./turn-locator-rail";

export {
  MESSAGE_LIST_DEFAULT_PADDING_BOTTOM,
  MESSAGE_LIST_FOLLOWUPS_EXTRA_PADDING_BOTTOM,
  MESSAGE_LIST_TIMEOUT_WARNING_MS,
  MESSAGE_LIST_STALL_HINT_MS,
  takeUnseenTaskIds,
  HistoricalTurnBoundary,
  placeTimelineEntries,
  partitionMessageGroupsIntoTurns,
  buildTurnMarkers,
  streamingMessageProgressKey,
  nearestTurnKeyByViewportCenter,
  visibleTurnMarkerWindow,
  turnMarkerKindFromMessages,
  isLatestMessageGroup,
} from "./message-list-turns";
export type {
  TurnMarker,
  MessageTurnSlice,
  MessageListTimelineEntry,
} from "./message-list-turns";
export {
  structuredFailureFromMessages,
  failureKind,
} from "./message-list-failure";

export function MessageList({
  className,
  threadId,
  thread,
  paddingBottom = MESSAGE_LIST_DEFAULT_PADDING_BOTTOM,
  header,
  emptyState,
  footer,
  onOpenArtifact,
  lastTurnToolEvents,
  liveToolEvents,
  allToolEvents,
  currentAgent,
  agentRoster = EMPTY_AGENT_ROSTER,
  completedAgentOutput = false,
  showSenderName = false,
  mode,
  project,
  onSendFollowUp,
  onRetryTask,
  onAuthorizeNetwork,
  authorizingNetworkTier = null,
  onStop,
  isStopping = false,
  projectMessageActions,
  timelineEntries = [],
  allowThreadFork = true,
  showResumeSkeleton = true,
}: {
  className?: string;
  threadId: string;
  thread: BaseStream<AgentThreadState>;
  paddingBottom?: number;
  /** Active chat mode. Used to keep the work-log (tool steps) expanded in
   *  code mode so the thread reads like an IDE, not a chat. */
  mode?: string;
  /** Label each agent message with its name (group-chat / team room). */
  showSenderName?: boolean;
  /** Rendered above the first message — e.g. a "load older turns"
   * banner when the thread resumed with a paginated window. */
  header?: ReactNode;
  /** Rendered only when neither thread nor external timeline has content. */
  emptyState?: ReactNode;
  footer?: ReactNode;
  onOpenArtifact?: (path: string) => void;
  lastTurnToolEvents?: LiveToolEvent[];
  liveToolEvents?: LiveToolEvent[];
  allToolEvents?: LiveToolEvent[];
  completedAgentOutput?: boolean;
  currentAgent?: {
    name: string;
    display_name?: string | null;
    avatar_url?: string | null;
    icon?: string | null;
    execution_engine?: "echo" | "codex" | "opencode";
  } | null;
  agentRoster?: MessageListAgentRosterEntry[];
  /** Project path for ambient suggestions */
  project?: string | null;
  /** Callback when user selects a follow-up suggestion */
  onSendFollowUp?: (prompt: string) => void;
  /** Retry a failed task while preserving its conversation context. */
  onRetryTask?: (prompt: string) => void;
  /** Use the page-level stop controller so every stop entry point shares state. */
  onStop?: () => void | Promise<void>;
  isStopping?: boolean;
  /** Callback when the user authorizes network access from the
   *  environment-blocked banner ("common domains" or "full"). */
  onAuthorizeNetwork?: (tier: "common" | "full") => void;
  authorizingNetworkTier?: "common" | "full" | null;
  /** Quick actions shown on human bubbles in a bound project group. */
  projectMessageActions?: MessageListProjectActions;
  /** Prevent a legacy non-persona owner from being copied into a new thread. */
  allowThreadFork?: boolean;
  /** Room-only messages/cards to merge at thread-group time boundaries. */
  timelineEntries?: readonly MessageListTimelineEntry[];
  /** Show the history skeleton while resuming. A brand-new thread has no
   *  history, so the page turns this off and lets its empty state stand alone. */
  showResumeSkeleton?: boolean;
}) {
  const { t, locale } = useI18n();
  const [settings] = useLocalSettings();
  // Settled group lanes (clarification / present-files) never token-stream:
  // their content arrives complete with the tool result. Keying this stack on
  // the thread-level loading flag flipped plugin identity on every stream
  // start/stop, defeating MarkdownContent's memo and re-parsing those blocks
  // (KaTeX/sanitize) across the history; it also re-armed the word-split
  // streaming animation on already-settled text.
  const settledRehypePlugins = useRehypeSplitWordsIntoSpans(false);
  const updateSubtask = useUpdateSubtask();
  const loadingProgressAtRef = useRef<number | null>(null);
  const [loadingAgeMs, setLoadingAgeMs] = useState(0);
  const threadAgentRoster = Array.isArray(thread.values?.agent_roster)
    ? (thread.values.agent_roster as MessageListAgentRosterEntry[])
    : EMPTY_AGENT_ROSTER;
  // Kept for compatibility. Other code branches used to gate behavior
  // on this. The per-message header now renders unconditionally when
  // the AI message carries agent metadata, so this flag is informational
  // only.
  const _isGroupChat = threadAgentRoster.length + agentRoster.length > 0;
  void _isGroupChat;

  const combinedAgentRoster = useMemo(
    () => [...threadAgentRoster, ...agentRoster],
    [agentRoster, threadAgentRoster],
  );
  // O(1) lookup by agent id, backend name, or display name.
  const agentRosterMap = useMemo(
    () => buildAgentRosterMap(combinedAgentRoster),
    [combinedAgentRoster],
  );
  const soleRosterEntry =
    combinedAgentRoster.length === 1 ? combinedAgentRoster[0] : undefined;

  const messages = thread.messages;
  const latestClarificationContent = latestClarificationToolContent(messages);
  const showConversationActivity = thread.isLoading && !thread.error;
  // Message objects are immutable and reference-stable for untouched realtime
  // items. Build the positional lookup once per projected messages array so
  // rendering N rows does not call Array#indexOf N times.
  const messageIndexByReference = useMemo(() => {
    const indexes = new Map<Message, number>();
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index]!;
      // Preserve Array#indexOf semantics if a legacy projection happens to
      // repeat the same Message object.
      if (!indexes.has(message)) indexes.set(message, index);
    }
    return indexes;
  }, [messages]);
  const latestOutboundDeliveryFailed = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.type !== "human") continue;
      return message.additional_kwargs?.delivery_state === "failed";
    }
    return false;
  }, [messages]);

  const lastMessage = messages[messages.length - 1];
  const lastMessageIsLoading = Boolean(
    thread.isLoading &&
    lastMessage &&
    lastMessage.id === thread.streamingMessage?.id,
  );
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
  const hasTimelineContent = messages.length > 0 || timelineEntries.length > 0;

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
      messages.length,
      liveEvents,
    ].join("::");
  }, [
    lastTurnToolEvents,
    liveToolEvents,
    messages.length,
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
  const streamVitals = (
    thread as BaseStream<AgentThreadState> & { vitals?: StreamVitals }
  ).vitals;

  // A content delta is progress, so move the silence watermark without
  // restarting the per-turn timer. The previous combined effect tore down
  // and recreated an interval on every token, adding avoidable effect/timer
  // churn to the hottest rendering path.
  useEffect(() => {
    if (!thread.isLoading) return;
    loadingProgressAtRef.current = Date.now();
    setLoadingAgeMs((age) => (age === 0 ? age : 0));
  }, [thread.isLoading, contentFingerprint]);

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
            : publicExecutionErrorMessage(message),
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
  const isWarningFailure =
    isNetworkError ||
    failureReceipt?.kind === "auth" ||
    failureReceipt?.kind === "capability" ||
    failureReceipt?.kind === "rate-limit" ||
    isBackpressureError ||
    failureReceipt?.kind === "environment" ||
    failureReceipt?.kind === "blocked";
  const failureHeaderText =
    failureReceipt?.kind === "blocked"
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

  // Tool-run folding into collapsible bubbles lives in the group/timeline
  // layer (message-group.tsx): `aggregateSimilarToolCalls` merges consecutive
  // same-kind tool calls, and the component keeps a tool-carrying AI
  // message's streamed answer in the conversation lane instead of burying it
  // inside the process replay. That guard is what the old message-level
  // `groupActivities` folding in message-grouping.ts lacked, so it ate
  // streaming AI messages and was removed as a redundant, regression-prone
  // path. groupMessages stays a straight group mapper here.
  const groupedMessages = useMemo(
    () => groupMessages(messages, (group) => group),
    [messages],
  );
  const messageTurns = useMemo(
    () => partitionMessageGroupsIntoTurns(groupedMessages),
    [groupedMessages],
  );
  const timelineEntrySlots = useMemo(
    () =>
      placeTimelineEntries(
        groupedMessages.map((group) => {
          for (const message of group.messages) {
            const createdAt = messageCreatedAt(message);
            if (createdAt) return createdAt;
          }
          return null;
        }),
        timelineEntries,
      ),
    [groupedMessages, timelineEntries],
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
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Holds the ResizeObserver created in the turn-locator effect so the
  // activity-observer effect below can switch which marker node it watches
  // without tearing down the scroll/resize listeners.
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const observedMarkerRef = useRef<string | null>(null);
  const resolveAgentIdentity = useCallback(
    (msg?: (typeof messages)[number]): AgentIdentity => {
      const aiMsg = msg && isAIMessage(msg) ? msg : undefined;
      if (threadId.startsWith("echo-assistant") && currentAgent) {
        return {
          avatar:
            cleanIdentityText(currentAgent.avatar_url) ??
            fallbackAgentAvatarUrl(currentAgent.name),
          icon: cleanIdentityText(currentAgent.icon),
          id: currentAgent.name,
          name: currentAgent.display_name ?? currentAgent.name,
          role: undefined,
        };
      }
      const explicitDisplayName = cleanIdentityText(
        aiMsg?.additional_kwargs?.agent_display_name,
      );
      const explicitAgentId =
        cleanIdentityText(aiMsg?.additional_kwargs?.agent_id) ??
        cleanIdentityText(aiMsg?.additional_kwargs?.agent_name) ??
        cleanIdentityText(aiMsg?.additional_kwargs?.agent);
      const threadAgentId =
        cleanIdentityText(thread.values?.["agent_name"]) ??
        cleanIdentityText(thread.values?.["agent_id"]) ??
        cleanIdentityText(thread.values?.["lead_agent_name"]);
      const threadDisplayName =
        cleanIdentityText(thread.values?.["team_leader"]) ??
        cleanIdentityText(thread.values?.["lead_agent_name"]);
      const rosterMatch =
        findRosterEntry(
          agentRosterMap,
          explicitAgentId,
          explicitDisplayName,
          currentAgent?.name,
          currentAgent?.display_name,
          threadAgentId,
          threadDisplayName,
        ) ?? soleRosterEntry;
      const rosterAgentId = agentIdForRosterEntry(rosterMatch);
      const rosterDisplayName = displayNameForRosterEntry(rosterMatch);
      // Older group-fanout messages persisted the runtime id in the
      // display-name field (for example "coder" or "desktop_operator").
      // When that value resolves to a roster member, the roster's persona
      // label is authoritative for presentation while the stored id remains
      // untouched for replay/audit.
      const explicitDisplayIsRuntimeId = Boolean(
        rosterMatch &&
        explicitDisplayName &&
        [rosterMatch.name, rosterMatch.agent_id].some(
          (value) => identityKey(value) === identityKey(explicitDisplayName),
        ),
      );
      const name =
        (explicitDisplayIsRuntimeId
          ? rosterDisplayName
          : explicitDisplayName) ??
        rosterDisplayName ??
        currentAgent?.display_name ??
        currentAgent?.name ??
        threadDisplayName;
      const avatar =
        cleanIdentityText(aiMsg?.additional_kwargs?.agent_avatar_url) ??
        cleanIdentityText(rosterMatch?.avatar_url) ??
        cleanIdentityText(currentAgent?.avatar_url) ??
        fallbackAgentAvatarUrl(
          rosterAgentId ?? currentAgent?.name ?? explicitAgentId,
        );
      const icon =
        cleanIdentityText(aiMsg?.additional_kwargs?.agent_icon) ??
        cleanIdentityText(rosterMatch?.icon) ??
        cleanIdentityText(currentAgent?.icon);
      const role = cleanIdentityText(rosterMatch?.role);
      const description = cleanIdentityText(rosterMatch?.description);
      const model = cleanIdentityText(rosterMatch?.model);
      const toolGroups = Array.isArray(rosterMatch?.toolGroups)
        ? rosterMatch.toolGroups.filter(
            (tool): tool is string =>
              typeof tool === "string" && Boolean(tool.trim()),
          )
        : undefined;

      return {
        avatar,
        icon,
        id: rosterAgentId ?? currentAgent?.name ?? explicitAgentId,
        name,
        role,
        description,
        model,
        toolGroups,
      };
    },
    [agentRosterMap, currentAgent, soleRosterEntry, thread.values, threadId],
  );
  // Recomputed on every streamed frame (groupedMessages is rebuilt each
  // flush), but the scroll-spy effect and the locator rail key off array
  // identity — return the previous array whenever the content is unchanged
  // so listeners are not torn down and re-attached per frame.
  const turnMarkersRef = useRef<TurnMarker[]>([]);
  const turnMarkers = useMemo<TurnMarker[]>(() => {
    const markers = buildTurnMarkers(
      groupedMessages,
      messageTurns,
      t.message.turnLabel,
    );
    const previous = turnMarkersRef.current;
    if (
      previous.length === markers.length &&
      markers.every((marker, index) => sameTurnMarker(previous[index]!, marker))
    ) {
      return previous;
    }
    turnMarkersRef.current = markers;
    return markers;
  }, [groupedMessages, messageTurns, t.message.turnLabel]);
  const [activeTurnKey, setActiveTurnKey] = useState<string | null>(null);

  useEffect(() => {
    setActiveTurnKey((current) =>
      current && turnMarkers.some((marker) => marker.key === current)
        ? current
        : (turnMarkers.at(-1)?.key ?? null),
    );
  }, [turnMarkers]);

  useEffect(() => {
    if (turnMarkers.length === 0 || typeof window === "undefined") {
      return;
    }
    const firstNode = groupRefs.current[turnMarkers[0]!.key] ?? null;
    const scrollElement = getTurnScrollViewport(firstNode);
    let frame = 0;

    const updateActiveTurn = () => {
      frame = 0;
      const rootRect =
        scrollElement instanceof Window
          ? { top: 0, height: window.innerHeight }
          : scrollElement.getBoundingClientRect();
      const rects: Record<string, Pick<DOMRect, "bottom" | "top"> | undefined> =
        {};
      for (const marker of turnMarkers) {
        rects[marker.key] =
          groupRefs.current[marker.key]?.getBoundingClientRect();
      }
      const nextKey = nearestTurnKeyByViewportCenter(
        turnMarkers,
        rects,
        rootRect.top,
        rootRect.height,
      );
      if (nextKey) {
        setActiveTurnKey((current) =>
          current === nextKey ? current : nextKey,
        );
      }
    };

    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateActiveTurn);
    };

    scheduleUpdate();
    scrollElement.addEventListener("scroll", scheduleUpdate, { passive: true });
    if (scrollElement !== window) {
      window.addEventListener("scroll", scheduleUpdate, { passive: true });
    }
    window.addEventListener("resize", scheduleUpdate);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleUpdate);
    resizeObserverRef.current = resizeObserver;
    observedMarkerRef.current = null;
    // Only observe the scroll container here. Historical turns run under
    // `content-visibility:auto` (`.message-turn-history`), so they are skipped
    // from layout while off-screen and essentially never resize; observing all
    // of them made the observer list grow linearly with turn count on long
    // conversations. The only node that actually grows during streaming is the
    // active turn's marker, which the activity-observer effect below subscribes
    // to (and switches) based on activeTurnKey.
    if (resizeObserver && scrollElement instanceof HTMLElement) {
      resizeObserver.observe(scrollElement);
    }
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scrollElement.removeEventListener("scroll", scheduleUpdate);
      if (scrollElement !== window) {
        window.removeEventListener("scroll", scheduleUpdate);
      }
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
      resizeObserverRef.current = null;
      observedMarkerRef.current = null;
    };
  }, [structuralFingerprint, turnMarkers]);

  // Switch which marker node the shared ResizeObserver watches as the active
  // turn changes. Keeps the observer count bounded (scroll container + 1
  // active marker) regardless of how many historical turns exist.
  useEffect(() => {
    const observer = resizeObserverRef.current;
    if (!observer) return;
    const prevKey = observedMarkerRef.current;
    if (prevKey) {
      const prevNode = groupRefs.current[prevKey];
      if (prevNode) observer.unobserve(prevNode);
    }
    observedMarkerRef.current = null;
    if (!activeTurnKey) return;
    const node = groupRefs.current[activeTurnKey];
    if (node) {
      observer.observe(node);
      observedMarkerRef.current = activeTurnKey;
    }
  }, [activeTurnKey, structuralFingerprint]);

  const scrollToTurn = (key: string) => {
    setActiveTurnKey(key);
    groupRefs.current[key]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };
  const subtaskUpdates = useMemo<SubtaskUpdate[]>(() => {
    const updates: SubtaskUpdate[] = [];
    for (const group of groupedMessages) {
      if (group.type !== "assistant:subagent") {
        continue;
      }
      for (const message of group.messages) {
        if (isAIMessage(message)) {
          for (const toolCall of message.tool_calls ?? []) {
            if (toolCall.name !== "task" || !toolCall.id) {
              continue;
            }
            // No `progress` here: this reduction replays on every message
            // change and updateSubtask merges shallowly, so a hardcoded 0
            // would clobber any real progress written by a live source.
            updates.push({
              id: toolCall.id,
              subagent_type: toolCall.args.subagent_type as string,
              description: toolCall.args.description as string,
              prompt: toolCall.args.prompt as string,
              status: "in_progress",
            });
          }
          continue;
        }
        // REMOVED: Dead subtask status contract (lines 1444-1476).
        // Backend never sends "Task Succeeded. Result:" / "Task failed." /
        // "Task timed out" prefixes. Subtask status must flow through proper
        // SSE events (item/subtask/status), not text parsing.
      }
    }
    return updates;
  }, [groupedMessages]);

  useEffect(() => {
    for (const update of subtaskUpdates) {
      updateSubtask(update);
    }
  }, [subtaskUpdates, updateSubtask]);

  const renderAssistantFrame = ({
    key,
    executionEngine,
    agentName,
    agentAvatar,
    agentIcon,
    agentRole,
    agentDescription,
    agentModel,
    agentToolGroups,
    replyTo,
    headerMeta,
    children,
  }: {
    key: string;
    executionEngine?: unknown;
    agentName?: string;
    agentAvatar?: string;
    agentIcon?: string | null;
    agentRole?: string;
    agentDescription?: string;
    agentModel?: string;
    agentToolGroups?: string[];
    /** ③ @因果链：本气泡回应/反驳的成员名，显示"回应 @谁"。 */
    replyTo?: string;
    /** Compact execution state; detailed task/event streams live in workbench. */
    headerMeta?: ReactNode;
    children: ReactNode;
  }) => {
    const displayName =
      builtinPersonaDisplayName(agentName) || agentName || t.message.assistant;
    const capabilitySummary = summarizeAgentCapabilities(agentToolGroups);
    // In a team room, label each agent's message with its name (and 队长
    // badge) so the thread reads like a group chat — you can see who's
    // speaking, not just an anonymous avatar.
    const isTeam = showSenderName;
    return (
      <div key={key} className="flex w-full items-start gap-3">
        <MemberProfilePopover
          name={displayName}
          roleLabel={agentRole === "tl" ? "队长" : "协作成员"}
          presenceLabel="参与对话"
          summary={agentDescription || "正在参与当前协作。"}
          details={[
            ...(agentModel ? [{ label: "模型", value: agentModel }] : []),
            ...(capabilitySummary
              ? [{ label: "擅长", value: capabilitySummary }]
              : []),
          ]}
          trigger={
            <button
              type="button"
              className="mt-1 shrink-0 rounded-md outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${displayName} · 查看成员信息`}
            >
              <AgentAvatar
                agentDisplayName={displayName}
                agentId={agentName}
                avatarUrl={
                  agentAvatar
                    ? withAgentAvatarVersion(agentAvatar)
                    : agentAvatar
                }
                icon={agentIcon}
                className="size-8 rounded-md"
              />
            </button>
          }
        />
        <div className="min-w-0 flex-1">
          {isTeam && agentName && (
            <div className="mb-0.5 flex w-full items-center gap-1.5">
              <span className="text-sm font-semibold text-foreground">
                {displayName}
              </span>
              {agentRole === "tl" && (
                <span className="rounded-md border border-border bg-muted/60 px-1.5 py-0 text-xs leading-4 font-medium text-muted-foreground">
                  队长
                </span>
              )}
              {replyTo && (
                <span
                  className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0 text-xs leading-4 font-medium text-primary"
                  title={replyTo}
                >
                  ↪ 回应 @{replyTo}
                </span>
              )}
              {headerMeta ? (
                <span className="ml-auto flex shrink-0 items-center">
                  {headerMeta}
                </span>
              ) : null}
            </div>
          )}
          <ExecutionEngineBadge engine={executionEngine} />
          {children}
        </div>
      </div>
    );
  };

  const renderMessageContent = (
    msg: (typeof messages)[number],
    keyPrefix: string | undefined,
    beforeContent?: ReactNode,
    suppressReasoningPanel = false,
    afterContent?: ReactNode,
  ) => {
    const key = `${keyPrefix}/${msg.id}`;
    const messageIndex = messageIndexByReference.get(msg);
    return (
      <div key={key}>
        {beforeContent}
        <MessageListItem
          message={msg}
          isLoading={thread.isLoading && msg.id === thread.streamingMessage?.id}
          chatFontSize={settings.display.chat_font_size}
          suppressReasoningPanel={
            Boolean(beforeContent) || suppressReasoningPanel
          }
          enableClarificationActions={
            !thread.isLoading && messages[messages.length - 1] === msg
          }
          isLastMessage={messages[messages.length - 1] === msg}
          messageIndex={messageIndex}
          afterContent={afterContent}
          projectMessageActions={projectMessageActions}
          shadowReview={
            msg === shadowReviewMessage ? actionableShadowReview : undefined
          }
          allowThreadFork={allowThreadFork}
        />
      </div>
    );
  };

  const renderMessageWithHeader = (
    msg: (typeof messages)[number],
    keyPrefix: string | undefined,
    beforeContent?: ReactNode,
    suppressReasoningPanel = false,
    afterContent?: ReactNode,
    headerMeta?: ReactNode,
  ) => {
    const key = `${keyPrefix}/${msg.id}`;
    const messageIndex = messageIndexByReference.get(msg);
    const content = (
      <>
        {beforeContent}
        <MessageListItem
          message={msg}
          isLoading={thread.isLoading && msg.id === thread.streamingMessage?.id}
          chatFontSize={settings.display.chat_font_size}
          suppressReasoningPanel={
            Boolean(beforeContent) || suppressReasoningPanel
          }
          enableClarificationActions={
            !thread.isLoading && messages[messages.length - 1] === msg
          }
          isLastMessage={messages[messages.length - 1] === msg}
          messageIndex={messageIndex}
          afterContent={afterContent}
          projectMessageActions={projectMessageActions}
          shadowReview={
            msg === shadowReviewMessage ? actionableShadowReview : undefined
          }
          allowThreadFork={allowThreadFork}
        />
      </>
    );
    if (msg.type !== "ai") {
      return <div key={key}>{content}</div>;
    }
    const { name, avatar, icon, role, description, model, toolGroups } =
      resolveAgentIdentity(msg);
    return renderAssistantFrame({
      key,
      executionEngine: msg.additional_kwargs?.execution_engine,
      agentName: name,
      agentAvatar: avatar,
      agentIcon: icon,
      agentRole: role,
      agentDescription: description,
      agentModel: model,
      agentToolGroups: toolGroups,
      headerMeta,
      replyTo:
        typeof msg.additional_kwargs?.reply_to === "string"
          ? msg.additional_kwargs.reply_to
          : undefined,
      children: content,
    });
  };

  const renderGroupHeader = (
    group: (typeof groupedMessages)[number],
    enableClarificationActions = false,
    keepOpen = false,
    showAssistantAvatar = true,
    delegationContent?: ReadonlyMap<string, ReactNode>,
    suppressSubagentRows = false,
    externalClarification: string | null = null,
  ) => {
    if (!hasVisibleMessageGroupContent(group.messages, t)) return null;
    const aiMessage = group.messages.find(
      (message): message is AIMessage => message.type === "ai",
    );
    const {
      name: agentName,
      avatar: agentAvatar,
      icon: agentIcon,
      role: agentRole,
      description: agentDescription,
      model: agentModel,
      toolGroups: agentToolGroups,
    } = resolveAgentIdentity(aiMessage);
    const content = (
      <>
        <MessageGroup
          delegationContent={delegationContent}
          collapseCompletedProcess
          enableClarificationActions={enableClarificationActions}
          externalClarificationContent={externalClarification}
          messages={group.messages}
          keepOpen={keepOpen}
          codeMode={mode === "code"}
          suppressSubagentRows={suppressSubagentRows}
          isLoading={
            keepOpen ||
            (thread.isLoading &&
              group.messages.some(
                (message) => message.id === thread.streamingMessage?.id,
              ))
          }
        />
      </>
    );
    if (!showAssistantAvatar) {
      return <div className="ml-11 w-auto">{content}</div>;
    }
    if (!agentName) return content;
    return renderAssistantFrame({
      key: `agent-frame/${group.id ?? agentName}`,
      executionEngine: aiMessage?.additional_kwargs?.execution_engine,
      agentName,
      agentAvatar,
      agentIcon,
      agentRole,
      agentDescription,
      agentModel,
      agentToolGroups,
      replyTo:
        typeof aiMessage?.additional_kwargs?.reply_to === "string"
          ? aiMessage.additional_kwargs.reply_to
          : undefined,
      children: content,
    });
  };

  const renderGroupContent = (
    group: (typeof groupedMessages)[number],
    assistantHeaderMeta?: (messageId?: string) => ReactNode,
    enableClarificationActions = false,
    keepOpen = false,
    deferOutputs = false,
    auditNotice: string | null = null,
    failure: FailurePresentation | null = null,
    showAssistantAvatar = true,
    delegationContent?: ReadonlyMap<string, ReactNode>,
    suppressSubagentRows = false,
    turnRenderInfo?: GroupTurnRenderInfo,
    // Clarification text sourced from the turn's tool output rather than from
    // this group's own messages. MemoizedGroup forwards it for the latest
    // group only; MessageGroup falls back to its own content when absent.
    externalClarification: string | null = null,
  ) => {
    if (group.type === "human" || group.type === "assistant") {
      const groupIndex = turnRenderInfo ? -1 : groupedMessages.indexOf(group);
      const turnHasProcessingLane =
        turnRenderInfo?.hasProcessingLane ??
        (() => {
          if (groupIndex < 0) return false;
          for (let index = groupIndex - 1; index >= 0; index -= 1) {
            const previous = groupedMessages[index]!;
            if (previous.type === "human") break;
            if (previous.type === "assistant:processing") return true;
          }
          for (
            let index = groupIndex + 1;
            index < groupedMessages.length;
            index += 1
          ) {
            const next = groupedMessages[index]!;
            if (next.type === "human") break;
            if (next.type === "assistant:processing") return true;
          }
          return false;
        })();
      const groupTurnMessages =
        turnRenderInfo?.turnMessages ??
        turnMessagesForGroup(groupedMessages, group);
      const isTerminalAssistantGroup =
        group.type === "assistant" &&
        (turnRenderInfo?.isLastAssistantOfTurn ??
          (isLastAssistantGroupOfTurn(groupedMessages, group) &&
            !hasLaterProcessActivity(groupTurnMessages, group)));
      const isProcessChangeGroup =
        group.type === "assistant" &&
        !isTerminalAssistantGroup &&
        hasMessageOutputSummary(group.messages);
      const outputSummary =
        isTerminalAssistantGroup && !deferOutputs ? (
          <MessageOutputSummary
            auditNotice={auditNotice}
            messages={group.messages}
            turnMessages={groupTurnMessages}
            retryContextMessages={messages}
            threadId={threadId}
            onOpenArtifact={onOpenArtifact}
            onRetryTask={onRetryTask}
            onAuthorizeNetwork={onAuthorizeNetwork}
            authorizingNetworkTier={authorizingNetworkTier}
            isRetrying={showConversationActivity}
            failure={failure}
          />
        ) : isProcessChangeGroup ? (
          <MessageOutputSummary
            messages={group.messages}
            retryContextMessages={messages}
            threadId={threadId}
            onOpenArtifact={onOpenArtifact}
            onRetryTask={onRetryTask}
            onAuthorizeNetwork={onAuthorizeNetwork}
            authorizingNetworkTier={authorizingNetworkTier}
            isRetrying={showConversationActivity}
            presentation="process"
          />
        ) : null;
      const outputHostMessage = outputSummary
        ? [...group.messages].reverse().find((message) => message.type === "ai")
        : undefined;
      const renderedMessages = group.messages.map((msg) => {
        const headerMeta =
          msg.type === "ai" ? assistantHeaderMeta?.(msg.id) : undefined;
        return showAssistantAvatar || msg.type !== "ai"
          ? renderMessageWithHeader(
              msg,
              group.id,
              undefined,
              turnHasProcessingLane,
              msg === outputHostMessage ? outputSummary : undefined,
              headerMeta,
            )
          : renderMessageContent(
              msg,
              group.id,
              undefined,
              turnHasProcessingLane,
              msg === outputHostMessage ? outputSummary : undefined,
            );
      });
      return (
        <>
          {group.type === "assistant" && !showAssistantAvatar ? (
            <div className="ml-11 w-auto">{renderedMessages}</div>
          ) : (
            renderedMessages
          )}
          {outputSummary && !outputHostMessage && outputSummary}
        </>
      );
    }
    if (group.type === "assistant:clarification") {
      const message = group.messages[0];
      if (message && hasContent(message)) {
        const content = extractContentFromMessage(message);
        const questionnaire = extractClarificationQuestionnaire(content);
        const visibleContent = questionnaire?.visibleContent ?? content;
        return (
          <div className="w-full">
            {visibleContent.trim() && (
              <MarkdownContent
                content={visibleContent}
                isLoading={false}
                rehypePlugins={settledRehypePlugins}
              />
            )}
            <ClarificationChoiceCard
              content={content}
              active={
                !thread.isLoading &&
                isLatestMessageGroup(groupedMessages, group)
              }
              messageId={message.id}
            />
          </div>
        );
      }
      return null;
    }
    if (group.type === "assistant:present-files") {
      const files: string[] = [];
      for (const message of group.messages) {
        if (hasPresentFiles(message)) {
          files.push(...extractPresentFilesFromMessage(message));
        }
      }
      return (
        <div className="ml-11 w-auto">
          {group.messages[0] && hasContent(group.messages[0]) && (
            <MarkdownContent
              content={extractContentFromMessage(group.messages[0])}
              isLoading={false}
              rehypePlugins={settledRehypePlugins}
              className="mb-4"
            />
          )}
          {!deferOutputs && (
            <ArtifactFileList files={files} threadId={threadId} />
          )}
        </div>
      );
    }
    if (group.type === "assistant:subagent") {
      const taskIds = new Set<string>();
      for (const message of group.messages) {
        if (!isAIMessage(message)) continue;
        for (const toolCall of message.tool_calls ?? []) {
          if (toolCall.name === "task" && toolCall.id) {
            taskIds.add(toolCall.id);
          }
        }
      }
      const results: React.ReactNode[] = [];
      const renderedTaskIds = new Set<string>();
      let renderedTaskCount = false;
      for (const message of group.messages.filter(isAIMessage)) {
        if (hasReasoning(message)) {
          results.push(
            <MessageGroup
              collapseCompletedProcess
              key={"thinking-group-" + message.id}
              messages={[message]}
              keepOpen={keepOpen}
              codeMode={mode === "code"}
              isLoading={
                thread.isLoading && message.id === thread.streamingMessage?.id
              }
            />,
          );
        }
        // A streamed/replayed delegation can arrive as several AI messages
        // carrying the same task tool call. The SubtaskCard is already live
        // by task id, so mounting it once prevents duplicate reports while
        // preserving later status updates through its own subscription.
        if (!renderedTaskCount && taskIds.size > 0) {
          renderedTaskCount = true;
          results.push(
            <div
              key="subtask-count"
              className="text-muted-foreground font-normal pt-2 text-sm"
            >
              {t.subagents.executing(taskIds.size)}
            </div>,
          );
        }
        const validTaskIds = takeUnseenTaskIds(
          message.tool_calls,
          renderedTaskIds,
        );
        if (validTaskIds.length > 1) {
          results.push(
            <ParallelSubtasksGrid
              key={"parallel-grid-" + message.id}
              taskIds={validTaskIds}
              isLoading={
                thread.isLoading && message.id === thread.streamingMessage?.id
              }
            />,
          );
        } else {
          for (const taskId of validTaskIds) {
            results.push(
              <SubtaskCard
                key={"task-group-" + taskId}
                taskId={taskId}
                isLoading={
                  thread.isLoading && message.id === thread.streamingMessage?.id
                }
              />,
            );
          }
        }
      }
      return <div className="relative z-1 flex flex-col gap-2">{results}</div>;
    }
    // Default: assistant:processing renders as MessageGroup.
    return renderGroupHeader(
      group,
      enableClarificationActions,
      keepOpen,
      showAssistantAvatar,
      delegationContent,
      suppressSubagentRows,
      externalClarification,
    );
  };

  const assistantFrameIdentity = useCallback(
    (group: (typeof groupedMessages)[number]): string | null => {
      if (group.type !== "assistant" && group.type !== "assistant:processing") {
        return null;
      }
      const aiMessage = group.messages.find(
        (message): message is AIMessage => message.type === "ai",
      );
      const identity = resolveAgentIdentity(aiMessage);
      // Avatar URLs and icons are presentation metadata and can arrive a frame
      // later than the stable agent id/name. Including them in the speaker key
      // made one uninterrupted reply grow a second avatar during streaming.
      // Prefer semantic identity and use visual metadata only as a last resort.
      const stableId = identityKey(identity.id);
      if (stableId) return `id:${stableId}`;
      const stableName = identityKey(identity.name);
      if (stableName) return `name:${stableName}`;
      const presentationIdentity = [
        identityKey(identity.avatar),
        identityKey(identity.icon),
      ]
        .filter((value): value is string => Boolean(value))
        .join("|");
      return presentationIdentity || null;
    },
    [resolveAgentIdentity],
  );

  // Budget the turn-wide scans once per groupedMessages change: the render
  // loop below used to re-derive turn message slices, last-assistant
  // positions and previous-speaker identities per group (slice + reverse +
  // map + filter each time), which is O(groups) per group and O(groups^2)
  // per frame. One walk per turn keeps it O(groups) per frame; the render
  // loop then does O(1) map lookups.
  const groupTurnRenderInfo = useMemo(() => {
    const info = new Map<number, GroupTurnRenderInfo>();
    for (const turn of messageTurns) {
      const start = turn.groupIndexes[0]!;
      const end = turn.groupIndexes[turn.groupIndexes.length - 1]!;
      // Same span and identity dedupe as turnMessagesForGroup: a turn starts
      // at its human group (or index 0 for the prelude) and runs to the last
      // group before the next human one.
      const seen = new Set<Message>();
      const turnMessages: Message[] = [];
      let lastAssistantActivityIndex = -1;
      let hasProcessingLane = false;
      for (let index = start; index <= end; index += 1) {
        const group = groupedMessages[index]!;
        if (group.type === "assistant:processing") {
          hasProcessingLane = true;
        }
        if (
          group.type === "assistant" ||
          group.type === "assistant:processing" ||
          group.type === "assistant:clarification" ||
          group.type === "assistant:subagent"
        ) {
          lastAssistantActivityIndex = index;
        }
        for (const message of group.messages) {
          if (seen.has(message)) continue;
          seen.add(message);
          turnMessages.push(message);
        }
      }
      let previousAssistantGroupCount = 0;
      let previousAssistantIdentity: string | undefined;
      for (const index of turn.groupIndexes) {
        const group = groupedMessages[index]!;
        const assistantIdentity = assistantFrameIdentity(group);
        info.set(index, {
          turnMessages,
          isLastAssistantOfTurn:
            group.type === "assistant" &&
            index === lastAssistantActivityIndex &&
            !hasLaterProcessActivity(turnMessages, group),
          assistantIdentity,
          previousAssistantGroupCount,
          previousAssistantIdentity,
          hasProcessingLane,
        });
        if (
          group.type === "assistant" ||
          group.type === "assistant:processing"
        ) {
          previousAssistantGroupCount += 1;
          if (
            assistantIdentity !== null &&
            previousAssistantIdentity === undefined
          ) {
            previousAssistantIdentity = assistantIdentity;
          }
        }
      }
    }
    return info;
  }, [messageTurns, groupedMessages, assistantFrameIdentity]);

  const turnSubagentRenderInfo = useMemo(() => {
    const info = new Map<
      string,
      {
        agents: InlineSubagentInfo[];
        events: LiveToolEvent[];
        mission: string;
        settled: boolean;
        firstProcessingIndex: number;
        hasCluster: boolean;
        agentsByGroupIndex: Map<number, InlineSubagentInfo[]>;
        eventsByGroupIndex: Map<number, LiveToolEvent[]>;
        bindingsByGroupIndex: Map<
          number,
          Map<string, { agent: InlineSubagentInfo; events: LiveToolEvent[] }>
        >;
      }
    >();
    // Historical events are immutable for this render. Index them once
    // instead of filtering the complete event history for every turn.
    const historicalEventsByTurn = new Map<number, LiveToolEvent[]>();
    for (const event of allToolEvents ?? []) {
      const eventTurnIndex = event.turnIndex ?? event.iteration;
      if (typeof eventTurnIndex !== "number") continue;
      const bucket = historicalEventsByTurn.get(eventTurnIndex);
      if (bucket) bucket.push(event);
      else historicalEventsByTurn.set(eventTurnIndex, [event]);
    }
    for (let turnIndex = 0; turnIndex < messageTurns.length; turnIndex += 1) {
      const turn = messageTurns[turnIndex]!;
      const turnMessages =
        groupTurnRenderInfo.get(turn.groupIndexes[0]!)?.turnMessages ?? [];
      const agents = deriveSubagentsFromMessages(turnMessages).map((agent) => {
        const rosterEntry = findRosterEntry(
          agentRosterMap,
          agent.id,
          agent.name,
          agent.role,
        );
        if (!rosterEntry) return agent;
        const rosterName = displayNameForRosterEntry(rosterEntry);
        const rosterAgentId = agentIdForRosterEntry(rosterEntry);
        return {
          ...agent,
          name: rosterName ?? agent.name,
          avatar:
            cleanIdentityText(rosterEntry.avatar_url) ??
            agent.avatar ??
            fallbackAgentAvatarUrl(rosterAgentId),
        };
      });
      const mission = deriveSubagentMissionFromMessages(turnMessages);
      const isLatestTurn = turnIndex === messageTurns.length - 1;
      const sourceEvents = isLatestTurn
        ? [...(lastTurnToolEvents ?? []), ...(liveToolEvents ?? [])]
        : (historicalEventsByTurn.get(turnIndex) ?? []);
      const seenEventIds = new Set<string>();
      const events = sourceEvents.filter((event) => {
        if (seenEventIds.has(event.id)) return false;
        seenEventIds.add(event.id);
        return (
          event.name === "subagent" ||
          event.lifecycle === "spawned" ||
          event.lifecycle === "finished" ||
          Boolean(event.subAgentRole) ||
          Boolean(event.subagentCodename) ||
          (Boolean(event.parentToolUseId) && event.agentId !== "__main__")
        );
      });
      const firstProcessingIndex =
        turn.groupIndexes.find(
          (index) => groupedMessages[index]?.type === "assistant:processing",
        ) ?? -1;
      const agentsByGroupIndex = new Map<number, InlineSubagentInfo[]>();
      const eventsByGroupIndex = new Map<number, LiveToolEvent[]>();
      const bindingsByGroupIndex = new Map<
        number,
        Map<string, { agent: InlineSubagentInfo; events: LiveToolEvent[] }>
      >();
      const claimedAgentIds = new Set<string>();

      // Bind each member state to the exact answer message authored by that
      // stable agent id. One assistant group can contain adjacent replies from
      // several members, so group-level identity is not precise enough here.
      for (const groupIndex of turn.groupIndexes) {
        const group = groupedMessages[groupIndex];
        if (group?.type !== "assistant") continue;
        const bindings = new Map<
          string,
          { agent: InlineSubagentInfo; events: LiveToolEvent[] }
        >();
        for (const message of group.messages) {
          if (message.type !== "ai" || !message.id) continue;
          const speaker = resolveAgentIdentity(message);
          const speakerKeys = new Set(
            [speaker.id, speaker.name]
              .map(identityKey)
              .filter((value): value is string => Boolean(value)),
          );
          const agent = agents.find((candidate) => {
            if (claimedAgentIds.has(candidate.id)) return false;
            return [candidate.id, candidate.name].some((value) => {
              const key = identityKey(value);
              return Boolean(key && speakerKeys.has(key));
            });
          });
          if (!agent) continue;
          claimedAgentIds.add(agent.id);
          const aliases = new Set(
            [agent.id, agent.name]
              .map(identityKey)
              .filter((value): value is string => Boolean(value)),
          );
          const matchingEvents = events.filter((event) =>
            [event.agentId, event.agentName, event.subagentCodename].some(
              (value) => {
                const key = identityKey(value);
                return Boolean(key && aliases.has(key));
              },
            ),
          );
          bindings.set(message.id, { agent, events: matchingEvents });
        }
        if (bindings.size > 0) {
          bindingsByGroupIndex.set(groupIndex, bindings);
        }
      }

      // A member that never emitted any answer still needs an observable
      // failure/running card. Keep those unmatched lanes at the process slot.
      const unmatchedAgents = agents.filter(
        (agent) => !claimedAgentIds.has(agent.id),
      );
      const processingIndexes = turn.groupIndexes.filter(
        (index) => groupedMessages[index]?.type === "assistant:processing",
      );
      const placedAgentIds = new Set<string>();
      for (const index of processingIndexes) {
        const ids = new Set(
          deriveSubagentsFromMessages(groupedMessages[index]!.messages).map(
            (agent) => agent.id,
          ),
        );
        const groupAgents = unmatchedAgents.filter((agent) =>
          ids.has(agent.id),
        );
        if (!groupAgents.length) continue;
        groupAgents.forEach((agent) => placedAgentIds.add(agent.id));
        agentsByGroupIndex.set(index, groupAgents);
        eventsByGroupIndex.set(index, events);
      }
      // Legacy event-only receipts have no call anchor. Keep them after the
      // last process group, never ahead of the main agent's explanation.
      const fallbackIndex = processingIndexes.at(-1);
      const unplacedAgents = unmatchedAgents.filter(
        (agent) => !placedAgentIds.has(agent.id),
      );
      if (
        fallbackIndex !== undefined &&
        (unplacedAgents.length || (!agents.length && events.length))
      ) {
        agentsByGroupIndex.set(fallbackIndex, [
          ...(agentsByGroupIndex.get(fallbackIndex) ?? []),
          ...unplacedAgents,
        ]);
        eventsByGroupIndex.set(fallbackIndex, events);
      }
      info.set(turn.key, {
        agents,
        events,
        mission,
        settled: !isLatestTurn,
        firstProcessingIndex,
        hasCluster: agents.length > 0 || events.length > 0,
        agentsByGroupIndex,
        eventsByGroupIndex,
        bindingsByGroupIndex,
      });
    }
    return info;
  }, [
    allToolEvents,
    agentRosterMap,
    groupTurnRenderInfo,
    groupedMessages,
    lastTurnToolEvents,
    liveToolEvents,
    messageTurns,
    resolveAgentIdentity,
  ]);

  if (showResumeSkeleton && thread.isThreadLoading && messages.length === 0) {
    return <MessageListSkeleton />;
  }

  // A terminal/send error and an active pulse must never be visible at the
  // same time. If the transport still reports loading while an error is
  // already authoritative, prefer the recoverable error receipt.
  const showEmptyPendingAssistantFrame =
    messageTurns.length === 0 &&
    showConversationActivity &&
    !hasStreamingAnswer;
  const emptyPendingAssistantIdentity = showEmptyPendingAssistantFrame
    ? resolveAgentIdentity()
    : null;

  return (
    <Conversation
      className={cn(
        "relative flex size-full flex-col select-text overflow-x-hidden",
        "[&_p]:select-text [&_li]:select-text [&_span]:select-text [&_pre]:select-text [&_code]:select-text",
        className,
      )}
      data-message-scroll-root="true"
      role="presentation"
    >
      {/* Keep the live status outside the busy log: aria-busy intentionally
          defers streamed message additions, but reconnect/slow/finished status
          changes must remain immediately available to assistive technology. */}
      <PublicThinkingStatus
        isLoading={showConversationActivity}
        liveToolEvents={liveToolEvents ?? []}
        hasStreamingMessage={hasStreamingAnswer}
        vitals={streamVitals}
        renderVisual={false}
      />
      <ConversationContent
        scrollClassName={TURN_SCROLL_VIEWPORT_CLASS}
        // "relaxed" and "compact" are the two density tokens globals.css
        // actually defines; the previous "comfortable" matched no rule at all.
        // Nothing in this subtree consumes --density-* today, so this is a
        // forward-looking correctness fix, not a visual change.
        data-density={showSenderName ? "compact" : "relaxed"}
        role="log"
        aria-label={t.conversation.messageLog}
        aria-busy={showConversationActivity}
        aria-relevant="additions"
        className={cn(
          "mx-auto w-full max-w-(--conversation-column) px-4 pt-2 pb-0",
          // A work-group timeline contains sender labels, short human turns,
          // and compact project events.  The private-chat rhythm is too airy
          // here and makes the room read like a report rather than a live
          // conversation.  Keep long AI answers' internal spacing unchanged;
          // only tighten the distance between top-level turns.
          showSenderName ? "gap-5" : "gap-7",
        )}
      >
        {header}
        {!hasTimelineContent ? emptyState : null}
        {showEmptyPendingAssistantFrame &&
          renderAssistantFrame({
            key: "pending-agent-frame/empty-turn",
            agentName: emptyPendingAssistantIdentity?.name,
            agentAvatar: emptyPendingAssistantIdentity?.avatar,
            agentIcon: emptyPendingAssistantIdentity?.icon,
            agentRole: emptyPendingAssistantIdentity?.role,
            children: (
              <PublicThinkingStatus
                isLoading={showConversationActivity}
                liveToolEvents={liveToolEvents ?? []}
                hasStreamingMessage={hasStreamingAnswer}
                vitals={streamVitals}
                className="ml-0"
                renderAnnouncement={false}
              />
            ),
          })}
        {messageTurns.map((turn, turnIndex) => {
          const isLatestTurn = turnIndex === messageTurns.length - 1;
          const subagentRenderInfo = turnSubagentRenderInfo.get(turn.key);
          const markerKey = turn.key.startsWith("human:") ? turn.key : null;
          // A submitted turn can spend several seconds waiting for its first
          // model event. During that gap there is no assistant message group
          // to own the avatar, which made the activity line look detached
          // from the agent. Reserve the same assistant frame immediately;
          // it disappears as soon as a visible assistant group arrives.
          const latestTurnHasVisibleAssistantGroup = turn.groupIndexes.some(
            (groupIndex) => {
              const group = groupedMessages[groupIndex];
              if (!group) return false;
              return (
                (group.type === "assistant" ||
                  group.type === "assistant:processing") &&
                hasVisibleMessageGroupContent(group.messages, t)
              );
            },
          );
          const showPendingAssistantFrame =
            isLatestTurn &&
            showConversationActivity &&
            !hasStreamingAnswer &&
            !latestTurnHasVisibleAssistantGroup;
          const pendingAssistantIdentity = showPendingAssistantFrame
            ? resolveAgentIdentity()
            : null;

          // Avatar continuity must follow what the user can actually see.
          // Team execution groups are projected into the right workbench and
          // omitted from chat; counting one of those hidden groups used to
          // suppress the first visible member avatar after a reload. Empty
          // groups have the same problem. Build the speaker sequence from
          // visible conversation rows only, starting a new main-avatar frame
          // whenever the speaking member changes.
          const hiddenTeamExecutionIndexes = new Set<number>();
          const hasVisibleAssistantPredecessor = new Set<number>();
          let sawVisibleAssistantGroup = false;
          for (const groupIndex of turn.groupIndexes) {
            const group = groupedMessages[groupIndex]!;
            const hideTeamExecutionProjection = Boolean(
              showSenderName &&
              subagentRenderInfo?.hasCluster &&
              group.type === "assistant:processing",
            );
            if (hideTeamExecutionProjection) {
              hiddenTeamExecutionIndexes.add(groupIndex);
              continue;
            }
            if (
              group.type !== "assistant" &&
              group.type !== "assistant:processing"
            ) {
              continue;
            }
            if (sawVisibleAssistantGroup) {
              hasVisibleAssistantPredecessor.add(groupIndex);
            }
            sawVisibleAssistantGroup = true;
          }

          const virtualizeHistoricalTurn =
            !isLatestTurn &&
            messageTurns.length > HISTORY_TURN_KEEP_MOUNTED * 2 &&
            turnIndex < messageTurns.length - HISTORY_TURN_KEEP_MOUNTED;

          return (
            <HistoricalTurnBoundary
              key={turn.key}
              cacheKey={`${threadId}:${turn.key}`}
              virtualize={virtualizeHistoricalTurn}
              onNode={(node) => {
                if (!markerKey) return;
                if (node) {
                  groupRefs.current[markerKey] = node;
                } else {
                  delete groupRefs.current[markerKey];
                }
              }}
              className={cn(
                "message-turn flex flex-col gap-3",
                !isLatestTurn && "message-turn-history",
                // ChatGPT-style entrance: animate new turns appearing, skip history
                isLatestTurn &&
                  "animate-[message-entrance_220ms_cubic-bezier(0.33,1,0.68,1)]",
              )}
              data-message-turn={turn.key}
              data-turn-rendering={isLatestTurn ? "active" : "history"}
            >
              {turn.groupIndexes.map((index) => {
                const group = groupedMessages[index]!;
                const groupKey = `${group.type}:${group.id ?? `idx-${index}`}`;
                // A team room has exactly one owner for execution state: the
                // right-hand workbench. `groupMessages` may create a process
                // group and a terminal answer from the same tool-carrying
                // message, so the whole process group stays out of chat.
                const hideTeamExecutionProjection =
                  hiddenTeamExecutionIndexes.has(index);
                if (hideTeamExecutionProjection) {
                  // Team rooms already project every member's live state and
                  // output into the right-hand execution workbench. Keeping
                  // the legacy inline "Agent 集群" card in the chat duplicates
                  // that surface and pushes the actual replies out of view.
                  return (
                    <Fragment key={groupKey}>
                      {timelineEntrySlots[index]?.map((entry) => (
                        <Fragment key={`timeline:${entry.id}`}>
                          {entry.content}
                        </Fragment>
                      ))}
                    </Fragment>
                  );
                }
                const isLatestGroup = index === groupedMessages.length - 1;
                const groupHasStreamingMessage =
                  thread.streamingMessage != null &&
                  group.messages.some(
                    (message) => message.id === thread.streamingMessage?.id,
                  );
                const keepGroupOpen =
                  groupHasStreamingMessage ||
                  (thread.isLoading && isLatestGroup);
                const enableGroupClarificationActions =
                  !thread.isLoading && isLatestGroup;
                const deferGroupOutputs =
                  thread.isLoading &&
                  latestHumanGroupIndex >= 0 &&
                  index > latestHumanGroupIndex;
                const groupAuditNotice =
                  groupKey === auditNoticeGroupKey
                    ? verificationAuditNotice
                    : null;
                const groupInfo = groupTurnRenderInfo.get(index)!;
                const boundSubagentAgents =
                  subagentRenderInfo?.agentsByGroupIndex.get(index);
                const boundSubagentEvents =
                  subagentRenderInfo?.eventsByGroupIndex.get(index);
                const boundSubagentBindings =
                  subagentRenderInfo?.bindingsByGroupIndex.get(index);
                const groupTurnMessages =
                  group.type === "assistant"
                    ? groupInfo.turnMessages
                    : group.messages;
                const structuredGroupFailure =
                  group.type === "assistant" && groupInfo.isLastAssistantOfTurn
                    ? structuredFailureFromMessages(groupTurnMessages)
                    : null;
                const historicalGroupFailure = structuredGroupFailure
                  ? {
                      ...presentFailure(structuredGroupFailure),
                      resolved: (() => {
                        let sawLaterHumanTurn = false;
                        for (
                          let laterIndex = index + 1;
                          laterIndex < groupedMessages.length;
                          laterIndex += 1
                        ) {
                          const laterGroup = groupedMessages[laterIndex]!;
                          if (laterGroup.type === "human") {
                            sawLaterHumanTurn = true;
                            continue;
                          }
                          if (
                            sawLaterHumanTurn &&
                            laterGroup.type === "assistant" &&
                            laterGroup.messages.some((message) =>
                              isSettledAssistantAnswer(message),
                            )
                          ) {
                            return true;
                          }
                        }
                        return false;
                      })(),
                    }
                  : null;
                const shouldShowFailureReceipt =
                  Boolean(failureReceipt) &&
                  isLatestGroup &&
                  group.type === "assistant" &&
                  !thread.isLoading &&
                  (!hasVisibleAssistantText(group) ||
                    hasMessageOutputSummary(groupTurnMessages));
                const groupFailure =
                  historicalGroupFailure ??
                  (failureReceipt && shouldShowFailureReceipt
                    ? failureReceipt
                    : null);

                const assistantIdentity = groupInfo.assistantIdentity;
                const previousAssistantIdentity =
                  groupInfo.previousAssistantIdentity;
                const showAssistantAvatar =
                  !hasVisibleAssistantPredecessor.has(index) ||
                  groupInfo.previousAssistantGroupCount === 0 ||
                  (assistantIdentity !== null &&
                    previousAssistantIdentity !== undefined &&
                    previousAssistantIdentity !== assistantIdentity);

                return (
                  <Fragment key={groupKey}>
                    {timelineEntrySlots[index]?.map((entry) => (
                      <Fragment key={`timeline:${entry.id}`}>
                        {entry.content}
                      </Fragment>
                    ))}
                    <MemoizedGroup
                      group={group}
                      index={index}
                      groupKey={groupKey}
                      isLatestGroup={isLatestGroup}
                      groupHasStreamingMessage={groupHasStreamingMessage}
                      keepGroupOpen={keepGroupOpen}
                      externalClarificationContent={
                        isLatestGroup ? latestClarificationContent : null
                      }
                      enableClarificationActions={
                        enableGroupClarificationActions
                      }
                      deferGroupOutputs={deferGroupOutputs}
                      groupFailure={groupFailure}
                      groupAuditNotice={groupAuditNotice}
                      renderGroupContent={renderGroupContent}
                      showAssistantAvatar={showAssistantAvatar}
                      // Fresh empty arrays would fail MemoizedGroup's reference
                      // comparator on every streamed frame and reopen every
                      // otherwise-settled historical group.
                      subagentAgents={
                        boundSubagentAgents?.length
                          ? boundSubagentAgents
                          : undefined
                      }
                      subagentEvents={
                        boundSubagentEvents?.length
                          ? boundSubagentEvents
                          : undefined
                      }
                      subagentBindings={boundSubagentBindings}
                      subagentMission={subagentRenderInfo?.mission}
                      subagentSettled={subagentRenderInfo?.settled}
                      subagentTurnIndex={turnIndex}
                      showSubagentCluster={Boolean(
                        boundSubagentAgents?.length ||
                        boundSubagentEvents?.length ||
                        boundSubagentBindings?.size,
                      )}
                      groupTurnRenderInfo={groupInfo}
                    />
                  </Fragment>
                );
              })}
              {isLatestTurn &&
                (showPendingAssistantFrame ? (
                  renderAssistantFrame({
                    key: `pending-agent-frame/${turn.key}`,
                    agentName: pendingAssistantIdentity?.name,
                    agentAvatar: pendingAssistantIdentity?.avatar,
                    agentIcon: pendingAssistantIdentity?.icon,
                    agentRole: pendingAssistantIdentity?.role,
                    children: (
                      <PublicThinkingStatus
                        isLoading={showConversationActivity}
                        liveToolEvents={liveToolEvents ?? []}
                        hasStreamingMessage={hasStreamingAnswer}
                        vitals={streamVitals}
                        className="ml-0"
                        renderAnnouncement={false}
                      />
                    ),
                  })
                ) : (
                  <div
                    className="ml-11"
                    data-testid="assistant-continuation-activity"
                  >
                    <PublicThinkingStatus
                      isLoading={showConversationActivity}
                      liveToolEvents={liveToolEvents ?? []}
                      hasStreamingMessage={hasStreamingAnswer}
                      vitals={streamVitals}
                      className="ml-0"
                      renderAnnouncement={false}
                    />
                  </div>
                ))}
            </HistoricalTurnBoundary>
          );
        })}

        {timelineEntrySlots[groupedMessages.length]?.map((entry) => (
          <Fragment key={`timeline:${entry.id}`}>{entry.content}</Fragment>
        ))}

        {/* Follow-up suggestions: show after the last turn when conversation is idle */}
        {onSendFollowUp &&
          project &&
          messageTurns.length > 0 &&
          !thread.isLoading && (
            <FollowUpSuggestions
              project={project}
              agentId={threadId}
              conversationVersion={messageTurns.length}
              isLoading={thread.isLoading}
              onSelect={onSendFollowUp}
              className="ml-11 mt-4"
            />
          )}

        {footer}

        {errorBannerText &&
          !failureReceiptAttachedToGroup &&
          !failureAlreadyVisibleInAssistantText &&
          !(verificationAuditNotice && auditNoticeGroupKey) && (
            <div
              role="alert"
              className={cn(
                "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-[var(--shadow-xs)]",
                isWarningFailure
                  ? "border-warning/30/70 bg-warning/5 text-warning dark:border-warning/50"
                  : "border-destructive/25 bg-destructive/8 text-destructive dark:border-destructive/35 dark:bg-destructive/12",
              )}
            >
              {isWarningFailure ? (
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
              ) : (
                <XCircleIcon className="mt-0.5 size-4 shrink-0" />
              )}
              <div className="min-w-0 flex-1 leading-6">
                <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                  <span>{failureHeaderText}</span>
                  {!isNetworkError && failedCompletedFileCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-background/60 px-2 py-0.5 text-xs font-normal text-foreground/70">
                      {t.message.completedChanges} · {failedCompletedFileCount}
                    </span>
                  )}
                </div>
                {!isNetworkError && (
                  <div className="text-sm opacity-80">{errorBannerText}</div>
                )}
                {failureReceipt?.kind === "environment" &&
                  onAuthorizeNetwork && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onAuthorizeNetwork("common")}
                        disabled={
                          authorizingNetworkTier !== null ||
                          showConversationActivity
                        }
                        aria-busy={authorizingNetworkTier === "common"}
                        className="inline-flex items-center gap-1.5 rounded-md border border-warning/80 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/20 disabled:cursor-wait disabled:opacity-70 dark:border-warning/60 dark:hover:bg-warning/70"
                      >
                        {authorizingNetworkTier === "common" ? (
                          <Loader2Icon
                            className="size-3 animate-spin"
                            aria-hidden="true"
                          />
                        ) : null}
                        {t.streaming.environmentBlockedAuthorizeCommon}
                      </button>
                      <button
                        type="button"
                        onClick={() => onAuthorizeNetwork("full")}
                        disabled={
                          authorizingNetworkTier !== null ||
                          showConversationActivity
                        }
                        aria-busy={authorizingNetworkTier === "full"}
                        className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 px-2.5 py-1 text-xs font-medium text-warning/90 transition-colors hover:bg-warning/10 disabled:cursor-wait disabled:opacity-70 dark:border-warning/50"
                      >
                        {authorizingNetworkTier === "full" ? (
                          <Loader2Icon
                            className="size-3 animate-spin"
                            aria-hidden="true"
                          />
                        ) : null}
                        {t.streaming.environmentBlockedAuthorizeFull}
                      </button>
                    </div>
                  )}
                {(failureReceipt?.kind === "auth" ||
                  failureReceipt?.kind === "rate-limit") && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => emitOpenSettings("models")}
                      className="rounded-md border border-warning/80 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/20 dark:border-warning/60"
                    >
                      {t.streaming.openModelSettings}
                    </button>
                    {failureReceipt.kind === "rate-limit" &&
                      fallbackRetryPrompt &&
                      onRetryTask &&
                      !latestOutboundDeliveryFailed && (
                        <button
                          type="button"
                          onClick={() => onRetryTask(fallbackRetryPrompt)}
                          disabled={showConversationActivity}
                          aria-busy={showConversationActivity}
                          className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 px-2.5 py-1 text-xs font-medium text-warning/90 transition-colors hover:bg-warning/10 disabled:cursor-wait disabled:opacity-70 dark:border-warning/50"
                        >
                          {showConversationActivity ? (
                            <Loader2Icon
                              className="size-3 animate-spin"
                              aria-hidden="true"
                            />
                          ) : null}
                          {showConversationActivity
                            ? t.message.retryingTask
                            : t.message.retryTask}
                        </button>
                      )}
                  </div>
                )}
                {(failureReceipt?.kind === "capability" ||
                  failureReceipt?.kind === "network" ||
                  failureReceipt?.kind === "error") &&
                  fallbackRetryPrompt &&
                  onRetryTask &&
                  !latestOutboundDeliveryFailed && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => onRetryTask(fallbackRetryPrompt)}
                        disabled={showConversationActivity}
                        aria-busy={showConversationActivity}
                        title={t.message.retryTaskHint}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-70",
                          isWarningFailure
                            ? "border-warning/80 bg-warning/10 text-warning hover:bg-warning/20 dark:border-warning/60"
                            : "border-destructive/40 bg-destructive/8 text-destructive hover:border-destructive/55 hover:bg-destructive/15 dark:border-destructive/50",
                        )}
                      >
                        {showConversationActivity ? (
                          <Loader2Icon
                            className="size-3 animate-spin"
                            aria-hidden="true"
                          />
                        ) : null}
                        {showConversationActivity
                          ? t.message.retryingTask
                          : t.message.retryTask}
                      </button>
                    </div>
                  )}
              </div>
            </div>
          )}

        <div
          aria-hidden="true"
          data-clearance-mode="composer-overlap-only"
          data-testid="conversation-bottom-safe-area"
          style={{
            // Keep the scroll viewport itself fixed so historical turns never
            // move when streamed text grows. The content already contributes
            // a 28px flex gap before this node and the overlay contributes a
            // 32px transparent fade above its input card. Reserve only the
            // remaining opaque composer overlap plus a small safety margin.
            // The old full composer height + 56px created a second, visible
            // window of empty space below short answers.
            // `paddingBottom` is only a fallback for standalone/test renders.
            // Once ChatPageLayout publishes the measured composer height, use
            // it directly. Treating the fallback as a permanent minimum left
            // a visible empty strip whenever the compact composer was shorter
            // than the old 160px estimate.
            height: `max(0px, calc(var(--chat-input-overlay-height, ${paddingBottom}px) - 52px))`,
          }}
        />
      </ConversationContent>

      <TurnLocatorRail
        activeKey={activeTurnKey}
        markers={turnMarkers}
        onSelect={scrollToTurn}
        runState={turnLocatorRunState}
      />

      <ConversationScrollButton
        activityKey={contentFingerprint}
        activityLabel={t.message.newUpdates}
        aria-label={t.message.backToLatest}
        title={t.message.backToLatest}
        style={{
          // Keep the affordance in the reading surface, not on top of the
          // absolutely-positioned composer. The layout publishes its measured
          // height, including expanded todos, approvals and multiline input.
          bottom: "calc(var(--chat-input-overlay-height, 160px) + 12px)",
        }}
      >
        {t.message.latest}
      </ConversationScrollButton>

      {showStallHint && !thread.error && (
        <div
          role="status"
          aria-live="polite"
          className="absolute top-4 left-[50%] z-10 -translate-x-1/2 flex items-center gap-2 rounded-lg border border-border-default bg-muted/80 px-3 py-1.5 text-xs text-muted-foreground shadow-[var(--shadow-xs)]"
        >
          <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
          <span>{t.message.stallHint(Math.floor(loadingAgeMs / 1000))}</span>
        </div>
      )}

      {showTimeoutWarning && !thread.error && (
        <div
          role="status"
          aria-live="polite"
          className="absolute top-4 left-[50%] z-10 -translate-x-1/2 flex items-center gap-3 rounded-lg border border-warning/70 bg-warning/5 px-4 py-2 text-xs text-warning shadow-[var(--shadow-xs)] dark:border-warning/50"
        >
          <AlertTriangleIcon className="size-4 shrink-0 text-warning" />
          <span>
            {t.message.timeoutWarning(Math.floor(loadingAgeMs / 1000))}
          </span>
          <button
            type="button"
            disabled={isStopping}
            aria-busy={isStopping}
            onClick={() => {
              // The main page supplies its unified interrupt + durable-pause
              // controller. Standalone MessageList consumers fall back to the
              // stream stop method and still surface a rejected interrupt.
              void Promise.resolve()
                .then(onStop ?? thread.stop)
                .catch(() => toast.error(t.chatPage.stopFailed));
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-warning/80 px-2 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/10 disabled:cursor-wait disabled:opacity-70 dark:border-warning/60 dark:hover:bg-warning/70"
          >
            {isStopping ? (
              <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
            ) : null}
            {isStopping ? t.chatInputBox.stopping : t.common.stop}
          </button>
        </div>
      )}
    </Conversation>
  );
}
