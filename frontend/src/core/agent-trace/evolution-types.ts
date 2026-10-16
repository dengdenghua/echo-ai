/**
 * Report shapes of the evolution quality endpoints (subagent fitness,
 * organization topology, auto-verifier, repair routes, browser/desktop
 * quality, agent scorecard, automation radar, E2E certification).
 * Re-exported from ./api, which callers import.
 */

import type { AgentTraceReviewQueueItem } from "./types";

export interface SubagentFitnessRole {
  role: string;
  score: number;
  confidence: number;
  sample_count: number;
  by_status: Record<string, number>;
  promoted_count: number;
  rejected_count: number;
  pending_count: number;
  routing_evidence_count?: number;
  by_evidence_source?: Record<string, number>;
  verdict: "strong" | "developing" | "watch" | "retire_candidate" | string;
  recommendation: string;
  evidence_item_ids: string[];
}

export interface SubagentFitnessReport {
  schema: "echo.subagent_fitness.v1" | string;
  role?: string | null;
  roles: SubagentFitnessRole[];
  role_count: number;
  top_risks: SubagentFitnessRole[];
  next_actions: Array<{
    role: string;
    verdict: string;
    action: string;
  }>;
}

export interface SubagentPolicyDecisionResult {
  schema: "echo.subagent_policy.v1" | string;
  role: string;
  action: "watch" | "retire" | "clear" | string;
  policy: Record<string, unknown> | null;
  summary: {
    schema: string;
    policies: Record<string, Record<string, unknown>>;
    policy_count: number;
    retired_count: number;
    watch_count: number;
    lastUpdated: string;
  };
}

export interface SubagentPolicyImpactItem {
  role: string;
  agent_id: string;
  status: string;
  reason?: string;
  actor?: string;
  updated_at?: string;
  evidence_item_ids?: string[];
}

export interface SubagentPolicyImpact {
  status: "blocked" | "watch" | "clear" | string;
  blocked: boolean;
  retired: SubagentPolicyImpactItem[];
  watch: SubagentPolicyImpactItem[];
  retired_count: number;
  watch_count: number;
  policy_count: number;
  lastUpdated: string;
}

export interface OrganizationTopology {
  name: string;
  protocol: string;
  task_bucket: string;
  fingerprint: string;
  agents: Record<string, { agent_id: string } & Record<string, unknown>>;
  subagent_policy?: SubagentPolicyImpact;
  metadata?: Record<string, unknown>;
}

export interface OrganizationTopologyProposal {
  kind: string;
  base_topology: string;
  bucket: string;
  detail: Record<string, unknown> & {
    historical_lift?: {
      matched_promotions: number;
      improved_count: number;
      regressed_count: number;
      avg_success_rate_delta?: number | null;
      avg_quality_score_delta?: number | null;
      rank_adjustment: number;
    };
  };
  confidence: number;
  rank_score?: number;
  rationale: string;
}

export interface OrganizationTopologyProposalsReport {
  schema: string;
  count: number;
  persisted_count: number;
  subagent_promotion_count: number;
  proposals: OrganizationTopologyProposal[];
  subagent_promotion?: Record<string, unknown>;
}

export interface OrganizationTopologyLiftReport {
  schema: string;
  count: number;
  reports: Array<{
    topology: string;
    fingerprint: string;
    base_fingerprint: string;
    bucket: string;
    mutation: string;
    promotion_source: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    lift: Record<string, unknown>;
    verdict: string;
  }>;
}

export interface AutoVerifierFamilySummary {
  family: string;
  total: number;
  pass_count: number;
  fail_count: number;
  pass_rate: number;
  avg_duration_ms: number;
  latest_ts?: string;
  commands: Array<{
    command: string;
    count: number;
  }>;
}

export interface AutoVerifierDecisionCandidate {
  rank: number;
  command: string;
  kind: string;
  priority: number;
  family: string;
  history_count: number;
  pass_rate: number;
  avg_duration_ms: number;
  reason: string;
  original_index?: number;
}

export interface AutoVerifierDecision {
  schema: "echo.auto_verifier_decision.v1" | string;
  ts: string;
  selected_command: string;
  candidates: AutoVerifierDecisionCandidate[];
}

