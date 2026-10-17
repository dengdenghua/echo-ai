"use client";

import {
  BrainCircuitIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { copyTextToClipboard } from "@/core/clipboard";
import { useI18n } from "@/core/i18n/hooks";
import { swallow } from "@/core/utils/log";
import { cn } from "@/lib/utils";

import { emitAgentWorkbenchFocus } from "./agent-workbench-events";
import {
  agentRunBadgeClass,
  agentRunDotClass,
  agentRunProgressBarClass,
  agentRunTextClass,
} from "./agent-run-status";
import type { AgentTile } from "./agent-workbench-utils";
import { compactDetail, durationLabel } from "./agent-workbench-utils";
import type { LiveToolEvent } from "./live-tool-timeline";
import type {
  SwarmOverviewStatus,
  SwarmPhaseId,
  SwarmRunOverviewModel,
  SwarmRunSynthesis,
} from "./swarm-run-overview-model";
import { buildSwarmRunOverview } from "./swarm-run-overview-model";
import {
  appendSwarmReplayEvidence,
  buildSwarmReplayPackage,
  downloadSwarmReplayPackage,
} from "./swarm-run-replay";

export { buildSwarmRunOverview } from "./swarm-run-overview-model";
export type { SwarmRunOverviewModel } from "./swarm-run-overview-model";
export { buildSwarmReplayPackage } from "./swarm-run-replay";
export type { SwarmReplayPackage } from "./swarm-run-replay";

export function SwarmRunOverview({
  events,
  className,
  controlSessionId,
}: {
  events: LiveToolEvent[];
  className?: string;
  controlSessionId?: string;
}) {
  const { t } = useI18n();
  const overview = useMemo(() => buildSwarmRunOverview(events), [events]);

  if (!overview) return null;

  const visibleAgents = overview.agents.slice(0, 6);
  const hiddenCount = Math.max(
    0,
    overview.capacity.dispatchedMembers - visibleAgents.length,
  );
  const statusText = statusLabel(overview.status, t.swarmPanel);
  const rhythmLine = buildRhythmLine(overview, t.swarmPanel);

  return (
    <section
      aria-label={t.swarmPanel.title}
      className={cn(
        "mb-2 overflow-hidden rounded-md border border-border-default bg-background/85 text-xs shadow-[var(--shadow-xs)] shadow-black/[0.03]",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <BrainCircuitIcon className="size-4 shrink-0 text-info dark:text-info" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">
              {t.swarmPanel.title}
            </span>
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-xs font-medium",
                agentRunBadgeClass(overview.status),
              )}
            >
              {statusText}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {overview.currentAgent
              ? currentAgentLine(overview.currentAgent)
              : t.swarmPanel.noActivity}
          </div>
        </div>
        <div className="hidden items-center gap-3 text-xs text-muted-foreground sm:flex">
          <Stat label={t.swarmPanel.statTotal} value={overview.counts.total} />
          <Stat
            label={t.swarmPanel.statCapacity}
            value={overview.capacity.requestedMembers}
          />
          <Stat
            label={t.swarmPanel.statRunning}
            value={overview.counts.running + overview.counts.waiting}
          />
          <Stat
            label={t.swarmPanel.statCompleted}
            value={overview.counts.done}
          />
          <Stat label={t.swarmPanel.statFailed} value={overview.counts.error} />
          <Stat
            label={t.swarmPanel.statEvidence}
            value={overview.evidenceCount}
          />
        </div>
      </div>

      <div className="h-1 bg-muted/45">
        <div
          className={cn(
            "h-full transition-[width] duration-slow",
            agentRunProgressBarClass(overview.status),
          )}
          style={{ width: `${Math.round(overview.progress * 100)}%` }}
        />
      </div>

      <div className="flex min-w-0 items-center gap-2 border-b border-border-subtle px-3 py-1.5 text-xs">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-sm",
            agentRunDotClass(overview.activePhase.status),
            overview.activePhase.status === "running" && "animate-pulse",
          )}
        />
        <span className="shrink-0 font-medium text-foreground">
          {phaseLabel(overview.activePhase.id, t.swarmPanel)}
        </span>
        <span className="min-w-0 truncate text-muted-foreground">
          {rhythmLine}
        </span>
      </div>

      <div className="grid grid-cols-4 border-b border-border-subtle bg-muted/15">
        {overview.phases.map((phase) => (
          <div
            key={phase.id}
            className="flex min-w-0 items-center gap-1.5 border-r border-border-subtle px-2 py-1.5 last:border-r-0"
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-sm",
                agentRunDotClass(phase.status),
                phase.status === "running" && "animate-pulse",
              )}
            />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
              {phaseLabel(phase.id, t.swarmPanel)}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {phase.count}
            </span>
          </div>
        ))}
      </div>

      {overview.synthesis && (
        <SynthesisStrip
          controlSessionId={controlSessionId}
          events={events}
          overview={overview}
          synthesis={overview.synthesis}
        />
      )}

      <div className="grid gap-1.5 p-2 sm:grid-cols-2">
        {visibleAgents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            className="group flex min-w-0 items-center gap-2 rounded-md border border-border-default bg-muted/20 px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-muted/35"
            onClick={() => emitAgentWorkbenchFocus({ agentId: agent.id })}
          >
            <span
              className={cn(
                "size-2 shrink-0 rounded-sm",
                agentRunDotClass(agent.status),
                agent.status === "running" && "animate-pulse",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium text-foreground">
                  {agent.name}
                </span>
                {agent.role && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {agent.role}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {agent.currentTool ?? compactDetail(agent.task, 72)}
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 text-xs font-medium",
                agentRunTextClass(agent.status),
              )}
            >
              {statusLabel(agent.status, t.swarmPanel)}
            </span>
          </button>
        ))}
        {hiddenCount > 0 && (
          <div className="flex items-center justify-center rounded-md border border-dashed border-border-default px-2 py-1.5 text-xs text-muted-foreground">
            +{hiddenCount}
          </div>
        )}
      </div>
    </section>
  );
}

