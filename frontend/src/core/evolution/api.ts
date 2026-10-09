import {
  apiGet,
  apiPost,
  failureDetail,
  type ApiFailure,
} from "@/core/api/request";

const EVOLUTION_TIMEOUT_MS = 8_000;

/** Run an evolution request with an 8s abort budget. */
async function withEvolutionTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    EVOLUTION_TIMEOUT_MS,
  );
  try {
    return await run(controller.signal);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/** Keep this module's historical ``"<label>: <statusText>"`` wording. */
function failed(label: string) {
  return (failure: ApiFailure): string => `${label}: ${failure.statusText}`;
}

/** A truthy body ``detail`` wins, else ``fallback``. */
function detailOr(fallback: (failure: ApiFailure) => string) {
  return (failure: ApiFailure): string => {
    const detail = failureDetail(failure);
    return detail ? String(detail) : fallback(failure);
  };
}

export interface EvolutionOverview {
  skills: {
    total: number;
    auto_extracted: number;
    manual: number;
    avg_success_rate: number;
  };
  memory: {
    total_facts: number;
    categories: {
      memories: number;
      rules: number;
      trajectories: number;
    };
  };
  knowledge_graph: { nodes: number; edges: number } | null;
  learning_events: number;
  improvement_score: number;
  proactive_learning: {
    enabled: boolean;
    is_running: boolean;
    total_reports: number;
    subscriptions: number;
    enabled_subscriptions: number;
    last_report_at: string | null;
    total_skills_created: number;
  };
  source: string;
}

export interface LearningCurvePoint {
  week: string;
  success_rate: number;
  avg_duration_ms: number;
  skills_used: number;
}

export interface SkillPerformance {
  name: string;
  usage_count: number;
  success_count: number;
  success_rate: number;
  avg_cost_usd: number;
  avg_tokens: number;
  source: string;
}

export interface MemoryGrowthPoint {
  date: string;
  fact: number;
  preference: number;
  learned_skill: number;
  relationship: number;
}

export interface Recommendation {
  type: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  action_label: string;
  meta: Record<string, unknown>;
}

export interface EvolutionStoryChange {
  kind: "rule" | "memory" | "skill";
  title: string;
  content: string;
  effect: string;
}

export interface EvolutionStoryObservation {
  task_id: string;
  thread_id: string | null;
  title: string;
  timestamp: string;
  status: string;
  success: boolean;
  step_count: number;
  tools: string[];
  learning_points: string[];
}

export interface EvolutionStory {
  has_real_change: boolean;
  observed_task_count: number;
  durable_change_count: number;
  rule_count: number;
  memory_count: number;
  skill_count: number;
  changes: EvolutionStoryChange[];
  observations: EvolutionStoryObservation[];
}

export interface FitnessReport {
  ok: boolean;
  agent_id: string;
  ts: string;
  l1: {
    score: number;
    trend: string;
    success_rate: number;
    avg_rounds: number;
  } | null;
  l2: {
    score: number;
    dominant_failure: string;
    action: string;
    confidence: number;
  } | null;
  combined: number;
  verdict: string;
}

export interface DriftReport {
  ok: boolean;
  agent_id: string;
  ts: string;
  has_drift: boolean;
  max_severity: string;
  events: Array<{ kind: string; severity: string; detail: string }>;
}

export interface LedgerRecord {
  id: string;
  kind: string;
  description: string;
  status: string;
  proposer: string;
  ts: string;
  fitness_before: number | null;
  fitness_after: number | null;
}

export interface CanaryState {
  skill_name: string;
  phase: string;
  sample_count: number;
  success_count: number;
  current_rate: number;
  entered_ts: string;
}

export interface CodexGapCapability {
  id: string;
  area: "codex_parity" | "echo_advantage";
  title: string;
  why: string;
  score: number;
  target_score: number;
  status: string;
  next_actions: string[];
}

export interface CodexGapReport {
  ok: boolean;
  schema: string;
  parity_score: number;
  advantage_score: number;
  combined_score: number;
  verdict: string;
  capabilities: CodexGapCapability[];
  top_gaps?: CodexGapCapability[];
  error?: string;
}

export interface AgentBenchmarkReport {
  ok: boolean;
  schema: string;
  score: number;
  passed: number;
  total: number;
  ready: boolean;
  cases: Array<{
    id: string;
    title: string;
    dimension: string;
    passed: boolean;
    next_action: string;
  }>;
  error?: string;
}

export interface DualHelixEvidence {
  ok: boolean;
  schema: string;
  paired_count: number;
  unpaired_count: number;
  echo_wins: number;
  codex_wins: number;
  ties: number;
  echo_win_rate: number | null;
  evidence_quality?: "controlled_same_task" | "observational";
  controlled?: ControlledExperimentEvidence;
  strands: Record<
    "echo" | "codex",
    { samples: number; successes: number; success_rate: number | null }
  >;
  pairs: Array<{
    goal_fingerprint: string;
    goal: string;
    winner: "echo" | "codex" | "tie";
    echo: {
      outcome: "success" | "failure";
      model: string | null;
      ts: string;
    };
    codex: { outcome: "success" | "failure"; model: string | null; ts: string };
  }>;
  error?: string;
}

export interface ControlledExperimentEvidence {
  ok: boolean;
  schema: "echo.evolution.pair_evidence.v1" | string;
  generated_at: string;
  trial_count: number;
  paired_count: number;
  pairable_key_count: number;
  unpaired_key_count: number;
  echo_wins: number;
  codex_wins: number;
  ties: number;
  excluded: {
    infrastructure_failed: number;
    incomplete: number;
    hard_gate_failed: number;
    duplicate_engine_trial: number;
  };
  primary_metric: string;
  pairs: Array<{
    pair_key: string;
    experiment_id: string;
    case_id: string;
    task_spec_hash: string;
    trial_index: number;
    goal: string;
    domain: string;
    winner: "echo" | "codex" | "tie";
  }>;
}

export interface EvolutionCandidateList {
  ok: boolean;
  schema: string;
  total: number;
  by_status: Record<string, number>;
  by_gene_type: Record<string, number>;
  candidates: Array<{
    candidate_id: string;
    gene_type: "prompt" | "skill" | "routing" | "workflow" | "role" | "policy";
    scope: string;
    proposer: string;
    status:
      | "proposed"
      | "validated"
      | "shadow"
      | "canary"
      | "promoted"
      | "rejected"
      | "rolled_back";
    role_id: string;
    task_domain: string;
    risk_level: string;
    hard_gate_passed: boolean;
    hard_gate_results: Record<string, boolean>;
    metric_vector: Record<string, number>;
    experiment_ids: string[];
    metadata: Record<string, unknown>;
    deployment_key: string;
    runtime_consumer_ready: boolean;
    created_at: string;
    updated_at: string;
    canary?: {
      skill_name: string;
      phase: "canary_5" | "canary_25" | "canary_50" | "full" | "rolled_back";
      sample_count: number;
      success_count: number;
      failure_count: number;
      current_rate: number;
    } | null;
  }>;
}

export interface CandidateCanaryStatus {
  ok: boolean;
  schema: string;
  candidate: EvolutionCandidateList["candidates"][number];
  canary: {
    skill_name: string;
    phase: "canary_5" | "canary_25" | "canary_50" | "full" | "rolled_back";
    sample_count: number;
    success_count: number;
    failure_count: number;
    current_rate: number;
  } | null;
}

export interface DualHelixShadowStatus {
  ok: boolean;
  schema?: string;
  enabled: boolean;
  automatic_enabled?: boolean;
  automatic_policy?: {
    risk_gated: boolean;
    repeated_failure_threshold?: number;
    low_confidence_threshold?: number;
  };
  isolation?: string;
  runs: Array<{
    run_id: string;
    goal: string;
    primary_engine: "echo" | "codex";
    shadow_engine: "echo" | "codex";
    status: string;
    created_at: string;
    updated_at?: string;
    source_thread_id?: string | null;
    source_message_id?: string | null;
    candidate_id?: string | null;
    experiment_id?: string | null;
    result?: string | null;
    verdict?: "pass" | "fail" | "inconclusive" | null;
    hard_gates?: Record<string, boolean> | null;
    evidence?: string[] | null;
    recommendations?: string[] | null;
    trigger?: string;
    trigger_signals?: string[] | null;
    error?: string | null;
  }>;
  error?: string;
}

export async function getEvolutionOverview(): Promise<EvolutionOverview> {
  return (await withEvolutionTimeout((signal) =>
    apiGet("/api/evolution/overview", {
      signal,
      errorMessage: failed("Failed to load evolution overview"),
    }),
  )) as EvolutionOverview;
}

export async function getCodexGapReport(): Promise<CodexGapReport> {
  return (await withEvolutionTimeout((signal) =>
    apiGet("/api/evolution/codex-gap", {
      signal,
      errorMessage: failed("Failed to load Codex gap report"),
    }),
  )) as CodexGapReport;
}

export async function getAgentBenchmarkReport(): Promise<AgentBenchmarkReport> {
  return (await withEvolutionTimeout((signal) =>
    apiGet("/api/evolution/agent-benchmark", {
      signal,
      errorMessage: failed("Failed to load agent benchmark"),
    }),
  )) as AgentBenchmarkReport;
}

export async function getDualHelixEvidence(): Promise<DualHelixEvidence> {
  return (await withEvolutionTimeout((signal) =>
    apiGet("/api/evolution/dual-helix/evidence", {
      signal,
      errorMessage: failed("Failed to load dual-helix evidence"),
    }),
  )) as DualHelixEvidence;
}

export async function getControlledExperimentEvidence(): Promise<ControlledExperimentEvidence> {
  return (await withEvolutionTimeout((signal) =>
    apiGet("/api/evolution/experiments/evidence", {
      signal,
      errorMessage: failed("Failed to load controlled experiment evidence"),
    }),
  )) as ControlledExperimentEvidence;
}

export async function getEvolutionCandidates(): Promise<EvolutionCandidateList> {
  return (await withEvolutionTimeout((signal) =>
    apiGet("/api/evolution/candidates", {
      signal,
      errorMessage: failed("Failed to load evolution candidates"),
    }),
  )) as EvolutionCandidateList;
}

export async function registerCandidateCanary(
  candidateId: string,
): Promise<CandidateCanaryStatus> {
  return (await withEvolutionTimeout((signal) =>
    apiPost("/api/evolution/candidates/{candidate_id}/canary/register", {
      path: { candidate_id: candidateId },
      // Bodiless, but the JSON content type was always sent.
      headers: { "Content-Type": "application/json" },
      signal,
      errorMessage: detailOr(() => "Failed to register candidate canary"),
    }),
  )) as CandidateCanaryStatus;
}

export async function rollbackEvolutionCandidate(
  candidateId: string,
  reason = "operator rollback",
): Promise<CandidateCanaryStatus> {
  return (await withEvolutionTimeout((signal) =>
    apiPost("/api/evolution/candidates/{candidate_id}/rollback", {
      path: { candidate_id: candidateId },
      body: { reason },
      signal,
      errorMessage: detailOr(() => "Failed to rollback candidate"),
    }),
  )) as CandidateCanaryStatus;
}

export async function getDualHelixShadowStatus(): Promise<DualHelixShadowStatus> {
  return (await withEvolutionTimeout((signal) =>
    apiGet("/api/evolution/dual-helix/shadow/status", {
      signal,
      errorMessage: failed("Failed to load shadow status"),
    }),
  )) as DualHelixShadowStatus;
}

export async function setDualHelixShadowEnabled(
  enabled: boolean,
): Promise<DualHelixShadowStatus> {
  return (await withEvolutionTimeout((signal) =>
    apiPost("/api/evolution/dual-helix/shadow/settings", {
      body: { enabled },
      signal,
      errorMessage: failed("Failed to update shadow status"),
    }),
  )) as DualHelixShadowStatus;
}

export interface DualHelixShadowRunRequest {
  goal: string;
  primary_engine: "echo" | "codex";
  primary_output: string;
  workspace_path?: string;
  source_thread_id?: string;
  source_message_id?: string;
  candidate_id?: string;
  experiment_id?: string;
  automatic?: boolean;
  risk_level?: "low" | "medium" | "high" | "critical";
  failure_count?: number;
  confidence?: number | "low" | "medium" | "high";
}

export async function queueDualHelixShadowRun(
  body: DualHelixShadowRunRequest,
): Promise<DualHelixShadowStatus["runs"][number]> {
  const value = (await withEvolutionTimeout((signal) =>
    apiPost("/api/evolution/dual-helix/shadow/run", {
      body,
      signal,
      errorMessage: detailOr(failed("Failed to queue shadow review")),
    }),
  )) as DualHelixShadowStatus["runs"][number] & { ok?: boolean };
  return value;
}

export async function getEvolutionStory(): Promise<EvolutionStory> {
  return (await withEvolutionTimeout((signal) =>
    apiGet("/api/evolution/story", {
      signal,
      errorMessage: failed("Failed to load evolution story"),
    }),
  )) as EvolutionStory;
}

export async function getLearningCurve(
  weeks?: number,
): Promise<LearningCurvePoint[]> {
  // ``List[dict]`` rows are loose records; widen before narrowing.
  return (await withEvolutionTimeout((signal) =>
    apiGet("/api/evolution/learning-curve", {
      query: { weeks },
      signal,
      errorMessage: failed("Failed to load learning curve"),
    }),
  )) as unknown as LearningCurvePoint[];
}

export async function getSkillPerformance(): Promise<SkillPerformance[]> {
  // ``List[dict]`` rows are loose records; widen before narrowing.
  return (await withEvolutionTimeout((signal) =>
    apiGet("/api/evolution/skills/performance", {
      signal,
      errorMessage: failed("Failed to load skill performance"),
    }),
  )) as unknown as SkillPerformance[];
}

export async function getMemoryGrowth(
  days?: number,
): Promise<MemoryGrowthPoint[]> {
  // ``List[dict]`` rows are loose records; widen before narrowing.
  return (await withEvolutionTimeout((signal) =>
    apiGet("/api/evolution/memory/growth", {
      query: { days },
      signal,
      errorMessage: failed("Failed to load memory growth"),
    }),
  )) as unknown as MemoryGrowthPoint[];
}

export async function getRecommendations(): Promise<Recommendation[]> {
  // ``List[dict]`` rows are loose records; widen before narrowing.
  return (await withEvolutionTimeout((signal) =>
    apiGet("/api/evolution/recommendations", {
      signal,
      errorMessage: failed("Failed to load recommendations"),
    }),
  )) as unknown as Recommendation[];
}

export async function getFitness(
  agentId: string,
  window?: number,
): Promise<FitnessReport> {
  return (await apiGet("/api/evolution/fitness/{agent_id}", {
    path: { agent_id: agentId },
    query: { window },
    errorMessage: failed("Failed to load fitness report"),
  })) as FitnessReport;
}

export async function getDrift(agentId: string): Promise<DriftReport> {
  return (await apiGet("/api/evolution/drift/{agent_id}", {
    path: { agent_id: agentId },
    errorMessage: failed("Failed to load drift report"),
  })) as DriftReport;
}

export async function getLedger(opts?: {
  status?: string;
  kind?: string;
  limit?: number;
}): Promise<{
  total: number;
  records: LedgerRecord[];
  stats: Record<string, unknown>;
}> {
  return (await apiGet("/api/evolution/ledger", {
    query: {
      status: opts?.status || undefined,
      kind: opts?.kind || undefined,
      limit: opts?.limit,
    },
    errorMessage: failed("Failed to load ledger"),
  })) as {
    total: number;
    records: LedgerRecord[];
    stats: Record<string, unknown>;
  };
}

export async function getCanary(): Promise<{
  active_count: number;
  canaries: CanaryState[];
}> {
  return (await apiGet("/api/evolution/canary", {
    errorMessage: failed("Failed to load canary state"),
  })) as {
    active_count: number;
    canaries: CanaryState[];
  };
}

export async function rollbackCanary(
  skillName: string,
): Promise<{ ok: boolean; skill_name: string; phase: string }> {
  return (await apiPost("/api/evolution/canary/{skill_name}/rollback", {
    path: { skill_name: skillName },
    // Bodiless, but the JSON content type was always sent.
    headers: { "Content-Type": "application/json" },
    errorMessage: failed("Failed to rollback canary"),
  })) as {
    ok: boolean;
    skill_name: string;
    phase: string;
  };
}
