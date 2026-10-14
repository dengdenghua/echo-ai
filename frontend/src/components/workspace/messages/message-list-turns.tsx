/**
 * Turns, the timeline and the agent roster of the message list: how message groups split into turns, the turn locator's markers, history virtualization and which agent spoke.
 */
import { isAIMessage, type Message, type ToolCall } from "@/core/api/types";
import { isObjectLike, isUnknownArray } from "@/core/utils/guards";
import type { ComponentProps, ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  extractContentFromMessage,
  extractTextFromMessage,
  hasReasoning,
  hasToolCalls,
  type MessageGroup as CoreMessageGroup,
} from "@/core/messages/utils";
import type { Subtask } from "@/core/tasks";

import { type AgentRunState } from "../agent-run-status";

export const MESSAGE_LIST_DEFAULT_PADDING_BOTTOM = 160;
export const MESSAGE_LIST_FOLLOWUPS_EXTRA_PADDING_BOTTOM = 80;
export const MESSAGE_LIST_TIMEOUT_WARNING_MS = 300_000;
export const MESSAGE_LIST_STALL_HINT_MS = 60_000;
export type SubtaskUpdate = Partial<Subtask> & { id: string };

/**
 * Return task-call ids that have not been rendered in this subagent lane.
 * Replayed/streaming AI frames can repeat a call id; the live task card owns
 * the state for that id, so a second card is always a duplicate presentation.
 */
export function takeUnseenTaskIds(
  toolCalls: readonly ToolCall[] | undefined,
  seen: Set<string>,
): string[] {
  const ids: string[] = [];
  for (const toolCall of toolCalls ?? []) {
    const id = toolCall.name === "task" ? toolCall.id?.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export interface TurnMarker {
  key: string;
  kind: "dot" | "phase";
  label: string;
  number: number;
}
export function sameTurnMarker(a: TurnMarker, b: TurnMarker): boolean {
  return (
    a.key === b.key &&
    a.kind === b.kind &&
    a.label === b.label &&
    a.number === b.number
  );
}
export type TurnLocatorRunState = AgentRunState;
export type MessageListAgentRole = "tl" | "member" | string;

export interface MessageListAgentRosterEntry {
  agent_id?: string | null;
  avatar_url?: string | null;
  display_name?: string | null;
  icon?: string | null;
  name?: string | null;
  role?: MessageListAgentRole | null;
  description?: string | null;
  model?: string | null;
  toolGroups?: string[] | null;
}

export interface AgentIdentity {
  avatar?: string;
  icon?: string | null;
  id?: string;
  name?: string;
  role?: string;
  description?: string;
  model?: string;
  toolGroups?: string[];
}

export const EMPTY_AGENT_ROSTER: MessageListAgentRosterEntry[] = [];
export const TURN_LOCATOR_VISIBLE_LIMIT = 17;
export const TURN_SCROLL_VIEWPORT_CLASS = "message-list-scroll-viewport";
export const STREAM_PROGRESS_TAIL_LENGTH = 240;
export const HISTORY_TURN_KEEP_MOUNTED = 2;
export const HISTORY_TURN_OVERSCAN_PX = 1200;
export const HISTORY_TURN_ESTIMATED_HEIGHT = 320;
export const HISTORY_TURN_HEIGHT_CACHE_LIMIT = 500;
export const historicalTurnHeightCache = new Map<string, number>();

export function rememberHistoricalTurnHeight(key: string, height: number) {
  if (!Number.isFinite(height) || height < 1) return;
  historicalTurnHeightCache.delete(key);
  historicalTurnHeightCache.set(key, Math.ceil(height));
  if (historicalTurnHeightCache.size <= HISTORY_TURN_HEIGHT_CACHE_LIMIT) return;
  const oldest = historicalTurnHeightCache.keys().next().value;
  if (typeof oldest === "string") historicalTurnHeightCache.delete(oldest);
}

/**
 * Keep completed turns in normal document flow while unmounting React-heavy
 * content well outside the viewport. Unlike translated-row virtualizers, the
 * wrapper itself never moves, so a growing live answer cannot overlap the next
 * turn and browser scroll anchoring can preserve the reader's position.
 */
export function HistoricalTurnBoundary({
  cacheKey,
  children,
  className,
  estimatedHeight = HISTORY_TURN_ESTIMATED_HEIGHT,
  onNode,
  virtualize,
  ...props
}: ComponentProps<"div"> & {
  cacheKey: string;
  estimatedHeight?: number;
  onNode?: (node: HTMLDivElement | null) => void;
  virtualize: boolean;
}) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const onNodeRef = useRef(onNode);
  useLayoutEffect(() => {
    onNodeRef.current = onNode;
  }, [onNode]);
  // MessageList renders once per streamed frame. Keeping the callback ref
  // stable prevents React from detaching and reattaching every historical
  // turn's unchanged DOM node on each frame (two registry writes per turn).
  // The latest owner callback is still used for the real unmount.
  const setNodeRef = useCallback((node: HTMLDivElement | null) => {
    nodeRef.current = node;
    onNodeRef.current?.(node);
  }, []);
  const [measuredHeight, setMeasuredHeight] = useState(
    () => historicalTurnHeightCache.get(cacheKey) ?? null,
  );
  const [mounted, setMounted] = useState(
    () => !virtualize || typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    const cached = historicalTurnHeightCache.get(cacheKey) ?? null;
    setMeasuredHeight(cached);
    if (!virtualize || typeof IntersectionObserver === "undefined") {
      setMounted(true);
    }
  }, [cacheKey, virtualize]);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node || !virtualize || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setMounted(true);
          return;
        }
        if (node.contains(document.activeElement)) return;
        const height = node.getBoundingClientRect().height;
        rememberHistoricalTurnHeight(cacheKey, height);
        if (height > 0) setMeasuredHeight(Math.ceil(height));
        setMounted(false);
      },
      { rootMargin: `${HISTORY_TURN_OVERSCAN_PX}px 0px` },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cacheKey, virtualize]);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node || !mounted || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const height = node.getBoundingClientRect().height;
      if (height < 1) return;
      const rounded = Math.ceil(height);
      rememberHistoricalTurnHeight(cacheKey, rounded);
      setMeasuredHeight((current) => (current === rounded ? current : rounded));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [cacheKey, mounted]);

  return (
    <div
      {...props}
      ref={setNodeRef}
      className={className}
      data-turn-mounted={mounted ? "true" : "false"}
      style={
        mounted
          ? props.style
          : {
              ...props.style,
              height: measuredHeight ?? estimatedHeight,
            }
      }
    >
      {mounted ? children : null}
    </div>
  );
}