function SynthesisStrip({
  controlSessionId,
  events,
  overview,
  synthesis,
}: {
  controlSessionId?: string;
  events: LiveToolEvent[];
  overview: SwarmRunOverviewModel;
  synthesis: SwarmRunSynthesis;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const status = synthesis.ready
    ? t.swarmPanel.deliveryReady
    : t.swarmPanel.deliveryNeedsReview;
  const copyLabel = copied
    ? t.swarmPanel.deliveryCopied
    : t.swarmPanel.deliveryCopy;
  const exportLabel = exported
    ? t.swarmPanel.deliveryReplayExported
    : t.swarmPanel.deliveryReplayExport;
  const CopyStatusIcon = copied ? CheckIcon : CopyIcon;
  const ExportStatusIcon = exported ? CheckIcon : DownloadIcon;

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
    };
  }, []);

  async function handleCopyPrimaryReply() {
    if (!synthesis.primaryReply) return;
    try {
      await copyTextToClipboard(synthesis.primaryReply);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1400);
    } catch (error) {
      swallow(error, "swarm-delivery-copy");
    }
  }

  async function handleExportReplayPackage() {
    try {
      const replayPackage = buildSwarmReplayPackage(overview, events);
      downloadSwarmReplayPackage(replayPackage);
      await appendSwarmReplayEvidence(controlSessionId, replayPackage);
      setExported(true);
      if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
      exportTimerRef.current = setTimeout(() => setExported(false), 1400);
    } catch (error) {
      swallow(error, "swarm-replay-export");
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-3 py-2 text-xs">
      <span
        className={cn(
          "rounded-sm px-1.5 py-0.5 font-medium",
          synthesis.ready
            ? "bg-success/10 text-success"
            : "bg-warning/10 text-warning",
        )}
      >
        {status}
      </span>
      {synthesis.primaryAgentId && (
        <span className="min-w-0 truncate text-muted-foreground">
          {t.swarmPanel.deliveryPrimary}:{" "}
          <span className="font-medium text-foreground">
            {synthesis.primaryAgentId}
          </span>
        </span>
      )}
      <span className="text-muted-foreground">
        {t.swarmPanel.deliverySupporting(synthesis.supportingCount)}
      </span>
      <span className="text-muted-foreground">
        {t.swarmPanel.deliveryCoverage(
          synthesis.answeredCount,
          synthesis.totalCount,
        )}
      </span>
      {synthesis.retryCount > 0 && (
        <span className="text-warning">
          {t.swarmPanel.deliveryRetry(synthesis.retryCount)}
        </span>
      )}
      {synthesis.nextAction && (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {t.swarmPanel.deliveryNext}:{" "}
          {nextActionLabel(synthesis.nextAction, t.swarmPanel)}
        </span>
      )}
      <button
        type="button"
        aria-label={exportLabel}
        title={exportLabel}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={handleExportReplayPackage}
      >
        <ExportStatusIcon className="size-3" />
      </button>
      {synthesis.primaryReply && (
        <div className="flex basis-full items-start gap-2 rounded-sm bg-muted/30 px-2 py-1 text-foreground">
          <span className="min-w-0 flex-1">
            <span className="font-medium">
              {t.swarmPanel.deliverySummary}:{" "}
            </span>
            <span>{compactDetail(synthesis.primaryReply, 180)}</span>
          </span>
          <button
            type="button"
            aria-label={copyLabel}
            title={copyLabel}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={handleCopyPrimaryReply}
          >
            <CopyStatusIcon className="size-3" />
          </button>
        </div>
      )}
      {synthesis.retryCount > 0 && (
        <span className="basis-full rounded-sm bg-warning/10 px-2 py-1 text-warning">
          {t.swarmPanel.deliveryRetryNote(synthesis.retryCount)}
        </span>
      )}
    </div>
  );
}

