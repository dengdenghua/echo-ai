/**
 * Response and request shapes of the agent-trace, task-run, review-queue and
 * replay endpoints. Re-exported from ./api, which callers import.
 */

export interface AgentTraceTokenTotals {
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  cached_tokens: number;
  cost_usd: number;
}

export interface AgentTraceStats {
  messages: number;
  events: number;
  approvals: number;
  checkpoints: number;
  resume_requests?: number;
  token_usage: number;
  token_totals: AgentTraceTokenTotals;
}

export interface AgentTraceEvent {
  id: number;
  ts: string;
  thread_id?: string | null;
  turn_id?: string | null;
  task_id?: string | null;
  agent_id?: string | null;
  item_id?: string | null;
  event_type: string;
  payload: Record<string, unknown>;
}

export interface AgentTraceApproval {
  id: number;
  requested_at: string;
  decided_at?: string | null;
  thread_id?: string | null;
  turn_id?: string | null;
  task_id?: string | null;
  agent_id?: string | null;
  tool_name: string;
  tool_call_id: string;
  args_preview: string;
  decision: string;
  reason: string;
  metadata: Record<string, unknown>;
}

export interface AgentTraceCheckpoint {
  id: number;
  ts: string;
  task_id: string;
  thread_id?: string | null;
  turn_id?: string | null;
  agent_id?: string | null;
  checkpoint_type: string;
  iteration: number;
  summary: string;
  state: Record<string, unknown>;
}

export interface AgentTraceResumeProposal {
  checkpoint: {
    id: number;
    task_id?: string;
    taskId?: string;
    thread_id?: string | null;
    agent_id?: string | null;
    type: string;
    iteration: number;
    timestamp: string;
  };
  recovery_hints?: {
    phase: string | null;
    progress: string | null;
    message_count: number;
    step_count: number;
    working_set: string[];
    recent_tool_calls?: AgentTraceRecentToolCall[];
  };
  recoveryHints?: {
    phase: string | null;
    progress: string | null;
    messageCount: number;
    stepCount: number;
    workingSet: string[];
    recentToolCalls?: AgentTraceRecentToolCall[];
  };
  resume_plan?: {
    title: string;
    steps: string[];
  };
  resumePlan?: {
    title: string;
    steps: string[];
  };
  safety: {
    raw_state_included?: boolean;
    raw_message_snapshots_included?: boolean;
    rawStateIncluded?: boolean;
    rawMessageSnapshotsIncluded?: boolean;
  };
}

export interface AgentTraceRecentToolCall {
  iteration: number;
  tool: string;
  input_preview?: string;
  inputPreview?: string;
  observation_preview?: string;
  observationPreview?: string;
}

export interface AgentTraceResumeRequest {
  id: number;
  ts: string;
  thread_id: string;
  checkpoint_id: number;
  task_id?: string | null;
  status: "pending" | "confirmed" | "consumed" | string;
  intent: {
    schema?: string;
    requires_confirmation?: boolean;
    confirmed?: boolean;
    source?: string;
    checkpoint_id?: number;
    task_id?: string | null;
    checkpoint_type?: string;
    iteration?: number;
    continue_from_iteration?: number;
    phase?: string | null;
    working_set?: string[];
    resume_plan?: string[];
    recent_tool_calls?: AgentTraceRecentToolCall[];
    safety?: {
      raw_state_included?: boolean;
      raw_message_snapshots_included?: boolean;
    };
  };
  confirmed_at?: string | null;
  consumed_at?: string | null;
}

export interface AgentTraceTaskRun {
  task_id: string;
  thread_id?: string | null;
  turn_id?: string | null;
  agent_id?: string | null;
  title?: string | null;
  mode?: string | null;
  status?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  summary?: string | null;
  tool_calls_started?: number;
  tool_calls_finished?: number;
  tool_errors?: number;
  tool_names?: string[];
  token_totals?: Partial<AgentTraceTokenTotals>;
}

export interface AgentTraceExecutionStep {
  sequence: number;
  call_id: string;
  tool: string;
  input?: unknown;
  output?: unknown;
  status: "running" | "completed" | "failed" | "cancelled" | "unknown" | string;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null;
  event_ids: Array<number | string | null>;
}

export interface AgentTraceExecutionTrace {
  schema: "echo.execution_trace.v1" | string;
  trace_id?: string | null;
  thread_id?: string | null;
  turn_id: string;
  task_id?: string | null;
  agent_id?: string | null;
  engine: string;
  model?: string | null;
  steps: AgentTraceExecutionStep[];
  outcome: {
    status: string;
    reason?: unknown;
    event_id?: number | string | null;
    ts?: string | null;
  };
  integrity: {
    event_count: number;
    tool_start_count: number;
    tool_end_count: number;
    orphan_start_count: number;
    orphan_end_count: number;
    has_terminal: boolean;
    complete: boolean;
  };
}

