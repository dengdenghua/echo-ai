import { EchoAPIError, untypedApi } from "@/core/api/request";

import type {
  AgentScorecardGapQueueResult,
  AgentTraceApproval,
  AgentTraceCheckpoint,
  AgentTraceEvent,
  AgentTraceExecutionTrace,
  AgentTraceExperienceQualitySummary,
  AgentTracePolicyReviewRuleDrafts,
  AgentTracePolicyReviewRuleInstallResult,
  AgentTraceProcessTimeline,
  AgentTracePromotionApplyResult,
  AgentTracePromotionAuditSummary,
  AgentTraceReplayCaseCorpus,
  AgentTraceReplayEvaluationCorpus,
  AgentTraceReplayGate,
  AgentTraceResumeProposal,
  AgentTraceResumeRequest,
  AgentTraceReviewQueueItem,
  AgentTraceReviewQueueSummary,
  AgentTraceScope,
  AgentTraceStats,
  AgentTraceTaskRecoveryQueue,
  AgentTraceTaskRun,
  AgentTraceTaskRunMutationResult,
  AgentTraceTrustDenialSummary,
  BrowserReplayQueueResult,
  ReplayEvidenceHint,
} from "./types";
import type {
  AgentCompetitorScorecard,
  AutoVerifierMetricsReport,
  AutomationPolicyRuleDraftsReport,
  AutomationPolicyRuleInstallResult,
  AutomationRadarReport,
  BrowserDesktopQualityReport,
  BrowserDesktopRepairRecipeEvidenceAttachment,
  BrowserDesktopRepairRecipeQueueResult,
  BrowserDesktopRepairRecipeRerunBatchResult,
  BrowserDesktopRepairRecipeRerunResult,
  BrowserDesktopRepairRecipeVerificationsReport,
  BrowserDesktopRepairRecipesReport,
  BrowserDesktopStaleArtifactRejectionResult,
  E2ESurpassCertification,
  OrganizationTopology,
  OrganizationTopologyLiftReport,
  OrganizationTopologyProposalsReport,
  RepairRoutePromotionQueueResult,
  RepairRouteQualityReport,
  SubagentFitnessReport,
  SubagentPolicyDecisionResult,
} from "./evolution-types";

// The response shapes live in ./types and ./evolution-types; re-exported so
// `@/core/agent-trace/api` stays the one import path for callers.
export type * from "./types";
export type * from "./evolution-types";

export const E2E_SURPASS_TARGET_SCORE = 95;

export class AgentTraceRequestError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(`Agent trace request failed: ${status}`);
    this.name = "AgentTraceRequestError";
    this.status = status;
    this.detail = detail;
  }
}

function appendScope(params: URLSearchParams, scope?: AgentTraceScope) {
  if (scope?.threadId) params.set("thread_id", scope.threadId);
  if (scope?.taskId) params.set("task_id", scope.taskId);
  if (scope?.agentId) params.set("agent_id", scope.agentId);
  if (scope?.turnId) params.set("turn_id", scope.turnId);
}

const DYNAMIC_PATH_REASON =
  "callers pass ~50 dynamic agent-trace / task-run / replay paths with prebuilt query strings, including server-provided queue URLs";

/** HTTP failures keep surfacing as ``AgentTraceRequestError(status, detail)``. */
async function traceRequest<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof EchoAPIError) {
      throw new AgentTraceRequestError(error.status, error.detail);
    }
    throw error;
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  return traceRequest(() =>
    untypedApi.get<T>(path, { reason: DYNAMIC_PATH_REASON }),
  );
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return traceRequest(() =>
    untypedApi.post<T>(path, {
      reason: DYNAMIC_PATH_REASON,
      body,
      // Historically sent even when the POST carries no body.
      headers: { "Content-Type": "application/json" },
    }),
  );
}

export async function fetchAgentTraceStats(
  scope?: AgentTraceScope,
): Promise<AgentTraceStats> {
  const params = new URLSearchParams();
  appendScope(params, scope);
  const query = params.toString();
  return fetchJson<AgentTraceStats>(
    `/api/agent-trace/stats${query ? `?${query}` : ""}`,
  );
}

export async function fetchAgentTraceEvents(
  limit = 8,
  offset = 0,
  scope?: AgentTraceScope,
): Promise<AgentTraceEvent[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(Math.max(0, offset)),
  });
  appendScope(params, scope);
  const data = await fetchJson<{ events: AgentTraceEvent[] }>(
    `/api/agent-trace/events?${params.toString()}`,
  );
  return data.events;
}