export interface AutoVerifierAlert {
  family: string;
  severity: "warning" | "critical" | string;
  total: number;
  fail_count: number;
  pass_rate: number;
  latest_ts?: string;
  top_command?: string;
  message: string;
}

export interface AutoVerifierMetricsReport {
  ok?: boolean;
  schema: "echo.auto_verifier_metrics.v1" | string;
  total: number;
  pass_count: number;
  fail_count: number;
  pass_rate: number;
  avg_duration_ms: number;
  families: AutoVerifierFamilySummary[];
  alerts?: AutoVerifierAlert[];
  top_failures: Array<{
    command: string;
    count: number;
  }>;
  recent_decisions: AutoVerifierDecision[];
}

export interface RepairRoutePromotionCandidate {
  schema: "echo.repair_route_promotion_candidate.v1" | string;
  route: string;
  priority: "P0" | "P1" | "P2" | string;
  status: string;
  evidence: {
    count: number;
    share: number;
    failed_verification_count: number;
    unverified_code_changes: number;
    failure_sources?: Array<Record<string, unknown>>;
    recommended_commands?: Array<{ command: string; count: number }>;
    example_proposal_ids?: string[];
  };
  promotion_gate: {
    schema: "echo.repair_route_promotion_gate.v1" | string;
    requires_operator_review: boolean;
    requires_passing_rerun: boolean;
    blocks_auto_promotion: boolean;
  };
}

export interface RepairRouteQualityReport {
  ok?: boolean;
  schema: "echo.repair_route_quality.v1" | string;
  score: number;
  ready: boolean;
  quality_gate: {
    schema: "echo.repair_route_quality_gate.v1" | string;
    score: number;
    ready: boolean;
    blockers: string[];
    signals: Record<string, unknown>;
  };
  total_failures: number;
  route_count: number;
  routes: Array<Record<string, unknown>>;
  promotion_candidates: RepairRoutePromotionCandidate[];
  summary: Record<string, unknown>;
  recommendations: string[];
}

export interface RepairRoutePromotionQueueResult {
  ok?: boolean;
  schema: "echo.repair_route_promotion_queue.v1" | string;
  created: number;
  updated: number;
  candidates: RepairRoutePromotionCandidate[];
  items: AgentTraceReviewQueueItem[];
  summary?: Record<string, unknown>;
}

export interface BrowserDesktopQualityReport {
  ok?: boolean;
  schema: "echo.browser_desktop_quality.v1" | string;
  score: number;
  passed: number;
  total: number;
  ready: boolean;
  checks: Array<Record<string, unknown>>;
  replay_trends: {
    schema: "echo.browser_desktop_replay_trends.v1" | string;
    total: number;
    pending_count: number;
    reviewed_count: number;
    promoted_count: number;
    rejected_count: number;
    review_rate: number;
    stale_source_artifact_count?: number;
    by_status: Record<string, number>;
    by_candidate_kind: Record<string, number>;
    repair_recipe_summary?: Record<string, unknown>;
    latest: Array<Record<string, unknown>>;
    next_actions: string[];
  };
  next_actions: string[];
}

export interface BrowserDesktopRepairRecipe {
  schema: "echo.browser_desktop_repair_recipe.v1" | string;
  recipe_id: string;
  cluster_key: string;
  candidate_kind: string;
  title: string;
  priority: "P0" | "P1" | "P2" | string;
  occurrences: number;
  source_item_ids: string[];
  case_ids: string[];
  fingerprints: string[];
  evidence_summary: Record<string, unknown>;
  recommended_steps: string[];
  verification_plan: Record<string, unknown>;
  promotion_gate: Record<string, unknown>;
}

export interface BrowserDesktopRepairRecipesReport {
  ok?: boolean;
  schema: "echo.browser_desktop_repair_recipes.v1" | string;
  total_pending_cases: number;
  recipe_count: number;
  recipes: BrowserDesktopRepairRecipe[];
  ready: boolean;
  next_actions: string[];
}

export interface BrowserDesktopRepairRecipeQueueResult {
  ok?: boolean;
  schema: "echo.browser_desktop_repair_recipe_queue.v1" | string;
  created: number;
  updated: number;
  recipes: BrowserDesktopRepairRecipe[];
  items: AgentTraceReviewQueueItem[];
  summary?: Record<string, unknown>;
}

