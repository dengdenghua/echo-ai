import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  MonitorIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useI18n } from "@/core/i18n/hooks";
import { useAgents } from "@/core/agents/hooks";
import { PersonaGlyph } from "@/components/brand/persona-glyph";
import { cn } from "@/lib/utils";
import { emitAgentWorkbenchFocus } from "@/components/workspace/agent-workbench-events";
import { subagentAvatarSrc } from "@/components/workspace/agent-workbench-utils";
import { InlineSubagentCardExpansion } from "./inline-subagent-card-expansion";
import type {
  InlineSubagentInfo,
  InlineSubagentStatus,
} from "./inline-subagent-helpers";

/**
 * Two-row LED dot progress bar (2 rows × 14 columns), matching Kimi's style.
 * Columns light up left-to-right strictly by percentage:
 *   0%  - 6%   → 0 cols lit (just started)
 *   7%  - 13%  → 1 col lit
 *   ...
 *   93%+       → 13 cols lit (running cap — full 14 is the completed state)
 * The rightmost lit column pulses softly to show "actively working".
 */
function LedProgress({
  progress,
  completed = false,
}: {
  progress?: number;
  completed?: boolean;
}) {
  const cols = 14;
  // progress undefined/NaN → just started (0.1 = ~1 col)
  const p =
    typeof progress === "number" && !isNaN(progress)
      ? Math.max(0, Math.min(1, progress))
      : 0.1;
  // Running agents max out at 13/14; completion fills the matrix.
  const litCols = completed ? cols : Math.min(cols - 1, Math.floor(p * cols));
  const isActive = !completed && p > 0 && p < 1;

  return (
    <span
      className="inline-grid shrink-0 grid-flow-col grid-rows-2 gap-[1.5px] leading-none"
      aria-label={completed ? "completed" : "running"}
    >
      {Array.from({ length: cols * 2 }).map((_, index) => {
        const c = Math.floor(index / 2);
        const isLit = c < litCols;
        const isPulsing = isLit && c === litCols - 1 && isActive;
        return (
          <span
            key={index}
            className={cn(
              "inline-block rounded-sm transition-colors duration-base",
              isLit
                ? "bg-success/90 dark:bg-success/90"
                : "bg-success/15 dark:bg-success/15",
              isPulsing && "animate-[pulse-soft_1.2s_ease-in-out_infinite]",
            )}
            style={{
              width: "3px",
              height: "3px",
            }}
          />
        );
      })}
    </span>
  );
}

function StatusIndicator({
  status,
  progress,
}: {
  status: InlineSubagentStatus;
  progress?: number;
}) {
  if (status === "done") {
    return <LedProgress progress={1} completed />;
  }
  if (status === "error") {
    return (
      <span className="flex size-4 items-center justify-center text-destructive/80">
        <XCircleIcon className="size-3.5" />
      </span>
    );
  }
  if (status === "waiting") {
    return (
      <span className="flex size-4 items-center justify-center text-warning/80">
        <Loader2Icon className="size-3.5 animate-spin" />
      </span>
    );
  }
  // running: LED dot matrix with column-by-column fill
  return <LedProgress progress={progress} />;
}

function AgentIndexBadge({ index, done }: { index: number; done?: boolean }) {
  return (
    <span
      className={cn(
        "font-mono text-xs",
        done ? "text-muted-foreground" : "text-muted-foreground",
      )}
    >
      {String(index + 1).padStart(2, "0")}
    </span>
  );
}

// Subtle L-shaped tree connector like Kimi's — small, faint, minimal
function isImageAvatar(avatar: string): boolean {
  return (
    avatar.startsWith("/") ||
    avatar.startsWith("http://") ||
    avatar.startsWith("https://") ||
    avatar.startsWith("data:") ||
    avatar.startsWith("blob:")
  );
}

