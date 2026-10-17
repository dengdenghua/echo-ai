// ---------------------------------------------------------------------------
// Types (minimal — match the pydantic schemas)
// ---------------------------------------------------------------------------

/**
 * The panel's GET/POST helpers. `index.tsx` owns the implementation and
 * hands it to every section, so the sections stay free of raw `fetch`.
 */
export interface EvolutionApi {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
}

export interface BudgetComponent {
  name: string;
  budget: {
    max_calls_per_hour: number;
    max_calls_per_day: number;
    breaker_failure_threshold: number;
    breaker_cooldown_seconds: number;
  };
  usage: {
    hourly_used: number;
    hourly_limit: number;
    hourly_remaining: number;
    daily_used: number;
    daily_limit: number;
    daily_remaining: number;
  };
  breaker: {
    component: string;
    state: "closed" | "open" | "half_open";
    consecutive_failures: number;
    opened_at: string | null;
  };
  last_24h: {
    success: number;
    failure: number;
    rejected_budget: number;
    rejected_breaker: number;
  };
  cost?: {
    hourly_tokens: number;
    daily_tokens: number;
    hourly_usd: number;
    daily_usd: number;
  };
  last_reset_at?: string | null;
}

export interface BudgetSnapshot {
  components: BudgetComponent[];
  source?: string;
  events?: number;
}

export interface SkillProposal {
  id?: number;
  name: string;
  created_at: string;
  topic?: string | null;
  source_url?: string | null;
  status: string;
}

export interface ModelProposal {
  id?: number;
  model_label: string;
  created_at: string;
  status: string;
  benchmark_notes?: string | null;
}

export interface McpProposal {
  id?: number;
  server_name: string;
  created_at: string;
  suggested_cmd?: string | null;
  description?: string | null;
  status: string;
}

export interface CurriculumGoal {
  id: number;
  cluster_key: string;
  category: string;
  title: string;
  description: string;
  keywords: string[] | string;
  failure_count: number;
  priority: number;
  status: string;
  covered_by?: string | null;
}

export interface BenchmarkRow {
  id: number;
  strategy_a: string;
  strategy_b: string;
  base_model: string;
  a_wins: number;
  b_wins: number;
  ties: number;
  total_tasks: number;
  win_rate_b: number;
  decision: string;
}

export interface DriftEvent {
  id: number;
  protocol_id: string;
  detected_at: string;
  summary: string;
  acknowledged: boolean;
}

export interface RepairProposal {
  id: number;
  drift_event_id: number;
  protocol_id: string;
  created_at: string;
  suggested_diff: string;
  rationale: string;
  status: string;
  source?: string;
  repair_tasks?: RepairTask[];
}

export interface RepairTask {
  id: number;
  proposal_id: number;
  protocol_id: string;
  priority: string;
  title: string;
  target_layer: string;
  target_modules: string[];
  verification_commands: string[];
}

export type DispatchSnapshot = Record<
  string,
  {
    skill_name: string;
    a_assigned: number;
    b_assigned: number;
    a_reported: number;
    b_reported: number;
    outcomes: Record<string, number>;
  }
>;
