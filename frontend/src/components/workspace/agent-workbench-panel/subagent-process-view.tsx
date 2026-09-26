import { useMemo, useRef, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownIcon,
  BookmarkIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  PencilIcon,
  SendHorizontalIcon,
  Share2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { eventBus } from "@/core/events/event-bus";

import type { AIMessage, Message, ToolMessage } from "@/core/api/types";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";
import {
  STREAMING_TYPE_PRESETS,
  useStreamingTextBuffer,
} from "@/hooks/use-streaming-text-buffer";

import type { AgentTile } from "../agent-workbench-utils";
import { repairMojibakeText } from "../agent-workbench-utils";
import type { LiveToolEvent } from "../live-tool-timeline";
import type { WorkBlock } from "../work-blocks";
import { MessageGroup } from "../messages/message-group";
import { MessageListItem } from "../messages/message-list-item";
import { ComputerScopeSwitch } from "./computer-scope-switch";

function publicBlockOutput(block: WorkBlock): string {
  const observation = block.event.observation?.trim();
  if (observation) return repairMojibakeText(readableResultText(observation));
  if (block.event.error?.trim()) return repairMojibakeText(block.event.error);
  // Prefer a readable text channel inside an object payload over a raw
  // JSON.stringify dump — same contract as subagentResultText. Fall back to
  // the stringified snapshot only when the payload carries no text field.
  const rawOutput = block.event.output;
  if (rawOutput && typeof rawOutput === "object" && !Array.isArray(rawOutput)) {
    const readable = readableResultText(rawOutput);
    if (readable) return repairMojibakeText(readable);
  }
  const output = block.outputText.trim();
  if (output) return repairMojibakeText(readableResultText(output));
  return "";
}

const RESULT_TEXT_KEYS = [
  "output",
  "summary",
  "result",
  "reason",
  "message",
  "text",
  "content",
  "output_preview",
  "stdout",
  "content_text",
];

/** Turn a structured result — including legacy JSON-in-a-string envelopes —
 * into the sentence a person is meant to read. Metadata-only envelopes stay
 * blank instead of leaking implementation details into the conversation. */
function readableResultText(value: unknown, depth = 0): string {
  if (depth > 2 || value === null || value === undefined) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const readable = readableResultText(parsed, depth + 1);
        if (readable) return readable;
      } catch {
        // It only looked like JSON; preserve the original public text.
      }
    }
    return trimmed;
  }
  if (typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  for (const key of RESULT_TEXT_KEYS) {
    const readable = readableResultText(record[key], depth + 1);
    if (readable) return readable;
  }
  return "";
}

/** Readable final-answer text for a finished sub-agent event.
 *
 * Prefer explicit text channels (``observation``, ``result.output`` /
 * ``summary`` / ``output_preview`` / ``result``). Never JSON-stringify the
 * whole result envelope as a stand-in answer — that used to render the
 * lifecycle metadata ({codename, role, agent_id, duration_s, ...}) as if it
 * were the agent's verdict. */
function subagentResultText(event: LiveToolEvent): string {
  const observation = event.observation?.trim();
  if (observation) return readableResultText(observation);
  for (const bag of [event.input, event.output]) {
    const text = readableResultText(bag);
    if (text) return text;
  }
  return event.error?.trim() ?? "";
}

/**
 * Project one selected sub-agent's event stream onto the exact message model
 * used by the main conversation. MessageGroup then owns thinking/execution
 * streaming, aggregation and disclosure state; this view owns only isolation.
 */
