// AI message merge/dedupe helpers for the realtime adapter
// (``realtime-adapter.ts``): duplicate detection, trace-metadata merging,
// post-final status-only suppression and additional_kwargs assembly.
// Internal to the adapter.

import {
  isAIMessage,
  type AIMessage,
  type Message,
  type ToolCall,
} from "@/core/api/types";
import { mentionsCompletion, mentionsDelivered } from "@/core/i18n/llmMarkers";
import { splitReactTrace } from "./realtime-adapter-react-trace";

const TEAM_ROLE_START_RE =
  /^\s*\[(?:planner|researcher|critic|arbiter|synthesizer|writer|reviewer|analyst|coder|designer|executor|tester)\]\s*starting\s*(?:[·•-]|\u00b7)\s*agent=[^\n]*\n*/i;
const TEAM_ROLE_PREFIX_RE =
  /^\s*\[(?:planner|researcher|critic|arbiter|synthesizer|writer|reviewer|analyst|coder|designer|executor|tester)\]\s*/i;
const NULLISH_PLACEHOLDER_RE = /^\s*(?:null|undefined|none|n\/a)\s*$/i;
const REPEATED_NULL_PLACEHOLDER_RE = /^\s*(?:null\s*)+$/i;
export const STATUS_ONLY_MESSAGE_MAX_LENGTH = 320;

export function mergePendingIntoLastAiAnswer(
  messages: Message[],
  pending: {
    reasoning: string[];
    plan: string | null;
  },
): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.type === "human") break;
    if (!isAIMessage(message)) continue;
    // Commentary is a process checkpoint, never the delivered answer. A
    // completed turn can still have trailing private reasoning (providers
    // sometimes finish the reasoning item after the answer item); attaching
    // that tail to commentary makes the adapter treat the checkpoint as if it
    // were the terminal response and can hide the real answer downstream.
    if (message.additional_kwargs?.public_progress === true) continue;
    if (!normalizeMessageTextForDedupe(message.content)) continue;
    // Tool items are never merged here — they are already emitted as their
    // own AI messages at their real timeline position.
    const existing = message;
    const incoming: AIMessage = {
      type: "ai",
      content: "",
      additional_kwargs: buildAiAdditionalKwargs(pending),
    };
    messages[index] = mergeAiTraceMetadata(existing, incoming);
    return true;
  }
  return false;
}

export function isPostFinalStatusOnlyMessage(
  content: string,
  pending: { reasoning: string[] },
  out: Message[],
): boolean {
  if (
    !out.some(
      (message) =>
        message.type === "ai" &&
        message.additional_kwargs?.public_progress !== true &&
        normalizeMessageTextForDedupe(message.content).length >= 24,
    )
  ) {
    return false;
  }
  // A real report often opens with wording such as "analysis complete" or
  // "the report is delivered". Those phrases alone do not make a multi-
  // paragraph answer bookkeeping noise. Only compact terminal acknowledgments
  // are eligible for suppression; substantive answers must remain visible.
  const publicContent = normalizeStatusOnlyText(content);
  if (publicContent.length > STATUS_ONLY_MESSAGE_MAX_LENGTH) return false;
  // Tool items are emitted as independent messages before this check runs,
  // so only the prose lanes (answer text + trailing reasoning) decide
  // whether this message is post-final bookkeeping noise.
  const text = normalizeStatusOnlyText(
    [content, ...pending.reasoning].join("\n"),
  );
  if (!text) return false;
  return mentionsDelivered(text) && mentionsCompletion(text);
}