export interface AgentTraceTaskLeaseHealth {
  state?: string;
  holder_id?: string | null;
  holder_heartbeat_at?: string | null;
  lease_expires_at?: string | null;
  recommended_action?: string;
  can_takeover?: boolean;
  can_resume?: boolean;
  recovery?: AgentTraceTaskRecoveryPlan;
  [key: string]: unknown;
}

export interface AgentTraceTaskRecoveryPlan {
  can_takeover?: boolean;
  can_resume?: boolean;
  has_checkpoint?: boolean;
  recommended_action?: string;
  operation?: string | null;
  steps?: string[];
  reason?: string;
  latest_checkpoint_id?: string | number | null;
  resume_checkpoint_id?: string | number | null;
  checkpoint_id?: string | number | null;
  [key: string]: unknown;
}

export interface AgentTraceTaskRecoveryQueueItem {
  task_id: string;
  status?: string | null;
  /** Why a paused run stopped (e.g. budget_near_limit, approval_required). */
  pause_reason?: string | null;
  pause_detail?: string | null;
  kind?: string | null;
  title?: string | null;
  owner_id?: string | null;
  thread_id?: string | null;
  workspace_path?: string | null;
  recommended_action: string;
  priority: number;
  can_takeover: boolean;
  can_resume: boolean;
  has_checkpoint: boolean;
  latest_checkpoint_id?: string | number | null;
  resume_checkpoint_id?: string | number | null;
  checkpoint_id?: string | number | null;
  operation?: string | null;
  steps?: string[];
  recovery_plan?: AgentTraceTaskRecoveryPlan;
  lease_health?: AgentTraceTaskLeaseHealth;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface AgentTraceTaskRecoveryQueue {
  schema: "echo.task_recovery_queue.v1" | string;
  total: number;
  count: number;
  limit: number;
  items: AgentTraceTaskRecoveryQueueItem[];
  generated_at?: string;
  filters?: Record<string, unknown>;
}

export interface AgentTraceTaskRunMutationResult {
  schema: string;
  task_run: Record<string, unknown>;
  lease_health: AgentTraceTaskLeaseHealth;
}

export interface AgentTraceProcessTimelineNode {
  id?: string;
  lane: string;
  kind: string;
  ts?: string | null;
  title?: string;
  text?: string;
  severity?: string;
  status?: string;
  tool?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentTraceProcessTimeline {
  schema: string;
  task_id: string;
  overview: {
    status?: string | null;
    score?: number | null;
    approval_count?: number;
    experience_record_count?: number;
    tool_error_count?: number;
    [key: string]: unknown;
  };
  timeline: AgentTraceProcessTimelineNode[];
  capabilities?: Array<Record<string, unknown>>;
  safety?: Record<string, unknown>;
}

export type AgentTraceReviewQueueStatus =
  | "pending"
  | "promoted"
  | "rejected"
  | "archived"
  | string;

export interface AgentTraceReviewQueueItem {
  id: string;
  created_at?: string;
  updated_at?: string;
  decided_at?: string;
  source: string;
  source_kind: string;
  candidate_kind: string;
  priority: "P0" | "P1" | "P2" | string;
  target_bucket: string;
  title: string;
  text: string;
  status: AgentTraceReviewQueueStatus;
  decision_reason?: string;
  promoted_to?: string;
  occurrences: number;
  last_seen_at?: string;
  source_task_ids?: string[];
  thread_ids?: string[];
  turn_ids?: string[];
  agent_ids?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  source_hash?: string;
}

export interface AgentTraceReviewQueueSummary {
  schema: string;
  total: number;
  pending_count: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  by_target_bucket: Record<string, number>;
  next_actions: Array<{
    priority: string;
    item_id: string;
    target_bucket: string;
    action: string;
  }>;
}

export interface BrowserReplayQueueResult {
  ok: boolean;
  schema: string;
  queue: {
    created: number;
    updated: number;
    total: number;
    items: AgentTraceReviewQueueItem[];
  };
}

export interface ReplayEvidenceHint {
  schema?: string;
  case_id?: string;
  fingerprint?: string;
  replay_ready?: boolean;
  replay_case_url?: string;
  queue_url?: string;
  queue_body?: Record<string, unknown>;
}

export interface AgentScorecardGapQueueResult {
  ok: boolean;
  schema: "echo.agent_scorecard_gap_queue.v1" | string;
  created: number;
  updated: number;
  total: number;
  items: AgentTraceReviewQueueItem[];
  scorecard?: {
    overall?: Record<string, number>;
    verdict?: string;
    evidence_adjusted_overall?: Record<string, number>;
    below_target_count?: number;
  };
}

export interface AgentTracePromotionApplyResult {
  schema: string;
  dry_run: boolean;
  applied: number;
  failed: number;
  skipped: number;
  results: Array<Record<string, unknown>>;
  replay_gate?: AgentTraceReplayGate;
  override_replay_gate?: boolean;
}

export interface AgentTraceReplayGate {
  schema: string;
  passed: boolean;
  reason: string;
  thresholds: {
    min_cases: number;
    min_score: number;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    below_min_score: number;
  };
  failing_cases: Array<Record<string, unknown>>;
  filters?: Record<string, unknown>;
}

export interface AgentTraceReplayCase {
  schema: string;
  case_id: string;
  fingerprint: string;
  source: {
    task_id?: string | null;
    thread_id?: string | null;
    turn_id?: string | null;
    agent_id?: string | null;
    status?: string | null;
  };
  replay: {
    case_id?: string;
    fingerprint?: string;
    replayable?: boolean;
    step_count?: number;
    steps?: Array<Record<string, unknown>>;
  };
  expectations: {
    status?: string | null;
    score?: number | null;
    finding_types?: string[];
    tool_error_count?: number;
  };
  resume: {
    available: boolean;
    source?: string | null;
    latest_checkpoint_id?: string | null;
  };
  safety: {
    raw_messages_included: boolean;
    raw_checkpoint_state_included: boolean;
    tool_outputs_truncated: boolean;
  };
}

export interface AgentTraceReplayEvaluationCheck {
  name: string;
  passed: boolean;
  description: string;
}

export interface AgentTraceReplayEvaluation {
  schema: string;
  case_id: string;
  fingerprint: string;
  passed: boolean;
  score: number;
  checks: AgentTraceReplayEvaluationCheck[];
  source: {
    task_id?: string | null;
    thread_id?: string | null;
    turn_id?: string | null;
    agent_id?: string | null;
    status?: string | null;
  };
}

export interface AgentTraceReplayCaseCorpus {
  schema: string;
  cases: AgentTraceReplayCase[];
  total: number;
  limit: number;
  offset: number;
}

export interface AgentTraceReplayEvaluationCorpus {
  schema: string;
  passed: number;
  failed: number;
  total: number;
  limit: number;
  offset: number;
  evaluations: AgentTraceReplayEvaluation[];
}

export interface AgentTracePromotionAuditSummary {
  schema: string;
  total: number;
  by_status: Record<string, number>;
  by_target: Record<string, number>;
  by_event_type?: Record<string, number>;
  integrity?: {
    schema: string;
    path: string;
    ok: boolean;
    entries_checked: number;
    broken_at?: number | null;
    error?: string;
    details?: string[];
  };
  override_count: number;
  gate_failed_count: number;
  gate_blocked_override_count: number;
  topology_policy_block_count?: number;
  latest: Array<Record<string, unknown>>;
}

export interface AgentTraceExperienceQualitySummary {
  schema: string;
  total: number;
  active_count: number;
  contradicted_count: number;
  stale_count: number;
  low_reliability_count: number;
  avg_reliability: number;
  by_bucket: Record<string, number>;
  top_risks: Array<Record<string, unknown>>;
  next_actions: string[];
}

export interface AgentTraceTrustDenialItem {
  id?: number | string | null;
  ts?: string | null;
  thread_id?: string | null;
  turn_id?: string | null;
  task_id?: string | null;
  agent_id?: string | null;
  tool_name: string;
  decision: string;
  action: string;
  reason?: string | null;
  risk_level?: string | null;
}

export interface AgentTraceTrustDenialSummary {
  schema: "echo.trust_denial_summary.v1" | string;
  total: number;
  by_tool: Record<string, number>;
  by_action: Record<string, number>;
  recent: AgentTraceTrustDenialItem[];
  queue?: {
    schema: string;
    min_occurrences: number;
    created: number;
    updated: number;
    items: AgentTraceReviewQueueItem[];
  };
}

export interface AgentTracePolicyReviewRuleDraft {
  schema: "echo.policy_review_rule_draft.v1" | string;
  draft_id: string;
  signed_payload: {
    schema?: string;
    proposal_id?: string;
    proposal_kind?: string;
    review_queue_item_id?: string;
    rule?: {
      effect?: string;
      tool?: string;
      args_contains?: string;
      reason?: string;
    };
    evidence?: Record<string, unknown>;
    review_required?: boolean;
  };
  signature: {
    schema?: string;
    algorithm?: string;
    digest?: string;
  };
}

export interface AgentTracePolicyReviewRuleDrafts {
  schema: "echo.policy_review_rule_drafts.v1" | string;
  total: number;
  verified: number;
  drafts: AgentTracePolicyReviewRuleDraft[];
}

export interface AgentTracePolicyReviewRuleInstallResult {
  schema: "echo.policy_review_rule_install.v1" | string;
  installed: boolean;
  draft_id?: string;
  rule: {
    effect: string;
    tool: string;
    args_contains: string;
    reason: string;
  };
  policy_rule_count: number;
  signature?: Record<string, unknown>;
}

export interface AgentTraceScope {
  threadId?: string | null;
  taskId?: string | null;
  agentId?: string | null;
  turnId?: string | null;
}
