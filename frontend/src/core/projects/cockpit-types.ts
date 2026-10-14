import type { ProjectGovernance } from "./hooks";

export type Health =
  | "on_track"
  | "at_risk"
  | "overdue"
  | "blocked"
  | "completed";

interface MilestonePM {
  id: string;
  name: string;
  status: string;
  health: Health;
  priority: string;
  planned_start: string;
  due_at: string;
  done: number;
  total: number;
  failed: number;
  progress: number;
  total_estimate: number;
  remaining_estimate: number;
  overdue_tasks: Array<{
    id: string;
    goal: string;
    due_at: string;
    priority: string;
  }>;
  success_criteria: string[];
}

export interface PmeReport {
  project_id: string;
  name: string;
  status: string;
  overall_progress: number;
  done_tasks: number;
  total_tasks: number;
  total_estimate: number;
  remaining_estimate: number;
  milestones: MilestonePM[];
  burndown: Array<{
    milestone: string;
    health: Health;
    done: number;
    total: number;
    remaining_estimate: number;
  }>;
  risks: Array<{
    type: "milestone" | "task";
    milestone?: string;
    task_id?: string;
    task?: string;
    health: string;
    detail: string;
  }>;
  blockers: string[];
  overdue: Array<{ milestone: string; tasks: MilestonePM["overdue_tasks"] }>;
  next_actions: Array<{
    milestone: string;
    task_id: string;
    task: string;
    priority: string;
    estimate: number;
    due_at: string;
  }>;
  assignments: Record<string, string[]>;
}

interface Retro {
  project_id: string;
  name: string;
  goal: string;
  status: string;
  milestone_count: number;
  task_count: number;
  done_tasks: number;
  failed_tasks: number;
  rejected_tasks: number;
  attempts_total: number;
  total_estimate: number;
  duration_days: number | null;
  blocked_milestones: string[];
  risks_hit: string[];
  recommendations: string[];
}

interface ActionSpec {
  action: string;
  label: string;
  api: { method: string; path: string; body?: Record<string, unknown> };
  realtime_command?: string;
}

interface TaskReadModel {
  id: string;
  milestone_id: string;
  type: string;
  goal: string;
  assigned_role: string;
  assigned_agent: string;
  team_mode: string;
  priority: string;
  estimate: number;
  due_at: string;
  acceptance_criteria: string[];
  status: string;
  attempts: number;
}

export interface ProjectFull {
  project: {
    id: string;
    name: string;
    goal: string;
    status: string;
    owner: string;
    owner_id?: string;
    created_at: string;
    started_at: string;
    finished_at: string;
    execution_thread_id?: string;
    icon?: string | null;
    category?: string | null;
  };
  milestones: Array<Record<string, unknown> & { id: string; name: string }>;
  tasks: Record<string, TaskReadModel[]>;
  pm: PmeReport | null;
  retro: Retro | null;
  available_actions: string[];
  action_specs: ActionSpec[];
  governance?: ProjectGovernance;
}

export interface ProjectSummary {
  id: string;
  name: string;
  goal?: string;
  status?: string;
  created_at?: string;
  execution_thread_id?: string;
  icon?: string | null;
  category?: string | null;
}