export interface BrowserDesktopStaleArtifactRejectionResult {
  ok?: boolean;
  schema: "echo.browser_desktop_stale_replay_artifact_rejection.v1" | string;
  inspected: number;
  rejected_count: number;
  archived_recipe_count?: number;
  skipped_count: number;
  rejected: Array<Record<string, unknown>>;
  archived_recipes?: Array<Record<string, unknown>>;
}

export interface BrowserDesktopRepairRecipeVerificationsReport {
  ok?: boolean;
  schema: "echo.browser_desktop_repair_recipe_verifications.v1" | string;
  total: number;
  verified_count: number;
  blocked_count: number;
  ready: boolean;
  verifications: Array<{
    schema: "echo.browser_desktop_repair_recipe_verification.v1" | string;
    item_id?: string;
    recipe_id?: string;
    title?: string;
    priority?: string;
    status: "verified" | "needs_rerun_evidence" | string;
    blockers: string[];
    source_status_counts: Record<string, number>;
    missing_evidence: string[];
    verification_evidence: Record<string, unknown>;
  }>;
  next_actions: string[];
}

export interface BrowserDesktopRepairRecipeEvidenceAttachment {
  ok?: boolean;
  schema: "echo.browser_desktop_repair_recipe_evidence_attachment.v1" | string;
  item: AgentTraceReviewQueueItem;
  evidence: {
    schema: "echo.browser_desktop_repair_recipe_evidence.v1" | string;
    attached_at: string;
    actor: string;
    passed: boolean;
    provided: string[];
    artifacts: Array<Record<string, unknown>>;
    notes: string;
  };
  verification?:
    | BrowserDesktopRepairRecipeVerificationsReport["verifications"][number]
    | null;
}

export interface BrowserDesktopRepairRecipeRerunResult {
  ok?: boolean;
  schema: "echo.browser_desktop_repair_recipe_rerun.v1" | string;
  item_id: string;
  passed: boolean;
  provided: string[];
  missing: string[];
  promoted_source_count: number;
  artifacts: Array<Record<string, unknown>>;
  attachment: BrowserDesktopRepairRecipeEvidenceAttachment;
}

export interface BrowserDesktopRepairRecipeRerunBatchResult {
  ok?: boolean;
  schema: "echo.browser_desktop_repair_recipe_rerun_batch.v1" | string;
  attempted: number;
  passed: number;
  failed: number;
  results: BrowserDesktopRepairRecipeRerunResult[];
}

export interface AgentCompetitorScorecardDimension {
  id: string;
  title: string;
  weight: number;
  why: string;
  scores: Record<string, number>;
  evidence_adjusted_scores?: Record<string, number>;
  leader: string;
  target_score?: number;
  best_external_competitor?: string;
  best_external_score?: number;
  surpass_target_score?: number;
  effective_target_score?: number;
  echo_surpasses_best_external?: boolean;
  echo_gap_to_surpass?: number;
  echo_gap_to_target: number;
  echo_gap_to_effective_target?: number;
  echo_baseline_score?: number;
  echo_score_source?: string;
  echo_evidence_adjusted_score?: number;
  echo_evidence_adjusted_gap_to_target?: number;
  echo_evidence_adjusted_gap_to_effective_target?: number;
  echo_evidence_adjusted_score_source?: string;
  echo_certified_score_floor?: number;
  echo_certification_score_applied?: boolean;
  echo_certification_adjustment_available?: boolean;
  echo_certification_evidence?: Array<{
    id?: string;
    title?: string;
    score_floor?: number;
  }>;
  echo_evidence_readiness: number;
  echo_evidence: Array<{
    id?: string;
    title?: string;
    score?: number;
    status?: string;
  }>;
  echo_evidence_checklist?: Array<{
    id?: string;
    title?: string;
    score?: number;
    status?: string;
    implementation: {
      present: number;
      total: number;
      missing_count: number;
      missing: string[];
      coverage: number;
    };
    tests: {
      present: number;
      total: number;
      missing_count: number;
      missing: string[];
      coverage: number;
    };
    next_actions: string[];
  }>;
  echo_missing_evidence_count?: number;
  operator_drilldown?: {
    schema: "echo.scorecard_operator_drilldown.v1" | string;
    dimension_id?: string;
    certified_floor?: number;
    links?: Array<{
      id?: string;
      label?: string;
      method?: string;
      href?: string;
      body?: Record<string, unknown>;
    }>;
    source_refs?: Array<Record<string, unknown>>;
  };
  echo_ecosystem_readiness?: AgentEcosystemReadiness;
  echo_next_actions: string[];
}