function AgentAvatar({
  agent,
  large = false,
}: {
  agent: InlineSubagentInfo;
  large?: boolean;
}) {
  const className = large ? "size-8" : "size-4";
  const [failedAvatarSrc, setFailedAvatarSrc] = useState<string | null>(null);
  // The cached installed roster also repairs older receipts that omitted
  // visuals. Match the exact role ID, never an unrelated same-name persona.
  const { agents: installedAgents } = useAgents();
  const installed = installedAgents.find((role) => role.name === agent.id);
  const marketAvatarSrc = subagentAvatarSrc(
    installed ? (installed.avatar_url ?? undefined) : agent.avatarUrl,
  );
  const avatar = installed ? (installed.icon ?? undefined) : agent.avatar;
  if (marketAvatarSrc && failedAvatarSrc !== marketAvatarSrc) {
    return (
      <img
        alt=""
        src={marketAvatarSrc}
        onError={() => setFailedAvatarSrc(marketAvatarSrc)}
        className={cn(className, "rounded-md object-cover")}
      />
    );
  }
  if (avatar && isImageAvatar(avatar)) {
    return (
      <img
        alt=""
        src={avatar}
        className={cn(className, "rounded-md object-cover")}
      />
    );
  }
  // Emoji role avatars are never drawn (BRAND.md): a neutral monogram tile.
  return (
    <span
      aria-hidden="true"
      className={cn(
        className,
        "flex items-center justify-center rounded-md border border-border-default bg-muted",
        large ? "text-xs" : "text-micro",
      )}
    >
      <PersonaGlyph agentId={agent.id} name={agent.name || agent.role} />
    </span>
  );
}

