import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleIcon,
  FileTextIcon,
  GitBranchIcon,
  GitForkIcon,
  GitPullRequestIcon,
  HardDriveIcon,
  InfoIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  StickyNoteIcon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  agentPhaseDisplayTitle,
  deriveAgentPhases,
  progressForPhases,
  type AgentPhase,
  type AgentPhaseStatus,
} from "./agent-phases";
import type { LiveToolEvent } from "./live-tool-timeline";
import { useI18n } from "@/core/i18n/hooks";
import { useGitSummary } from "@/core/workspace/use-git-summary";
import { cn } from "@/lib/utils";

const NOTE_EXPANDED_STORAGE_KEY = "echo.workspace-note.expanded";

function readStoredExpanded(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(NOTE_EXPANDED_STORAGE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // Private-mode browsers throw on storage access; persistence is
    // best-effort and the props decide the initial state instead.
  }
  return null;
}

function writeStoredExpanded(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOTE_EXPANDED_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Mirror readStoredExpanded: quota or privacy errors are non-fatal.
  }
}

/**
 * Always-visible floating card styled like ZCode / Codex.
 *
 * Displays Git tools (branch, uncommitted changes, commit/push action)
 * alongside the run process checklist in a single persistent top-right floating card.
 * Can be collapsed into a compact pill button.
 */
