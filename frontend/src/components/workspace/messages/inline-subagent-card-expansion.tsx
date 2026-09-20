import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BookmarkIcon,
  CheckIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  Loader2Icon,
  MessageSquareIcon,
  Share2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { eventBus } from "@/core/events/event-bus";
import { cn } from "@/lib/utils";
import type { InlineSubagentInfo } from "./inline-subagent-cards";

export interface InlineSubagentCardExpansionProps {
  agent: InlineSubagentInfo;
  isOpen: boolean;
  onOpenWorkbench: () => void;
  onForkSandbox?: () => void;
  onRecordDecision?: () => void;
  className?: string;
}

export function InlineSubagentCardExpansion({
  agent,
  isOpen,
  onOpenWorkbench,
  onForkSandbox,
  onRecordDecision,
  className,
}: InlineSubagentCardExpansionProps) {
  const navigate = useNavigate();
  const routeParams = useParams();
  const currentThreadId = routeParams.threadId ?? routeParams.thread_id;
  const [published, setPublished] = useState(false);
  const [decisionRecorded, setDecisionRecorded] = useState(false);

  if (!isOpen) return null;

  const handlePublishToRoom = () => {
    const summary = (agent.summary || agent.task || agent.error || "").trim();
    const name = agent.name || "并列协作者";
    const text = summary
      ? `📢 来自并列协作者【${name}】的阶段交付：\n\n${summary}`
      : `📢 并列协作者【${name}】正在推进：\n${agent.task || ""}`;
    eventBus.emit("composer:insert-mention", {
      text,
      submit: true,
    });
    setPublished(true);
    toast.success(`已将【${name}】的工作成果同步发布至群公共`);
  };

  const handleRecordDecision = () => {
    if (onRecordDecision) {
      onRecordDecision();
      setDecisionRecorded(true);
      return;
    }
    const summary = (agent.summary || agent.task || agent.error || "").trim();
    const name = agent.name || "并列协作者";
    const text = summary
      ? `🏛️ [项目决策固化] 采纳并列协作者【${name}】交付成果：\n\n${summary}`
      : `🏛️ [项目决策固化] 确立并列协作者【${name}】推进目标：\n${agent.task || ""}`;
    eventBus.emit("composer:insert-mention", {
      text,
      submit: true,
    });
    setDecisionRecorded(true);
    toast.success(`已将【${name}】的成果固化为长项目核心决策`);
  };

  const handleForkSandbox = () => {
    const name = agent.name || "并列协作者";
    if (onForkSandbox) {
      onForkSandbox();
      return;
    }
    const params = new URLSearchParams();
    if (agent.name) params.set("agent", agent.name);
    if (agent.task || agent.summary) {
      params.set(
        "prompt",
        `【方案推演沙盒】\n针对前序长项目任务展开独立概念验证（POC）与方案推演：\n${agent.task || agent.summary}\n\n`,
      );
    }
    params.set("sandbox", "true");
    if (currentThreadId) params.set("parent_thread_id", currentThreadId);
    navigate(`/workspace/realtime/new?${params.toString()}`);
    toast.info(`已为【${name}】开辟独立的方案推演沙盒`);
  };

  const handleDirectFollowup = () => {
    const targetName = agent.name || "agent";
    eventBus.emit("composer:insert-mention", {
      text: `@${targetName} `,
      submit: false,
    });
    toast.info(`已将针对【${targetName}】的对话装填入主输入框`);
  };

  return (
    <div
      data-testid={`agent-inline-expansion-${agent.index ?? 0}`}
      className={cn(
        "mx-1 mt-1 basis-full rounded-md border border-border/60 bg-background/70 p-2.5 text-xs text-muted-foreground shadow-xs backdrop-blur-xs",
        className,
      )}
    >
      {/* 顶部第一视角身份徽章与状态 */}
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-border/40 pb-1.5">
        <div className="flex min-w-0 items-center gap-1.5 font-medium text-foreground/80">
          <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            我的第一视角 · 并列协作者
          </span>
          <span className="text-muted-foreground/50">|</span>
          <span className="truncate text-xs text-foreground/90">
            {agent.name || "并列协作者"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground/80">
          {agent.filesTouchedCount > 0 && (
            <span>修改了 {agent.filesTouchedCount} 个文件</span>
          )}
          {agent.iterationCount && agent.iterationCount > 0 ? (
            <span>{agent.iterationCount} 轮迭代</span>
          ) : null}
        </div>
      </div>

      {/* 任务描述与阶段成果 */}
      <div className="space-y-1.5 leading-relaxed">
        {agent.task && (
          <div className="rounded bg-muted/40 px-2 py-1 text-[11px] text-foreground/80">
            <span className="font-medium text-foreground/90">任务目标：</span>
            {agent.task}
          </div>
        )}

        {agent.error ? (
          <div className="rounded border border-destructive/20 bg-destructive/10 p-2 text-destructive">
            <span className="font-medium">遇到错误：</span>
            <p className="mt-0.5 whitespace-pre-wrap">{agent.error}</p>
          </div>
        ) : agent.summary ? (
          <div
            data-testid={`agent-report-${agent.index ?? 0}`}
            className="whitespace-pre-wrap rounded border border-border/40 bg-background/50 p-2 text-foreground/90"
          >
            {agent.summary}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 py-1 text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            <span>并列协作者正在后台并行推进中，随时可查看执行画面或发送指令…</span>
          </div>
        )}
      </div>

      {/* 底部第一视角与长项目专属操作栏 */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-border/40 pt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handlePublishToRoom}
            disabled={published}
            className={cn(
              "inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              published
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20",
            )}
            title="将该并列协作者产出的阶段性结果，一键发布到全群公共主对话中"
          >
            {published ? (
              <CheckIcon className="size-3" />
            ) : (
              <Share2Icon className="size-3" />
            )}
            <span>{published ? "已同步至群公共" : "同步至群公共"}</span>
          </button>

          <button
            type="button"
            onClick={handleRecordDecision}
            disabled={decisionRecorded}
            className={cn(
              "inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              decisionRecorded
                ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "border-border/60 bg-background/80 text-foreground/80 hover:bg-muted hover:text-foreground",
            )}
            title="将该并列协作者的交付成果作为长项目的核心决策固化沉淀到 Project OS 事实库"
          >
            <BookmarkIcon className="size-3" />
            <span>{decisionRecorded ? "已固化为决策" : "固化为决策"}</span>
          </button>

          <button
            type="button"
            onClick={handleForkSandbox}
            className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/80 px-2 py-1 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title="开辟独立推演沙盒，进行多方案 POC 隔离验证，避免污染长项目主干"
          >
            <GitBranchIcon className="size-3" />
            <span>推演沙盒</span>
          </button>

          <button
            type="button"
            onClick={handleDirectFollowup}
            className="inline-flex items-center gap-1 rounded border border-border/50 bg-background/80 px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title="在主输入框定向 @该协作者 发起追问"
          >
            <MessageSquareIcon className="size-3" />
            <span>定向追问</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenWorkbench}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          title="在右侧工作台大屏查看完整的工具调用流与执行画面"
        >
          <span>在大屏工作台查看完整流</span>
          <ExternalLinkIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}
