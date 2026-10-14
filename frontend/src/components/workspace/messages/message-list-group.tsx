/**
 * One message group in the list, memoized so streaming only re-renders the groups that changed.
 */
import type { ReactNode } from "react";
import { memo } from "react";

import { type MessageGroup as CoreMessageGroup } from "@/core/messages/utils";
import { cn } from "@/lib/utils";

import type { LiveToolEvent } from "../live-tool-timeline";

import { type FailurePresentation } from "./message-output-summary";
import {
  deriveSubagentsFromMessages,
  InlineSubagentCards,
  type InlineSubagentInfo,
} from "./inline-subagent-cards";
import { sameGroupContent } from "./message-list-turns";
import type { GroupTurnRenderInfo } from "./message-list-turns";

export const MemoizedGroup = memo(
  function MemoizedGroup({
    group,
    index,
    groupKey,
    isLatestGroup: _isLatestGroup,
    groupHasStreamingMessage: _groupHasStreamingMessage,
    keepGroupOpen,
    externalClarificationContent,
    enableClarificationActions,
    deferGroupOutputs,
    groupAuditNotice,
    groupFailure,
    showAssistantAvatar,
    subagentAgents,
    subagentEvents,
    subagentBindings,
    subagentMission,
    subagentSettled,
    subagentTurnIndex,
    showSubagentCluster,
    renderGroupContent,
    groupTurnRenderInfo,
  }: {
    group: CoreMessageGroup;
    index: number;
    groupKey: string;
    isLatestGroup: boolean;
    groupHasStreamingMessage: boolean;
    keepGroupOpen: boolean;
    externalClarificationContent: string | null;
    enableClarificationActions: boolean;
    deferGroupOutputs: boolean;
    groupAuditNotice: string | null;
    groupFailure?: FailurePresentation | null;
    showAssistantAvatar: boolean;
    subagentAgents?: InlineSubagentInfo[];
    subagentEvents?: LiveToolEvent[];
    subagentBindings?: Map<
      string,
      { agent: InlineSubagentInfo; events: LiveToolEvent[] }
    >;
    subagentMission?: string;
    subagentSettled?: boolean;
    subagentTurnIndex?: number;
    showSubagentCluster: boolean;
    renderGroupContent: (
      group: CoreMessageGroup,
      assistantHeaderMeta?: (messageId?: string) => ReactNode,
      enableClarificationActions?: boolean,
      keepOpen?: boolean,
      deferOutputs?: boolean,
      auditNotice?: string | null,
      failure?: FailurePresentation | null,
      showAssistantAvatar?: boolean,
      delegationContent?: ReadonlyMap<string, ReactNode>,
      suppressSubagentRows?: boolean,
      turnRenderInfo?: GroupTurnRenderInfo,
      externalClarification?: string | null,
    ) => ReactNode;
    groupTurnRenderInfo: GroupTurnRenderInfo;
  }) {
    const hasPairedBindings = Boolean(subagentBindings?.size);
    const delegationSlots = new Map<string, ReactNode>();
    const anchoredAgentIds = new Set<string>();
    if (!hasPairedBindings && showSubagentCluster) {
      for (const message of group.messages) {
        if (message.type !== "ai") continue;
        let batchIds: string[] = [];
        let batchAgents: InlineSubagentInfo[] = [];
        const flushBatch = () => {
          if (!batchIds.length) return;
          delegationSlots.set(
            batchIds[0]!,
            <InlineSubagentCards
              agents={batchAgents}
              events={subagentEvents?.filter((event) =>
                Boolean(
                  event.parentToolUseId &&
                  batchIds.includes(event.parentToolUseId),
                ),
              )}
              mission={subagentMission}
              settled={subagentSettled}
              turnIndex={subagentTurnIndex}
            />,
          );
          for (const id of batchIds.slice(1)) delegationSlots.set(id, null);
          batchIds = [];
          batchAgents = [];
        };
        for (const call of message.tool_calls ?? []) {
          if (!call.id || delegationSlots.has(call.id)) continue;
          const callAgents = deriveSubagentsFromMessages([
            { ...message, tool_calls: [call] },
            ...group.messages.filter((candidate) => candidate.type === "tool"),
          ]);
          if (!callAgents.length) {
            flushBatch();
            continue;
          }
          const agents = callAgents.map((agent) => {
            anchoredAgentIds.add(agent.id);
            const identity = subagentAgents?.find(
              (entry) => entry.id === agent.id,
            );
            return {
              ...agent,
              name: identity?.name ?? agent.name,
              avatar: identity?.avatar ?? agent.avatar,
              avatarUrl: identity?.avatarUrl ?? agent.avatarUrl,
            };
          });
          batchIds.push(call.id);
          batchAgents.push(...agents);
        }
        flushBatch();
      }
    }
    const unanchoredAgents = subagentAgents?.filter(
      (agent) => !anchoredAgentIds.has(agent.id),
    );
    const showUnanchoredCluster =
      showSubagentCluster &&
      !hasPairedBindings &&
      (Boolean(unanchoredAgents?.length) ||
        (!subagentAgents?.length && !delegationSlots.size));
    const pairedStatusControl = hasPairedBindings
      ? (messageId?: string) => {
          if (!messageId) return undefined;
          const binding = subagentBindings?.get(messageId);
          return binding ? (
            <InlineSubagentCards
              agents={[binding.agent]}
              events={binding.events}
              mission={subagentMission}
              settled={subagentSettled}
              turnIndex={subagentTurnIndex}
              variant="paired"
            />
          ) : undefined;
        }
      : undefined;
    const renderedGroup = renderGroupContent(
      group,
      pairedStatusControl,
      enableClarificationActions,
      keepGroupOpen,
      deferGroupOutputs,
      groupAuditNotice,
      groupFailure,
      showAssistantAvatar,
      delegationSlots,
      Boolean(subagentAgents?.length || subagentEvents?.length),
      groupTurnRenderInfo,
      externalClarificationContent,
    );
    return (
      <div
        data-turn-key={group.type === "human" ? groupKey : undefined}
        className={cn(
          index === 0 ? "pt-1" : undefined,
          group.type === "human" ? "scroll-mt-6" : undefined,
          !showAssistantAvatar &&
            (group.type === "assistant" ||
              group.type === "assistant:processing") &&
            "-mt-2",
        )}
      >
        {hasPairedBindings ? (
          renderedGroup
        ) : (
          <>
            {renderedGroup}
            {showUnanchoredCluster ? (
              <InlineSubagentCards
                agents={unanchoredAgents}
                events={
                  unanchoredAgents?.length
                    ? subagentEvents?.filter((event) =>
                        unanchoredAgents.some((agent) =>
                          [
                            event.agentId,
                            event.agentName,
                            event.subagentCodename,
                          ].some((id) => id === agent.id || id === agent.name),
                        ),
                      )
                    : subagentEvents
                }
                mission={subagentMission}
                settled={subagentSettled}
                turnIndex={subagentTurnIndex}
                className="mb-1 ml-11"
              />
            ) : null}
          </>
        )}
      </div>
    );
  },
  (prev, next) =>
    // Only re-render if the group content changed or it is the active
    // streaming group. For non-streaming groups, shallow-equal the stable props.
    prev.groupKey === next.groupKey &&
    sameGroupContent(prev.group, next.group) &&
    prev.isLatestGroup === next.isLatestGroup &&
    prev.groupHasStreamingMessage === next.groupHasStreamingMessage &&
    prev.keepGroupOpen === next.keepGroupOpen &&
    prev.enableClarificationActions === next.enableClarificationActions &&
    prev.deferGroupOutputs === next.deferGroupOutputs &&
    prev.groupAuditNotice === next.groupAuditNotice &&
    prev.groupFailure === next.groupFailure &&
    prev.showAssistantAvatar === next.showAssistantAvatar &&
    prev.subagentAgents === next.subagentAgents &&
    prev.subagentEvents === next.subagentEvents &&
    prev.subagentBindings === next.subagentBindings &&
    prev.subagentMission === next.subagentMission &&
    prev.subagentSettled === next.subagentSettled &&
    prev.subagentTurnIndex === next.subagentTurnIndex &&
    prev.showSubagentCluster === next.showSubagentCluster,
);

/**
 * Unified chat message list.
 *
 * Previous versions virtualized individual rows via ``@tanstack/react-virtual``
 * to save render cost on long conversations. The approach interacted badly
 * with streaming: each token chunk grows the currently-streaming group by a
 * few lines, and the virtualizer's ResizeObserver measures async, so rows
 * below sat at stale ``translateY`` offsets for a frame or two. Visually,
 * text would overlap and the scroll bar would jitter.
 *
 * Turns now stay in normal document flow. Stable historical turns opt into
 * CSS ``content-visibility:auto`` and distant turns unmount behind fixed-height
 * wrappers. The latest four turns are always fully rendered. This skips React,
 * layout and paint work without translated rows or any chance of hiding the
 * active streaming response.
 */
