/**
 * Conversation -> AgentThreadState adapter.
 *
 * The realtime gateway delivers state as ``Conversation``: a flat list of turns, each turn a list of typed Items keyed by stable ``id``.
 *
 * Workspace pages consume the ``AgentThreadState`` view via ``useThreadStream``.
 *
 * Semantically pure (output depends only on input); internally memoized
 * per Turn/Item identity so unchanged turns map to reference-equal
 * ``Message`` objects across calls — treat the output as immutable.
 */

import {
  isAIMessage,
  type AIMessage,
  type Message,
  type ToolCall,
} from "@/core/api/types";
import { isObjectLike } from "@/core/utils/guards";
import type { Todo } from "@/core/todos";
import { itemStreamText } from "@/core/realtime/reducer";
import {
  isLegacyInternalAgentError,
  sanitizeLegacyGuardDiagnostic,
  sanitizeLegacyInternalAgentError,
} from "@/core/messages/utils";

import type {
  Conversation,
  GroundingSource,
  Item,
  Turn,
} from "@/core/realtime/items";

import type { AgentThreadState } from "./types";
import {
  commandExecutionInput,
  commandExecutionToolName,
} from "./realtime-tool-compat";
import {
  appendCancelledTurnReceipt,
  appendFailedTurnReceipt,
  appendInterruptedTurnReceipt,
  appendPausedTurnReceipt,
  attachGroundingToNarrativeAnchor,
  errorToAi,
  toolCallTimelineCoordinates,
  userMessageToHuman,
} from "./realtime-adapter-message-builders";
import {
  buildAiAdditionalKwargs,
  findDuplicateAiMessageIndex,
  isPostFinalStatusOnlyMessage,
  mergeDuplicateAiMessages,
  mergePendingIntoLastAiAnswer,
} from "./realtime-adapter-message-merge";
import { splitReactTrace } from "./realtime-adapter-react-trace";
import {
  failedVerificationMessage,
  isNoOutputPlannerFailure,
  safeGroundingSources,
  safeTurnItems,
  stableDeepEqual,
  supersededPreToolAnswerIds,
  turnArtifactsFrom,
  turnTodosFrom,
} from "./realtime-adapter-turn-items";

export { splitReactTrace } from "./realtime-adapter-react-trace";

const LEGACY_GROUP_SUMMARY_RE = /^\s*协作汇总[:：]/;
const LEGACY_PRIMARY_VIEWPOINT_RE =
  /[；;]\s*(?:主要观点来自|优先采纳)\s*[^。.!！\n]+[。.!！]?\s*$/;

function sanitizeLegacyGroupSummary(content: string): string {
  if (
    !LEGACY_GROUP_SUMMARY_RE.test(content) ||
    !LEGACY_PRIMARY_VIEWPOINT_RE.test(content)
  ) {
    return content;
  }
  const summary = content.replace(LEGACY_PRIMARY_VIEWPOINT_RE, "").trimEnd();
  const punctuation = /[。.!！]$/.test(summary) ? "" : "。";
  return `${summary}${punctuation} 历史记录未经过新版协作验收。`;
}

/**
 * Convert a realtime ``Conversation`` into the ``AgentThreadState``
 * shape that the legacy thread hooks (``useThreadStream``) expose.
 *
 * Mapping:
 *   - Each turn's items are walked in the server-authored causal order.
 *     Legacy items without timeline coordinates keep their stored positions.
 *   - User messages -> ``HumanMessage`` records.
 *   - Reasoning + agentMessage items in the SAME turn collapse into
 *     ONE ``AIMessage``: reasoning attaches to
 *     ``additional_kwargs.reasoning_content`` of the AI reply that
 *     immediately follows it.
 *   - commandExecution / mcpToolCall items become tool_calls on the
 *     trailing AIMessage of the same turn (or on a fresh AIMessage
 *     if there's no agentMessage yet).
 *   - fileChange items are surfaced through ``thread.artifacts``.
 *   - ``todo-list`` items are mapped to ``thread.todos``.
 *   - ``plan`` items are surfaced via ``additional_kwargs.thinking_plan``
 *     on the active AI reply.
 *   - ``error`` items become a final synthetic AIMessage with
 *     ``additional_kwargs.error``.
 *
 * The top-level state object and ``messages`` array are fresh on every
 * call, but ``Message`` objects are reused by reference while the
 * underlying ``Turn``/``Item`` objects are unchanged (the realtime
 * reducer rebuilds only what a delta touched). Downstream React.memo
 * layers rely on that identity to skip unchanged content during
 * streaming, so treat the returned messages as immutable.
 */