export function KimiStyleSubagentCard({
  agent,
  previewEnabled,
  turnIndex,
  paired = false,
}: {
  agent: InlineSubagentInfo;
  previewEnabled: boolean;
  turnIndex?: number;
  paired?: boolean;
}) {
  const { t } = useI18n();
  const detailId = `${useId()}-agent-preview`;
  const [previewSuppressed, setPreviewSuppressed] = useState(false);
  const [reportOpen, setReportOpen] = useState(agent.status === "error");
  useEffect(() => {
    if (agent.status === "error") setReportOpen(true);
  }, [agent.status]);
  const hasReport = Boolean(agent.summary || agent.error);
  const isDone = agent.status === "done";
  const statusLabel =
    agent.status === "done"
      ? agent.role === "cowork"
        ? t.message.statusResponded
        : t.message.statusCompleted
      : agent.status === "error"
        ? t.message.statusError
        : agent.status === "waiting"
          ? t.message.statusWaiting
          : t.message.statusViewing;
  const openInWorkbench = (trigger?: HTMLElement) => {
    setPreviewSuppressed(true);
    setReportOpen(false);
    trigger?.blur();
    // Open the agent in the workbench
    emitAgentWorkbenchFocus({
      agentId: agent.id,
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        avatar: agent.avatar,
        status: agent.status,
        task: agent.task,
        summary: agent.summary,
        iterationCount: agent.iterationCount,
        filesTouchedCount: agent.filesTouchedCount,
        error: agent.error,
        index: agent.index,
      },
      turnIndex,
      tab: "agent",
      view: "screen",
    });
  };
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) =>
    openInWorkbench(event.currentTarget);

  if (paired) {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={`${agent.name} · ${statusLabel} · 查看执行画面`}
        title="查看执行画面"
        className={cn(
          "inline-flex shrink-0 items-center gap-1 px-0.5 py-0 text-xs font-medium transition-colors",
          "hover:underline hover:underline-offset-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
          agent.status === "done" && "text-success",
          agent.status === "error" && "text-destructive",
          (agent.status === "running" || agent.status === "waiting") &&
            "text-warning",
        )}
      >
        {agent.status === "done" ? (
          <CheckIcon aria-hidden className="size-3" />
        ) : agent.status === "error" ? (
          <XCircleIcon aria-hidden className="size-3" />
        ) : (
          <Loader2Icon aria-hidden className="size-3 animate-spin" />
        )}
        {statusLabel}
      </button>
    );
  }

  return (
    <div
      className="group/agent-card relative mb-1 flex flex-wrap items-center gap-x-1 last:mb-0"
      onMouseLeave={() => setPreviewSuppressed(false)}
    >
      <button
        type="button"
        onClick={handleClick}
        aria-label={`${agent.name} · ${agent.role ?? t.message.agent} · ${agent.task || t.message.noTaskDescription} · ${statusLabel}`}
        aria-describedby={
          previewEnabled && !previewSuppressed && !reportOpen
            ? detailId
            : undefined
        }
        className={cn(
          "group/agent-row flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
          "hover:bg-background/80 focus-visible:bg-background/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 dark:bg-background/25 dark:hover:bg-background/40",
        )}
      >
        <AgentAvatar agent={agent} />
        <span
          title={agent.name}
          className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
        >
          {agent.name}
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 text-xs",
            agent.status === "error"
              ? "text-destructive"
              : agent.status === "waiting"
                ? "text-warning"
                : "text-muted-foreground",
          )}
        >
          {agent.status === "done" ? (
            <CheckIcon className="size-3.5 text-success" aria-hidden />
          ) : agent.status === "error" ? (
            <XCircleIcon className="size-3.5" aria-hidden />
          ) : (
            <Loader2Icon
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          )}
          {statusLabel}
        </span>
      </button>

      {hasReport && (
        <div className="contents">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setPreviewSuppressed(true);
              event.currentTarget.blur();
              setReportOpen((value) => !value);
            }}
            aria-expanded={reportOpen}
            className={cn(
              "mr-2 inline-flex min-h-8 shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
              reportOpen
                ? "text-foreground/75 hover:bg-background/60"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
            )}
          >
            {reportOpen ? (
              <ChevronUpIcon className="size-3" />
            ) : (
              <ChevronDownIcon className="size-3" />
            )}
            {reportOpen
              ? agent.role === "cowork"
                ? t.message.collapseReply
                : t.message.collapseReport
              : agent.error
                ? t.message.viewReportError
                : agent.role === "cowork"
                  ? t.message.viewReply
                  : t.message.viewReport}
          </button>
          <InlineSubagentCardExpansion
            agent={agent}
            isOpen={reportOpen}
            onOpenWorkbench={() => openInWorkbench()}
          />
        </div>
      )}

      {previewEnabled && !previewSuppressed && !reportOpen && (
        <div
          id={detailId}
          role="tooltip"
          data-testid={`agent-hover-${agent.index ?? 0}`}
          className="pointer-events-none invisible absolute left-5 top-full z-40 w-[min(28rem,calc(100vw-4rem))] pt-1.5 opacity-0 transition-opacity duration-150 group-hover/agent-card:visible group-hover/agent-card:opacity-100 group-hover/agent-card:delay-500 group-focus-within/agent-card:visible group-focus-within/agent-card:opacity-100 group-focus-within/agent-card:delay-0"
        >
          <div className="rounded-lg border border-border/70 bg-popover p-3 text-popover-foreground shadow-lg">
            <div className="flex items-start gap-2.5">
              <AgentAvatar agent={agent} large />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {agent.name}
                  </span>
                  <AgentIndexBadge index={agent.index ?? 0} done={isDone} />
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <StatusIndicator
                      status={agent.status}
                      progress={agent.progress}
                    />
                    {statusLabel}
                  </span>
                </div>
                {agent.role && agent.role !== agent.name && (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {agent.role}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-2 text-xs leading-relaxed text-foreground/85">
              {agent.task || t.message.noTaskDescription}
            </div>

            {(agent.iterationCount !== undefined ||
              agent.filesTouchedCount > 0) && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                {agent.iterationCount !== undefined && (
                  <span>
                    {agent.iterationCount} {t.subagents.iterations}
                  </span>
                )}
                {agent.filesTouchedCount > 0 && (
                  <span>
                    {agent.filesTouchedCount} {t.subagents.filesModified}
                  </span>
                )}
              </div>
            )}

            {agent.summary && agent.status !== "error" && (
              <div className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                {agent.summary}
              </div>
            )}
            {agent.error && agent.status === "error" && (
              <div className="mt-2 line-clamp-3 text-xs leading-relaxed text-destructive/80">
                {agent.error}
              </div>
            )}

            <div className="mt-2 flex items-center gap-1 border-t border-border/60 pt-2 text-xs font-medium text-foreground/75">
              <MonitorIcon className="size-3.5" />
              {t.message.viewComputer}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
