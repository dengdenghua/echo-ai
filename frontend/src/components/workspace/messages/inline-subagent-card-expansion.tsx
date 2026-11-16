import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BookmarkIcon,
  CheckIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  Loader2Icon,
  MessageSquareIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react";
import { toast } from "sonner";
import { eventBus } from "@/core/events/event-bus";
import {
  submitComposerRequest,
  type ComposerRequestResult,
} from "@/core/threads/composer-request";
import { formatSessionReferenceMention } from "../mention-autocomplete";
import { useI18n } from "@/core/i18n/hooks";
import { projectCollabCopy } from "@/core/i18n/locales/project-collab";
import { cn } from "@/lib/utils";
import { useChatRehypePlugins } from "@/core/rehype";
import { MarkdownContent } from "./markdown-content";
import type { InlineSubagentInfo } from "./inline-subagent-helpers";
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
  onRecordDecision?: () => void | boolean | Promise<void | boolean>;
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
  const rehypePlugins = useChatRehypePlugins({ splitWords: false });
  const navigate = useNavigate();
  const routeParams = useParams();
  const currentThreadId = routeParams.threadId ?? routeParams.thread_id;
  const [published, setPublished] = useState(false);
  const [decisionRecorded, setDecisionRecorded] = useState(false);
  const [pending, setPending] = useState<"publish" | "decision" | null>(null);
  const [result, setResult] = useState<ComposerRequestResult | null>(null);
  const busy = useRef(false);
  const scope = useRef<object>({});
  useEffect(() => {
    const token = {};
    scope.current = token;
    busy.current = false;
    setPending(null);
    setResult(null);
    setPublished(false);
    setDecisionRecorded(false);
    return () => {
      if (scope.current === token) scope.current = {};
    };
  }, [agent.id, agent.sessionId, currentThreadId]);

  const runAction = async (action: "publish" | "decision", text: string) => {
    if (busy.current || result === "unknown") return;
    busy.current = true;
    setPending(action);
    setResult(null);
    const token = scope.current;
    let outcome: ComposerRequestResult;
    try {
      if (action === "decision" && onRecordDecision) {
        const accepted = await onRecordDecision();
        outcome =
          accepted === true
            ? "confirmed"
            : accepted === false
              ? "failed"
              : "unknown";
      } else outcome = await submitComposerRequest(currentThreadId, text);
    } catch {
      outcome = "failed";
    }
    if (scope.current !== token) return;
    busy.current = false;
    setPending(null);
    setResult(outcome);
    if (outcome === "confirmed") {
      if (action === "publish") setPublished(true);
      else setDecisionRecorded(true);
      toast.success(
        action === "publish"
          ? copy.publishedToast(agent.name)
          : copy.decisionToast(agent.name),
      );
    }
  };

  if (!isOpen) return null;

  const handlePublishToRoom = () => {
    const summary = (agent.summary || agent.task || agent.error || "").trim();
    const name = agent.name || collabCopy.collaboratorFallback;
    // The broadcast header is protocol (see project-collaboration-landmark);
    // the landmark card shows it localized.
    const text = summary
      ? `${BROADCAST_DELIVERY_PREFIX}${name}${BROADCAST_DELIVERY_SUFFIX}\n\n${summary}`
      : `${BROADCAST_PROGRESS_PREFIX}${name}${BROADCAST_PROGRESS_SUFFIX}\n${agent.task || ""}`;
    void runAction("publish", text);
  };

  const handleRecordDecision = () => {
    const summary = (agent.summary || agent.task || agent.error || "").trim();
    const name = agent.name || collabCopy.collaboratorFallback;
    const text = summary
      ? `${DECISION_MARKER} ${copy.decisionAdopted(name)}\n\n${summary}`
      : `${DECISION_MARKER} ${copy.decisionGoal(name)}\n${agent.task || ""}`;
    void runAction("decision", text);
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
    if (!agent.sessionId) return;
    const targetName = agent.name || "agent";
    eventBus.emit("composer:insert-mention", {
      text: `${formatSessionReferenceMention(agent.sessionId, targetName)} `,
      submit: false,
    });
    toast.info(copy.followUpToast(targetName));
  };

  return (
    <div
      data-testid={`agent-inline-expansion-${agent.index ?? 0}`}
      className={cn(
        "mt-2 min-w-0 basis-full rounded-lg border border-border-subtle bg-background p-3 text-xs text-muted-foreground",
        className,
      )}
    >
      {(agent.filesTouchedCount > 0 || !!agent.iterationCount) && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {agent.filesTouchedCount > 0 && (
            <span>{copy.filesTouched(agent.filesTouchedCount)}</span>
          )}
          {agent.iterationCount && agent.iterationCount > 0 ? (
            <span>{copy.iterations(agent.iterationCount)}</span>
          ) : null}
        </div>
      )}

      {/* 任务描述与阶段成果 */}
      <div className="space-y-3 leading-relaxed [overflow-wrap:anywhere]">
        {agent.task && (
          <details className="group/task">
            <summary className="cursor-pointer py-1 text-xs font-medium hover:text-foreground">
              {copy.taskGoal.replace(/[:：]\s*$/, "")}
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-5">
              {agent.task}
            </p>
          </details>
        )}

        {agent.error ? (
          <div className="rounded border border-destructive/20 bg-destructive/10 p-2 text-destructive">
            <span className="font-medium">{copy.errorLabel}</span>
            <p className="mt-0.5 whitespace-pre-wrap">{agent.error}</p>
          </div>
        ) : agent.summary ? (
          <div
            data-testid={`agent-report-${agent.index ?? 0}`}
            className="min-w-0 text-foreground"
          >
            <MarkdownContent
              content={agent.summary}
              isLoading={false}
              rehypePlugins={rehypePlugins}
              chatFontSize="small"
            />
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
            disabled={published || pending !== null || result === "unknown"}
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
              <SquareArrowOutUpRightIcon className="size-3" />
            )}
            <span>
              {pending === "publish"
                ? copy.awaitingConfirmation
                : published
                  ? copy.published
                  : copy.publish}
            </span>
          </button>

          <button
            type="button"
            onClick={handleRecordDecision}
            disabled={
              decisionRecorded || pending !== null || result === "unknown"
            }
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
              {pending === "decision"
                ? copy.awaitingConfirmation
                : decisionRecorded
                  ? copy.decisionRecorded
                  : copy.recordDecision}
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
            disabled={!agent.sessionId}
            className="inline-flex items-center gap-1 rounded border border-border/50 bg-background/80 px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title={
              agent.sessionId
                ? copy.followUpHint
                : copy.followUpUnavailableHint
            }
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
          <span>{copy.viewDetails}</span>
          <ExternalLinkIcon className="size-3" />
        </button>
      </div>
      {result === "failed" && (
        <p role="alert" className="mt-2 text-destructive">
          {copy.sendUnconfirmed}
        </p>
      )}
      {result === "unknown" && (
        <p role="status" className="mt-2">
          {copy.resultUnknown}
        </p>
      )}
    </div>
  );
}
