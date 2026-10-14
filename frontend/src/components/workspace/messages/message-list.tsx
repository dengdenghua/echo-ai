import { type Message } from "@/core/api/types";
import type { BaseStream } from "@/core/api/use-stream-types";
import type { ReactNode } from "react";
import { AlertTriangleIcon, Loader2Icon, XCircleIcon } from "lucide-react";
import { Fragment, useMemo } from "react";
import { toast } from "sonner";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { useLocalSettings } from "@/core/settings";
import { useI18n } from "@/core/i18n/hooks";
import { emitOpenSettings } from "@/core/events/event-bus";
import { groupMessages, isSettledAssistantAnswer } from "@/core/messages/utils";
import { useRehypeSplitWordsIntoSpans } from "@/core/rehype";
import type { AgentThreadState } from "@/core/threads";
import { cn } from "@/lib/utils";

import type { LiveToolEvent } from "../live-tool-timeline";
import { PublicThinkingStatus } from "../public-thinking-status";

import { hasVisibleMessageGroupContent } from "./message-group";
import { latestClarificationToolContent } from "./message-grouping";
import { type MessageListProjectActions } from "./message-list-item";
import { hasMessageOutputSummary } from "./message-output-summary";
import { MessageListSkeleton } from "./skeleton";
import { useTurnFailure } from "./use-turn-failure";
import { createGroupRenderers } from "./message-list-renderers";
import { useTurnRenderInfo } from "./use-turn-render-info";
import {
  useAgentIdentityResolver,
  useSubtaskSync,
  useTurnLocator,
} from "./use-turn-locator";
import {
  useConversationLocate,
  useShadowReview,
  useTurnActivity,
} from "./message-list-hooks";
import { FollowUpSuggestions } from "./follow-up-suggestions";
import {
  MESSAGE_LIST_DEFAULT_PADDING_BOTTOM,
  EMPTY_AGENT_ROSTER,
  TURN_SCROLL_VIEWPORT_CLASS,
  HISTORY_TURN_KEEP_MOUNTED,
  HistoricalTurnBoundary,
  placeTimelineEntries,
  messageCreatedAt,
  partitionMessageGroupsIntoTurns,
  buildAgentRosterMap,
  hasVisibleAssistantText,
} from "./message-list-turns";
import type {
  MessageListAgentRosterEntry,
  MessageListTimelineEntry,
} from "./message-list-turns";
import { structuredFailureFromMessages } from "./message-list-failure";
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
  const { shadowReviewMessage, actionableShadowReview } = useShadowReview({
    messages,
    messageIndexByReference,
    lastMessage,
    lastMessageIsLoading,
    currentAgent,
    threadId,
    project,
  });
  const hasTimelineContent = messages.length > 0 || timelineEntries.length > 0;

  const {
    structuralFingerprint,
    contentFingerprint,
    hasStreamingAnswer,
    streamVitals,
    loadingAgeMs,
    turnLocatorRunState,
    showTimeoutWarning,
    showStallHint,
  } = useTurnActivity({
    thread,
    messagesLength: messages.length,
    liveToolEvents,
    lastTurnToolEvents,
    completedAgentOutput,
  });
  useConversationLocate();
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
  const {
    presentFailure,
    failureReceipt,
    isNetworkError,
    isWarningFailure,
    failureHeaderText,
    errorBannerText,
    verificationAuditNotice,
    fallbackRetryPrompt,
    failureReceiptAttachedToGroup,
    failureAlreadyVisibleInAssistantText,
    auditNoticeGroupKey,
    latestHumanGroupIndex,
    failedCompletedFileCount,
  } = useTurnFailure({ thread, messages, groupedMessages, t, locale });
  const resolveAgentIdentity = useAgentIdentityResolver({
    threadId,
    threadValues: thread.values,
    currentAgent,
    agentRosterMap,
    soleRosterEntry,
  });
  const { groupRefs, turnMarkers, activeTurnKey, scrollToTurn } =
    useTurnLocator({
      groupedMessages,
      messageTurns,
      turnLabel: t.message.turnLabel,
      structuralFingerprint,
    });
  useSubtaskSync(groupedMessages);

  const { renderAssistantFrame, renderGroupContent } = createGroupRenderers({
    t,
    locale,
    showSenderName,
    thread,
    settings,
    messages,
    messageIndexByReference,
    projectMessageActions,
    shadowReviewMessage,
    actionableShadowReview,
    allowThreadFork,
    resolveAgentIdentity,
    mode,
    groupedMessages,
    threadId,
    onOpenArtifact,
    onRetryTask,
    onAuthorizeNetwork,
    authorizingNetworkTier,
    showConversationActivity,
    settledRehypePlugins,
  });

  const { groupTurnRenderInfo, turnSubagentRenderInfo } = useTurnRenderInfo({
    groupedMessages,
    messageTurns,
    resolveAgentIdentity,
    agentRosterMap,
    allToolEvents,
    lastTurnToolEvents,
    liveToolEvents,
  });

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