export function conversationToAgentThreadState(
  conv: Conversation,
  base?: Partial<AgentThreadState>,
): AgentThreadState {
  // Conversation-level incremental path. Only valid when no ``base`` is
  // supplied (the realtime caller always calls ``conversationToAgentThreadState(state)``):
  // in that case the top-level arrays derive purely from ``conv.turns``, so a
  // stable ``turns`` array reference implies unchanged messages/artifacts/todos and
  // the whole result can be reused without re-walking every turn. The reducer only
  // allocates a new ``turns`` array when a turn was added/replaced/streamed (a
  // single-token delta rebuilds its owning turn and the turns array); non-turn
  // updates (token usage, thread status, plain no-ops) keep the same reference.
  if (base === undefined) {
    const cached = topLevelViewCache.get(conv.turns);
    if (cached) {
      return {
        title: "",
        messages: cached.messages,
        artifacts: cached.artifacts,
        ...(cached.todos !== undefined ? { todos: cached.todos } : {}),
        ...(cached.latestGrounding !== undefined
          ? { latest_grounding: cached.latestGrounding }
          : {}),
      };
    }
  }

  const messages: Message[] = [];
  const artifacts: string[] = base?.artifacts ? [...base.artifacts] : [];
  let todos: Todo[] | undefined = base?.todos ? [...base.todos] : undefined;
  let latestGrounding: GroundingSource[] | undefined = base?.latest_grounding
    ? [...base.latest_grounding]
    : undefined;

  for (const turn of conv.turns) {
    latestGrounding = safeGroundingSources(turn.grounding);
    const turnArtifacts = turnArtifactsFrom(turn);
    if (turnArtifacts.length > 0) artifacts.push(...turnArtifacts);

    const turnTodos = turnTodosFrom(turn);
    if (turnTodos !== null) todos = turnTodos;

    const turnMessages = turnToMessagesStable(turn);
    messages.push(...turnMessages);
  }

  if (base === undefined) {
    topLevelViewCache.set(conv.turns, {
      messages,
      artifacts,
      todos,
      latestGrounding,
    });
  }

  return {
    title: base?.title ?? "",
    messages,
    artifacts,
    ...(todos !== undefined ? { todos } : {}),
    ...(latestGrounding !== undefined
      ? { latest_grounding: latestGrounding }
      : {}),
    ...(base?.agent_roster !== undefined
      ? { agent_roster: base.agent_roster }
      : {}),
    ...(base?.current_speaker !== undefined
      ? { current_speaker: base.current_speaker }
      : {}),
    ...(base?.execution_metrics !== undefined
      ? { execution_metrics: base.execution_metrics }
      : {}),
    ...(base?.execution_plan !== undefined
      ? { execution_plan: base.execution_plan }
      : {}),
  };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Per-turn helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Identity caches. The realtime reducer keeps object identity stable for
// turns/items a delta didn't touch (replaceAt/replaceTurnItem rebuild only
// the changed one), so an unchanged ``Turn`` reference can reuse its whole
// mapping, and inside a changed turn an unchanged ``Item`` can reuse the
// ``Message`` it anchored last time. WeakMaps: entries die together with
// the reducer state that owns the keys.
const turnMessagesCache = new WeakMap<Turn, Message[]>();
const itemMessageCache = new WeakMap<Item, Message>();

// Conversation-level view cache, keyed on the ``conv.turns`` array reference.
// Reuses the fully-materialized top-level mapping (messages/artifacts/todos)
// when the turns array is unchanged, so unchanged turns are never re-walked.
// Only populated on the no-``base`` path (see conversationToAgentThreadState).
const topLevelViewCache = new WeakMap<
  Turn[],
  {
    messages: Message[];
    artifacts: string[];
    todos: Todo[] | undefined;
    latestGrounding: GroundingSource[] | undefined;
  }
>();

function turnToMessagesStable(turn: Turn): Message[] {
  const cached = turnMessagesCache.get(turn);
  if (cached) return cached;

  const fresh = turnToMessages(turn);

  // Reconcile per-message identity: a message anchored to an item id
  // (user/steering/error messages, and AI messages carrying their
  // agentMessage item id) is swapped for last call's object when its
  // content is unchanged, keeping the reference strictly equal for
  // React.memo consumers. Synthetic flush messages have no id → always
  // fresh (they only exist on interrupted/streaming tails).
  const itemsById = new Map<string, Item>();
  for (const item of safeTurnItems(turn)) itemsById.set(item.id, item);
  for (let index = 0; index < fresh.length; index += 1) {
    const message = fresh[index];
    if (!message?.id) continue;
    const anchor = itemsById.get(message.id);
    if (!anchor) continue;
    const previous = itemMessageCache.get(anchor);
    if (previous && stableDeepEqual(previous, message)) {
      fresh[index] = previous;
    } else {
      itemMessageCache.set(anchor, message);
    }
  }

  turnMessagesCache.set(turn, fresh);
  return fresh;
}

function turnToMessages(turn: Turn): Message[] {
  const out: Message[] = [];
  // Persisted logs can outlive a schema revision. Treat a missing/corrupt
  // items field as an empty turn instead of crashing the whole conversation
  // during history recovery.
  const turnItems = safeTurnItems(turn);
  const supersededPreToolAnswers = supersededPreToolAnswerIds(turnItems);
  const hasLegacyMemberFailure = turnItems.some((item) => {
    if (item.type === "agentMessage") {
      return isLegacyInternalAgentError(itemStreamText(item));
    }
    if (item.type === "subagent") {
      const subagent = item;
      return (
        isLegacyInternalAgentError(subagent.summary) ||
        isLegacyInternalAgentError(subagent.error)
      );
    }
    return false;
  });

  // A cancelled turn may contain a final agentMessage snapshot whose bytes
  // were flushed just before the interruption. It is a recoverable draft,
  // not an authoritative response. Target only the last prose item; earlier
  // public checkpoints and completed tool evidence stay visible.
  let interruptedMessageId: string | null = null;
  if (
    turn.status === "interrupted" ||
    turn.status === "paused" ||
    turn.status === "cancelled"
  ) {
    for (let index = turnItems.length - 1; index >= 0; index -= 1) {
      const item = turnItems[index];
      if (item?.type === "agentMessage") {
        interruptedMessageId = item.id;
        break;
      }
    }
  }

  // We accumulate reasoning + plan into the AIMessage that FOLLOWS them.
  // ``pending`` holds the so-far-collected metadata that the next
  // agentMessage (or end-of-turn synthetic AI) will absorb. Tool items are
  // NOT buffered here: they are emitted immediately as their own AI
  // messages (see ``pushToolCallMessage``) so each command card lands at
  // its real position in the timeline.
  type PendingAi = {
    reasoning: string[];
    plan: string | null;
    // Sum of reasoning item durationMs contributing to this AI message.
    // Null when no reasoning item carried a duration (legacy data).
    reasoningDurationMs: number | null;
    // ISO timestamp of the earliest reasoning item's createdAt — used by
    // the UI to start the live thinking timer at the true first-token
    // arrival time instead of the React render frame.
    reasoningStartedAt: string | null;
    // ISO timestamp of the earliest item feeding this AI message — used by
    // the UI to show when the answer started (reasoning first, else the
    // answer prose item).
    createdAt: string | null;
  };
  const newPending = (): PendingAi => ({
    reasoning: [],
    plan: null,
    reasoningDurationMs: null,
    reasoningStartedAt: null,
    createdAt: null,
  });
  let pending: PendingAi = newPending();

  const pushAiMessage = (ai: AIMessage): void => {
    const duplicateIndex = findDuplicateAiMessageIndex(out, ai);
    const duplicate = out[duplicateIndex];
    if (duplicate && isAIMessage(duplicate)) {
      out[duplicateIndex] = mergeDuplicateAiMessages(duplicate, ai);
      return;
    }
    out.push(ai);
  };

  // Emit a tool item as its OWN message so it renders as an independent
  // inline card at the position it actually occurred in the timeline — not
  // buffered into the next agentMessage's tool_calls (which made commands
  // appear under a later bubble during streaming). The render pipeline
  // (convertToSteps) already turns an AI message's tool_calls into a
  // standalone timeline row, so this reuses that path without a new type.
  const pushToolCallMessage = (toolCall: ToolCall): void => {
    pushAiMessage({
      type: "ai",
      id: toolCall.id,
      content: "",
      tool_calls: [toolCall],
    });
  };

  const flushPendingAsTrailingAi = (): void => {
    // End-of-turn flush: if there's leftover reasoning/plan
    // but no agentMessage came through (e.g. interrupted mid-turn),
    // surface them as a synthetic AI record so the UI doesn't lose
    // the work-in-progress display. Tool items never land here — they
    // are emitted as independent messages at processing time.
    if (pending.reasoning.length === 0 && pending.plan === null) {
      return;
    }
    if (
      turn.status === "completed" &&
      mergePendingIntoLastAiAnswer(out, pending)
    ) {
      pending = newPending();
      return;
    }
    const kwargs = buildAiAdditionalKwargs(pending);
    if (
      turn.status === "interrupted" ||
      turn.status === "paused" ||
      turn.status === "cancelled"
    ) {
      kwargs.response_state = turn.status;
      if (turn.interruptReason) {
        kwargs.interrupt_reason = turn.interruptReason;
      }
    }
    const ai: AIMessage = {
      type: "ai",
      content: "",
      additional_kwargs: kwargs,
    };
    pushAiMessage(ai);
    pending = newPending();
  };

  for (const item of turnItems) {
    switch (item.type) {
      case "userMessage": {
        // Flush any preceding agent state before we move to a new
        // turn boundary represented by a user message inside the
        // turn (rare; usually one user message per turn).
        flushPendingAsTrailingAi();
        out.push(userMessageToHuman(item));
        break;
      }
      case "steeringUserMessage": {
        const steering = item;
        // Child reports are internal steering: they update the running
        // parent's model context and are already observable in Agent cards.
        // Rendering them as human messages creates fake turn 2/3 rows and
        // makes a single Kimi-style swarm look like several conversations.
        // Prefix detection keeps old persisted histories clean too.
        if (
          steering.source === "subagent_report" ||
          /^\s*\[子代理报告\]/.test(steering.text)
        ) {
          break;
        }
        flushPendingAsTrailingAi();
        out.push({
          type: "human",
          id: steering.id,
          content: steering.text,
          additional_kwargs: {
            steering: true,
            target_turn_id: steering.targetTurnId,
          },
        });
        break;
      }
      case "reasoning": {
        const r = item;
        const content = itemStreamText(r);
        if (content) pending.reasoning.push(content);
        else if (Array.isArray(r.summary) && r.summary.length > 0) {
          pending.reasoning.push(r.summary.join("\n"));
        }
        // Accumulate wall-clock thinking time across consecutive reasoning
        // items. Null durations (legacy data) are skipped; if every item is
        // null the total stays null so the UI shows nothing on replay.
        if (typeof r.durationMs === "number" && r.durationMs >= 0) {
          pending.reasoningDurationMs =
            (pending.reasoningDurationMs ?? 0) + r.durationMs;
        }
        // Keep the earliest reasoning item's createdAt so the UI can start
        // the live timer at the true first-token arrival time.
        if (
          r.createdAt &&
          (pending.reasoningStartedAt === null ||
            r.createdAt < pending.reasoningStartedAt)
        ) {
          pending.reasoningStartedAt = r.createdAt;
        }
        if (r.createdAt) pending.createdAt ??= r.createdAt;
        break;
      }
      case "plan": {
        pending.plan = itemStreamText(item);
        break;
      }
      case "commandExecution": {
        const ce = item;
        pushToolCallMessage({
          id: ce.id,
          name: commandExecutionToolName(ce),
          args: {
            ...commandExecutionInput(ce),
            output: itemStreamText(ce),
            exit_code: ce.exitCode,
            status: ce.status,
          },
          type: "tool_call",
          effectReceipt: ce.effectReceipt ?? undefined,
          ...toolCallTimelineCoordinates(ce),
        });
        break;
      }
      case "mcpToolCall": {
        const mcp = item;
        // Sub-agent lifecycle markers carry their identity payload in
        // ``result`` (finish) rather than ``arguments`` (spawn) — see
        // ``_subagent_lifecycle_item_from_journal``. The renderer only reads
        // args, so a finish row rendered as a nameless "委派任务". Fold the
        // result payload in as a fallback so both halves name their agent.
        const isSubagentMarker = mcp.tool.includes("subagent");
        const markerResult =
          isSubagentMarker && isObjectLike(mcp.result) ? mcp.result : null;
        pushToolCallMessage({
          id: mcp.id,
          name: `${mcp.server}.${mcp.tool}`,
          args: markerResult
            ? { ...markerResult, ...(mcp.arguments ?? {}) }
            : mcp.arguments,
          type: "tool_call",
          ...toolCallTimelineCoordinates(mcp),
        });
        break;
      }
      case "subagent": {
        const subagent = item;
        const legacyInternalError =
          isLegacyInternalAgentError(subagent.summary) ||
          isLegacyInternalAgentError(subagent.error);
        pushToolCallMessage({
          id: subagent.id,
          name: "subagent",
          args: {
            subagent_id: subagent.subagentId,
            role: subagent.role,
            name: subagent.name,
            codename: subagent.codename,
            status: legacyInternalError ? "failed" : subagent.status,
            summary: legacyInternalError ? null : subagent.summary,
            error: legacyInternalError
              ? "该成员当时未能生成有效回复。"
              : subagent.error,
            files_touched: subagent.filesTouched,
          },
          type: "tool_call",
          ...toolCallTimelineCoordinates(subagent),
        });
        break;
      }
      case "agentMessage": {
        const am = item;
        const isInterruptedMessage = am.id === interruptedMessageId;
        const isFailedMessage = am.status === "failed";
        const split = splitReactTrace(itemStreamText(am));
        const messageKind = supersededPreToolAnswers.has(am.id)
          ? "commentary"
          : (am.messageKind ??
            (split.publicUpdate && !split.finalAnswer
              ? "commentary"
              : "answer"));
        // The earliest item feeding a FINAL answer is its reasoning (or the
        // answer prose itself). Commentary/progress messages are separate
        // bubbles with their own start time — they must not inherit the
        // turn's earliest reasoning timestamp (overridden below).
        if (am.createdAt && messageKind !== "commentary") {
          pending.createdAt ??= am.createdAt;
        }
        // The backend's ReAct loop streams the LLM's raw trajectory:
        // "Thought: ...\nAction: tool(...)\nFinal Answer: ..." into
        // a single ``agentMessage`` item. Rendering that verbatim dumps
        // ReAct scaffolding into the chat bubble. Peel it apart here so
        // the main bubble shows only the polished Final Answer while
        // the thought process falls through to ``reasoning_content``
        // (collapsible) and the Action line is dropped (the tool call
        // is already surfaced as a separate commandExecution item).
        const kwargs = buildAiAdditionalKwargs(pending);
        // Merge any Thought text extracted from the agentMessage into
        // whatever reasoning the earlier ``reasoning`` items already
        // accumulated.
        if (split.thought) {
          const existing =
            typeof kwargs.reasoning_content === "string"
              ? kwargs.reasoning_content
              : "";
          kwargs.reasoning_content = existing
            ? `${existing}\n\n${split.thought}`
            : split.thought;
        }
        if (isPostFinalStatusOnlyMessage(split.finalAnswer, pending, out)) {
          pending = newPending();
          break;
        }
        // Per-speaker identity (group/team rooms) → additional_kwargs the
        // message-list reads to render the real author's avatar + name.
        if (am.agentDisplayName) {
          kwargs.agent_display_name = am.agentDisplayName;
        }
        if (am.agentAvatarUrl) {
          kwargs.agent_avatar_url = am.agentAvatarUrl;
        }
        if (am.agentIcon) {
          kwargs.agent_icon = am.agentIcon;
        }
        if (am.replyTo) {
          kwargs.reply_to = am.replyTo;
        }
        if (am.phaseId) {
          kwargs.phase_id = am.phaseId;
        }
        if (am.parentItemId) {
          kwargs.parent_item_id = am.parentItemId;
        }
        if (typeof am.progressSequence === "number") {
          kwargs.progress_sequence = am.progressSequence;
        }
        if (typeof am.timelineSequence === "number") {
          kwargs.timeline_sequence = am.timelineSequence;
        }
        // Current realtime messages carry an explicit protocol lane. Expose
        // it to the grouping layer so the very first answer token renders in
        // the answer lane instead of being reclassified later by text length
        // or Markdown shape. The fallback above keeps old logs compatible.
        kwargs.message_kind = messageKind;
        if (turn.execution) {
          kwargs.execution_engine = turn.execution.engine;
          kwargs.execution = turn.execution;
        }
        if (turn.outcomeReason) {
          kwargs.outcome_reason = turn.outcomeReason;
        }
        if (turn.completionDecision) {
          kwargs.completion_decision = turn.completionDecision;
        }
        if (turn.objectiveId) kwargs.objective_id = turn.objectiveId;
        if (turn.taskId) kwargs.task_id = turn.taskId;
        if (turn.checkpointId) kwargs.checkpoint_id = turn.checkpointId;
        if (isInterruptedMessage) {
          kwargs.response_state = turn.status;
          if (turn.interruptReason) {
            kwargs.interrupt_reason = turn.interruptReason;
          }
          if (split.finalAnswer?.trim()) {
            // Preserve the draft for replay; answer prose remains readable
            // in chat alongside an explicit incomplete/cancelled receipt.
            kwargs.interrupted_draft = split.finalAnswer;
          }
        }
        if (isFailedMessage) {
          const turnError =
            turn.error && typeof turn.error === "object" ? turn.error : null;
          // A "blocked_on_user" disposition is a genuine hand-off (the agent
          // asked the user for input), not an agent failure — surface it as a
          // waiting/amber state instead of a red "failed".
          const disposition =
            typeof turnError?.disposition === "string"
              ? turnError.disposition
              : "";
          const blockedOnUser = disposition === "blocked_on_user";
          const failureDetail = sanitizeLegacyGuardDiagnostic(
            (typeof turnError?.message === "string" &&
              turnError.message.trim()) ||
              split.finalAnswer?.trim() ||
              "turn failed",
          );
          const failureCode =
            (typeof turnError?.code === "string" && turnError.code.trim()) ||
            "agent_response_failed";
          const failureKind =
            typeof turnError?.failure_kind === "string"
              ? turnError.failure_kind
              : "";
          kwargs.response_state = blockedOnUser ? "blocked" : "failed";
          kwargs.error = {
            message: failureDetail,
            will_retry: false,
            info: {
              code: failureCode,
              ...(disposition ? { disposition } : {}),
              ...(failureKind ? { failure_kind: failureKind } : {}),
              details: turnError?.details,
            },
          };
        }
        if (messageKind === "commentary" && !isInterruptedMessage) {
          kwargs.public_progress = true;
        }
        // Commentary bubbles show their own start time instead of the
        // reasoning that preceded them in the same turn.
        if (messageKind === "commentary" && am.createdAt) {
          kwargs.created_at = am.createdAt;
        }
        const visibleContent = split.finalAnswer || split.publicUpdate || "";
        const preserveStoppedAnswer =
          isInterruptedMessage &&
          messageKind === "answer" &&
          (turn.status === "interrupted" || turn.status === "cancelled");
        const ai: AIMessage = {
          type: "ai",
          id: am.id,
          content:
            (isInterruptedMessage && !preserveStoppedAnswer) || isFailedMessage
              ? ""
              : hasLegacyMemberFailure &&
                  LEGACY_GROUP_SUMMARY_RE.test(visibleContent)
                ? "协作汇总：本轮部分成员未能生成有效回复，已按失败状态展示。"
                : sanitizeLegacyGroupSummary(
                    sanitizeLegacyInternalAgentError(visibleContent),
                  ),
          additional_kwargs: kwargs,
        };
        pushAiMessage(ai);
        pending = newPending();
        break;
      }
      case "fileChange": {
        // FileChanges are surfaced as AIMessage tool_calls so the
        // LiveToolTimeline sees them; the artifact list separately
        // collects the paths (see ``turnArtifactsFrom``).
        const fc = item;
        pushToolCallMessage({
          id: fc.id,
          name: "file_change",
          args: {
            changes: fc.changes,
            grant_root: fc.grantRoot,
          },
          type: "tool_call",
          ...toolCallTimelineCoordinates(fc),
        });
        break;
      }
      case "todo-list": {
        // Already surfaced via ``turnTodosFrom`` at the thread level;
        // no-op here.
        break;
      }
      case "approval": {
        const approval = item;
        pushToolCallMessage({
          id: approval.id,
          name: "approval",
          args: {
            method: approval.method,
            decision: approval.decision,
            target_item_id: approval.targetItemId,
            params: approval.params,
          },
          type: "tool_call",
          ...toolCallTimelineCoordinates(approval),
        });
        break;
      }
      case "verification": {
        const verification = item;
        pushToolCallMessage({
          id: verification.id,
          name: "verification",
          args: {
            command: verification.command,
            kind: verification.kind,
            exit_code: verification.exitCode,
            summary: verification.summary,
            related_files: verification.relatedFiles,
            related_change_item_ids: verification.relatedChangeItemIds,
          },
          type: "tool_call",
          ...toolCallTimelineCoordinates(verification),
        });
        break;
      }
      case "artifact": {
        const artifact = item;
        pushToolCallMessage({
          id: artifact.id,
          name: "artifact",
          args: {
            artifact_id: artifact.artifactId,
            kind: artifact.kind,
            path: artifact.path,
            title: artifact.title,
            render_status: artifact.renderStatus,
            validation_status: artifact.validationStatus,
          },
          type: "tool_call",
          ...toolCallTimelineCoordinates(artifact),
        });
        break;
      }
      case "visibility": {
        // Visibility (capability routing / delegation / skill-catalog)
        // snapshots are surfaced on the Agent workbench panel, not in the
        // conversation narrative — skip silently.
        break;
      }
      case "error": {
        flushPendingAsTrailingAi();
        pushAiMessage(errorToAi(item));
        break;
      }
      default: {
        // Unknown item types: skip silently. The reducer is stricter,
        // but this adapter prefers forward-compatibility (a future
        // item type shouldn't break legacy pages).
        const _exhaustive: never = item;
        void _exhaustive;
      }
    }
  }

  flushPendingAsTrailingAi();
  appendPausedTurnReceipt(out, turn);
  appendCancelledTurnReceipt(out, turn);
  appendInterruptedTurnReceipt(out, turn);
  appendFailedTurnReceipt(out, turn);
  attachGroundingToNarrativeAnchor(out, turn.grounding);
  // A tool-only AI record can anchor the grouped assistant header. Carry
  // the same observed engine there as on the final prose and error receipt.
  if (turn.execution) {
    for (const message of out) {
      if (message.type === "ai") {
        message.additional_kwargs = {
          ...message.additional_kwargs,
          execution_engine: turn.execution.engine,
          execution: turn.execution,
        };
      }
    }
  }
  const startedAt = Date.parse(turn.startedAt);
  const completedAt = turn.completedAt ? Date.parse(turn.completedAt) : NaN;
  if (Number.isFinite(startedAt) && Number.isFinite(completedAt)) {
    const turnDurationMs = Math.max(0, completedAt - startedAt);
    for (const message of out) {
      if (message.type !== "ai") continue;
      message.additional_kwargs = {
        ...message.additional_kwargs,
        turn_duration_ms: turnDurationMs,
      };
    }
  }
  return out;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Convenience: derive ``isLoading`` / ``error`` from Conversation
// for callers that need just those flags without full state mapping.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function conversationIsLoading(conv: Conversation): boolean {
  if (conv.turns.length === 0) return false;
  const last = conv.turns[conv.turns.length - 1];
  return last !== undefined && last.status === "inProgress";
}

export function conversationStreamingMessage(
  conv: Conversation,
): Message | null {
  if (!conversationIsLoading(conv)) return null;
  const last = conv.turns[conv.turns.length - 1];
  if (!last) return null;
  // Shares the identity cache with conversationToAgentThreadState so the
  // streaming message keeps the same reference as its list counterpart.
  const messages = turnToMessagesStable(last);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.type === "ai") return message;
  }
  return null;
}