export async function fetchAgentTraceTaskRuns(
  limit = 8,
  offset = 0,
  scope?: AgentTraceScope,
  status?: string,
): Promise<AgentTraceTaskRun[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(Math.max(0, offset)),
  });
  appendScope(params, scope);
  if (status) params.set("status", status);
  const data = await fetchJson<{ task_runs: AgentTraceTaskRun[] }>(
    `/api/agent-trace/task-runs?${params.toString()}`,
  );
  return data.task_runs;
}

export async function fetchAgentTraceExecutionTrace(
  turnId: string,
  scope?: AgentTraceScope,
): Promise<AgentTraceExecutionTrace> {
  const params = new URLSearchParams({ turn_id: turnId });
  appendScope(params, scope);
  const data = await fetchJson<{ trace: AgentTraceExecutionTrace }>(
    `/api/agent-trace/execution-trace?${params.toString()}`,
  );
  return data.trace;
}

export async function fetchTaskRecoveryQueue(options?: {
  limit?: number;
  status?: string;
  kind?: string;
  threadId?: string;
  includeMonitor?: boolean;
}): Promise<AgentTraceTaskRecoveryQueue> {
  const params = new URLSearchParams({
    limit: String(options?.limit ?? 8),
  });
  if (options?.status) params.set("status", options.status);
  if (options?.kind) params.set("kind", options.kind);
  if (options?.threadId) params.set("thread_id", options.threadId);
  if (options?.includeMonitor) params.set("include_monitor", "true");
  return fetchJson<AgentTraceTaskRecoveryQueue>(
    `/api/task-runs/recovery-queue?${params.toString()}`,
  );
}

export async function takeoverTaskRun(
  taskId: string,
  reason = "operator recovery queue takeover",
): Promise<AgentTraceTaskRunMutationResult> {
  return postJson<AgentTraceTaskRunMutationResult>(
    `/api/task-runs/${encodeURIComponent(taskId)}/takeover`,
    { reason },
  );
}

export async function fetchAgentTraceProcessTimeline(
  taskId: string,
): Promise<AgentTraceProcessTimeline> {
  const data = await fetchJson<{ timeline: AgentTraceProcessTimeline }>(
    `/api/agent-trace/task-runs/${encodeURIComponent(taskId)}/process-timeline`,
  );
  return data.timeline;
}

export async function queueAgentTraceTaskRunReview(taskId: string): Promise<{
  created: number;
  updated: number;
  total: number;
  items: AgentTraceReviewQueueItem[];
}> {
  const data = await postJson<{
    queue: {
      created: number;
      updated: number;
      total: number;
      items: AgentTraceReviewQueueItem[];
    };
  }>(`/api/agent-trace/task-runs/${encodeURIComponent(taskId)}/review/queue`);
  return data.queue;
}

export async function queueLatestBrowserSessionReplayCase(
  reason = "operator panel browser replay capture",
): Promise<BrowserReplayQueueResult> {
  const sessions = await fetchJson<{
    sessions: Array<{
      session_id: string;
      action_count?: number;
      last_activity?: number;
    }>;
  }>("/api/browser/sessions");
  const latest = sessions.sessions
    .filter((session) => (session.action_count ?? 0) > 0)
    .sort((lhs, rhs) => (rhs.last_activity ?? 0) - (lhs.last_activity ?? 0))[0];
  if (!latest?.session_id) {
    throw new AgentTraceRequestError(409, {
      detail: "No browser session with replay actions is available.",
    });
  }
  return postJson<BrowserReplayQueueResult>(
    "/api/browser/session/replay-case/queue",
    {
      session_id: latest.session_id,
      reason,
    },
  );
}

export async function queueComputerActivityReplayCase(
  reason = "operator panel desktop replay capture",
): Promise<BrowserReplayQueueResult> {
  return postJson<BrowserReplayQueueResult>(
    "/api/computer/activity/replay-case/queue",
    { reason },
  );
}

export async function queueReplayEvidenceHint(
  evidence: ReplayEvidenceHint,
  reason = "operator panel replay evidence drill-down",
): Promise<BrowserReplayQueueResult> {
  const queueUrl = String(evidence.queue_url || "");
  if (!queueUrl.startsWith("/api/")) {
    throw new AgentTraceRequestError(400, {
      detail: "Replay evidence is missing a trusted queue URL.",
    });
  }
  return postJson<BrowserReplayQueueResult>(queueUrl, {
    ...(evidence.queue_body ?? {}),
    reason,
  });
}

