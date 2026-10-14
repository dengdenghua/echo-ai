/**
 * What each message group needs to render, computed once per turn instead of
 * once per group: the turn's messages, speaker changes, and where each
 * sub-agent's card and events belong.
 */
import { useCallback, useMemo } from "react";

import type { AIMessage, Message } from "@/core/api/types";
import type { MessageGroup as CoreMessageGroup } from "@/core/messages/utils";

import type { LiveToolEvent } from "../live-tool-timeline";
import {
  deriveSubagentMissionFromMessages,
  deriveSubagentsFromMessages,
  type InlineSubagentInfo,
} from "./inline-subagent-cards";
import {
  agentIdForRosterEntry,
  cleanIdentityText,
  displayNameForRosterEntry,
  fallbackAgentAvatarUrl,
  findRosterEntry,
  hasLaterProcessActivity,
  identityKey,
  type AgentIdentity,
  type GroupTurnRenderInfo,
  type MessageListAgentRosterEntry,
  type MessageTurnSlice,
} from "./message-list-turns";

export function useTurnRenderInfo({
  groupedMessages,
  messageTurns,
  resolveAgentIdentity,
  agentRosterMap,
  allToolEvents,
  lastTurnToolEvents,
  liveToolEvents,
}: {
  groupedMessages: CoreMessageGroup[];
  messageTurns: MessageTurnSlice[];
  resolveAgentIdentity: (message?: Message) => AgentIdentity;
  agentRosterMap: Map<string, MessageListAgentRosterEntry>;
  allToolEvents?: LiveToolEvent[];
  lastTurnToolEvents?: LiveToolEvent[];
  liveToolEvents?: LiveToolEvent[];
}) {
  const assistantFrameIdentity = useCallback(
    (group: CoreMessageGroup): string | null => {
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

  return {
    groupTurnRenderInfo,
    turnSubagentRenderInfo,
  };
}
