import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  ListChecksIcon,
  Loader2Icon,
  RefreshCwIcon,
  StickyNoteIcon,
  XCircleIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";

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

/**
 * Always-visible corner note.
 *
 * The workbench sidebar is the right home for *acting* on a workspace (stage,
 * commit, push, compare branches). This badge is the opposite: a one-line
 * reading of what the sidebar would tell you — branch, how much changed, and
 * how far the current run has got — that stays on screen with the sidebar
 * closed. It never mutates anything.
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
}: {
  workDir?: string | null;
  events: LiveToolEvent[];
  hasAnswer?: boolean;
  runSettled?: boolean;
  runFailed?: boolean;
  paused?: boolean;
  className?: string;
  pollIntervalMs?: number;
}) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
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

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setExpanded(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [expanded]);

  // Nothing worth a permanent pixel: no repository, no changes, no run yet.
  if (!summary?.branch && changedFiles === 0 && !hasProcess && !error) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      data-workspace-note-badge={expanded ? "expanded" : "collapsed"}
      className={cn("relative flex flex-col items-end", className)}
    >
      <button
        type="button"
        data-note-summary="true"
        aria-expanded={expanded}
        aria-label={t.workspaceNote.title}
        title={t.workspaceNote.title}
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          "pointer-events-auto flex max-w-[min(22rem,60vw)] items-center gap-2",
          "rounded-full border border-border-default bg-background/95 py-1 pr-2 pl-2.5 text-xs",
          "shadow-[var(--shadow-xs)] backdrop-blur transition-colors hover:bg-muted/60",
        )}
      >
        <StickyNoteIcon className="size-3.5 shrink-0 text-primary" />
        {summary?.branch ? (
          <span
            data-note-branch={summary.branch}
            className="flex min-w-0 items-center gap-1"
          >
            <GitBranchIcon className="size-3 shrink-0 text-muted-foreground" />
            <span
              className="min-w-0 truncate font-medium text-foreground/85"
              title={summary.branch}
            >
              {summary.branch}
            </span>
          </span>
        ) : null}
        {changedFiles > 0 ? (
          <span
            data-note-changes={changedFiles}
            className="flex shrink-0 items-center gap-1.5 font-mono tabular-nums"
          >
            <span className="text-muted-foreground/70">
              {t.workspaceNote.filesCount(
                numberFormat.format(changedFiles),
              )}
            </span>
            {lineDelta > 0 ? (
              <>
                <span className="text-success">
                  +{numberFormat.format(summary?.added ?? 0)}
                </span>
                <span className="text-destructive">
                  -{numberFormat.format(summary?.removed ?? 0)}
                </span>
              </>
            ) : null}
          </span>
        ) : null}
        {hasProcess ? (
          <span
            data-note-process={progress.total}
            className="shrink-0 rounded-full bg-muted/70 px-1.5 py-0.5 font-medium tabular-nums text-muted-foreground"
          >
            {t.workspaceNote.processProgress(
              progress.current,
              progress.total,
            )}
          </span>
        ) : null}
        {expanded ? (
          <ChevronUpIcon className="size-3 shrink-0 text-muted-foreground/70" />
        ) : (
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/70" />
        )}
      </button>

      {expanded ? (
        <div
          data-note-card="true"
          className={cn(
            "pointer-events-auto absolute right-0 top-[calc(100%+0.375rem)] w-72",
            "overflow-hidden rounded-xl border border-border-default",
            "bg-background/95 shadow-[var(--shadow-lg)] backdrop-blur",
          )}
        >
          <header
            data-note-environment="true"
            className="flex items-center justify-between border-b border-border-subtle px-2.5 py-1.5"
          >
            <span className="text-xs font-medium text-foreground/85">
              {t.workspaceNote.environmentSection}
            </span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={isLoading}
                title={t.workspaceNote.refresh}
                aria-label={t.workspaceNote.refresh}
                className="flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
              >
                <RefreshCwIcon className={cn("size-3", isLoading && "animate-spin")} />
              </button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                title={t.workspaceNote.collapse}
                aria-label={t.workspaceNote.collapse}
                className="flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronUpIcon className="size-3" />
              </button>
            </div>
          </header>

          <div className="space-y-0.5 px-1 py-1">
            <NoteRow
              icon={<CircleIcon className="size-3 text-primary" />}
              label={t.workspaceNote.changesLabel}
            >
              {changedFiles === 0 ? (
                <span className="text-muted-foreground/70">
                  {t.workspaceNote.clean}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 font-mono tabular-nums">
                  <span className="text-muted-foreground/70">
                    {t.workspaceNote.filesCount(
                      numberFormat.format(changedFiles),
                    )}
                  </span>
                  {lineDelta > 0 ? (
                    <>
                      <span className="text-success">
                        +{numberFormat.format(summary?.added ?? 0)}
                      </span>
                      <span className="text-destructive">
                        -{numberFormat.format(summary?.removed ?? 0)}
                      </span>
                    </>
                  ) : null}
                </span>
              )}
            </NoteRow>

            <NoteRow
              icon={<GitBranchIcon className="size-3 text-muted-foreground" />}
              label={t.workspaceNote.branchLabel}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className="min-w-0 truncate font-mono"
                  title={summary?.branch || undefined}
                >
                  {summary?.branch || t.workspaceNote.detachedHead}
                </span>
                {summary && (summary.ahead > 0 || summary.behind > 0) ? (
                  <span className="shrink-0 text-muted-foreground/70">
                    {t.workspaceNote.aheadBehind(
                      numberFormat.format(summary.ahead),
                      numberFormat.format(summary.behind),
                    )}
                  </span>
                ) : null}
              </span>
            </NoteRow>

            <NoteRow
              data-note-pr="unavailable"
              icon={<GitPullRequestIcon className="size-3 text-muted-foreground" />}
              label={t.workspaceNote.pullRequestLabel}
            >
              <span
                className="text-muted-foreground/70"
                title={t.workspaceNote.pullRequestHint}
              >
                {t.workspaceNote.pullRequestUnavailable}
              </span>
            </NoteRow>

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
                {t.workspaceNote.unavailable}
              </p>
            ) : null}
          </div>

          <header className="flex items-center justify-between border-t border-border-subtle px-2.5 py-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground/85">
              <ListChecksIcon className="size-3.5 text-primary" />
              {t.workspaceNote.processSection}
            </span>
            {hasProcess ? (
              <span className="rounded-full bg-muted/70 px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {t.workspaceNote.processProgress(
                  progress.current,
                  progress.total,
                )}
              </span>
            ) : null}
          </header>

          <div data-note-process-list="true" className="max-h-40 overflow-y-auto px-1 pb-1.5">
            {hasProcess ? (
              phases.map((phase) => (
                <PhaseRow
                  key={phase.id}
                  phase={phase}
                  active={phase.id === currentPhase?.id}
                  labels={t.agentPhases}
                  statusLabel={phaseStatusLabel(phase.status, t)}
                />
              ))
            ) : (
              <p className="px-2 py-1 text-[11px] leading-snug text-muted-foreground/60">
                {t.workspaceNote.processEmpty}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NoteRow({
  icon,
  label,
  children,
  ...rest
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className="flex min-w-0 items-start gap-2 rounded-lg px-2 py-1 text-xs"
    >
      <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-right text-foreground/85">
        {children}
      </span>
    </div>
  );
}

function PhaseRow({
  phase,
  active,
  labels,
  statusLabel,
}: {
  phase: AgentPhase;
  active: boolean;
  labels: Parameters<typeof agentPhaseDisplayTitle>[1];
  statusLabel: string;
}) {
  return (
    <div
      data-note-phase={phase.status}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-xs",
        active ? "bg-primary/8 text-foreground" : "text-muted-foreground",
      )}
    >
      <PhaseStatusIcon status={phase.status} />
      <span className="min-w-0 flex-1 truncate" title={phase.title}>
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
    return <CircleIcon className="size-3.5 shrink-0 text-muted-foreground/45" />;
  }
  if (status === "error") {
    return <XCircleIcon className="size-3.5 shrink-0 text-destructive" />;
  }
  return <CheckCircle2Icon className="size-3.5 shrink-0 text-success" />;
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