export async function queueAgentScorecardGaps(options?: {
  targetScore?: number;
  limit?: number;
  reason?: string;
  dimensionId?: string;
}): Promise<AgentScorecardGapQueueResult> {
  return postJson<AgentScorecardGapQueueResult>(
    "/api/evolution/agent-scorecard/gaps/queue",
    {
      target_score: options?.targetScore ?? E2E_SURPASS_TARGET_SCORE,
      limit: options?.limit ?? 10,
      reason: options?.reason ?? "operator panel real score gap review",
      dimension_id: options?.dimensionId ?? "",
    },
  );
}

export async function fetchRepairRouteQuality(
  limit = 1000,
): Promise<RepairRouteQualityReport> {
  const params = new URLSearchParams({ limit: String(limit) });
  return fetchJson<RepairRouteQualityReport>(
    `/api/evolution/repair-route-quality?${params.toString()}`,
  );
}

export async function queueRepairRoutePromotionCandidates(
  limit = 1000,
): Promise<RepairRoutePromotionQueueResult> {
  return postJson<RepairRoutePromotionQueueResult>(
    "/api/evolution/repair-route-quality/promotions/queue",
    { limit },
  );
}

export async function fetchBrowserDesktopQuality(): Promise<BrowserDesktopQualityReport> {
  return fetchJson<BrowserDesktopQualityReport>(
    "/api/evolution/browser-desktop-quality",
  );
}

export async function fetchAutomationRadar(
  targetScore = E2E_SURPASS_TARGET_SCORE,
): Promise<AutomationRadarReport> {
  const params = new URLSearchParams({ target_score: String(targetScore) });
  return fetchJson<AutomationRadarReport>(
    `/api/evolution/automation-radar?${params.toString()}`,
  );
}

export async function fetchE2ESurpassCertification(
  targetScore = E2E_SURPASS_TARGET_SCORE,
): Promise<E2ESurpassCertification> {
  const params = new URLSearchParams({ target_score: String(targetScore) });
  return fetchJson<E2ESurpassCertification>(
    `/api/evolution/e2e-surpass-certification?${params.toString()}`,
  );
}

export async function fetchAutomationPolicyRuleDrafts(
  limit = 100,
): Promise<AutomationPolicyRuleDraftsReport> {
  const params = new URLSearchParams({ limit: String(limit) });
  return fetchJson<AutomationPolicyRuleDraftsReport>(
    `/api/evolution/automation-policy-rule-drafts?${params.toString()}`,
  );
}

export async function installAutomationPolicyRuleDraft(
  draftId: string,
): Promise<AutomationPolicyRuleInstallResult> {
  return postJson<AutomationPolicyRuleInstallResult>(
    "/api/evolution/automation-policy-rule-drafts/install",
    {
      draft_id: draftId,
      confirm_install: true,
    },
  );
}

export async function fetchBrowserDesktopRepairRecipes(
  limit = 1000,
  minOccurrences = 1,
): Promise<BrowserDesktopRepairRecipesReport> {
  const params = new URLSearchParams({
    limit: String(limit),
    min_occurrences: String(minOccurrences),
  });
  return fetchJson<BrowserDesktopRepairRecipesReport>(
    `/api/evolution/browser-desktop-repair-recipes?${params.toString()}`,
  );
}

export async function queueBrowserDesktopRepairRecipes(
  limit = 1000,
  minOccurrences = 1,
): Promise<BrowserDesktopRepairRecipeQueueResult> {
  return postJson<BrowserDesktopRepairRecipeQueueResult>(
    "/api/evolution/browser-desktop-repair-recipes/queue",
    {
      limit,
      min_occurrences: minOccurrences,
    },
  );
}

export async function rejectStaleBrowserDesktopReplayArtifacts(
  limit = 1000,
): Promise<BrowserDesktopStaleArtifactRejectionResult> {
  return postJson<BrowserDesktopStaleArtifactRejectionResult>(
    "/api/evolution/browser-desktop-repair-recipes/stale-artifacts/reject",
    { limit },
  );
}

