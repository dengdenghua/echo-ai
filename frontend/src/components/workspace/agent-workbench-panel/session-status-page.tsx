/**
 * The workbench's 状态 tab: where this conversation runs, how full the model
 * context is (with manual compression and its progress), and the files it
 * has produced. Modelled on a desktop agent's session side panel.
 */
import { Loader2Icon, MinimizeIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useArtifacts } from "@/components/workspace/artifacts/context";
import {
  ContextUsageDetails,
  contextUsage,
  type ContextWindowSegment,
} from "@/components/workspace/chat-input-box/context-usage-details";
import {
  shortenPath,
  WorkLocationIcon,
} from "@/components/workspace/work-location-picker";
import { artifactDisplayPath } from "@/core/artifacts/utils";
import type { WorkLocation } from "@/core/execution/work-location";
import { useI18n } from "@/core/i18n/hooks";
import { sessionStatusCopy } from "@/core/i18n/locales/session-status";
import type { ExecutionEngine } from "@/core/realtime/execution-policy";
import { getFileIcon, getFileName } from "@/core/utils/files";
import { cn } from "@/lib/utils";

/** Usage at which the hint warns that the runtime's ~90% auto-compaction is near. */
const AUTO_COMPACT_HINT_PERCENT = 75;

const ENGINE_NAMES: Record<ExecutionEngine, string> = {
  echo: "Echo",
  codex: "Codex",
  opencode: "OpenCode",
};

export interface SessionStatusPageProps {
  workLocation: WorkLocation;
  workDir: string;
  engine: ExecutionEngine;
  /** ``null`` while the model is chosen per turn (自动). */
  modelLabel: string | null;
  contextTokens: number;
  maxContextTokens: number;
  contextSegments: ContextWindowSegment[];
  isCompressingContext: boolean;
  onCompressContext?: () => void | Promise<void>;
  onOpenArtifact?: (path: string) => void;
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

function StatusCard({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-xl border border-border-default bg-background p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
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
    <div className="flex items-center justify-between gap-3 py-1 text-xs">
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

export function SessionStatusPage({
  workLocation,
  workDir,
  engine,
  modelLabel,
  contextTokens,
  maxContextTokens,
  contextSegments,
  isCompressingContext,
  onCompressContext,
  onOpenArtifact,
}: SessionStatusPageProps) {
  const { t, locale } = useI18n();
  const copy = sessionStatusCopy(locale);
  const { artifacts } = useArtifacts();
  const elapsed = useElapsedSeconds(isCompressingContext);
  const { percentage } = contextUsage(contextTokens, maxContextTokens);
  const files = artifacts ?? [];

  return (
    <div
      data-testid="session-status-page"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
    >
      <StatusCard title={copy.environment}>
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
          value={workDir ? shortenPath(workDir) : t.codeMode.personalSpace}
          hint={workDir || t.codeMode.personalSpace}
        />
        <EnvironmentRow label={copy.engine} value={ENGINE_NAMES[engine]} />
        <EnvironmentRow
          label={copy.model}
          value={modelLabel ?? copy.autoModel}
        />
      </StatusCard>

      <StatusCard title={copy.context}>
        <ContextUsageDetails
          contextTokens={contextTokens}
          maxContextTokens={maxContextTokens}
          segments={contextSegments}
          showTitle={false}
        />
        {percentage >= AUTO_COMPACT_HINT_PERCENT ? (
          <p className="mt-3 rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
            {copy.autoCompactSoon}
          </p>
        ) : null}
        {onCompressContext ? (
          <>
            <button
              type="button"
              data-testid="session-status-compress"
              onClick={() => void onCompressContext()}
              disabled={isCompressingContext || contextTokens <= 0}
              aria-busy={isCompressingContext}
              className={cn(
                "mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-border-default text-xs font-medium transition-colors",
                "text-foreground hover:bg-muted disabled:cursor-default disabled:opacity-60",
              )}
            >
              {isCompressingContext ? (
                <Loader2Icon
                  className="size-3.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <MinimizeIcon className="size-3.5" aria-hidden="true" />
              )}
              {isCompressingContext ? copy.compressing(elapsed) : copy.compress}
            </button>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {copy.compressHint}
            </p>
          </>
        ) : null}
      </StatusCard>

      <StatusCard
        title={copy.outputs}
        aside={
          files.length > 0 ? (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {files.length}
            </span>
          ) : null
        }
      >
        {files.length === 0 ? (
          <p className="text-xs text-muted-foreground">{copy.noOutputs}</p>
        ) : (
          <ul className="-mx-1.5 space-y-0.5">
            {files.map((file) => {
              const displayPath = artifactDisplayPath(file);
              return (
                <li key={file}>
                  <button
                    type="button"
                    onClick={() => onOpenArtifact?.(file)}
                    disabled={!onOpenArtifact}
                    title={displayPath}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted/60 disabled:cursor-default"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                      {getFileIcon(displayPath, "size-3.5")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {getFileName(displayPath)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </StatusCard>
    </div>
  );
}
