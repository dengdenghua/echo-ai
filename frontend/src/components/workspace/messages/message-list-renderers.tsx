/**
 * How MessageList renders one message group: the assistant frame (avatar,
 * name, member card), single messages, process groups, clarifications,
 * delivered files and sub-agent task cards. Built per render from the list's
 * current state, exactly like the closures it replaced.
 */
import type { ReactNode } from "react";

import { builtinPersonaDisplayName } from "@/core/agents/persona-display";
import { withAgentAvatarVersion } from "@/core/agents/avatar";
import { isAIMessage, type AIMessage, type Message } from "@/core/api/types";
import type { BaseStream } from "@/core/api/use-stream-types";
import { memberCardCopy } from "@/core/i18n/locales/member-card";
import type { Translations } from "@/core/i18n/locales/types";
import {
  extractContentFromMessage,
  extractPresentFilesFromMessage,
  hasContent,
  hasPresentFiles,
  hasReasoning,
  type MessageGroup as CoreMessageGroup,
} from "@/core/messages/utils";
import type { useRehypeSplitWordsIntoSpans } from "@/core/rehype";
import type { LocalSettings } from "@/core/settings";
import type { AgentThreadState } from "@/core/threads";
import {
  MemberProfilePopover,
  summarizeAgentCapabilities,
} from "@/components/workspace/member-profile-popover";

import { ArtifactFileList } from "../artifacts/artifact-file-list";
import { extractClarificationQuestionnaire } from "../clarification-questionnaire";
import { ExecutionEngineBadge } from "../execution-engine-picker";
import { AgentAvatar } from "./agent-message-header";
import { ClarificationChoiceCard } from "./clarification-choice-card";
import { MarkdownContent } from "./markdown-content";
import { hasVisibleMessageGroupContent, MessageGroup } from "./message-group";
import {
  MessageListItem,
  type MessageListProjectActions,
  type ShadowReviewContext,
} from "./message-list-item";
import {
  hasLaterProcessActivity,
  isLastAssistantGroupOfTurn,
  isLatestMessageGroup,
  takeUnseenTaskIds,
  turnMessagesForGroup,
  type AgentIdentity,
  type GroupTurnRenderInfo,
} from "./message-list-turns";
import {
  hasMessageOutputSummary,
  MessageOutputSummary,
  type FailurePresentation,
} from "./message-output-summary";
import { ParallelSubtasksGrid } from "./parallel-subtasks-grid";
import { SubtaskCard } from "./subtask-card";

export interface GroupRendererContext {
  t: Translations;
  locale: string;
  showSenderName: boolean;
  thread: BaseStream<AgentThreadState>;
  settings: LocalSettings;
  messages: Message[];
  messageIndexByReference: Map<Message, number>;
  projectMessageActions: MessageListProjectActions | undefined;
  shadowReviewMessage: Message | null;
  actionableShadowReview: ShadowReviewContext | undefined;
  allowThreadFork: boolean;
  resolveAgentIdentity: (message?: Message) => AgentIdentity;
  mode: string | undefined;
  groupedMessages: CoreMessageGroup[];
  threadId: string;
  onOpenArtifact: ((path: string) => void) | undefined;
  onRetryTask: ((prompt: string) => void) | undefined;
  onAuthorizeNetwork: ((tier: "common" | "full") => void) | undefined;
  authorizingNetworkTier: "common" | "full" | null;
  showConversationActivity: boolean;
  settledRehypePlugins: ReturnType<typeof useRehypeSplitWordsIntoSpans>;
}

export function createGroupRenderers({
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
}: GroupRendererContext) {
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
    const member = memberCardCopy(locale);
    // In a team room, label each agent's message with its name (and 队长
    // badge) so the thread reads like a group chat — you can see who's
    // speaking, not just an anonymous avatar.
    const isTeam = showSenderName;
    return (
      <div key={key} className="flex w-full items-start gap-3">
        <MemberProfilePopover
          name={displayName}
          roleLabel={agentRole === "tl" ? member.teamLead : member.member}
          presenceLabel={member.presence}
          summary={agentDescription || member.summaryFallback}
          details={[
            ...(agentModel ? [{ label: member.model, value: agentModel }] : []),
            ...(capabilitySummary
              ? [{ label: member.strengths, value: capabilitySummary }]
              : []),
          ]}
          trigger={
            <button
              type="button"
              className="mt-1 shrink-0 rounded-md outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={member.viewProfile(displayName)}
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
                  {member.teamLead}
                </span>
              )}
              {replyTo && (
                <span
                  className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0 text-xs leading-4 font-medium text-primary"
                  title={replyTo}
                >
                  {member.replyTo(replyTo)}
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
    msg: Message,
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
    msg: Message,
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
    group: CoreMessageGroup,
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
    group: CoreMessageGroup,
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

  return {
    renderAssistantFrame,
    renderMessageContent,
    renderMessageWithHeader,
    renderGroupHeader,
    renderGroupContent,
  };
}
