import { isAIMessage, isToolMessage, type Message } from "@/core/api/types";
import { isObjectLike } from "@/core/utils/guards";

import {
  extractContentFromMessage,
  extractTextFromMessage,
  splitInlineReasoning,
} from "./visible-content";

export {
  extractContentFromMessage,
  extractTextFromMessage,
  extractURLFromImageURLContent,
  isLegacyInternalAgentError,
  sanitizeLegacyGuardDiagnostic,
  sanitizeLegacyInternalAgentError,
  stripInternalToolProtocol,
  stripLeakedRendererMarkup,
} from "./visible-content";
export type { FileInMessage } from "./uploaded-files";
export { parseUploadedFiles, stripUploadedFilesTag } from "./uploaded-files";

interface GenericMessageGroup<T = string> {
  type: T;
  id: string | undefined;
  messages: Message[];
}

interface HumanMessageGroup extends GenericMessageGroup<"human"> {}

interface AssistantProcessingGroup extends GenericMessageGroup<"assistant:processing"> {}

interface AssistantMessageGroup extends GenericMessageGroup<"assistant"> {}

interface AssistantPresentFilesGroup extends GenericMessageGroup<"assistant:present-files"> {}

interface AssistantClarificationGroup extends GenericMessageGroup<"assistant:clarification"> {}

interface AssistantSubagentGroup extends GenericMessageGroup<"assistant:subagent"> {}

export type MessageGroup =
  | HumanMessageGroup
  | AssistantProcessingGroup
  | AssistantMessageGroup
  | AssistantPresentFilesGroup
  | AssistantClarificationGroup
  | AssistantSubagentGroup;

function normalizedNarrativeText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().toLowerCase()
    : "";
}

function publicNarrativeCandidates(message: Message): string[] {
  if (message.type !== "ai") return [];
  const additional = message.additional_kwargs;
  const echoField = additional?.echo;
  const echo = isObjectLike(echoField) ? echoField : null;
  return [
    extractContentFromMessage(message),
    additional?.public_reasoning_summary,
    echo?.public_reasoning_summary,
  ]
    .map(normalizedNarrativeText)
    .filter(Boolean);
}

const PROCESS_PRELUDE_NARRATIVE_RE =
  /(?:接下来|下一步|随后|这就|按计划|从.{1,32}开始|(?:我|我们)(?:会|将|先)|先.{0,80}(?:再|然后|随后|逐一)|\b(?:next|let me|i(?:'ll| will| am going to)|we(?:'ll| will)|start by)\b|\bfirst\b.{0,120}\bthen\b)/i;
const TERMINAL_OUTCOME_NARRATIVE_RE =
  /(?:已完成|完成了|分析完成|结果(?:是|如下)|结论|总结|最终(?:结果|结论|报告)|\b(?:done|completed|result|conclusion|summary|final report)\b)/i;

/**
 * Some providers mark every visible assistant fragment as ``answer``, even
 * when a short fragment only announces work that the next message performs.
 * Keep protocol-marked real answers authoritative, but recover this narrow,
 * observable prelude shape so it does not become a premature answer bubble.
 */
function hasProcessPreludeNarrative(message: Message): boolean {
  const narrative = normalizedNarrativeText(extractContentFromMessage(message));
  return Boolean(
    narrative &&
    narrative.length <= 480 &&
    PROCESS_PRELUDE_NARRATIVE_RE.test(narrative) &&
    !TERMINAL_OUTCOME_NARRATIVE_RE.test(narrative),
  );
}

/**
 * Check whether an AI message is an intermediate process prelude rather than
 * the final answer. This covers cases where the model emits a plan/commentary
 * message (e.g. "接下来我会先圈定3个...") BEFORE any tool calls. If subsequent
 * AI messages in the same turn carry tool calls or public_progress markers,
 * this message belongs on the process timeline, not as a standalone answer
 * bubble above the thinking. groupMessages uses an equivalent pre-indexed
 * predicate; this exported helper remains useful to callers classifying one
 * isolated message.
 */