export interface AgentEcosystemReadiness {
  schema: "echo.ecosystem_readiness.v1" | string;
  score: number;
  passed: number;
  total: number;
  missing_count: number;
  topics: Array<Record<string, unknown>>;
  next_actions: string[];
}

export interface AgentScoreEvidenceLayers {
  schema: "echo.agent_score_evidence_layers.v1" | string;
  architecture: {
    status: "estimated" | string;
    echo_score: number;
    codex_score: number;
    source: string;
  };
  static_certification: {
    status: "certified" | "not_certified" | string;
    ready: boolean;
    passed: number;
    total: number;
  };
  behavioral_head_to_head: {
    status: "certified" | "not_certified" | string;
    ready: boolean;
    verdict?: string;
    blocker?: "infrastructure" | "evidence" | null | string;
    infrastructure?: BehavioralInfrastructureStatus;
    echo_pass_pow_k: number;
    codex_pass_pow_k: number;
  };
}

export interface BehavioralInfrastructureStatus {
  active: boolean;
  current?: boolean;
  path?: string;
  generated_at?: string;
  age_days?: number | null;
  system_id?: string;
  failures?: Array<{ case_id: string; categories: string[] }>;
}

export interface AgentCompetitorScorecard {
  ok?: boolean;
  schema: "echo.agent_competitor_scorecard.v1" | string;
  target_score: number;
  surpass_margin?: number;
  competitors: string[];
  external_competitors?: string[];
  overall: Record<string, number>;
  ranking: Array<{ competitor: string; score: number }>;
  verdict: "leading" | "competitive" | "near_parity" | "behind" | string;
  evidence_adjusted_overall?: Record<string, number>;
  evidence_adjusted_ranking?: Array<{ competitor: string; score: number }>;
  evidence_adjusted_verdict?:
    | "leading"
    | "competitive"
    | "near_parity"
    | "behind"
    | string;
  evidence_layers?: AgentScoreEvidenceLayers;
  scorecard_policy?: {
    schema?: string;
    overall?: string;
    evidence_adjusted_overall?: string;
    certification_floors_do_not_change_overall?: boolean;
    per_dimension_target?: string;
    explicit_objective?: string;
  };
  dimensions: AgentCompetitorScorecardDimension[];
  echo_below_target: AgentCompetitorScorecardDimension[];
  echo_strengths: AgentCompetitorScorecardDimension[];
  echo_external_leaders?: AgentCompetitorScorecardDimension[];
  echo_external_gap_dimensions?: AgentCompetitorScorecardDimension[];
  echo_focus_gaps?: AgentCompetitorScorecardDimension[];
  surpass_summary?: {
    schema?: "echo.agent_surpass_summary.v1" | string;
    total_dimensions: number;
    surpassed_dimensions: number;
    gap_dimensions: number;
    target_gap_dimensions?: number;
    focus_gap_dimensions?: number;
    all_dimensions_surpassed: boolean;
    largest_gap: number;
    largest_effective_gap?: number;
  };
  next_focus: string[];
  ecosystem_readiness?: AgentEcosystemReadiness;
  parity_certification?: {
    schema: "echo.parity_certification.v1" | string;
    passed: number;
    total: number;
    ready: boolean;
    by_kind?: Record<string, { passed: number; total: number }>;
    requirements: Array<Record<string, unknown>>;
    dimension_score_floors: Record<string, number>;
    dimension_evidence: Record<string, Array<Record<string, unknown>>>;
    next_actions: string[];
  };
  codex_gap?: {
    schema?: string;
    combined_score?: number;
    verdict?: string;
    next_focus?: string[];
  };
}

export interface AutomationPolicyRuleDraftsReport {
  ok?: boolean;
  schema: "echo.automation_policy_rule_drafts.v1" | string;
  total: number;
  verified: number;
  drafts: Array<{
    schema?: string;
    draft_id: string;
    signed_payload: {
      schema?: string;
      proposal_id?: string;
      proposal_kind?: string;
      review_queue_item_id?: string | null;
      automation?: {
        id?: string;
        surface?: string;
        tool?: string;
      };
      rule: {
        effect: "deny" | "allow" | string;
        tool: string;
        args_contains?: string;
        reason?: string;
      };
      evidence?: Record<string, unknown>;
      review_required?: boolean;
    };
    signature?: {
      schema?: string;
      algorithm?: string;
      digest?: string;
    };
  }>;
}