function subagentMessages(
  agent: AgentTile,
  blocks: WorkBlock[],
): {
  task: Message | null;
  process: Message[];
  answer: Message | null;
} {
  const taskText = repairMojibakeText(
    agent.prompt ?? agent.task ?? agent.lastThought ?? "",
  );
  const task: Message | null = taskText
    ? {
        id: `subagent-${agent.id}-task`,
        type: "human",
        content: taskText,
      }
    : null;
  const process: Message[] = [];
  // Once the agent settles, a trailing block that never received a done event
  // must not keep rendering as "running": fold its output into a real result
  // row instead of leaving a half-open step.
  const settled = agent.status !== "running";
  let answerText = "";
  let answerId = `subagent-${agent.id}-answer`;

  for (const block of blocks) {
    const event = block.event;
    if (event.lifecycle === "spawned") continue;
    if (event.lifecycle === "finished") {
      const text = repairMojibakeText(
        subagentResultText(event) || agent.resultSummary || agent.error || "",
      );
      if (text) {
        answerText = text;
        answerId = `${block.id}-answer`;
      }
      continue;
    }

    const callId = event.id || block.id;
    const output = publicBlockOutput(block);
    const thought = repairMojibakeText(event.thought?.trim() || "");
    const ai: AIMessage = {
      id: `${block.id}-assistant`,
      type: "ai",
      content: "",
      tool_calls: [
        {
          id: callId,
          name: event.name,
          args: {
            ...(event.input ?? {}),
            // Match the main conversation's realtime adapter contract: live
            // execution output belongs to the active tool call until it ends.
            ...(event.status === "running" && !settled && output
              ? { output }
              : {}),
          },
          parentItemId: event.parentToolUseId ?? null,
        },
      ],
      additional_kwargs: {
        ...(thought ? { reasoning_content: thought } : {}),
        agent_id: agent.id,
        agent_display_name: agent.codename ?? agent.name,
      },
    };
    process.push(ai);

    if (event.status === "done" || event.status === "error" || settled) {
      const tool: ToolMessage = {
        id: `${block.id}-result`,
        type: "tool",
        tool_call_id: callId,
        content: output || event.error || "",
        status: event.status === "error" ? "error" : "success",
      };
      process.push(tool);
    }
  }

  if (!answerText) {
    answerText = repairMojibakeText(
      readableResultText(agent.resultSummary ?? agent.error ?? ""),
    );
  }
  const answer: Message | null = answerText
    ? {
        id: answerId,
        type: "ai",
        content: answerText,
        additional_kwargs: {
          agent_id: agent.id,
          agent_display_name: agent.codename ?? agent.name,
          ...(agent.status === "error" ? { response_state: "failed" } : {}),
        },
      }
    : null;

  return { task, process, answer };
}

