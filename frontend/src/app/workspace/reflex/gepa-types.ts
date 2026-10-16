/** Response shapes of the RecipeForge (/api/evolution/forge) endpoints. */

export type AppliedResp = {
  applied: boolean;
  path?: string;
  size?: number;
  mtime?: number;
  content_preview?: string;
  error?: string;
};

export type AddendumEntry = {
  scope: "global" | "per_recipe";
  recipe_id: string | null;
  path: string;
  size: number;
  mtime: number;
  preview: string;
};
export type AddendumsResp = { addendums: AddendumEntry[] };

export type ApplyResp = {
  ok: boolean;
  error: string;
  scope: string;
  size: number;
  path: string;
};

export type DeleteAddendumResp = {
  ok: boolean;
  error: string;
  deleted: boolean;
};

export type CanaryEntry = {
  skill_name: string;
  phase: string;
  sample_count: number;
  success_count: number;
  failure_count: number;
  current_rate: number;
  entered_ts: string;
  metadata?: Record<string, unknown>;
  proposal_id?: string | null;
  proposal_kind?: string | null;
  candidate_id?: string | null;
  recipe_id?: string | null;
  avg_score?: number | null;
  last_rollback_reason?: string | null;
};

export type CanaryResp = {
  ok: boolean;
  total?: number;
  active_count?: number;
  rolled_back_count?: number;
  full_count?: number;
  canaries?: CanaryEntry[];
  error?: string;
};

export type Candidate = {
  candidate_id: string;
  avg_score: number;
  task_scores: number[];
  rationale: string;
  prompt_preview: string;
};

export type HistoryEntry = {
  iter?: number;
  parent_id?: string;
  child_id?: string;
  child_avg?: number;
  improved?: boolean;
  rationale?: string;
  skipped?: boolean;
  reason?: string;
  early_stop?: boolean;
  front_size?: number;
};

export type WinnerProposal = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  proposal_id?: string;
  proposal_kind?: string;
  proposal_status?: string;
  canary_key?: string;
  canary_phase?: string;
  candidate_id?: string;
  avg_score?: number;
};

export type NativeEvaluation = {
  candidate_id?: string | null;
  total?: number | null;
  verdict?: string | null;
  task_score?: number | null;
  constraint_score?: number | null;
  failure_coverage?: number | null;
  positive_preservation?: number | null;
  efficiency?: number | null;
  reasons?: string[];
};

export type NativeReplayWeakCase = {
  case_id?: string | null;
  kind?: string | null;
  score?: number | null;
  reason?: string | null;
  missing_signals?: string[];
};

export type NativeReplayCandidate = {
  candidate_id?: string | null;
  total?: number | null;
  reasons?: string[];
  weak_cases?: NativeReplayWeakCase[];
};

export type NativeReplay = {
  case_count?: number;
  candidates?: NativeReplayCandidate[];
};

export type NativeSandboxReplayCandidate = {
  candidate_id?: string | null;
  total?: number | null;
  passed?: boolean;
  reasons?: string[];
  weak_cases?: NativeReplayWeakCase[];
};

export type NativeSandboxReplay = {
  case_count?: number;
  candidates?: NativeSandboxReplayCandidate[];
};

export type NativeTurnReplayCandidate = {
  candidate_id?: string | null;
  total?: number | null;
  passed?: boolean;
  reasons?: string[];
  weak_cases?: NativeReplayWeakCase[];
};

export type NativeTurnReplay = {
  case_count?: number;
  candidates?: NativeTurnReplayCandidate[];
};

export type NativeLLMReplayCandidate = {
  candidate_id?: string | null;
  total?: number | null;
  passed?: boolean;
  reasons?: string[];
  weak_cases?: NativeReplayWeakCase[];
};

export type NativeLLMReplay = {
  case_count?: number;
  candidates?: NativeLLMReplayCandidate[];
};

export type RunResp = {
  ok: boolean;
  error?: string;
  iterations_run?: number;
  elapsed_s?: number;
  front_size?: number;
  ts?: number;
  recipe_id?: string | null; // echoed from the run query param
  best?: Candidate;
  history?: HistoryEntry[];
  winner_proposal?: WinnerProposal | null;
  native_evaluation?: NativeEvaluation[];
  native_replay?: NativeReplay;
  native_sandbox_replay?: NativeSandboxReplay;
  native_turn_replay?: NativeTurnReplay;
  native_llm_replay?: NativeLLMReplay;
  optimizer_backend?: string | null;
};

export type StoredRun = {
  ts: number;
  trigger: string;
  recipe_id: string | null;
  iterations_run: number;
  elapsed_s: number;
  front_size: number;
  best_candidate_id: string | null;
  best_avg_score: number | null;
  best_rationale: string;
  best_prompt: string;
  applied: boolean;
  applied_at: number | null;
  winner_proposal_id?: string | null;
  winner_proposal_status?: string | null;
  winner_proposal_kind?: string | null;
  winner_canary_key?: string | null;
  winner_canary_phase?: string | null;
  winner_rollback_reason?: string | null;
  winner_lifecycle_state?: string | null;
  history_summary: HistoryEntry[];
  native_evaluation?: NativeEvaluation[];
  native_replay?: NativeReplay;
  native_sandbox_replay?: NativeSandboxReplay;
  native_turn_replay?: NativeTurnReplay;
  native_llm_replay?: NativeLLMReplay;
  winner_proposal?: WinnerProposal | null;
  optimizer_backend?: string | null;
};

export type RunsResp = { runs: StoredRun[] };

export type ProposalDetail = {
  id: string;
  kind: string;
  description: string;
  status: string;
  proposer: string;
  ts: string;
  fitness_before?: number | null;
  fitness_after?: number | null;
  model?: string | null;
  cost_tokens?: number;
  cost_usd?: number;
  metadata?: Record<string, unknown>;
  applied_ts?: string | null;
  rolled_back_ts?: string | null;
  rejection_reason?: string | null;
};

export type ProposalDetailResp = {
  ok: boolean;
  proposal?: ProposalDetail;
  canaries?: CanaryEntry[];
  rollbacks?: Array<{
    id: string;
    description: string;
    ts: string;
    rolled_back_ts?: string | null;
    metadata?: Record<string, unknown>;
  }>;
  error?: string;
};

export type AutoProposeResp = {
  ok: boolean;
  error?: string;
  proposals_generated?: number;
  results?: Array<{
    ok: boolean;
    skipped?: boolean;
    reason?: string;
    recipe_id?: string;
    ts?: number;
    iterations_run?: number;
    best_avg_score?: number;
    front_size?: number;
    error?: string;
  }>;
};