export function WorkspaceNoteBadge({
  workDir,
  events,
  hasAnswer,
  runSettled,
  runFailed,
  paused,
  className,
  pollIntervalMs,
  defaultExpanded,
  expanded: controlledExpanded,
  onExpandedChange,
  onOpenWorkbench,
}: {
  workDir?: string | null;
  events: LiveToolEvent[];
  hasAnswer?: boolean;
  runSettled?: boolean;
  runFailed?: boolean;
  paused?: boolean;
  className?: string;
  pollIntervalMs?: number;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onOpenWorkbench?: () => void;
}) {
  const { t, locale } = useI18n();
  // Persisted choice wins over defaultExpanded: once the user has explicitly
  // collapsed or expanded the note, re-mounts (and re-runs) honor that.
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(
    () => readStoredExpanded() ?? defaultExpanded ?? false,
  );
  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : uncontrolledExpanded;

  const setExpanded = (next: boolean | ((prev: boolean) => boolean)) => {
    const nextVal = typeof next === "function" ? next(expanded) : next;
    if (!isControlled) {
      setUncontrolledExpanded(nextVal);
      writeStoredExpanded(nextVal);
    }
    onExpandedChange?.(nextVal);
  };

  const rootRef = useRef<HTMLDivElement>(null);
  const { summary, error, isLoading, refresh } = useGitSummary(workDir, {
    pollIntervalMs,
  });
  const { phases, currentPhase } = useMemo(
    () =>
      deriveAgentPhases(events, { hasAnswer, runSettled, runFailed, paused }),
    [events, hasAnswer, runSettled, runFailed, paused],
  );
  const progress = currentPhase
    ? progressForPhases(phases, currentPhase)
    : { current: 0, total: 0 };
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const changedFiles = summary?.changedFiles ?? 0;
  const lineDelta = (summary?.added ?? 0) + (summary?.removed ?? 0);
  const hasProcess = phases.length > 0;

  // A detached HEAD arrives as an empty branch plus a flag, because git's own
  // wording for it ("HEAD (no branch)") is not something to show a reader who
  // is using the UI in another language.
  const branchLabel = summary?.branch
    ? summary.branch
    : summary?.detached
      ? t.workspaceNote.detachedHead
      : "";

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  // Nothing worth a permanent pixel: no repository, no changes, no run yet.
  if (!branchLabel && changedFiles === 0 && !hasProcess && !error) {
    return null;
  }

  if (!expanded) {
    return (
      <div
        ref={rootRef}
        data-workspace-note-badge="collapsed"
        className={cn("relative flex flex-col items-end", className)}
      >
        <button
          type="button"
          data-note-summary="true"
          aria-expanded={false}
          aria-label={t.workspaceNote.title}
          title={t.workspaceNote.title}
          onClick={() => setExpanded(true)}
          className={cn(
            "pointer-events-auto flex max-w-[min(24rem,65vw)] items-center gap-2",
            "rounded-full border border-border-default bg-background/95 py-1.5 pr-2.5 pl-3 text-xs",
            "shadow-md backdrop-blur transition-all hover:bg-muted/70 hover:shadow-lg",
          )}
        >
          <StickyNoteIcon className="size-3.5 shrink-0 text-primary" />
          {branchLabel ? (
            <span
              data-note-branch={summary?.branch || ""}
              data-note-detached={summary?.detached ? "true" : undefined}
              className="flex min-w-0 items-center gap-1 font-mono"
            >
              <GitBranchIcon className="size-3 shrink-0 text-muted-foreground" />
              <span
                className="min-w-0 truncate font-medium text-foreground/85"
                title={branchLabel}
              >
                {branchLabel}
              </span>
            </span>
          ) : null}
          {changedFiles > 0 ? (
            <span
              data-note-changes={changedFiles}
              className="flex shrink-0 items-center gap-1.5 font-mono tabular-nums"
            >
              <span className="text-muted-foreground/70">
                {t.workspaceNote.filesCount(numberFormat.format(changedFiles))}
              </span>
              {lineDelta > 0 ? (
                <>
                  <span className="font-medium text-emerald-500">
                    +{numberFormat.format(summary?.added ?? 0)}
                  </span>
                  <span className="font-medium text-rose-500">
                    -{numberFormat.format(summary?.removed ?? 0)}
                  </span>
                </>
              ) : null}
            </span>
          ) : null}
          {hasProcess ? (
            <span
              data-note-process={progress.total}
              className="shrink-0 rounded-full bg-muted/80 px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-muted-foreground"
            >
              {t.workspaceNote.processProgress(
                progress.current,
                progress.total,
              )}
            </span>
          ) : null}
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/70" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-workspace-note-badge="expanded"
      className={cn("relative flex flex-col items-end", className)}
    >
      <div
        data-note-card="true"
        className={cn(
          "pointer-events-auto flex w-72 flex-col overflow-hidden rounded-xl",
          "border border-border-default/80 bg-background/95 shadow-xl backdrop-blur-md",
        )}
      >
        {/* Header: Git 工具 + 刷新 + 更多 + 收起 */}
        <header
          data-note-environment="true"
          className="flex items-center justify-between border-b border-border-subtle/70 px-3 py-2"
        >
          <span className="text-xs font-semibold text-foreground/90">
            {t.workspaceNote.gitToolsTitle || t.workspaceNote.environmentSection}
          </span>
          <span className="sr-only">{t.workspaceNote.environmentSection}</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={isLoading}
              title={t.workspaceNote.refresh}
              aria-label={t.workspaceNote.refresh}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              <RefreshCwIcon className={cn("size-3", isLoading && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={onOpenWorkbench}
              title={t.workspaceNote.more ?? "更多选项"}
              aria-label={t.workspaceNote.more ?? "更多选项"}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontalIcon className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              title={t.workspaceNote.collapse}
              aria-label={t.workspaceNote.collapse}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronUpIcon className="size-3.5" />
            </button>
          </div>
        </header>

        {/* Section 1: Git Tools Body */}
        <div className="space-y-1 p-2">
          {/* Row 0: 环境 / Local or Worktree */}
          {summary ? (
            <div
              data-note-env={summary.worktree ? "worktree" : "local"}
              className="flex items-center justify-between rounded-lg px-2 py-1 text-xs hover:bg-muted/40 transition-colors"
              title={t.workspaceNote.envHandoffHint}
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                {summary.worktree ? (
                  <GitForkIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <HardDriveIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="font-medium text-foreground/85">
                  {summary.worktree
                    ? t.workspaceNote.worktreeEnv
                    : t.workspaceNote.localEnv}
                </span>
              </span>
              <InfoIcon className="size-3 shrink-0 text-muted-foreground/50" />
            </div>
          ) : null}

          {/* Row 1: 更改 / Changes */}
          <div className="flex items-center justify-between rounded-lg px-2 py-1 text-xs hover:bg-muted/40 transition-colors">
            <div className="flex items-center gap-2 text-muted-foreground">
              <FileTextIcon className="size-3.5 text-muted-foreground" />
              <span>{t.workspaceNote.changesLabel === "变更" ? "更改" : t.workspaceNote.changesLabel}</span>
              <span className="sr-only">{t.workspaceNote.changesLabel}</span>
            </div>
            <div>
              {!summary && error ? (
                <span className="text-xs text-muted-foreground/50 font-mono">
                  —
                </span>
              ) : changedFiles === 0 ? (
                <span className="text-xs text-muted-foreground/70 font-mono">
                  {t.workspaceNote.clean}
                </span>
              ) : (
                <span
                  data-note-changes={changedFiles}
                  className="flex items-center gap-1.5 font-mono text-xs tabular-nums"
                >
                  {lineDelta > 0 ? (
                    <>
                      <span className="font-medium text-emerald-500">
                        +{numberFormat.format(summary?.added ?? 0)}
                      </span>
                      <span className="font-medium text-rose-500">
                        -{numberFormat.format(summary?.removed ?? 0)}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground/70">
                      {t.workspaceNote.filesCount(numberFormat.format(changedFiles))}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Row 2: 分支 / Branch */}
          <div
            className="flex items-center justify-between rounded-lg px-2 py-1 text-xs hover:bg-muted/40 transition-colors"
            title={summary?.branch ? `${t.workspaceNote.branchLabel}: ${summary.branch}` : undefined}
          >
            <div className="flex min-w-0 items-center gap-2">
              <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="sr-only">{t.workspaceNote.branchLabel}</span>
              <span
                data-note-branch-label={branchLabel || "none"}
                className={cn(
                  "min-w-0 truncate text-foreground/90",
                  summary?.branch && "font-mono",
                )}
                title={summary?.branch || undefined}
              >
                {branchLabel || "—"}
              </span>
              {summary && (summary.ahead > 0 || summary.behind > 0) ? (
                <span className="shrink-0 text-[11px] font-mono text-muted-foreground/70">
                  {t.workspaceNote.aheadBehind(
                    numberFormat.format(summary.ahead),
                    numberFormat.format(summary.behind),
                  )}
                </span>
              ) : null}
            </div>
            <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/60" />
          </div>

          {summary?.detached ? (
            <p
              data-note-detached-hint="true"
              className="px-2 pt-0.5 text-[11px] leading-snug text-muted-foreground/60"
            >
              {t.workspaceNote.detachedHint}
            </p>
          ) : null}

          {/* Row 3: 提交或推送 / Commit or push */}
          <button
            type="button"
            onClick={onOpenWorkbench}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors text-left"
          >
            <GitForkIcon className="size-3.5 shrink-0 text-muted-foreground rotate-180" />
            <span className="font-medium text-foreground/85">
              {t.workspaceNote.commitOrPush}
            </span>
          </button>

          {/* Pull Request Row */}
          <div
            data-note-pr="unavailable"
            className="flex items-center justify-between rounded-lg px-2 py-0.5 text-[11px] text-muted-foreground/60"
          >
            <span className="flex items-center gap-1.5">
              <GitPullRequestIcon className="size-3 shrink-0 text-muted-foreground/60" />
              <span>{t.workspaceNote.pullRequestLabel}</span>
            </span>
            <span title={t.workspaceNote.pullRequestHint}>
              {t.workspaceNote.pullRequestUnavailable}
            </span>
          </div>

          {summary && summary.untrackedFiles > 0 ? (
            <p
              data-note-untracked={summary.untrackedFiles}
              className="px-2 pt-0.5 text-[11px] leading-snug text-muted-foreground/60"
            >
              {t.workspaceNote.trackedOnly}
            </p>
          ) : null}
          {summary?.diffError ? (
            <p
              data-note-diff-error="true"
              className="px-2 pt-0.5 text-[11px] leading-snug text-muted-foreground/60"
            >
              {t.workspaceNote.diffUnavailable}
            </p>
          ) : null}
          {error ? (
            <p
              data-note-error="true"
              className="px-2 pt-0.5 text-[11px] leading-snug text-warning"
            >
              {summary
                ? t.workspaceNote.unavailable
                : t.workspaceNote.unavailableFresh}
            </p>
          ) : null}
        </div>

        {/* Separator */}
        <div className="border-t border-border-subtle/70" />

        {/* Section 2: Process Checklist */}
        <div className="p-2">
          <div className="flex items-center justify-between px-2 pb-1.5">
            <span className="text-xs font-semibold text-foreground/90">
              {t.workspaceNote.processSection}
            </span>
            <div className="flex items-center gap-1.5">
              {hasProcess ? (
                <span className="font-mono text-xs font-medium tabular-nums text-muted-foreground">
                  {t.workspaceNote.processProgress(
                    progress.current,
                    progress.total,
                  )}
                </span>
              ) : null}
              {onOpenWorkbench ? (
                <button
                  type="button"
                  data-note-open-workbench="true"
                  onClick={onOpenWorkbench}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  {t.todoList.title}
                </button>
              ) : null}
            </div>
          </div>

          <div
            data-note-process-list="true"
            className="max-h-48 space-y-0.5 overflow-y-auto pr-1"
          >
            {hasProcess ? (
              phases.map((phase) => (
                <PhaseRow
                  key={phase.id}
                  phase={phase}
                  active={phase.id === currentPhase?.id}
                  labels={t.agentPhases}
                  statusLabel={phaseStatusLabel(phase.status, t)}
                  onClick={onOpenWorkbench}
                />
              ))
            ) : (
              <p className="px-2 py-1 text-[11px] leading-snug text-muted-foreground/60">
                {t.workspaceNote.processEmpty}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PhaseRow({
  phase,
  active,
  labels,
  statusLabel,
  onClick,
}: {
  phase: AgentPhase;
  active: boolean;
  labels: Parameters<typeof agentPhaseDisplayTitle>[1];
  statusLabel: string;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      data-note-phase={phase.status}
      className={cn(
        "group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors",
        active ? "bg-primary/8 text-foreground" : "text-muted-foreground/85 hover:text-foreground",
        onClick && "cursor-pointer hover:bg-muted/60",
      )}
    >
      <PhaseStatusIcon status={phase.status} />
      <span className="min-w-0 flex-1 truncate font-normal" title={phase.title}>
        {agentPhaseDisplayTitle(phase, labels)}
      </span>
      {active ? (
        <span className="shrink-0 text-[11px] font-medium text-primary">
          {statusLabel}
        </span>
      ) : null}
    </div>
  );
}

function PhaseStatusIcon({ status }: { status: AgentPhaseStatus }) {
  if (status === "running" || status === "waiting_approval") {
    return <Loader2Icon className="size-3.5 shrink-0 animate-spin text-primary" />;
  }
  if (status === "pending") {
    return <CircleIcon className="size-3.5 shrink-0 text-muted-foreground/40" />;
  }
  if (status === "error") {
    return <XCircleIcon className="size-3.5 shrink-0 text-destructive" />;
  }
  return <CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-500" />;
}

function phaseStatusLabel(
  status: AgentPhaseStatus,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (status === "running") return t.agentWorkbench.statusProcessing;
  if (status === "waiting_approval") return t.agentWorkbench.waitingToContinue;
  if (status === "error") return t.agentWorkbench.statusError;
  return t.agentWorkbench.statusCompleted;
}