function statusLabel(
  status: AgentTile["status"] | SwarmOverviewStatus,
  labels: ReturnType<typeof useI18n>["t"]["swarmPanel"],
): string {
  if (status === "running") return labels.panelStatusRunning;
  if (status === "waiting_approval") return labels.status.pending;
  if (status === "done") return labels.panelStatusCompleted;
  if (status === "error") return labels.panelStatusFailed;
  return labels.panelStatusPending;
}

function phaseLabel(
  phase: SwarmPhaseId,
  labels: ReturnType<typeof useI18n>["t"]["swarmPanel"],
): string {
  if (phase === "dispatch") return labels.phaseDispatch;
  if (phase === "execute") return labels.phaseExecute;
  if (phase === "aggregate") return labels.phaseAggregate;
  return labels.phaseSynthesize;
}

function nextActionLabel(
  action: string,
  labels: ReturnType<typeof useI18n>["t"]["swarmPanel"],
): string {
  if (action === "use_primary_response") {
    return labels.deliveryActionUsePrimary;
  }
  if (action === "use_primary_and_retry_failed_members") {
    return labels.deliveryActionUsePrimaryAndRetry;
  }
  if (action === "ask_members_to_expand") {
    return labels.deliveryActionAskMembers;
  }
  if (action === "retry_or_fallback_to_single_agent") {
    return labels.deliveryActionRetryOrFallback;
  }
  if (action === "fallback_to_single_agent") {
    return labels.deliveryActionFallback;
  }
  return action.replace(/_/g, " ");
}

function buildRhythmLine(
  overview: SwarmRunOverviewModel,
  labels: ReturnType<typeof useI18n>["t"]["swarmPanel"],
): string {
  const done = overview.counts.done + overview.counts.error;
  const total = Math.max(1, overview.counts.total);
  const progressLabel = labels.rhythmProgress(done, total);
  const evidenceLabel = labels.rhythmEvidence(overview.evidenceCount);
  const resultLabel = labels.rhythmResults(overview.resultCount);
  if (overview.status === "running" || overview.status === "waiting_approval") {
    const active = overview.currentAgent?.name
      ? labels.rhythmActive(overview.currentAgent.name)
      : labels.rhythmWorking;
    return [active, progressLabel, evidenceLabel].join(" · ");
  }
  if (overview.status === "error") {
    return [labels.rhythmNeedsReview, progressLabel, resultLabel].join(" · ");
  }
  return [
    labels.rhythmDelivered,
    progressLabel,
    evidenceLabel,
    resultLabel,
  ].join(" · ");
}

function currentAgentLine(agent: AgentTile): string {
  const parts = [
    agent.name,
    agent.currentTool,
    agent.durationMs !== undefined ? durationLabel(agent.durationMs) : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{label}</span>
      <span className="font-mono font-medium text-foreground">{value}</span>
    </span>
  );
}