export function cssEscape(value: string): string {
  const escape = globalThis.CSS?.escape;
  if (typeof escape === "function") return escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

export interface MessageTurnSlice {
  /** Indexes into the grouped-message array, kept contiguous and ordered. */
  groupIndexes: number[];
  /** Human group key when present; leading system content uses a prelude key. */
  key: string;
}

/** A non-thread event rendered inside the conversation's single scroll/log. */
export interface MessageListTimelineEntry {
  id: string;
  createdAt?: string | null;
  content: ReactNode;
}

export function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Place external room events before the first thread group at or after their
 * timestamp. Groups remain atomic, so tool/reasoning/streaming renderers are
 * never split. Entries without a usable timestamp stay at the tail.
 */
export function placeTimelineEntries(
  groupCreatedAt: readonly (string | null | undefined)[],
  entries: readonly MessageListTimelineEntry[],
): MessageListTimelineEntry[][] {
  const slots = Array.from(
    { length: groupCreatedAt.length + 1 },
    (): MessageListTimelineEntry[] => [],
  );
  const ordered = entries
    .map((entry, index) => ({ entry, index, at: timestampMs(entry.createdAt) }))
    .sort((left, right) => {
      if (left.at === null && right.at === null)
        return left.index - right.index;
      if (left.at === null) return 1;
      if (right.at === null) return -1;
      return left.at - right.at || left.index - right.index;
    });
  const anchors = groupCreatedAt.map(timestampMs);

  for (const item of ordered) {
    if (item.at === null) {
      slots[groupCreatedAt.length]!.push(item.entry);
      continue;
    }
    const groupIndex = anchors.findIndex(
      (anchor) => anchor !== null && anchor >= item.at!,
    );
    slots[groupIndex < 0 ? groupCreatedAt.length : groupIndex]!.push(
      item.entry,
    );
  }
  return slots;
}

export function messageCreatedAt(message: Message): string | null {
  for (const metadata of [
    message.additional_kwargs,
    message.response_metadata,
  ]) {
    const value = metadata?.created_at;
    if (typeof value === "string" && timestampMs(value) !== null) return value;
  }
  return null;
}

/** Per-group render inputs derived once per turn instead of per group. */
export interface GroupTurnRenderInfo {
  /** Deduped message slice of the whole turn (matches turnMessagesForGroup). */
  turnMessages: Message[];
  /** True when this is the terminal plain assistant group for the turn. */
  isLastAssistantOfTurn: boolean;
  /** assistantFrameIdentity of this group (null for non-assistant types). */
  assistantIdentity: string | null;
  /** Assistant-ish groups (assistant / assistant:processing) before this one. */
  previousAssistantGroupCount: number;
  /** Nearest previous assistant-ish group's non-null identity, if any. */
  previousAssistantIdentity: string | undefined;
  /** Whether this turn contains an assistant processing lane. */
  hasProcessingLane: boolean;
}

/**
 * Split the flat message-group stream into stable user turns.
 *
 * A turn starts at a human group and owns every following group until the next
 * human group. Keeping this boundary independent from streaming content lets
 * completed turns use display locking while the newest turn remains fully
 * rendered and free to grow token by token.
 */
export function partitionMessageGroupsIntoTurns(
  groups: CoreMessageGroup[],
): MessageTurnSlice[] {
  const turns: MessageTurnSlice[] = [];

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]!;
    if (group.type === "human" || turns.length === 0) {
      turns.push({
        groupIndexes: [index],
        key:
          group.type === "human"
            ? `${group.type}:${group.id ?? `idx-${index}`}`
            : `prelude:${group.type}:${group.id ?? `idx-${index}`}`,
      });
      continue;
    }

    turns[turns.length - 1]!.groupIndexes.push(index);
  }

  return turns;
}