export function isProcessPrelude(
  message: Message,
  index: number,
  messages: Message[],
): boolean {
  if (message.type !== "ai") return false;
  if (hasToolCalls(message)) return false;
  if (message.additional_kwargs?.public_progress === true) return false;
  // A provider may emit bookkeeping tools (for example the final todo
  // completion) after it has already published the answer. Protocol-marked
  // answers — and legacy messages that satisfy the same final-answer
  // compatibility predicate — must stay in the answer lane instead of being
  // reclassified as a process prelude merely because work follows them.
  if (
    isLikelyFinalAnswerContent(message) &&
    !hasProcessPreludeNarrative(message)
  ) {
    return false;
  }
  // Only messages with visible content can be preludes; reasoning-only
  // messages are already routed by the hasReasoning && !hasContent branch.
  if (!hasContent(message)) return false;

  for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
    const next = messages[nextIndex]!;
    if (next.type === "human") break;
    if (next.type !== "ai") continue;
    // A later AI message in the same turn that carries tool calls or
    // public progress signals means processing continues after this message →
    // this message is commentary/plan, not the final answer.
    if (
      next.additional_kwargs?.public_progress === true ||
      hasToolCalls(next)
    ) {
      return true;
    }
  }
  return false;
}

interface FutureMessageSignals {
  /** A later tool/progress AI message exists before the next human turn. */
  hasLaterProcessMessage: boolean[];
  /** A later structured process message repeats this message's narrative. */
  hasLaterDuplicateNarrative: boolean[];
  /** Any later non-error assistant message has visible content. */
  hasLaterSuccessfulAssistant: boolean[];
}

/**
 * Build the forward-looking predicates used by groupMessages in one reverse
 * walk. The former implementation sliced/scanned the remaining transcript
 * for every message, which made every streamed frame approach O(messages²)
 * on long-running tasks.
 */
function indexFutureMessageSignals(messages: Message[]): FutureMessageSignals {
  const hasLaterProcessMessage = Array<boolean>(messages.length).fill(false);
  const hasLaterDuplicateNarrative = Array<boolean>(messages.length).fill(
    false,
  );
  const hasLaterSuccessfulAssistant = Array<boolean>(messages.length).fill(
    false,
  );

  let laterProcessMessage = false;
  let laterSuccessfulAssistant = false;
  const laterProcessNarratives = new Set<string>();

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    hasLaterSuccessfulAssistant[index] = laterSuccessfulAssistant;
    if (
      (message.type === "ai" || message.type === "assistant") &&
      !message.additional_kwargs?.error &&
      hasContent(message)
    ) {
      laterSuccessfulAssistant = true;
    }

    if (message.type === "human") {
      laterProcessMessage = false;
      laterProcessNarratives.clear();
      continue;
    }

    hasLaterProcessMessage[index] = laterProcessMessage;
    if (message.type !== "ai") continue;

    const narrative = normalizedNarrativeText(
      extractContentFromMessage(message),
    );
    hasLaterDuplicateNarrative[index] = Boolean(
      narrative && laterProcessNarratives.has(narrative),
    );

    const isStructuredProcessMessage =
      message.additional_kwargs?.public_progress === true ||
      hasToolCalls(message) ||
      hasReasoning(message);
    if (isStructuredProcessMessage) {
      for (const candidate of publicNarrativeCandidates(message)) {
        laterProcessNarratives.add(candidate);
      }
    }
    if (
      message.additional_kwargs?.public_progress === true ||
      hasToolCalls(message)
    ) {
      laterProcessMessage = true;
    }
  }

  return {
    hasLaterProcessMessage,
    hasLaterDuplicateNarrative,
    hasLaterSuccessfulAssistant,
  };
}