export function SubagentProcessView({
  agent,
  blocks,
  onOpenMain,
  summaryOnly = false,
}: {
  agent: AgentTile;
  blocks: WorkBlock[];
  currentBlockId?: string | null;
  onOpenMain: () => void;
  onSelectBlock?: (blockId: string) => void;
  summaryOnly?: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [followupText, setFollowupText] = useState("");

  const handlePromoteToThread = () => {
    const params = new URLSearchParams();
    if (agent.name) params.set("agent", agent.name);
    if (agent.prompt || agent.task) {
      params.set(
        "prompt",
        `针对前序子任务继续推进：\n${agent.prompt || agent.task}\n\n`,
      );
    }
    navigate(`/workspace/realtime/new?${params.toString()}`);
    toast.success(`已为 ${agent.codename ?? agent.name} 开启独立对话窗口`);
  };

  const handlePublishToRoom = () => {
    const summary = readableResultText(
      agent.resultSummary || agent.task || agent.error || "",
    ).trim();
    const name = agent.codename ?? agent.name ?? "并列协作者";
    const text = summary
      ? `📢 来自并列协作者【${name}】的阶段交付：\n\n${summary}`
      : `📢 并列协作者【${name}】正在推进：\n${agent.task || ""}`;
    eventBus.emit("composer:insert-mention", {
      text,
      submit: true,
    });
    toast.success(`已将【${name}】的工作成果同步发布至群公共`);
  };

  const [decisionRecorded, setDecisionRecorded] = useState(false);

  const handleRecordDecision = () => {
    const summary = readableResultText(
      agent.resultSummary || agent.task || agent.error || "",
    ).trim();
    const name = agent.codename ?? agent.name ?? "并列协作者";
    const text = summary
      ? `🏛️ [项目决策固化] 采纳并列协作者【${name}】交付方案：\n\n${summary}`
      : `🏛️ [项目决策固化] 确立并列协作者【${name}】推进目标：\n${agent.task || ""}`;
    eventBus.emit("composer:insert-mention", {
      text,
      submit: true,
    });
    setDecisionRecorded(true);
    toast.success(`已将【${name}】的成果固化为长项目核心决策`);
  };

  const handleForkSandbox = () => {
    const targetName = agent.codename ?? agent.name ?? "并列协作者";
    const text = `🌱 【方案推演沙盒】针对并列协作者【${targetName}】的方案开启隔离推演验证：\n- 目标：${agent.task || "验证当前方案可行性"}\n- 请在沙盒内进行推演与 POC 测试，不污染项目主干。`;
    eventBus.emit("composer:insert-mention", {
      text,
      submit: true,
    });
    toast.success(`已为【${targetName}】开辟推演沙盒分支`);
  };

  const handleFollowupSubmit = (e: React.FormEvent, directSend = true) => {
    e.preventDefault();
    const text = followupText.trim();
    if (!text) return;
    const targetName = agent.name || agent.codename || "agent";
    eventBus.emit("composer:insert-mention", {
      text: `@${targetName} ${text}`,
      submit: directSend,
    });
    setFollowupText("");
    toast.success(
      directSend
        ? `已向并列协作者 ${agent.codename ?? agent.name} 直接发送对话`
        : `已将针对 ${agent.codename ?? agent.name} 的指令装入输入框`,
    );
  };

  const messages = useMemo(
    () => subagentMessages(agent, blocks),
    [agent, blocks],
  );

  // 智能滚动锚点：自动滚动到底部，除非用户主动向上滚动
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollFab, setShowScrollFab] = useState(false);

  // 检测用户是否主动滚动离开底部
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setAutoScroll(isNearBottom);
      setShowScrollFab(!isNearBottom && agent.status === "running");
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [agent.status]);

  // 当有新消息且处于自动滚动模式时，滚动到底部
  useEffect(() => {
    if (autoScroll && agent.status === "running") {
      const container = containerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    }
  }, [messages, autoScroll, agent.status]);

  const handleScrollToBottom = () => {
    setAutoScroll(true);
    const container = containerRef.current;
    container?.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  };
  const isRunning = agent.status === "running";
  const answerText =
    typeof messages.answer?.content === "string" ? messages.answer.content : "";
  // Reveal the final answer with the same typewriter buffer the main
  // conversation uses. The sub-agent's verdict only materialises at the
  // terminal finished marker (it isn't streamed token-by-token), so once the
  // run settles we drain the burst smoothly instead of a hard flash-in.
  // ``resetKey`` stays pinned to the agent so a live settle animates while a
  // replay/history switch shows the full text instantly.
  const answerDisplay = useStreamingTextBuffer({
    targetText: answerText,
    enabled: isRunning,
    resetKey: agent.id,
    ...STREAMING_TYPE_PRESETS.burstDrain,
  });
  const hasConversation = Boolean(
    messages.answer ||
    (!summaryOnly && (messages.task || messages.process.length > 0)),
  );

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div
        ref={containerRef}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col">
          <ComputerScopeSwitch
            subLabel={`${agent.codename ?? agent.name} · 并列协作者 ${agent.label}`}
            onOpenMain={onOpenMain}
            trailingAction={
              <div className="flex flex-wrap items-center gap-1.5 [&>button]:min-h-7 [&>button]:shrink-0 [&>button]:whitespace-nowrap [&_svg]:shrink-0">
                <button
                  type="button"
                  onClick={handleRecordDecision}
                  disabled={decisionRecorded}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    decisionRecorded
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : "border-border/60 bg-background/80 text-foreground/80 hover:bg-muted hover:text-foreground",
                  )}
                  title="将该并列协作者的交付成果作为长项目的核心决策固化沉淀到 Project OS 事实库"
                >
                  <BookmarkIcon className="size-3" />
                  <span>
                    {decisionRecorded ? "已固化为决策" : "固化为决策"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleForkSandbox}
                  className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-xs font-medium text-foreground/80 transition-all hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  title="开辟独立推演沙盒，进行多方案 POC 隔离验证"
                >
                  <GitBranchIcon className="size-3" />
                  <span>推演沙盒</span>
                </button>
                <button
                  type="button"
                  onClick={handlePublishToRoom}
                  className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-all hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  title="将该并列协作者的产出作为阶段成果同步发布到群公共流"
                >
                  <Share2Icon className="size-3" />
                  <span>同步至群公共</span>
                </button>
                <button
                  type="button"
                  onClick={handlePromoteToThread}
                  className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/80 px-2 py-0.5 text-xs font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  title="以独立对话窗口打开此并列进程，支持长期深度多轮对话"
                >
                  <ExternalLinkIcon className="size-3" />
                  <span>以独立会话打开</span>
                </button>
              </div>
            }
          />
          {!hasConversation ? (
            <div className="flex min-h-48 items-center justify-center px-5 text-sm text-muted-foreground">
              {t.agentWorkbenchPanel.waitingForSubagentOutput}
            </div>
          ) : (
            <div
              className="min-w-0 space-y-3 px-3 py-4"
              data-testid="subagent-main-conversation"
            >
              {!summaryOnly && messages.task ? (
                <MessageListItem
                  message={messages.task}
                  isLastMessage={false}
                />
              ) : null}
              {!summaryOnly && messages.process.length > 0 ? (
                <MessageGroup
                  messages={messages.process}
                  isLoading={isRunning}
                  keepOpen={isRunning}
                  codeMode
                />
              ) : null}
              {isRunning &&
              messages.process.length === 0 &&
              !messages.answer ? (
                <p role="status" className="text-xs text-muted-foreground">
                  正在并行运行，等待并列协作者返回进展…
                </p>
              ) : null}
              {messages.answer ? (
                <MessageListItem
                  message={{ ...messages.answer, content: answerDisplay }}
                  isLoading={isRunning}
                  isLastMessage
                />
              ) : null}
              <div className="h-4" />
            </div>
          )}
        </div>
      </div>

      {/* 底部定向追问/介入栏 */}
      <div
        data-testid="subagent-followup-bar"
        className="min-w-0 shrink-0 border-t border-border-subtle bg-background/95 p-2.5 backdrop-blur-xs"
      >
        <form
          onSubmit={(e) => handleFollowupSubmit(e, true)}
          className="mx-auto flex w-full min-w-0 max-w-2xl flex-wrap items-center justify-end gap-2"
        >
          <input
            type="text"
            aria-label={`向 ${agent.codename ?? agent.name} 发送指令`}
            value={followupText}
            onChange={(e) => setFollowupText(e.target.value)}
            placeholder={`随时打字向并列协作者 ${agent.codename ?? agent.name} 发起对话或发送指令…`}
            className="min-w-0 flex-[1_1_220px] rounded-md border border-input bg-background/80 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={!followupText.trim()}
              onClick={(e) => handleFollowupSubmit(e, false)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/50 bg-background/80 px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              title="装入主输入框草稿编辑"
            >
              <PencilIcon className="size-3" />
              <span>装入草稿</span>
            </button>
            <button
              type="submit"
              disabled={!followupText.trim()}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:opacity-50"
              title="直接发送对话给该并列协作者"
            >
              <SendHorizontalIcon className="size-3.5" />
              <span>直接发送</span>
            </button>
          </div>
        </form>
      </div>

      {/* 滚动到底部的悬浮按钮 */}
      {showScrollFab && (
        <button
          type="button"
          onClick={handleScrollToBottom}
          className={cn(
            "absolute bottom-28 right-4 z-10 flex items-center gap-2 rounded-full border border-border-default bg-background px-4 py-2.5 text-sm font-medium shadow-lg transition-all hover:scale-105 hover:shadow-xl",
            "animate-in fade-in slide-in-from-bottom-4 duration-300",
          )}
          aria-label={t.agentWorkbenchPanel?.scrollToBottom ?? "滚动到底部"}
        >
          <ArrowDownIcon className="size-4" />
          <span>
            {t.agentWorkbenchPanel?.viewLatestProgress ?? "查看最新进展"}
          </span>
        </button>
      )}
    </div>
  );
}