function normalizeStatusOnlyText(value: string): string {
  return (
    value
      // URLs are machine identifiers, not narrative status words. In
      // particular, generated-media URLs commonly contain `/task_<id>`;
      // letting that token participate in the completion heuristic made a
      // perfectly valid image answer look like post-final todo bookkeeping
      // whenever the accompanying reasoning mentioned "final answer".
      .replace(/https?:\/\/[^\s)>\]]+/gi, " ")
      .replace(/[`*_~>#-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  );
}

function normalizeMessageTextForDedupe(value: unknown): string {
  if (typeof value !== "string") return "";
  const split = splitReactTrace(value);
  const text = split.finalAnswer || value;
  const stripped = text
    .replace(TEAM_ROLE_START_RE, "")
    .replace(TEAM_ROLE_PREFIX_RE, "")
    .trim();
  if (
    NULLISH_PLACEHOLDER_RE.test(stripped) ||
    REPEATED_NULL_PLACEHOLDER_RE.test(stripped)
  ) {
    return "";
  }
  return stripped
    .replace(/<details\b[\s\S]*?<\/details>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_~>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function findDuplicateAiMessageIndex(
  messages: Message[],
  candidate: AIMessage,
): number {
  const candidateText = normalizeMessageTextForDedupe(candidate.content);
  if (candidateText.length < 24) return -1;
  const candidateIsProgress =
    candidate.additional_kwargs?.public_progress === true;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.type === "human") break;
    if (message.type !== "ai") continue;
    if (
      (message.additional_kwargs?.public_progress === true) !==
      candidateIsProgress
    ) {
      continue;
    }
    const existingText = normalizeMessageTextForDedupe(message.content);
    if (!existingText) continue;
    if (existingText === candidateText) return index;
  }
  return -1;
}

export function mergeDuplicateAiMessages(
  existing: AIMessage,
  duplicate: AIMessage,
): AIMessage {
  return mergeAiTraceMetadata(existing, duplicate);
}

function mergeAiTraceMetadata(
  existing: AIMessage,
  duplicate: AIMessage,
): AIMessage {
  const additional = mergeAdditionalKwargs(
    existing.additional_kwargs,
    duplicate.additional_kwargs,
  );
  const toolCalls = [
    ...(existing.tool_calls ?? []),
    ...(duplicate.tool_calls ?? []),
  ];
  return {
    ...existing,
    id: existing.id ?? duplicate.id,
    additional_kwargs: additional,
    ...(toolCalls.length > 0 ? { tool_calls: dedupeToolCalls(toolCalls) } : {}),
  };
}

function mergeAdditionalKwargs(
  existing?: Record<string, unknown>,
  incoming?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!existing && !incoming) return undefined;
  const merged: Record<string, unknown> = {
    ...(existing ?? {}),
    ...(incoming ?? {}),
  };
  const reasoning = mergeTextBlocks(
    existing?.reasoning_content,
    incoming?.reasoning_content,
  );
  if (reasoning) merged.reasoning_content = reasoning;
  // Sum thinking durations when trailing reasoning is merged into an
  // already-emitted AI message (e.g. reasoning finishes after the answer).
  const mergedDuration = mergeReasoningDurationMs(
    existing?.reasoning_duration_ms,
    incoming?.reasoning_duration_ms,
  );
  if (mergedDuration !== null) {
    merged.reasoning_duration_ms = mergedDuration;
  } else {
    delete merged.reasoning_duration_ms;
  }
  return merged;
}

function mergeReasoningDurationMs(a: unknown, b: unknown): number | null {
  const aNum = typeof a === "number" && Number.isFinite(a) ? a : null;
  const bNum = typeof b === "number" && Number.isFinite(b) ? b : null;
  if (aNum === null && bNum === null) return null;
  return (aNum ?? 0) + (bNum ?? 0);
}

function mergeTextBlocks(a: unknown, b: unknown): string | undefined {
  const blocks = [a, b]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    .map((value) => value.trim());
  if (blocks.length === 0) return undefined;
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const block of blocks) {
    const normalized = normalizeMessageTextForDedupe(block);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(block);
  }
  return unique.join("\n\n");
}

function dedupeToolCalls(toolCalls: ToolCall[]): ToolCall[] {
  const seen = new Set<string>();
  const unique: ToolCall[] = [];
  for (const toolCall of toolCalls) {
    const key = toolCall.id
      ? `id:${toolCall.id}`
      : `${toolCall.name}:${JSON.stringify(toolCall.args)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(toolCall);
  }
  return unique;
}

export function buildAiAdditionalKwargs(pending: {
  reasoning: string[];
  plan: string | null;
  reasoningDurationMs?: number | null;
  reasoningStartedAt?: string | null;
  createdAt?: string | null;
}): Record<string, unknown> {
  const kwargs: Record<string, unknown> = {};
  if (pending.reasoning.length > 0) {
    kwargs.reasoning_content = pending.reasoning.join("\n\n");
  }
  if (pending.plan !== null) {
    kwargs.thinking_plan = pending.plan;
  }
  if (typeof pending.reasoningDurationMs === "number") {
    kwargs.reasoning_duration_ms = pending.reasoningDurationMs;
  }
  if (pending.reasoningStartedAt) {
    kwargs.reasoning_started_at = pending.reasoningStartedAt;
  }
  if (pending.createdAt) {
    kwargs.created_at = pending.createdAt;
  }
  return kwargs;
}