export function groupMessages<T>(
  messages: Message[],
  mapper: (group: MessageGroup) => T,
): T[] {
  if (messages.length === 0) {
    return [];
  }

  const groups: MessageGroup[] = [];
  const futureSignals = indexFutureMessageSignals(messages);
  let currentTurnProcessingGroup: MessageGroup | null = null;
  const toolCallOwners = new Map<string, MessageGroup>();

  function indexToolCallOwner(
    message: Message,
    group: MessageGroup,
    prefer = false,
  ) {
    if (!isAIMessage(message)) return;
    for (const toolCall of message.tool_calls ?? []) {
      if (!toolCall.id) continue;
      if (prefer || !toolCallOwners.has(toolCall.id)) {
        toolCallOwners.set(toolCall.id, group);
      }
    }
  }

  // Returns the last group if it can still accept tool messages
  // (i.e. it's an in-flight processing group, not a terminal human/assistant group).
  function lastOpenGroup() {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.type !== "human" &&
      last.type !== "assistant" &&
      last.type !== "assistant:clarification"
    ) {
      return last;
    }
    return null;
  }

  // Terminal receipts (interrupted/failed/final answer) can be reduced before
  // an in-flight tool callback reaches the client. Keep looking within the
  // current human turn so those late process events return to the original
  // process lane instead of opening a new row below the terminal answer.
  function lastProcessingGroupInCurrentTurn() {
    return currentTurnProcessingGroup;
  }

  function groupOwningToolCall(toolCallId: string | undefined) {
    if (!toolCallId) return null;
    return toolCallOwners.get(toolCallId) ?? null;
  }

  function appendToCurrentProcessingGroup(message: Message) {
    const current = lastProcessingGroupInCurrentTurn();
    if (current) {
      current.messages.push(message);
      indexToolCallOwner(message, current, true);
      return current;
    }
    const group: MessageGroup = {
      id: message.id,
      type: "assistant:processing",
      messages: [message],
    };
    groups.push(group);
    currentTurnProcessingGroup = group;
    indexToolCallOwner(message, group, true);
    return group;
  }

  // AI progress/reasoning is chronological conversation content. If a final
  // answer has already been emitted, do not append a later thought back into
  // the older processing group above it — that makes the thought stream
  // visually stay at the top while the answer keeps growing below. Tool
  // callbacks retain the association-aware helper above because they may
  // arrive late and must stay attached to their originating call.
  function appendToLatestProcessingGroup(message: Message) {
    const latest = groups[groups.length - 1];
    if (latest?.type === "assistant:processing") {
      latest.messages.push(message);
      currentTurnProcessingGroup = latest;
      return;
    }
    const group: MessageGroup = {
      id: message.id,
      type: "assistant:processing",
      messages: [message],
    };
    groups.push(group);
    currentTurnProcessingGroup = group;
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (isHiddenFromUIMessage(message)) {
      continue;
    }

    if (
      isSupersededApprovalTimeoutMessage(
        message,
        futureSignals.hasLaterSuccessfulAssistant[index]!,
      )
    ) {
      continue;
    }

    if (message.name === "todo_reminder") {
      continue;
    }

    if (message.type === "human") {
      groups.push({ id: message.id, type: "human", messages: [message] });
      currentTurnProcessingGroup = null;
      continue;
    }

    if (isToolMessage(message)) {
      if (isClarificationToolMessage(message)) {
        // Add to the preceding processing group to preserve tool-call association,
        // then also open a standalone clarification group for prominent display.
        lastOpenGroup()?.messages.push(message);
        groups.push({
          id: message.id,
          type: "assistant:clarification",
          messages: [message],
        });
      } else {
        const open =
          groupOwningToolCall(message.tool_call_id) ??
          lastProcessingGroupInCurrentTurn() ??
          lastOpenGroup();
        if (open) {
          open.messages.push(message);
        } else {
          // Orphaned tool message (e.g., approval request from PermissionMiddleware).
          // Wrap it in its own processing group instead of dropping it.
          const group: MessageGroup = {
            id: message.id,
            type: "assistant:processing",
            messages: [message],
          };
          groups.push(group);
          currentTurnProcessingGroup = group;
        }
      }
      continue;
    }

    if (message.type === "ai") {
      if (hasPresentFiles(message)) {
        const group: MessageGroup = {
          id: message.id,
          type: "assistant:present-files",
          messages: [message],
        };
        groups.push(group);
        indexToolCallOwner(message, group);
      } else if (hasSubagent(message)) {
        const group: MessageGroup = {
          id: message.id,
          type: "assistant:subagent",
          messages: [message],
        };
        groups.push(group);
        indexToolCallOwner(message, group);
      } else if (message.additional_kwargs?.public_progress === true) {
        // Public checkpoints are answer-like prose, but they belong to the
        // chronological process lane rather than becoming standalone final
        // answer bubbles with a repeated assistant header.
        appendToLatestProcessingGroup(message);
      } else if (hasToolCalls(message)) {
        // Tool-call message: render public thinking / execution first.
        // If this same message carries a long final answer, append it
        // after the processing group so the report streams last.
        // Tool-call message → processing group (rendered as ChainOfThought
        // by MessageGroup, which shows the tool steps + a collapsed fold
        // for the reasoning trace).
        appendToCurrentProcessingGroup(message);
        if (hasContent(message) && isLikelyFinalAnswerContent(message)) {
          groups.push({
            id: message.id,
            type: "assistant",
            messages: [message],
          });
        }
      } else if (message.additional_kwargs?.response_state === "interrupted") {
        // The final draft is intentionally blank in the transcript, but the
        // turn still needs a small terminal receipt. Keep this as an ordinary
        // assistant group so MessageListItem can render that status without
        // inventing user-visible answer text.
        groups.push({ id: message.id, type: "assistant", messages: [message] });
      } else if (
        message.additional_kwargs?.response_state === "failed" ||
        message.additional_kwargs?.response_state === "blocked" ||
        message.additional_kwargs?.error
      ) {
        // Failed turns carry their detailed diagnostic as structured metadata.
        // Keep a terminal assistant group so MessageList can render one compact
        // receipt without replaying the raw guard/stack text in the transcript.
        groups.push({ id: message.id, type: "assistant", messages: [message] });
      } else if (
        hasContent(message) &&
        (futureSignals.hasLaterDuplicateNarrative[index] ||
          ((!isLikelyFinalAnswerContent(message) ||
            hasProcessPreludeNarrative(message)) &&
            futureSignals.hasLaterProcessMessage[index]))
      ) {
        appendToLatestProcessingGroup(message);
      } else if (hasReasoning(message) && !hasContent(message)) {
        // Reasoning-only intermediate message (no content, no tool
        // calls yet). Append to the processing group so it renders in
        // correct chronological order (thinking → commentary → actions)
        // inside MessageGroup, rather than creating a separate assistant
        // group that would render AFTER the processing lane and reverse
        // the visual order.
        appendToLatestProcessingGroup(message);
      } else if (hasContent(message)) {
        // Plain AI response (with or without reasoning). Render as a
        // normal assistant message — MessageListItem will draw a
        // collapsed reasoning fold above the content if reasoning is
        // present, so the chain of thought stays accessible without
        // dominating the visible answer.
        groups.push({ id: message.id, type: "assistant", messages: [message] });
      }
    }
  }

  return groups
    .map(mapper)
    .filter((result) => result !== undefined && result !== null);
}

