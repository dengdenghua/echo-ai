import { type TrustScore } from "@/core/cowork/trust";
export type ProjectWorkbenchTabId =
  | "overview"
  | "milestones"
  | "tasks"
  | "assets"
  | "members";

export type Health =
  | "on_track"
  | "at_risk"
  | "overdue"
  | "blocked"
  | "completed";

export interface ProjectActionSpec {
  action: string;
  label: string;
  api: {
    method: string;
    path: string;
    body?: Record<string, unknown>;
  };
  realtime_command?: string;
  requires?: string[];
}

export interface ProjectTaskReadModel {
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
  depends_on?: string[];
  output?: unknown;
  qa_verdict?: Record<string, unknown> | null;
  review_mode?: "" | "ai_auto" | "operator" | "human_run";
  reviewed_by?: string;
  available_actions?: string[];
  action_specs?: ProjectActionSpec[];
}

export interface MilestonePM {
  id: string;
  name: string;
  status: string;
  health: Health;
  priority: string;
  planned_start?: string;
  due_at: string;
  done: number;
  total: number;
  failed: number;
  progress: number;
  total_estimate?: number;
  remaining_estimate?: number;
  overdue_tasks?: Array<{
    id: string;
    goal: string;
    due_at: string;
    priority: string;
  }>;
  success_criteria?: string[];
}

export interface PmReport {
  project_id: string;
  name: string;
  status: string;
  overall_progress: number;
  done_tasks: number;
  total_tasks: number;
  total_estimate?: number;
  remaining_estimate: number;
  milestones: MilestonePM[];
  risks: Array<{
    type: "milestone" | "task";
    milestone?: string;
    task_id?: string;
    task?: string;
    health: string;
    detail: string;
  }>;
  blockers: string[];
  next_actions: Array<{
    type?: string;
    milestone_id?: string;
    milestone: string;
    task_id: string;
    task: string;
    priority: string;
    estimate: number;
    due_at: string;
  }>;
  assignments?: Record<string, string[]>;
}

export interface Retro {
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
  recommendations: string[];
}

export interface ProjectArtifactReadModel {
  id: string;
  name: string;
  kind?: string;
  path?: string;
  url?: string;
  summary?: string;
  task_id?: string;
  milestone_id?: string;
}

export interface ProjectDecisionReadModel {
  id?: string;
  title?: string;
  summary?: string;
  decision?: string;
  actor?: string;
  source_message_id?: string;
  milestone_id?: string;
  created_at?: string;
}

export interface ProjectMemberReadModel {
  id: string;
  name: string;
  role?: string;
  kind?: "human" | "agent" | "role";
  /** `ai` = 托管; `human` = 接管 (its owner holds the wheel). */
  driver?: "ai" | "human";
  /** The human accountable for a `role` (数字员工) member. */
  accountable_owner?: string | null;
  avatar_url?: string | null;
  status?: string;
}

export interface ProjectFullState {
  project: {
    id: string;
    name: string;
    goal: string;
    status: string;
    owner: string;
    owner_id?: string;
    current_ms?: string | null;
    execution_thread_id?: string;
    created_at: string;
    started_at: string;
    finished_at: string;
  };
  milestones: Array<{
    id: string;
    name: string;
    goal?: string;
    status: string;
    priority: string;
    planned_start?: string;
    due_at: string;
    success_criteria?: string[];
  }>;
  tasks: Record<string, ProjectTaskReadModel[]>;
  pm: PmReport | null;
  retro: Retro | null;
  available_actions: string[];
  action_specs: ProjectActionSpec[];
  /** Forward-compatible projection from the project room. */
  artifacts?: ProjectArtifactReadModel[];
  /** Forward-compatible decision log projected from project-room actions. */
  decisions?: ProjectDecisionReadModel[];
  /** Forward-compatible projection from the project room. */
  members?: ProjectMemberReadModel[];
}

export interface MilestoneView extends MilestonePM {
  goal?: string;
  progressPercent: number;
}

export interface ProjectAssetView extends ProjectArtifactReadModel {
  sourceTask?: string;
}

export interface ProjectMemberView {
  id: string;
  name: string;
  role: string;
  kind: "human" | "agent" | "role";
  driver?: "ai" | "human";
  accountableOwner?: string | null;
  avatarUrl?: string | null;
  status?: string;
  isOwner?: boolean;
  trust?: TrustScore | null;
}

export interface ProjectDecisionView {
  id: string;
  title: string;
  body?: string;
  actor?: string;
  milestoneId?: string;
  createdAt?: string;
}
