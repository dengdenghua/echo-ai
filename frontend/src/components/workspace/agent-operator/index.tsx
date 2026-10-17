import { serviceErrorMessage } from "@/core/utils/service-error";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  applyAgentTraceReviewQueuePromotions,
  decideAgentTraceReviewQueueItem,
  decideSubagentPolicy,
  fetchAgentTraceProcessTimeline,
  fetchAgentTraceTaskRuns,
  queueAgentTraceTaskRunReview,
} from "@/core/agent-trace/api";
import type {
  AgentTraceProcessTimeline,
  AgentTraceReviewQueueItem,
  AgentTraceTaskRun,
  ReplayEvidenceHint,
} from "@/core/agent-trace/api";
import { swallow } from "@/core/utils/log";
import { cn } from "@/lib/utils";
import {
  BrowserDesktopReplayReviewCard,
  ReplayEvidenceDrilldownCard,
  ReplayGateCard,
  StatusDot,
} from "../replay-panel";
import {
  CheckCircle2Icon,
  GitBranchIcon,
  ListChecksIcon,
  RefreshCwIcon,
} from "lucide-react";
import { AutoVerifierCard } from "./cards/AutoVerifierCard";
import { AutomationRadarCard } from "./cards/AutomationRadarCard";
import { CompetitorScorecardCard } from "./cards/CompetitorScorecardCard";
import { E2ESurpassCertificationCard } from "./cards/E2ESurpassCertificationCard";
import { MemoryQualityCard } from "./cards/MemoryQualityCard";
import { PluginHealthCard } from "./cards/PluginHealthCard";
import { PolicyReviewRuleDraftCard } from "./cards/PolicyReviewRuleDraftCard";
import { PromotionAuditSummaryCard } from "./cards/PromotionAuditSummaryCard";
import { PublisherTrustCard } from "./cards/PublisherTrustCard";
import { ReviewQueueRow } from "./cards/ReviewQueueRow";
import { SubagentRiskCard } from "./cards/SubagentRiskCard";
import { TaskRecoveryQueueCard } from "./cards/TaskRecoveryQueueCard";
import { useTaskRecoveryActions } from "./use-task-recovery-actions";
import { TimelinePreview } from "./cards/TimelinePreview";
import { ToolSafetyCard } from "./cards/ToolSafetyCard";
import { TopologyPolicyCard } from "./cards/TopologyPolicyCard";
import { TopologyPromotionCard } from "./cards/TopologyPromotionCard";
import { ReplayGateOverrideDialog } from "./dialogs/ReplayGateOverrideDialog";
import { EmptyPanel, Metric, PanelTitle } from "./operator-primitives";
import {
  formatApplyResult,
  replayGateBlockFromError,
  shortId,
} from "./operator-utils";
import type { ReplayGateOverridePrompt } from "./shared";
import { useOperatorCopy } from "./use-operator-copy";
import { useOperatorQueueActions } from "./use-operator-queue-actions";
import { useOperatorReports } from "./use-operator-reports";

