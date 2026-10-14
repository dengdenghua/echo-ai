/**
 * MessageList's turn locator (which turn is in view, jumping to one), who
 * spoke each message, and the subtask cards fed from task tool calls.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isAIMessage, type Message } from "@/core/api/types";
import type { BaseStream } from "@/core/api/use-stream-types";
import type { MessageGroup as CoreMessageGroup } from "@/core/messages/utils";
import { useUpdateSubtask } from "@/core/tasks/context";
import type { AgentThreadState } from "@/core/threads";

import {
  agentIdForRosterEntry,
  buildTurnMarkers,
  cleanIdentityText,
  displayNameForRosterEntry,
  fallbackAgentAvatarUrl,
  findRosterEntry,
  getTurnScrollViewport,
  identityKey,
  nearestTurnKeyByViewportCenter,
  sameTurnMarker,
  type AgentIdentity,
  type MessageListAgentRosterEntry,
  type MessageTurnSlice,
  type SubtaskUpdate,
  type TurnMarker,
} from "./message-list-turns";

/** Which turn is in view, and how to jump to one. */
export function useTurnLocator({
  groupedMessages,
  messageTurns,
  turnLabel,
  structuralFingerprint,
}: {
  groupedMessages: CoreMessageGroup[];
  messageTurns: MessageTurnSlice[];
  turnLabel: (index: number) => string;
  structuralFingerprint: string;
}) {
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Holds the ResizeObserver created in the turn-locator effect so the
  // activity-observer effect below can switch which marker node it watches
  // without tearing down the scroll/resize listeners.
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const observedMarkerRef = useRef<string | null>(null);
  // Recomputed on every streamed frame (groupedMessages is rebuilt each
  // flush), but the scroll-spy effect and the locator rail key off array
  // identity — return the previous array whenever the content is unchanged
  // so listeners are not torn down and re-attached per frame.
  const turnMarkersRef = useRef<TurnMarker[]>([]);
  const turnMarkers = useMemo<TurnMarker[]>(() => {
    const markers = buildTurnMarkers(groupedMessages, messageTurns, turnLabel);
    const previous = turnMarkersRef.current;
    if (
      previous.length === markers.length &&
      markers.every((marker, index) => sameTurnMarker(previous[index]!, marker))
    ) {
      return previous;
    }
    turnMarkersRef.current = markers;
    return markers;
  }, [groupedMessages, messageTurns, turnLabel]);
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

  return { groupRefs, turnMarkers, activeTurnKey, scrollToTurn };
}

/** Who wrote a message: name, avatar and role from metadata and the roster. */
export function useAgentIdentityResolver({
  threadId,
  threadValues,
  currentAgent,
  agentRosterMap,
  soleRosterEntry,
}: {
  threadId: string;
  threadValues: BaseStream<AgentThreadState>["values"];
  currentAgent?: {
    name: string;
    display_name?: string | null;
    avatar_url?: string | null;
    icon?: string | null;
  } | null;
  agentRosterMap: Map<string, MessageListAgentRosterEntry>;
  soleRosterEntry: MessageListAgentRosterEntry | undefined;
}) {
  return useCallback(
    (msg?: Message): AgentIdentity => {
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
        cleanIdentityText(threadValues?.["agent_name"]) ??
        cleanIdentityText(threadValues?.["agent_id"]) ??
        cleanIdentityText(threadValues?.["lead_agent_name"]);
      const threadDisplayName =
        cleanIdentityText(threadValues?.["team_leader"]) ??
        cleanIdentityText(threadValues?.["lead_agent_name"]);
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
    [agentRosterMap, currentAgent, soleRosterEntry, threadValues, threadId],
  );
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Feed the subtask cards from the task tool calls in the conversation. */
export function useSubtaskSync(groupedMessages: CoreMessageGroup[]) {
  const updateSubtask = useUpdateSubtask();
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
              subagent_type: stringArg(toolCall.args.subagent_type),
              description: stringArg(toolCall.args.description),
              prompt: stringArg(toolCall.args.prompt),
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
}