export interface AutomationRadarReport {
  ok?: boolean;
  schema: "echo.automation_radar.v1" | string;
  target_score: number;
  scope: string;
  competitors: string[];
  overall: Record<string, number>;
  ranking: Array<{ competitor: string; score: number }>;
  verdict: "leading" | "competitive" | "near_parity" | "behind" | string;
  dimensions: Array<{
    id: string;
    title: string;
    weight: number;
    why: string;
    scores: Record<string, number>;
    leader: string;
    echo_gap_to_target: number;
    echo_gap_to_codex: number;
    evidence_ready: boolean;
    evidence_checks: Array<Record<string, unknown>>;
    missing_check_ids: string[];
    operator_drilldown?: {
      schema?: string;
      dimension_id?: string;
      links?: Array<Record<string, unknown>>;
    };
    next_actions: string[];
  }>;
  echo_gaps: AutomationRadarReport["dimensions"];
  echo_strengths: AutomationRadarReport["dimensions"];
  browser_desktop_quality: {
    schema?: string;
    score?: number;
    passed?: number;
    total?: number;
    ready?: boolean;
  };
  parity_certification: {
    schema?: string;
    passed?: number;
    total?: number;
    ready?: boolean;
  };
  policy_rule_drafts: {
    schema?: string;
    total: number;
    verified: number;
    ready: boolean;
    error?: string;
  };
  next_focus: string[];
}

export interface E2ESurpassCertificationCheck {
  id: string;
  title: string;
  passed: boolean;
  score: number;
  target: number;
  next_action?: string;
}

export interface E2ESurpassCertification {
  ok?: boolean;
  schema: "echo.e2e_surpass_certification.v1" | string;
  target_score: number;
  ready: boolean;
  verdict: "surpassed" | "needs_behavioral_evidence" | "needs_work" | string;
  summary: {
    scorecard_echo: number;
    scorecard_best_external: number;
    scorecard_evidence_adjusted_echo: number;
    automation_echo: number;
    automation_codex: number;
    quality_ready: number;
    quality_total: number;
    all_dimensions_surpassed: boolean;
    scorecard_gap_dimensions: number;
    automation_gap_dimensions: number;
    behavioral_ready: boolean;
    behavioral_echo_pass_pow_k: number;
    behavioral_codex_pass_pow_k: number;
  };
  checks: E2ESurpassCertificationCheck[];
  scorecard?: {
    schema?: string;
    target_score?: number;
    overall?: Record<string, number>;
    evidence_adjusted_overall?: Record<string, number>;
    verdict?: string;
    evidence_adjusted_verdict?: string;
    evidence_layers?: AgentScoreEvidenceLayers;
    surpass_summary?: Record<string, unknown>;
    next_focus?: string[];
  };
  automation?: {
    schema?: string;
    target_score?: number;
    overall?: Record<string, number>;
    verdict?: string;
    next_focus?: string[];
    gap_count?: number;
  };
  quality?: Array<{
    schema?: string;
    ready?: boolean;
    score?: number;
    passed?: number;
    total?: number;
    next_actions?: string[];
  }>;
  behavioral?: {
    schema?: string;
    ready: boolean;
    verdict: string;
    bundle_path?: string;
    age_days?: number | null;
    infrastructure?: BehavioralInfrastructureStatus;
    systems?: Record<
      string,
      {
        aggregate_pass_pow_k?: number;
        total_cases?: number;
        valid_cases?: number;
      }
    >;
    next_actions?: string[];
  };
  next_actions: string[];
}

export interface AutomationPolicyRuleInstallResult {
  ok?: boolean;
  schema: "echo.policy_review_rule_install.v1" | string;
  installed: boolean;
  draft_id?: string;
  source_kind?: string;
  rule: {
    effect: "deny" | "allow" | string;
    tool: string;
    args_contains?: string;
    reason?: string;
  };
  policy_rule_count: number;
  signature?: Record<string, unknown>;
}