export function AgentOperatorPanel() {
  const to = useOperatorCopy();
  const [taskRuns, setTaskRuns] = useState<AgentTraceTaskRun[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<AgentTraceProcessTimeline | null>(
    null,
  );
  const {
    queueItems,
    browserDesktopQueueItems,
    scorecardGapQueueItems,
    queueSummary,
    taskRecoveryQueue,
    auditSummary,
    experienceQuality,
    subagentFitness,
    topologies,
    topologyProposals,
    topologyLift,
    autoVerifierMetrics,
    browserDesktopQuality,
    automationRadar,
    automationPolicyRuleDrafts,
    browserDesktopRepairRecipes,
    browserDesktopRepairVerifications,
    repairRouteQuality,
    pluginSmokeSummary,
    pluginPublisherTrust,
    setPluginPublisherTrust,
    pluginLifecycleHistory,
    trustDenialSummary,
    setTrustDenialSummary,
    policyRuleDrafts,
    agentScorecard,
    scorecardError,
    e2eCertification,
    e2eCertificationError,
    replayGate,
    refreshQueue,
  } = useOperatorReports();
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [lastApplyResult, setLastApplyResult] = useState<string | null>(null);
  const [overridePrompt, setOverridePrompt] =
    useState<ReplayGateOverridePrompt | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorReplayEvidence, setErrorReplayEvidence] =
    useState<ReplayEvidenceHint | null>(null);

  const refreshTaskRuns = useCallback(async () => {
    const rows = await fetchAgentTraceTaskRuns(8);
    setTaskRuns(rows);
    setSelectedTaskId((current) => current ?? rows[0]?.task_id ?? null);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([refreshTaskRuns(), refreshQueue()]);
      setHasLoaded(true);
      setError(null);
    } catch (err) {
      swallow(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [refreshQueue, refreshTaskRuns]);

  useEffect(() => {
    void refreshAll();
    const timer = window.setInterval(() => void refreshAll(), 8000);
    return () => window.clearInterval(timer);
  }, [refreshAll]);

  useEffect(() => {
    if (!selectedTaskId) {
      setTimeline(null);
      return;
    }
    let cancelled = false;
    fetchAgentTraceProcessTimeline(selectedTaskId)
      .then((next) => {
        if (!cancelled) setTimeline(next);
      })
      .catch((err) => {
        swallow(err);
        if (!cancelled) setTimeline(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTaskId]);

  const selectedTask = useMemo(
    () => taskRuns.find((run) => run.task_id === selectedTaskId) ?? null,
    [selectedTaskId, taskRuns],
  );

  const onQueueSelectedReview = async () => {
    if (!selectedTaskId) return;
    setBusyId(`queue:${selectedTaskId}`);
    try {
      await queueAgentTraceTaskRunReview(selectedTaskId);
      await refreshQueue();
      setError(null);
    } catch (err) {
      swallow(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onDecide = async (
    item: AgentTraceReviewQueueItem,
    action: "promoted" | "rejected" | "archived",
  ) => {
    setBusyId(item.id);
    try {
      await decideAgentTraceReviewQueueItem(item.id, {
        action,
        promotedTo: action === "promoted" ? item.target_bucket : undefined,
        reason:
          action === "promoted" ? to("Accepted from operator panel.") : "",
      });
      await refreshQueue();
      setError(null);
    } catch (err) {
      swallow(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onApplyPromoted = async () => {
    setBusyId("apply-promoted");
    try {
      const result = await applyAgentTraceReviewQueuePromotions({ limit: 50 });
      setLastApplyResult(formatApplyResult(result));
      await refreshQueue();
      setError(null);
    } catch (err) {
      swallow(err);
      const blocked = replayGateBlockFromError(err);
      if (blocked) {
        setOverridePrompt(blocked);
        setOverrideReason("");
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusyId(null);
    }
  };

  const onOverrideApply = async () => {
    const reason = overrideReason.trim();
    if (!reason) {
      setError(to("Override reason is required."));
      return;
    }
    setBusyId("override-apply");
    try {
      const result = await applyAgentTraceReviewQueuePromotions({
        limit: 50,
        overrideReplayGate: true,
        overrideReason: reason,
      });
      setLastApplyResult(formatApplyResult(result));
      setOverridePrompt(null);
      setOverrideReason("");
      await refreshQueue();
      setError(null);
    } catch (err) {
      swallow(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onSubagentPolicyDecision = async (
    role: string,
    action: "watch" | "retire",
    evidenceItemIds: string[],
  ) => {
    setBusyId(`subagent-policy:${role}:${action}`);
    try {
      await decideSubagentPolicy(role, {
        action,
        evidenceItemIds,
        reason:
          action === "retire"
            ? to(
                "Retired from operator panel using subagent fitness route evidence.",
              )
            : to(
                "Placed on watch from operator panel using subagent fitness route evidence.",
              ),
      });
      await refreshQueue();
      setError(null);
    } catch (err) {
      swallow(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const {
    onQueueTrustDenials,
    onQueueBrowserDesktopReplay,
    onQueueBrowserDesktopRepairRecipes,
    onRejectStaleBrowserDesktopReplayArtifacts,
    onRerunBlockedBrowserDesktopRepairRecipes,
    onQueueRepairRoutePromotions,
    onQueueErrorReplayEvidence,
    onQueueRealScorecardGaps,
    onQueueScorecardGap,
    onInstallPolicyRuleDraft,
    onInstallAutomationPolicyRuleDraft,
  } = useOperatorQueueActions({
    to,
    agentScorecard,
    errorReplayEvidence,
    setBusyId,
    setError,
    setErrorReplayEvidence,
    setLastApplyResult,
    setTrustDenialSummary,
    refreshQueue,
  });

  const { onTakeoverTaskRun, onResumeTaskRun } = useTaskRecoveryActions({
    setBusyId,
    setError,
    setLastApplyResult,
    refreshTaskRuns,
    refreshQueue,
    to,
  });

  // Only the *first* load may take over the whole panel. Once data has
  // landed, an action failure must keep the operator queue usable and
  // surface itself through the inline banner (plus the replay-evidence
  // drill-down card) further down — those are unreachable if we bail out
  // to the skeleton on every `error`.
  if (!hasLoaded && (loading || error)) {
    return (
      <section
        className="workspace-panel space-y-3 px-5 py-4"
        aria-busy={loading}
        data-operator-state="placeholder"
      >
        <h2 className="text-base font-semibold">
          {to("Agent evolution queue")}
        </h2>
        <p
          role={error ? "alert" : "status"}
          className="text-sm text-muted-foreground"
        >
          {error ? serviceErrorMessage(error) : "正在读取运行与治理数据…"}
        </p>
        <p className="text-xs text-muted-foreground">
          {error
            ? "统计与健康检查尚未完成，暂不显示结论。"
            : "请稍候，读取后显示统计和检查结果。"}
        </p>
        {error && (
          <Button variant="outline" size="sm" onClick={() => void refreshAll()}>
            {to("Refresh")}
          </Button>
        )}
      </section>
    );
  }
  return (
    <section className="workspace-panel px-5 py-4" data-operator-state="ready">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-eyebrow text-muted-foreground">
            {to("Operator loop")}
          </div>
          <h2 className="mt-1 text-base font-semibold">
            {to("Agent evolution queue")}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            {to(
              "Task runs become review candidates first, then you decide what is promoted into memory, backlog, rules, or archive.",
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void onApplyPromoted()}
            disabled={
              busyId === "apply-promoted" ||
              (queueSummary.by_status.promoted ?? 0) === 0
            }
          >
            <CheckCircle2Icon className="mr-1.5 size-3.5" />
            {to("Apply promoted")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void refreshAll()}
            disabled={loading}
          >
            <RefreshCwIcon
              className={cn("mr-1.5 size-3.5", loading && "animate-spin")}
            />
            {to("Refresh")}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {errorReplayEvidence && (
        <ReplayEvidenceDrilldownCard
          evidence={errorReplayEvidence}
          busy={busyId === "queue-error-replay-evidence"}
          onQueue={() => void onQueueErrorReplayEvidence()}
        />
      )}
      {lastApplyResult && (
        <div className="mb-3 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-xs text-success">
          {lastApplyResult}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <Metric
          label={to("Pending")}
          value={queueSummary.pending_count}
          tone="amber"
        />
        <Metric
          label={to("Promoted")}
          value={queueSummary.by_status.promoted ?? 0}
          tone="emerald"
        />
        <Metric
          label={to("Rejected")}
          value={queueSummary.by_status.rejected ?? 0}
          tone="rose"
        />
        <Metric label={to("Total")} value={queueSummary.total} tone="blue" />
      </div>

      <ReplayGateCard gate={replayGate} />
      <TaskRecoveryQueueCard
        queue={taskRecoveryQueue}
        busyId={busyId}
        onTakeover={(taskId) => void onTakeoverTaskRun(taskId)}
        onResume={(taskId) => void onResumeTaskRun(taskId)}
      />
      <CompetitorScorecardCard
        report={agentScorecard}
        error={scorecardError}
        auditSummary={auditSummary}
        queueItems={scorecardGapQueueItems}
        queueBusy={busyId === "queue-scorecard-gaps"}
        busyId={busyId}
        applyBusy={busyId === "apply-promoted"}
        onQueueRealGaps={() => void onQueueRealScorecardGaps()}
        onQueueGap={(dimensionId) => void onQueueScorecardGap(dimensionId)}
        onApplyPromoted={() => void onApplyPromoted()}
      />
      <E2ESurpassCertificationCard
        certification={e2eCertification}
        error={e2eCertificationError}
      />
      <AutomationRadarCard
        radar={automationRadar}
        drafts={automationPolicyRuleDrafts}
        busyId={busyId}
        onInstallDraft={(draftId) =>
          void onInstallAutomationPolicyRuleDraft(draftId)
        }
      />
      <BrowserDesktopReplayReviewCard
        items={browserDesktopQueueItems}
        total={queueSummary.by_target_bucket.browser_desktop_replay ?? 0}
        quality={browserDesktopQuality}
        repairRecipes={browserDesktopRepairRecipes}
        repairVerifications={browserDesktopRepairVerifications}
        browserBusy={busyId === "queue-browser-desktop-replay"}
        desktopBusy={busyId === "queue-desktop-desktop-replay"}
        recipeBusy={busyId === "queue-browser-desktop-repair-recipes"}
        rerunBusy={busyId === "rerun-browser-desktop-repair-recipes"}
        staleBusy={busyId === "reject-stale-browser-desktop-replay-artifacts"}
        onQueueBrowser={() => void onQueueBrowserDesktopReplay("browser")}
        onQueueDesktop={() => void onQueueBrowserDesktopReplay("desktop")}
        onQueueRepairRecipes={() => void onQueueBrowserDesktopRepairRecipes()}
        onRerunBlocked={() => void onRerunBlockedBrowserDesktopRepairRecipes()}
        onRejectStale={() => void onRejectStaleBrowserDesktopReplayArtifacts()}
      />
      <PromotionAuditSummaryCard summary={auditSummary} />
      <MemoryQualityCard summary={experienceQuality} />
      <AutoVerifierCard
        report={autoVerifierMetrics}
        repairRoutes={repairRouteQuality}
        queueBusy={busyId === "queue-repair-route-promotions"}
        onQueueRepairRoutes={() => void onQueueRepairRoutePromotions()}
      />
      <PluginHealthCard
        summary={pluginSmokeSummary}
        lifecycle={pluginLifecycleHistory}
      />
      <PublisherTrustCard
        report={pluginPublisherTrust}
        onChanged={setPluginPublisherTrust}
      />
      <ToolSafetyCard
        summary={trustDenialSummary}
        busy={busyId === "queue-trust-denials"}
        onQueuePolicyReview={() => void onQueueTrustDenials()}
      />
      <PolicyReviewRuleDraftCard
        report={policyRuleDrafts}
        busyId={busyId}
        onInstall={(draftId) => void onInstallPolicyRuleDraft(draftId)}
      />
      <SubagentRiskCard
        report={subagentFitness}
        busyId={busyId}
        onWatch={(role, evidence) =>
          void onSubagentPolicyDecision(role, "watch", evidence)
        }
        onRetire={(role, evidence) =>
          void onSubagentPolicyDecision(role, "retire", evidence)
        }
      />
      <TopologyPromotionCard
        proposals={topologyProposals}
        lift={topologyLift}
      />
      <TopologyPolicyCard topologies={topologies} />

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-3">
          <PanelTitle
            icon={<GitBranchIcon className="size-4" />}
            title={to("Recent task runs")}
            meta={`${taskRuns.length} ${to("loaded")}`}
          />
          <div className="overflow-hidden rounded-lg border border-border-default">
            {taskRuns.length === 0 ? (
              <EmptyPanel title={to("No task runs yet")} />
            ) : (
              taskRuns.map((run) => (
                <button
                  key={run.task_id}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-border-default px-3 py-2 text-left last:border-b-0 hover:bg-muted/40",
                    selectedTaskId === run.task_id && "bg-primary/10",
                  )}
                  onClick={() => setSelectedTaskId(run.task_id)}
                >
                  <StatusDot status={run.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {run.title || run.summary || run.task_id}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{shortId(run.task_id)}</span>
                      <span>
                        {run.tool_calls_started ?? 0} {to("tools")}
                      </span>
                      {(run.tool_errors ?? 0) > 0 && (
                        <span className="text-destructive">
                          {run.tool_errors} {to("errors")}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {run.status ?? to("unknown")}
                  </Badge>
                </button>
              ))
            )}
          </div>

          <div className="rounded-lg border border-border-default bg-muted/15 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {selectedTask?.title ||
                    selectedTask?.summary ||
                    to("No task selected")}
                </div>
                {selectedTaskId && (
                  <div className="font-mono text-xs text-muted-foreground">
                    {selectedTaskId}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                className="h-8 shrink-0"
                disabled={
                  !selectedTaskId || busyId === `queue:${selectedTaskId}`
                }
                onClick={() => void onQueueSelectedReview()}
              >
                <ListChecksIcon className="mr-1.5 size-3.5" />
                {to("Queue review")}
              </Button>
            </div>
            <TimelinePreview timeline={timeline} />
          </div>
        </div>

        <div className="space-y-3">
          <PanelTitle
            icon={<ListChecksIcon className="size-4" />}
            title={to("Pending review queue")}
            meta={`${queueSummary.pending_count} ${to("pending")}`}
          />
          <div className="space-y-2">
            {queueItems.length === 0 ? (
              <EmptyPanel title={to("No pending review items")} />
            ) : (
              queueItems.map((item) => (
                <ReviewQueueRow
                  key={item.id}
                  item={item}
                  busy={busyId === item.id}
                  onPromote={() => void onDecide(item, "promoted")}
                  onReject={() => void onDecide(item, "rejected")}
                  onArchive={() => void onDecide(item, "archived")}
                />
              ))
            )}
          </div>
        </div>
      </div>
      <ReplayGateOverrideDialog
        prompt={overridePrompt}
        reason={overrideReason}
        busy={busyId === "override-apply"}
        onCancel={() => setOverridePrompt(null)}
        onReasonChange={setOverrideReason}
        onConfirm={() => void onOverrideApply()}
      />
    </section>
  );
}