export async function fetchBrowserDesktopRepairRecipeVerifications(
  limit = 1000,
): Promise<BrowserDesktopRepairRecipeVerificationsReport> {
  const params = new URLSearchParams({ limit: String(limit) });
  return fetchJson<BrowserDesktopRepairRecipeVerificationsReport>(
    `/api/evolution/browser-desktop-repair-recipes/verifications?${params.toString()}`,
  );
}

export async function attachBrowserDesktopRepairRecipeEvidence(options: {
  itemId: string;
  passed: boolean;
  provided?: string[];
  artifacts?: Array<Record<string, unknown>>;
  notes?: string;
  actor?: string;
}): Promise<BrowserDesktopRepairRecipeEvidenceAttachment> {
  return postJson<BrowserDesktopRepairRecipeEvidenceAttachment>(
    "/api/evolution/browser-desktop-repair-recipes/verifications/evidence",
    {
      item_id: options.itemId,
      passed: options.passed,
      provided: options.provided ?? [],
      artifacts: options.artifacts ?? [],
      notes: options.notes ?? "",
      actor: options.actor ?? "operator_panel",
    },
  );
}

export async function rerunBrowserDesktopRepairRecipeEvidence(options: {
  itemId: string;
  apiBaseUrl?: string;
  promoteSourceCases?: boolean;
  actor?: string;
}): Promise<BrowserDesktopRepairRecipeRerunResult> {
  return postJson<BrowserDesktopRepairRecipeRerunResult>(
    "/api/evolution/browser-desktop-repair-recipes/verifications/rerun",
    {
      item_id: options.itemId,
      api_base_url: options.apiBaseUrl ?? "http://127.0.0.1:8310",
      promote_source_cases: options.promoteSourceCases ?? false,
      actor: options.actor ?? "operator_panel",
    },
  );
}

export async function rerunBrowserDesktopRepairRecipeEvidenceBatch(options?: {
  apiBaseUrl?: string;
  promoteSourceCases?: boolean;
  actor?: string;
  limit?: number;
}): Promise<BrowserDesktopRepairRecipeRerunBatchResult> {
  return postJson<BrowserDesktopRepairRecipeRerunBatchResult>(
    "/api/evolution/browser-desktop-repair-recipes/verifications/rerun-batch",
    {
      api_base_url: options?.apiBaseUrl ?? "http://127.0.0.1:8310",
      promote_source_cases: options?.promoteSourceCases ?? false,
      actor: options?.actor ?? "operator_panel",
      limit: options?.limit ?? 20,
    },
  );
}

export async function fetchAgentTraceReviewQueue(
  limit = 12,
  offset = 0,
  filters?: {
    status?: string;
    targetBucket?: string;
    priority?: string;
    sourceTaskId?: string;
  },
): Promise<AgentTraceReviewQueueItem[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(Math.max(0, offset)),
  });
  if (filters?.status) params.set("status", filters.status);
  if (filters?.targetBucket) params.set("target_bucket", filters.targetBucket);
  if (filters?.priority) params.set("priority", filters.priority);
  if (filters?.sourceTaskId) params.set("source_task_id", filters.sourceTaskId);
  const data = await fetchJson<{ items: AgentTraceReviewQueueItem[] }>(
    `/api/agent-trace/review-queue?${params.toString()}`,
  );
  return data.items;
}

export async function fetchAgentTraceReviewQueueSummary(): Promise<AgentTraceReviewQueueSummary> {
  return fetchJson<AgentTraceReviewQueueSummary>(
    "/api/agent-trace/review-queue/summary",
  );
}

export async function decideAgentTraceReviewQueueItem(
  itemId: string,
  decision: {
    action: "promoted" | "rejected" | "archived";
    reason?: string;
    promotedTo?: string;
  },
): Promise<AgentTraceReviewQueueItem> {
  const data = await postJson<{ item: AgentTraceReviewQueueItem }>(
    `/api/agent-trace/review-queue/${encodeURIComponent(itemId)}/decision`,
    {
      action: decision.action,
      reason: decision.reason ?? "",
      promoted_to: decision.promotedTo,
    },
  );
  return data.item;
}

