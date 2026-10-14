/**
 * The 环境 and 上下文 sections of the chat header's status menu
 * (workspace-context-menu.tsx): where this conversation runs, how full the
 * model context is, and manual compression with its progress.
 */
import { Loader2Icon, MinimizeIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import {
  ContextUsageDetails,
  contextUsage,
  type ContextWindowSegment,
} from "@/components/workspace/chat-input-box/context-usage-details";
import {
  shortenPath,
  WorkLocationIcon,
} from "@/components/workspace/work-location-picker";
import type { WorkLocation } from "@/core/execution/work-location";
import { useI18n } from "@/core/i18n/hooks";
import { sessionStatusCopy } from "@/core/i18n/locales/session-status";
import type { ExecutionEngine } from "@/core/realtime/execution-policy";

/** Usage at which the hint warns that the runtime's ~90% auto-compaction is near. */
const AUTO_COMPACT_HINT_PERCENT = 75;

/** CompactionPolicy.keep_recent as wired in
 * runtime/platform/ui/_app_routers_extra.py: these turns always stay verbatim,
 * so a shorter thread has nothing to fold. */
export const KEEP_RECENT_TURNS = 12;

const ENGINE_NAMES: Record<ExecutionEngine, string> = {
  echo: "Echo",
  codex: "Codex",
  opencode: "OpenCode",
};

/** What the page knows about the model context (use-thread-timeline.tsx). */
export interface SessionContextStatus {
  contextTokens: number;
  maxContextTokens: number;
  contextSegments: ContextWindowSegment[];
  isCompressingContext: boolean;
  onCompressContext?: () => void | Promise<void>;
  /** ``null`` while the model is chosen per turn (自动). */
  modelLabel: string | null;
  /** User turns so far; compression needs more than KEEP_RECENT_TURNS. */
  turnCount: number;
  /** The total comes from the measured request, not a text estimate. */
  measured: boolean;
}

export interface SessionEnvironment {
  workLocation: WorkLocation;
  /** The conversation's folder; empty means the personal space. */
  folder: string;
  engine: ExecutionEngine;
  modelLabel: string | null;
}

function useElapsedSeconds(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    setSeconds(0);
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [running]);
  return seconds;
}

function EnvironmentRow({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 px-2 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className="flex min-w-0 items-center gap-1.5 text-foreground"
        title={hint ?? value}
      >
        {icon}
        <span className="truncate">{value}</span>
      </span>
    </div>
  );
}

function locationName(location: WorkLocation, localLabel: string): string {
  if (location.kind === "node") {
    const node = location.label || location.node_id;
    const space = location.workspace_name ?? location.workspace_id;
    return space ? `${node} · ${space}` : node;
  }
  if (location.kind === "remote") {
    return location.label || (location.transport === "wsl" ? "WSL" : "SSH");
  }
  return localLabel;
}

export function SessionEnvironmentRows({
  environment,
}: {
  environment: SessionEnvironment;
}) {
  const { t, locale } = useI18n();
  const copy = sessionStatusCopy(locale);
  const { workLocation, folder, engine, modelLabel } = environment;
  return (
    <>
      <EnvironmentRow
        label={copy.location}
        value={locationName(workLocation, t.workLocation.local)}
        icon={
          <WorkLocationIcon
            location={workLocation}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        }
      />
      <EnvironmentRow
        label={copy.folder}
        value={folder ? shortenPath(folder) : t.codeMode.personalSpace}
        hint={folder || t.codeMode.personalSpace}
      />
      <EnvironmentRow label={copy.engine} value={ENGINE_NAMES[engine]} />
      <EnvironmentRow label={copy.model} value={modelLabel ?? copy.autoModel} />
    </>
  );
}

export function SessionContextSection({
  status,
}: {
  status: SessionContextStatus;
}) {
  const { locale } = useI18n();
  const copy = sessionStatusCopy(locale);
  const {
    contextTokens,
    maxContextTokens,
    contextSegments,
    isCompressingContext,
    onCompressContext,
    turnCount,
  } = status;
  const elapsed = useElapsedSeconds(isCompressingContext);
  const tooFewTurns = turnCount <= KEEP_RECENT_TURNS;
  const { percentage } = contextUsage(contextTokens, maxContextTokens);
  return (
    <div className="px-2" data-testid="session-status-context">
      <ContextUsageDetails
        contextTokens={contextTokens}
        maxContextTokens={maxContextTokens}
        segments={contextSegments}
        showHeader={false}
      />
      {percentage >= AUTO_COMPACT_HINT_PERCENT ? (
        <p className="mt-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
          {copy.autoCompactSoon}
        </p>
      ) : null}
      {onCompressContext ? (
        <button
          type="button"
          data-testid="session-status-compress"
          onClick={() => void onCompressContext()}
          disabled={isCompressingContext || tooFewTurns || contextTokens <= 0}
          aria-busy={isCompressingContext}
          title={tooFewTurns ? undefined : copy.compressHint}
          className="mt-2.5 flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-border-default text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-60"
        >
          {isCompressingContext ? (
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <MinimizeIcon className="size-3.5" aria-hidden="true" />
          )}
          {isCompressingContext ? copy.compressing(elapsed) : copy.compress}
        </button>
      ) : null}
      {onCompressContext && tooFewTurns && !isCompressingContext ? (
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          {copy.compressAfterTurns(KEEP_RECENT_TURNS)}
        </p>
      ) : null}
    </div>
  );
}
