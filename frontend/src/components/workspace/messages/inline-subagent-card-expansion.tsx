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
import { useI18n } from "@/core/i18n/hooks";
import { projectCollabCopy } from "@/core/i18n/locales/project-collab";
import { cn } from "@/lib/utils";
import type { InlineSubagentInfo } from "./inline-subagent-cards";
import {
  BROADCAST_DELIVERY_PREFIX,
  BROADCAST_DELIVERY_SUFFIX,
  BROADCAST_PROGRESS_PREFIX,
  BROADCAST_PROGRESS_SUFFIX,
  DECISION_MARKER,
  SANDBOX_MARKER,
} from "./project-collaboration-landmark";

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
  const { locale } = useI18n();
  const collabCopy = projectCollabCopy(locale);
  const copy = collabCopy.expansion;
  const navigate = useNavigate();
  const routeParams = useParams();
  const currentThreadId = routeParams.threadId ?? routeParams.thread_id;
  const [published, setPublished] = useState(false);
  const [decisionRecorded, setDecisionRecorded] = useState(false);

  if (!isOpen) return null;

  const handlePublishToRoom = () => {
    const summary = (agent.summary || agent.task || agent.error || "").trim();
    const name = agent.name || collabCopy.collaboratorFallback;
    // The broadcast header is protocol (see project-collaboration-landmark);
    // the landmark card shows it localized.
    const text = summary
      ? `${BROADCAST_DELIVERY_PREFIX}${name}${BROADCAST_DELIVERY_SUFFIX}\n\n${summary}`
      : `${BROADCAST_PROGRESS_PREFIX}${name}${BROADCAST_PROGRESS_SUFFIX}\n${agent.task || ""}`;
    eventBus.emit("composer:insert-mention", {
      text,
      submit: true,
    });
    setPublished(true);
    toast.success(copy.publishedToast(name));
  };

  const handleRecordDecision = () => {
    if (onRecordDecision) {
      onRecordDecision();
      setDecisionRecorded(true);
      return;
    }
    const summary = (agent.summary || agent.task || agent.error || "").trim();
    const name = agent.name || collabCopy.collaboratorFallback;
    const text = summary
      ? `${DECISION_MARKER} ${copy.decisionAdopted(name)}\n\n${summary}`
      : `${DECISION_MARKER} ${copy.decisionGoal(name)}\n${agent.task || ""}`;
    eventBus.emit("composer:insert-mention", {
      text,
      submit: true,
    });
    setDecisionRecorded(true);
    toast.success(copy.decisionToast(name));
  };

  const handleForkSandbox = () => {
    const name = agent.name || collabCopy.collaboratorFallback;
    if (onForkSandbox) {
      onForkSandbox();
      return;
    }
    const params = new URLSearchParams();
    if (agent.name) params.set("agent", agent.name);
    if (agent.task || agent.summary) {
      params.set(
        "prompt",
        `${SANDBOX_MARKER}\n${copy.sandboxPromptIntro}\n${agent.task || agent.summary}\n\n`,
      );
    }
    params.set("sandbox", "true");
    if (currentThreadId) params.set("parent_thread_id", currentThreadId);
    void navigate(`/workspace/realtime/new?${params.toString()}`);
    toast.info(copy.sandboxToast(name));
  };

  const handleDirectFollowup = () => {
    const targetName = agent.name || "agent";
    eventBus.emit("composer:insert-mention", {
      text: `@${targetName} `,
      submit: false,
    });
    toast.info(copy.followUpToast(targetName));
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
          <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
            {copy.perspectiveBadge}
          </span>
          <span className="text-muted-foreground">|</span>
          <span className="truncate text-xs text-foreground/90">
            {agent.name || collabCopy.collaboratorFallback}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground/80">
          {agent.filesTouchedCount > 0 && (
            <span>{copy.filesTouched(agent.filesTouchedCount)}</span>
          )}
          {agent.iterationCount && agent.iterationCount > 0 ? (
            <span>{copy.iterations(agent.iterationCount)}</span>
          ) : null}
        </div>
      </div>

      {/* 任务描述与阶段成果 */}
      <div className="space-y-1.5 leading-relaxed">
        {agent.task && (
          <div className="rounded bg-muted/40 px-2 py-1 text-xs text-foreground/80">
            <span className="font-medium text-foreground/90">
              {copy.taskGoal}
            </span>
            {agent.task}
          </div>
        )}

        {agent.error ? (
          <div className="rounded border border-destructive/20 bg-destructive/10 p-2 text-destructive">
            <span className="font-medium">{copy.errorLabel}</span>
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
            <span>{copy.working}</span>
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
                ? "border-core/30 bg-core/10 text-core"
                : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20",
            )}
            title={copy.publishHint}
          >
            {published ? (
              <CheckIcon className="size-3" />
            ) : (
              <Share2Icon className="size-3" />
            )}
            <span>{published ? copy.published : copy.publish}</span>
          </button>

          <button
            type="button"
            onClick={handleRecordDecision}
            disabled={decisionRecorded}
            className={cn(
              "inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              decisionRecorded
                ? "border-core/30 bg-core/10 text-core"
                : "border-border/60 bg-background/80 text-foreground/80 hover:bg-muted hover:text-foreground",
            )}
            title={copy.decisionHint}
          >
            <BookmarkIcon className="size-3" />
            <span>
              {decisionRecorded ? copy.decisionRecorded : copy.recordDecision}
            </span>
          </button>

          <button
            type="button"
            onClick={handleForkSandbox}
            className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/80 px-2 py-1 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title={copy.sandboxHint}
          >
            <GitBranchIcon className="size-3" />
            <span>{copy.sandbox}</span>
          </button>

          <button
            type="button"
            onClick={handleDirectFollowup}
            className="inline-flex items-center gap-1 rounded border border-border/50 bg-background/80 px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title={copy.followUpHint}
          >
            <MessageSquareIcon className="size-3" />
            <span>{copy.followUp}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenWorkbench}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          title={copy.openWorkbenchHint}
        >
          <span>{copy.openWorkbench}</span>
          <ExternalLinkIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}