export function isSettledAssistantAnswer(
  message: Message,
  {
    allowToolCalls = false,
    minTextLength = 1,
  }: {
    allowToolCalls?: boolean;
    minTextLength?: number;
  } = {},
): boolean {
  if (message.type !== "ai") return false;
  const metadata = message.additional_kwargs;
  if (
    metadata?.message_kind === "commentary" ||
    metadata?.public_progress === true ||
    metadata?.response_state === "interrupted" ||
    metadata?.response_state === "paused" ||
    metadata?.response_state === "cancelled" ||
    metadata?.response_state === "failed" ||
    metadata?.response_state === "blocked" ||
    metadata?.run_status === "streaming"
  ) {
    return false;
  }
  if (!allowToolCalls && hasToolCalls(message)) return false;
  return extractContentFromMessage(message).trim().length >= minTextLength;
}

export type AssistantTerminalState =
  | "paused"
  | "cancelled"
  | "interrupted"
  | "failed"
  | "blocked";

export function isAssistantStopTerminalState(
  state: AssistantTerminalState | null,
): boolean {
  return state === "cancelled" || state === "interrupted";
}

export function latestAssistantTerminalState(
  messages: Message[],
): AssistantTerminalState | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "ai") continue;
    const state = message.additional_kwargs?.response_state;
    if (
      state === "paused" ||
      state === "cancelled" ||
      state === "interrupted" ||
      state === "failed" ||
      state === "blocked"
    ) {
      return state;
    }
  }
  return null;
}

/**
 * Older saved turns predate `response_state: "blocked"` and therefore look
 * completed even when the final assistant message is explicitly handing the
 * turn back to the user. Keep this deliberately conservative: only inspect
 * the latest visible, non-process assistant answer and only match direct
 * requests for input or confirmation.
 */
export function assistantAnswerRequestsUserInput(messages: Message[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "ai") continue;
    if (
      message.additional_kwargs?.public_progress === true ||
      message.additional_kwargs?.message_kind === "commentary" ||
      hasToolCalls(message)
    ) {
      continue;
    }
    const content = extractContentFromMessage(message)
      .replace(/\s+/g, " ")
      .trim();
    if (!content) continue;
    return /(?:请|麻烦)(?:你)?(?:确认|提供|告诉|选择|回复|上传|授权|补充)|(?:需要|还需要)(?:你|您)(?:来)?(?:确认|提供|告诉|选择|回复|上传|授权|补充)|等待(?:你|您|用户)(?:的)?(?:输入|确认|回复)|(?:please|could you|can you)\s+(?:confirm|provide|tell|choose|reply|upload|authorize|share)|(?:i|we)\s+need\s+you\s+to\s+(?:confirm|provide|tell|choose|reply|upload|authorize|share)/i.test(
      content,
    );
  }
  return false;
}

