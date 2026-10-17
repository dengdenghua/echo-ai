// Turn-level helpers for the realtime adapter (``realtime-adapter.ts``):
// safe item access, artifact/todo extraction, superseded pre-tool answers,
// grounding filtering, structural equality and failed-turn inspection.
// Internal to the adapter.

import { isObjectLike, isUnknownArray } from "@/core/utils/guards";
import type { Todo } from "@/core/todos";
import { isPrivateAgentGroundingSource } from "@/core/realtime/items";
import { itemStreamText } from "@/core/realtime/reducer";

import type {
  GroundingSource,
  Item,
  TodoListItem,
  Turn,
} from "@/core/realtime/items";

import { mentionsCompletion } from "@/core/i18n/llmMarkers";
import { STATUS_ONLY_MESSAGE_MAX_LENGTH } from "./realtime-adapter-message-merge";

const ROLE_NO_OUTPUT_PLACEHOLDER_RE =
  /^\s*\[[^\]\n]{1,80}\]\s*\((?:no output|no visible output|empty output)\)\s*$/i;

export function turnArtifactsFrom(turn: Turn): string[] {
  const out: string[] = [];
  for (const item of safeTurnItems(turn)) {
    if (item.type === "fileChange") {
      const fc = item;
      for (const change of fc.changes) {
        out.push(change.path);
      }
    } else if (item.type === "artifact") {
      out.push(item.path);
    }
  }
  return out;
}

/**
 * Returns the latest todo-list snapshot in the turn, or ``null`` if
 * none. (A turn can emit multiple todo-list updates; the last one
 * wins, matching how the live panel re-renders on each update.)
 */
export function turnTodosFrom(turn: Turn): Todo[] | null {
  let latest: TodoListItem | null = null;
  for (const item of safeTurnItems(turn)) {
    if (item.type === "todo-list") latest = item;
  }
  if (latest === null) return null;
  return latest.plan.map((entry) => ({
    content: entry.title,
    status: entry.status,
  }));
}

export function safeTurnItems(turn: Turn): Item[] {
  return Array.isArray(turn.items) ? turn.items : [];
}

/**
 * Recover old turns produced before pre-tool prose had an explicit commentary
 * lane. A same-author answer with real execution between it and a later
 * same-author answer is a draft checkpoint, not another settled chat reply.
 * Track an execution generation in one reverse pass so replay stays O(items).
 */
export function supersededPreToolAnswerIds(items: Item[]): Set<string> {
  const superseded = new Set<string>();
  const laterAnswerGenerationByAuthor = new Map<string, number>();
  let executionGeneration = 0;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (
      item.type === "commandExecution" ||
      item.type === "mcpToolCall" ||
      item.type === "fileChange"
    ) {
      executionGeneration += 1;
      continue;
    }
    if (item.type !== "agentMessage") continue;

    const message = item;
    if (message.messageKind === "commentary") continue;
    const text = itemStreamText(message).trim();
    // A short "Todo/任务已完成" item is a terminal receipt, not a newer
    // answer that should demote the report it follows. The existing adapter
    // performs the richer suppression after reasoning metadata is attached.
    if (
      text.length <= STATUS_ONLY_MESSAGE_MAX_LENGTH &&
      mentionsCompletion(text)
    ) {
      continue;
    }
    const author = String(message.agentDisplayName ?? "")
      .trim()
      .toLowerCase();
    const authorKey = author || "__turn_agent__";
    const laterGeneration = laterAnswerGenerationByAuthor.get(authorKey);
    if (
      laterGeneration !== undefined &&
      executionGeneration > laterGeneration
    ) {
      superseded.add(message.id);
    }
    laterAnswerGenerationByAuthor.set(authorKey, executionGeneration);
  }

  return superseded;
}

export function safeGroundingSources(
  grounding: GroundingSource[] | undefined,
): GroundingSource[] {
  return (grounding ?? []).filter(
    (source) =>
      source &&
      typeof source.path === "string" &&
      source.path.trim() !== "" &&
      !isPrivateAgentGroundingSource(source),
  );
}

// Structural equality with a reference fast path. Messages rebuilt from
// unchanged items carry reference-equal leaves (strings/arrays lifted off
// the item), so the walk touches object shells without re-comparing large
// payloads byte by byte.
export function stableDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (isUnknownArray(a) && isUnknownArray(b)) {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!stableDeepEqual(a[index], b[index])) return false;
    }
    return true;
  }
  // Always true past the checks above; it narrows both to records.
  if (!isObjectLike(a) || !isObjectLike(b)) return false;
  const left = a;
  const right = b;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!stableDeepEqual(left[key], right[key])) return false;
  }
  return true;
}

export function failedVerificationMessage(turn: Turn): string | undefined {
  const items = safeTurnItems(turn);
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.type !== "verification" || item.status !== "failed") continue;
    const verification = item;
    return (
      verification.summary?.trim() ||
      verification.stderrTail?.trim() ||
      verification.stdoutTail?.trim() ||
      "verification failed"
    );
  }
  return undefined;
}

export function isNoOutputPlannerFailure(turn: Turn): boolean {
  let sawNoOutputAgentMessage = false;
  for (const item of safeTurnItems(turn)) {
    if (item.type === "userMessage") continue;
    if (
      item.type === "agentMessage" &&
      ROLE_NO_OUTPUT_PLACEHOLDER_RE.test(itemStreamText(item))
    ) {
      sawNoOutputAgentMessage = true;
      continue;
    }
    return false;
  }
  return sawNoOutputAgentMessage;
}