/**
 * Derive locator markers in one pass over the already-partitioned turns.
 *
 * The previous implementation searched forward for the next human group for
 * every marker. Long threads therefore rebuilt the locator in O(turns²) on
 * streamed frames even though partitionMessageGroupsIntoTurns had already
 * calculated the exact boundaries.
 */
export function buildTurnMarkers(
  groups: CoreMessageGroup[],
  turns: MessageTurnSlice[],
  turnLabel: (number: number) => string,
): TurnMarker[] {
  const markers: TurnMarker[] = [];

  for (const turn of turns) {
    const firstGroupIndex = turn.groupIndexes[0];
    if (firstGroupIndex === undefined) continue;
    const humanGroup = groups[firstGroupIndex];
    // A restored assistant/system prelude is a render turn, but not a user
    // turn and therefore must not appear in the locator rail.
    if (!humanGroup || humanGroup.type !== "human") continue;

    const turnMessages: Message[] = [];
    for (const groupIndex of turn.groupIndexes) {
      const group = groups[groupIndex];
      if (group) turnMessages.push(...group.messages);
    }
    const firstMessage = humanGroup.messages[0];
    const rawLabel = firstMessage
      ? extractTextFromMessage(firstMessage).replace(/\s+/g, " ").trim()
      : "";
    const number = markers.length + 1;
    markers.push({
      key: turn.key,
      kind: turnMarkerKindFromMessages(turnMessages),
      label: rawLabel || turnLabel(number),
      number,
    });
  }

  return markers;
}

export function streamingMessageProgressKey(
  message: Message | null | undefined,
): string {
  if (!message) return "";
  if (typeof message.content === "string") {
    return `${message.content.length}:${message.content.slice(-STREAM_PROGRESS_TAIL_LENGTH)}`;
  }
  return message.content
    .filter((part) => part.type === "text")
    .map(
      (part) =>
        `${part.text.length}:${part.text.slice(-STREAM_PROGRESS_TAIL_LENGTH)}`,
    )
    .join("|");
}

export function cleanIdentityText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function identityKey(value: unknown): string | undefined {
  return cleanIdentityText(value)?.toLowerCase();
}

export function agentIdForRosterEntry(
  entry?: MessageListAgentRosterEntry | null,
): string | undefined {
  return cleanIdentityText(entry?.name) ?? cleanIdentityText(entry?.agent_id);
}

export function displayNameForRosterEntry(
  entry?: MessageListAgentRosterEntry | null,
): string | undefined {
  return (
    cleanIdentityText(entry?.display_name) ??
    cleanIdentityText(entry?.name) ??
    cleanIdentityText(entry?.agent_id)
  );
}

export function fallbackAgentAvatarUrl(
  agentId?: string | null,
): string | undefined {
  const cleanAgentId = cleanIdentityText(agentId);
  return cleanAgentId
    ? `/api/agents/${encodeURIComponent(cleanAgentId)}/avatar`
    : undefined;
}

export function rosterEntryHasUsableAvatar(
  entry?: MessageListAgentRosterEntry | null,
) {
  return Boolean(
    cleanIdentityText(entry?.avatar_url) ||
    fallbackAgentAvatarUrl(agentIdForRosterEntry(entry)),
  );
}