export async function applyAgentTraceReviewQueuePromotions(options?: {
  itemId?: string;
  target?: string;
  limit?: number;
  overrideReplayGate?: boolean;
  overrideReason?: string;
  minReplayCases?: number;
  minReplayScore?: number;
}): Promise<AgentTracePromotionApplyResult> {
  return postJson<AgentTracePromotionApplyResult>(
    "/api/agent-trace/review-queue/promotions/apply",
    {
      item_id: options?.itemId,
      target: options?.target,
      limit: options?.limit ?? 50,
      override_replay_gate: options?.overrideReplayGate,
      override_reason: options?.overrideReason,
      min_replay_cases: options?.minReplayCases,
      min_replay_score: options?.minReplayScore,
    },
  );
}

export async function fetchAgentTraceReplayGate(
  scope?: Pick<AgentTraceScope, "threadId" | "turnId" | "agentId"> & {
    status?: string;
    minCases?: number;
    minScore?: number;
    limit?: number;
  },
): Promise<AgentTraceReplayGate> {
  const params = new URLSearchParams({
    min_cases: String(scope?.minCases ?? 1),
    min_score: String(scope?.minScore ?? 1),
    limit: String(scope?.limit ?? 100),
  });
  appendScope(params, scope);
  if (scope?.status) params.set("status", scope.status);
  return fetchJson<AgentTraceReplayGate>(
    `/api/agent-trace/replay-gate?${params.toString()}`,
  );
}

export async function fetchAgentTraceReplayCases(
  scope?: Pick<AgentTraceScope, "threadId" | "turnId" | "agentId"> & {
    status?: string;
    limit?: number;
    offset?: number;
  },
): Promise<AgentTraceReplayCaseCorpus> {
  const params = new URLSearchParams({
    limit: String(scope?.limit ?? 100),
    offset: String(Math.max(0, scope?.offset ?? 0)),
  });
  appendScope(params, scope);
  if (scope?.status) params.set("status", scope.status);
  return fetchJson<AgentTraceReplayCaseCorpus>(
    `/api/agent-trace/replay-cases?${params.toString()}`,
  );
}

export async function fetchAgentTraceReplayEvaluations(
  scope?: Pick<AgentTraceScope, "threadId" | "turnId" | "agentId"> & {
    status?: string;
    limit?: number;
    offset?: number;
  },
): Promise<AgentTraceReplayEvaluationCorpus> {
  const params = new URLSearchParams({
    limit: String(scope?.limit ?? 100),
    offset: String(Math.max(0, scope?.offset ?? 0)),
  });
  appendScope(params, scope);
  if (scope?.status) params.set("status", scope.status);
  return fetchJson<AgentTraceReplayEvaluationCorpus>(
    `/api/agent-trace/replay-evaluations?${params.toString()}`,
  );
}

export async function fetchAgentTracePromotionAuditSummary(): Promise<AgentTracePromotionAuditSummary> {
  return fetchJson<AgentTracePromotionAuditSummary>(
    "/api/agent-trace/review-queue/promotions/audit/summary",
  );
}

export async function fetchAgentTraceExperienceQualitySummary(): Promise<AgentTraceExperienceQualitySummary> {
  return fetchJson<AgentTraceExperienceQualitySummary>(
    "/api/agent-trace/experience-ledger/quality-summary",
  );
}

export async function fetchAgentTraceTrustDenialSummary(
  limit = 1000,
  options?: {
    queueRepeated?: boolean;
    minOccurrences?: number;
  },
): Promise<AgentTraceTrustDenialSummary> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (options?.queueRepeated) params.set("queue_repeated", "true");
  if (options?.minOccurrences) {
    params.set("min_occurrences", String(options.minOccurrences));
  }
  return fetchJson<AgentTraceTrustDenialSummary>(
    `/api/agent-trace/trust-denials/summary?${params.toString()}`,
  );
}

export async function fetchAgentTracePolicyReviewRuleDrafts(
  limit = 100,
): Promise<AgentTracePolicyReviewRuleDrafts> {
  const params = new URLSearchParams({ limit: String(limit) });
  return fetchJson<AgentTracePolicyReviewRuleDrafts>(
    `/api/agent-trace/policy-review/rule-drafts?${params.toString()}`,
  );
}

export async function installAgentTracePolicyReviewRuleDraft(
  draftId: string,
): Promise<AgentTracePolicyReviewRuleInstallResult> {
  return postJson<AgentTracePolicyReviewRuleInstallResult>(
    "/api/agent-trace/policy-review/rule-drafts/install",
    {
      draft_id: draftId,
      confirm_install: true,
    },
  );
}

