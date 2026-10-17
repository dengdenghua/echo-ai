import type { Message } from "@/core/api/types";
import {
  extractContentFromMessage,
  stripInternalToolProtocol,
  stripLeakedRendererMarkup,
  stripUploadedFilesTag,
} from "@/core/messages/utils";

import { extractClarificationQuestionnaire } from "../clarification-questionnaire";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const INTERNAL_TRACE_DETAILS_RE =
  /^\s*<details\b[^>]*>\s*<summary\b[^>]*>\s*[^<]*(?:ReAct|\u8f68\u8ff9)[^<]*<\/summary>[\s\S]*?<\/details>\s*/i;

const INLINE_THINKING_DETAILS_CAPTURE_RE =
  /^\s*<details\b[^>]*>\s*<summary\b[^>]*>\s*[^<]*(?:\u601d\u8003\u8fc7\u7a0b|Thinking)[^<]*<\/summary>([\s\S]*?)<\/details>\s*/i;

const LEGACY_SUBAGENT_BUDGET_PLACEHOLDER_RE =
  /^\s*(?:\[[^\]\n]+\]\s*)?\(sub-agent exceeded token budget \d+\/\d+\)\s*$/i;

export function stripInternalTraceDetails(content: string): string {
  let next = content;
  for (let i = 0; i < 4; i += 1) {
    const stripped = next.replace(INTERNAL_TRACE_DETAILS_RE, "");
    if (stripped === next) break;
    next = stripped.trimStart();
  }
  return next;
}

export function stripLegacySubagentBudgetPlaceholder(content: string): string {
  return LEGACY_SUBAGENT_BUDGET_PLACEHOLDER_RE.test(content) ? "" : content;
}

export function splitInlineThinkingDetails(content: string) {
  const match = content.match(INLINE_THINKING_DETAILS_CAPTURE_RE);
  if (!match) {
    return { content, hadInlineThinking: false, thinkingContent: null };
  }
  const fullMatch = match[0] ?? "";
  const thinkingContent = (match[1] ?? "").trim();
  return {
    content: content.slice(fullMatch.length).trimStart(),
    hadInlineThinking: true,
    thinkingContent: thinkingContent || null,
  };
}

/**
 * Cheap pre-filter for the streaming hot path.
 *
 * The full protocol-cleaning chain (stripInternalToolProtocol →
 * stripInternalTraceDetails → splitInlineThinkingDetails → …) is a dozen
 * whole-string regex passes — fine per settled message, wasteful when it
 * re-runs on every streamed token. Every pattern in that chain requires at
 * least one of the characters below (protocol XML/fence markers, ReAct
 * field headers, guard boilerplate, and the ASCII opening paren of the
 * legacy ``(sub-agent exceeded token budget N/N)`` placeholder — its
 * optional ``[...]`` prefix already matches via ``[``). A reply containing
 * none of them is guaranteed to pass through every stage unchanged, so we
 * can skip the entire chain. First-mark test is O(n) with zero allocation.
 */
const PROTOCOL_FIRST_MARK_RE = /[<`TAFONS质量（({[]/;

export function containsProtocolMarkers(content: string): boolean {
  return PROTOCOL_FIRST_MARK_RE.test(content);
}

function getReasoningSummary(message: Message): string | null {
  const additional = isRecord(message.additional_kwargs)
    ? message.additional_kwargs
    : null;
  const echo = isRecord(additional?.echo) ? additional.echo : null;
  for (const source of [additional, echo]) {
    if (!source) continue;
    const value = source.public_reasoning_summary;
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function buildReasoningSummary(message: Message): string | null {
  // Legacy snapshots used this explicit field for readable reasoning
  // summaries. It remains a reasoning disclosure and is never promoted to
  // normal commentary. Provider aliases are intentionally not guessed here.
  return getReasoningSummary(message);
}

function cleanClipboardText(value: string): string {
  return stripLeakedRendererMarkup(stripInternalToolProtocol(value), {
    trim: true,
  });
}

export function messageClipboardText(message: Message): string {
  const rawContent = extractContentFromMessage(message) ?? "";
  if (message.type === "human") {
    return stripUploadedFilesTag(rawContent).trim();
  }

  const displayContent = splitInlineThinkingDetails(
    stripLegacySubagentBudgetPlaceholder(stripInternalTraceDetails(rawContent)),
  ).content;
  const visibleContent =
    extractClarificationQuestionnaire(displayContent)?.visibleContent ??
    displayContent;
  const cleanedVisible = cleanClipboardText(visibleContent);
  if (cleanedVisible) return cleanedVisible;

  // Preserve the legacy explicit summary in clipboard output without ever
  // falling back to raw provider reasoning or guessed alias fields.
  return cleanClipboardText(getReasoningSummary(message) ?? "");
}