export function preferRosterEntry(
  current: MessageListAgentRosterEntry | undefined,
  next: MessageListAgentRosterEntry,
): MessageListAgentRosterEntry {
  if (!current) return next;
  if (
    !rosterEntryHasUsableAvatar(current) &&
    rosterEntryHasUsableAvatar(next)
  ) {
    return next;
  }
  if (!cleanIdentityText(current.icon) && cleanIdentityText(next.icon)) {
    return next;
  }
  if (
    !cleanIdentityText(current.display_name) &&
    cleanIdentityText(next.display_name)
  ) {
    return next;
  }
  return current;
}

export function buildAgentRosterMap(entries: MessageListAgentRosterEntry[]) {
  const map = new Map<string, MessageListAgentRosterEntry>();
  for (const entry of entries) {
    for (const key of [
      identityKey(entry.name),
      identityKey(entry.agent_id),
      identityKey(entry.display_name),
    ]) {
      if (!key) continue;
      map.set(key, preferRosterEntry(map.get(key), entry));
    }
  }
  return map;
}

export function findRosterEntry(
  map: Map<string, MessageListAgentRosterEntry>,
  ...keys: Array<unknown>
): MessageListAgentRosterEntry | undefined {
  for (const key of keys) {
    const normalized = identityKey(key);
    if (!normalized) continue;
    const entry = map.get(normalized);
    if (entry) return entry;
  }
  return undefined;
}

export function nearestTurnKeyByViewportCenter(
  markers: TurnMarker[],
  rects: Record<string, Pick<DOMRect, "bottom" | "top"> | undefined>,
  viewportTop: number,
  viewportHeight: number,
): string | null {
  if (markers.length === 0) return null;
  const viewportCenter = viewportTop + viewportHeight * 0.36;
  let best: { distance: number; key: string } | null = null;
  for (const marker of markers) {
    const rect = rects[marker.key];
    if (!rect) continue;
    const top = rect.top;
    const bottom = Math.max(rect.bottom, top);
    const center =
      top <= viewportCenter && bottom >= viewportCenter
        ? viewportCenter
        : (top + bottom) / 2;
    const distance = Math.abs(center - viewportCenter);
    if (!best || distance < best.distance) {
      best = { distance, key: marker.key };
    }
  }
  return best?.key ?? markers.at(-1)?.key ?? null;
}

export function visibleTurnMarkerWindow(
  markers: TurnMarker[],
  activeKey: string | null,
  limit = TURN_LOCATOR_VISIBLE_LIMIT,
): TurnMarker[] {
  if (limit <= 0 || markers.length <= limit) return markers;
  const activeIndex = activeKey
    ? markers.findIndex((marker) => marker.key === activeKey)
    : -1;
  const focusIndex = activeIndex >= 0 ? activeIndex : markers.length - 1;
  const maxStart = Math.max(0, markers.length - limit);
  const activeOffset = Math.floor(limit * 0.68);
  const start = Math.min(maxStart, Math.max(0, focusIndex - activeOffset));
  return markers.slice(start, start + limit);
}