export async function fetchSubagentFitness(
  limit = 2000,
): Promise<SubagentFitnessReport> {
  const params = new URLSearchParams({ limit: String(limit) });
  const data = await fetchJson<SubagentFitnessReport & { ok?: boolean }>(
    `/api/evolution/subagent-fitness?${params.toString()}`,
  );
  return data;
}

export async function decideSubagentPolicy(
  role: string,
  decision: {
    action: "watch" | "retire" | "clear";
    reason?: string;
    evidenceItemIds?: string[];
  },
): Promise<SubagentPolicyDecisionResult> {
  return postJson<SubagentPolicyDecisionResult>(
    `/api/evolution/subagent-policy/${encodeURIComponent(role)}/decision`,
    {
      action: decision.action,
      reason: decision.reason ?? "",
      evidence_item_ids: decision.evidenceItemIds ?? [],
      actor: "operator_panel",
    },
  );
}

export async function fetchOrganizationTopologies(): Promise<
  OrganizationTopology[]
> {
  const data = await fetchJson<{ topologies: OrganizationTopology[] }>(
    "/api/organizations/topologies",
  );
  return data.topologies;
}

export async function fetchOrganizationTopologyProposals(): Promise<OrganizationTopologyProposalsReport> {
  return fetchJson<OrganizationTopologyProposalsReport>(
    "/api/organizations/topology-proposals",
  );
}

export async function fetchOrganizationTopologyLift(): Promise<OrganizationTopologyLiftReport> {
  return fetchJson<OrganizationTopologyLiftReport>(
    "/api/organizations/topology-promotion-lift",
  );
}

export async function fetchAutoVerifierMetrics(
  limit = 20,
): Promise<AutoVerifierMetricsReport> {
  const params = new URLSearchParams({ limit: String(limit) });
  return fetchJson<AutoVerifierMetricsReport>(
    `/api/evolution/auto-verifier-metrics?${params.toString()}`,
  );
}

export async function fetchAgentCompetitorScorecard(
  targetScore = E2E_SURPASS_TARGET_SCORE,
): Promise<AgentCompetitorScorecard> {
  const params = new URLSearchParams({ target_score: String(targetScore) });
  return fetchJson<AgentCompetitorScorecard>(
    `/api/evolution/agent-scorecard?${params.toString()}`,
  );
}

export async function fetchAgentTraceApprovals(
  limit = 5,
  offset = 0,
  scope?: Pick<AgentTraceScope, "threadId" | "turnId">,
): Promise<AgentTraceApproval[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(Math.max(0, offset)),
  });
  appendScope(params, scope);
  const data = await fetchJson<{ approvals: AgentTraceApproval[] }>(
    `/api/agent-trace/approvals?${params.toString()}`,
  );
  return data.approvals;
}

export async function fetchAgentTraceCheckpoints(
  limit = 3,
  offset = 0,
  scope?: AgentTraceScope,
): Promise<AgentTraceCheckpoint[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(Math.max(0, offset)),
  });
  appendScope(params, scope);
  const data = await fetchJson<{ checkpoints: AgentTraceCheckpoint[] }>(
    `/api/agent-trace/checkpoints?${params.toString()}`,
  );
  return data.checkpoints;
}

export async function fetchAgentTraceResumeProposal(
  checkpointId: number,
): Promise<AgentTraceResumeProposal> {
  const data = await fetchJson<{ proposal: AgentTraceResumeProposal }>(
    `/api/agent-trace/checkpoints/${encodeURIComponent(String(checkpointId))}/resume-proposal`,
  );
  return data.proposal;
}

export async function fetchAgentTraceResumeProposals(
  limit = 3,
  offset = 0,
  scope?: AgentTraceScope,
): Promise<AgentTraceResumeProposal[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(Math.max(0, offset)),
  });
  appendScope(params, scope);
  const data = await fetchJson<{ proposals: AgentTraceResumeProposal[] }>(
    `/api/agent-trace/resume-proposals?${params.toString()}`,
  );
  return data.proposals;
}

export async function fetchAgentTraceResumeRequests(
  limit = 5,
  offset = 0,
  scope?: Pick<AgentTraceScope, "threadId">,
  status?: string,
): Promise<AgentTraceResumeRequest[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(Math.max(0, offset)),
  });
  appendScope(params, scope);
  if (status) params.set("status", status);
  const data = await fetchJson<{ requests: AgentTraceResumeRequest[] }>(
    `/api/agent-trace/resume-requests?${params.toString()}`,
  );
  return data.requests;
}