export function conversationLastError(conv: Conversation): Error | undefined {
  // Return only when the most-recent turn ended in a hard failure.
  if (conv.turns.length === 0) return undefined;
  const last = conv.turns[conv.turns.length - 1];
  if (last === undefined) return undefined;
  if (last.status !== "failed") return undefined;
  if (last.error && typeof last.error === "object") {
    const m = last.error.message;
    const message = sanitizeLegacyGuardDiagnostic(
      typeof m === "string" ? m : "turn failed",
    );
    if (!/^turn failed$/i.test(message.trim())) {
      return new Error(message);
    }
  }
  // Look for a trailing ErrorItem.
  const lastItems = safeTurnItems(last);
  for (let i = lastItems.length - 1; i >= 0; i--) {
    const item = lastItems[i];
    if (item !== undefined && item.type === "error") {
      return new Error(sanitizeLegacyGuardDiagnostic(item.message));
    }
  }
  for (let i = lastItems.length - 1; i >= 0; i--) {
    const item = lastItems[i];
    if (
      item?.type === "agentMessage" &&
      item.status === "failed" &&
      itemStreamText(item).trim()
    ) {
      return new Error(
        sanitizeLegacyGuardDiagnostic(itemStreamText(item).trim()),
      );
    }
  }
  const verificationMessage = failedVerificationMessage(last);
  if (verificationMessage) return new Error(verificationMessage);
  if (isNoOutputPlannerFailure(last)) return undefined;
  return new Error("turn failed");
}