export function getTurnScrollViewport(
  node: Element | null,
): HTMLElement | Window {
  if (typeof window === "undefined" || !node) return window;

  const explicit = node.closest(`.${TURN_SCROLL_VIEWPORT_CLASS}`);
  if (explicit instanceof HTMLElement) return explicit;

  let current = node.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if (
      /(auto|scroll|overlay)/.test(style.overflowY) &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return window;
}

export function turnMarkerKindFromMessages(
  messages: Message[],
): "dot" | "phase" {
  for (const message of messages) {
    if (!isAIMessage(message)) continue;
    const aiMessage = message;
    const additional = aiMessage.additional_kwargs;
    if (
      typeof additional?.phase_id === "string" &&
      additional.phase_id.trim()
    ) {
      return "phase";
    }
    if (additional?.thinking_plan) return "phase";
    if (Array.isArray(additional?.phases) && additional.phases.length > 0) {
      return "phase";
    }
    const workbenchSnapshot = additional?.workbenchSnapshot;
    if (
      isObjectLike(workbenchSnapshot) &&
      isUnknownArray(workbenchSnapshot.phases) &&
      workbenchSnapshot.phases.length > 0
    ) {
      return "phase";
    }
    for (const toolCall of aiMessage.tool_calls ?? []) {
      if (typeof toolCall.phaseId === "string" && toolCall.phaseId.trim()) {
        return "phase";
      }
    }
  }
  return "dot";
}

/**
 * Group objects are rebuilt from scratch on every upstream state flush, so
 * comparing `prev.group === next.group` would never hold during streaming.
 * Compare the contained message references instead: once the adapter keeps
 * message identities stable, completed groups become deep-equal by
 * reference and stay frozen.
 */
export function sameGroupContent(
  a: CoreMessageGroup,
  b: CoreMessageGroup,
): boolean {
  if (a === b) return true;
  if (a.type !== b.type || a.id !== b.id) return false;
  if (a.messages.length !== b.messages.length) return false;
  for (let index = 0; index < a.messages.length; index += 1) {
    if (a.messages[index] !== b.messages[index]) return false;
  }
  return true;
}

// Full message slice of the turn a group belongs to: from the nearest
// preceding human group through the last group before the next human one.
// Grouping never puts human/tool messages into a plain "assistant" group,
// so per-turn scans (verifications, original prompt, result URL) must look
// at the whole turn, not just the group's own messages. Groups can share
// message objects (a long final answer is pushed to both the processing
// and the assistant group), hence the identity dedupe.
export function turnMessagesForGroup(
  groupedMessages: CoreMessageGroup[],
  group: CoreMessageGroup,
): Message[] {
  const index = groupedMessages.indexOf(group);
  if (index === -1) return group.messages;
  let start = index;
  while (start > 0 && groupedMessages[start]!.type !== "human") start -= 1;
  let end = index;
  while (
    end + 1 < groupedMessages.length &&
    groupedMessages[end + 1]!.type !== "human"
  ) {
    end += 1;
  }
  const seen = new Set<Message>();
  const slice: Message[] = [];
  for (const turnGroup of groupedMessages.slice(start, end + 1)) {
    for (const message of turnGroup.messages) {
      if (seen.has(message)) continue;
      seen.add(message);
      slice.push(message);
    }
  }
  return slice;
}

// A turn can contain several plain assistant groups, with more processing
// appended after an intermediate answer/checkpoint. Only an assistant group
// with no later assistant or processing activity may host the final receipt.
// This keeps in-progress file writes on the execution timeline and prevents a
// completed-change card from appearing in the middle of a still-running turn.
export function isLastAssistantGroupOfTurn(
  groupedMessages: CoreMessageGroup[],
  group: CoreMessageGroup,
): boolean {
  const index = groupedMessages.indexOf(group);
  if (index === -1) return true;
  for (let i = index + 1; i < groupedMessages.length; i++) {
    const later = groupedMessages[i]!;
    if (later.type === "human") break;
    if (
      later.type === "assistant" ||
      later.type === "assistant:processing" ||
      later.type === "assistant:clarification" ||
      later.type === "assistant:subagent"
    ) {
      return false;
    }
  }
  return true;
}

export function hasLaterProcessActivity(
  turnMessages: Message[],
  group: CoreMessageGroup,
): boolean {
  const hostMessage = [...group.messages]
    .reverse()
    .find((message) => message.type === "ai");
  if (!hostMessage) return false;
  const hostIndex = turnMessages.indexOf(hostMessage);
  if (hostIndex < 0) return false;
  return turnMessages
    .slice(hostIndex + 1)
    .some(
      (message) =>
        message.type === "ai" &&
        (message.additional_kwargs?.public_progress === true ||
          hasToolCalls(message) ||
          hasReasoning(message)),
    );
}

// A clarification card should only auto-answer (its 20s countdown) while it
// is the newest group in the conversation. Once the user moves on, stale
// cards must stay inert — otherwise every idle moment re-arms every old
// card and fires its default choice as a spurious user turn.
export function isLatestMessageGroup(
  groupedMessages: CoreMessageGroup[],
  group: CoreMessageGroup,
): boolean {
  return groupedMessages[groupedMessages.length - 1] === group;
}

export function hasVisibleAssistantText(group: CoreMessageGroup): boolean {
  return group.messages.some(
    (message) =>
      message.type === "ai" &&
      extractContentFromMessage(message).trim().length > 0,
  );
}

export function assistantGroupContainsFailureMessage(
  group: CoreMessageGroup,
  failureMessage: string,
): boolean {
  const normalizedFailure = failureMessage.replace(/\s+/g, " ").trim();
  if (!normalizedFailure) return false;

  return group.messages.some((message) => {
    if (message.type !== "ai") return false;
    const visibleText = extractTextFromMessage(message)
      .replace(/\s+/g, " ")
      .trim();
    if (!visibleText) return false;
    return (
      visibleText.includes(normalizedFailure) ||
      (visibleText.length >= 24 && normalizedFailure.includes(visibleText))
    );
  });
}