export function extractReasoningContentFromMessage(message: Message) {
  if (message.type !== "ai") {
    return null;
  }
  if (
    message.additional_kwargs &&
    "reasoning_content" in message.additional_kwargs
  ) {
    return message.additional_kwargs.reasoning_content as string | null;
  }
  if (Array.isArray(message.content)) {
    const part = message.content[0];
    if (part && "thinking" in part) {
      return part.thinking;
    }
  }
  if (typeof message.content === "string") {
    return splitInlineReasoning(message.content).reasoning;
  }
  return null;
}

export function removeReasoningContentFromMessage(message: Message) {
  if (message.type !== "ai" || !message.additional_kwargs) {
    return;
  }
  delete message.additional_kwargs.reasoning_content;
}

export function hasContent(message: Message) {
  if (typeof message.content === "string") {
    return extractContentFromMessage(message).length > 0;
  }
  if (Array.isArray(message.content)) {
    return extractContentFromMessage(message).length > 0;
  }
  return false;
}

export function isLikelyFinalAnswerContent(message: Message) {
  const messageKind = message.additional_kwargs?.message_kind;
  // Realtime protocol semantics are authoritative. This keeps a short answer
  // in one stable lane from its first streamed token and prevents commentary
  // from being promoted merely because it contains a heading or grows long.
  if (messageKind === "answer") return hasContent(message);
  if (messageKind === "commentary") return false;

  // Compatibility only for legacy/API messages that predate messageKind.
  const text = extractContentFromMessage(message);
  if (!text) return false;
  if (text.length > 320) return true;
  if (/^#{1,3}\s+\S+/m.test(text)) return true;
  if (/^\s*[一二三四五六七八九十]+[、.．]\s*\S+/m.test(text)) return true;
  if (/^\s*\d+[.)、]\s+\S+/m.test(text) && text.split(/\n+/).length >= 4) {
    return true;
  }
  if (/\|.+\|/.test(text) && /-{3,}/.test(text)) return true;
  return false;
}

export function hasReasoning(message: Message) {
  if (message.type !== "ai") {
    return false;
  }
  if (typeof message.additional_kwargs?.reasoning_content === "string") {
    return true;
  }
  if (Array.isArray(message.content)) {
    const part = message.content[0];
    // Compatible with the Anthropic gateway
    return part?.type === "thinking";
  }
  if (typeof message.content === "string") {
    return splitInlineReasoning(message.content).reasoning !== null;
  }
  return false;
}

export function hasToolCalls(message: Message) {
  if (!isAIMessage(message)) return false;
  return message.tool_calls != null && message.tool_calls.length > 0;
}

export function hasPresentFiles(message: Message) {
  if (!isAIMessage(message)) return false;
  return (
    message.tool_calls?.some((toolCall) => toolCall.name === "present_files") ??
    false
  );
}

export function isClarificationToolMessage(message: Message) {
  return (
    message.type === "tool" &&
    (message.name === "ask_clarification" ||
      message.name === "ask_user_question")
  );
}

export function extractPresentFilesFromMessage(message: Message) {
  if (!isAIMessage(message) || !hasPresentFiles(message)) {
    return [];
  }
  const files: string[] = [];
  for (const toolCall of message.tool_calls ?? []) {
    if (
      toolCall.name === "present_files" &&
      Array.isArray(toolCall.args.filepaths)
    ) {
      files.push(...(toolCall.args.filepaths as string[]));
    }
  }
  return files;
}

export function hasSubagent(message: Message) {
  if (!isAIMessage(message)) return false;
  for (const toolCall of message.tool_calls ?? []) {
    if (toolCall.name === "task") {
      return true;
    }
  }
  return false;
}

export function findToolCallResult(toolCallId: string, messages: Message[]) {
  for (const message of messages) {
    if (isToolMessage(message) && message.tool_call_id === toolCallId) {
      const content = extractTextFromMessage(message);
      if (content) {
        return content;
      }
    }
  }
  return undefined;
}

export function isHiddenFromUIMessage(message: Message) {
  return message.additional_kwargs?.hide_from_ui === true;
}

function isSupersededApprovalTimeoutMessage(
  message: Message,
  hasLaterSuccessfulAssistant: boolean,
) {
  if (message.type !== "ai") return false;
  const error = message.additional_kwargs?.error;
  if (!error || typeof error !== "object") return false;
  const text = extractTextFromMessage(message);
  if (
    !/timed out waiting for item\/commandExecution\/requestApproval/i.test(text)
  ) {
    return false;
  }
  return hasLaterSuccessfulAssistant;
}
