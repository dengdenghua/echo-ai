// Shared shapes for the observability page: the polling-hook state that the
// page hands to each heartbeat-driven panel, and the JSON bodies those
// panels poll.

/** What ``useHeartbeat`` (page.tsx) returns for one polled endpoint. */
export interface HeartbeatState<T> {
  data: T;
  loading: boolean;
  error: string | null;
  forbidden: boolean;
  refresh: () => void;
  lastFetchedAt: number | null;
}

export interface BlackboardListResp {
  turns: Array<{ turn_id: string; key_count: number; age_seconds: number }>;
}

export interface BlackboardSnapResp {
  turn_id: string;
  key_count: number;
  entries: Record<string, unknown>;
}

export interface RegenSummary {
  skill_forge: { status: string; forged_count: number };
  rule_extractor: {
    status: string;
    rules_count: number;
    failure_trajectories: number;
  };
  memory_consolidator: {
    status: string;
    memories_count: number;
    trajectories_scanned: number;
  };
  kg_updater: { status: string; triple_count: number };
  workflow_rewriter: { status: string; trajectories_scanned: number };
  recipe_evaluator: { status: string; recipes_tracked: number };
  trajectories: {
    total: number;
    failures: number;
    by_strategy: Record<string, number>;
  };
}

export interface HemolymphResp {
  count: number;
  max_tracked: number;
  snapshots: Array<{
    ts: number;
    budget_tokens: number;
    tokens_used: number;
    utilization: number;
    segment_count: number;
    by_bucket: Record<string, { used: number; alloc: number }>;
    recipe_id: string | null;
    task_type: string | null;
  }>;
}

export interface CostSummary {
  total_tokens: number;
  total_usd: number;
  commit_count: number;
  task_count: number;
  tasks: Array<{
    task_id: string;
    tokens: number;
    usd: number;
    commit_count: number;
    last_ts: string | null;
  }>;
}
