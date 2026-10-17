export type CanonStatus = "candidate";

export interface NarrativeProject {
  id: string;
  title: string;
  premise: string;
  language: string;
  default_branch_id?: string;
  canon_policy: string;
  canon_status: CanonStatus;
  governance?: {
    quorum: number;
    approval_ratio: number;
  };
  created_at?: string;
  updated_at?: string;
}

export interface NarrativeCounts {
  world_packs: number;
  branches: number;
  chapters: number;
  scenes: number;
  facts: number;
  state_changes: number;
}

export interface NarrativeWorldPack {
  id: string;
  name: string;
  summary: string;
  resources: unknown[];
  metadata?: Record<string, unknown>;
  canon_status: CanonStatus;
}

export interface NarrativeBranch {
  id: string;
  name: string;
  base_branch_id?: string;
  purpose: string;
  canon_status: CanonStatus;
}

export interface NarrativeChapter {
  id: string;
  branch_id: string;
  ordinal: number;
  title: string;
  summary: string;
  body: string;
  canon_status: CanonStatus;
}

export interface NarrativeScene {
  id: string;
  chapter_id: string;
  branch_id: string;
  ordinal: number;
  title: string;
  goal: string;
  conflict: string;
  outcome: string;
  pov_character_id?: string;
  body: string;
  canon_status: CanonStatus;
}

export interface NarrativeFact {
  id: string;
  branch_id?: string;
  subject: string;
  predicate: string;
  object: string;
  scope: string;
  source_refs: string[];
  canon_status: CanonStatus;
}

export interface NarrativeStateChange {
  id: string;
  branch_id: string;
  chapter_id?: string;
  scene_id?: string;
  entity_id: string;
  field: string;
  before?: unknown;
  after?: unknown;
  reason: string;
  canon_status: CanonStatus;
}

export interface NarrativeArc {
  id: string;
  title: string;
  summary: string;
  status: string;
  chapter_ids: string[];
  metadata?: Record<string, unknown>;
}

export interface NarrativeEntity {
  id: string;
  name: string;
  kind: string;
  description: string;
  attributes: Record<string, unknown>;
  source_refs: string[];
}

export interface NarrativeRelationship {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  kind: string;
  description: string;
  status: string;
}

export interface NarrativeForeshadow {
  id: string;
  title: string;
  setup: string;
  payoff: string;
  status: string;
  source_refs: string[];
  target_chapter_id?: string;
}

export interface NarrativeContextSource {
  id: string;
  kind: string;
  title: string;
  reference: string;
  excerpt: string;
  tokens: number;
  char_count: number;
  truncated: boolean;
  included: boolean;
}

export interface NarrativeContextPack {
  id: string;
  project_id: string;
  branch_id?: string;
  chapter_id?: string;
  scene_id?: string;
  token_budget: number;
  token_count: number;
  max_chars: number;
  max_items: number;
  total_chars: number;
  sources: NarrativeContextSource[];
  omitted_count: number;
  created_at?: string;
}

export type NarrativePipelineStageStatus =
  | "pending"
  | "submitted"
  | "ready"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";

export interface NarrativePipelineStage {
  id: string;
  name: string;
  status: NarrativePipelineStageStatus;
  ordinal: number;
  output?: unknown;
  error?: string;
  actor?: string;
  updated_at?: string;
}

export interface NarrativePipelineRun {
  id: string;
  project_id: string;
  branch_id?: string;
  chapter_id?: string;
  scene_id?: string;
  status: string;
  stages: NarrativePipelineStage[];
  created_at?: string;
  updated_at?: string;
}

export interface NarrativeReviewVote {
  id: string;
  actor: string;
  decision: string;
  rationale: string;
  created_at?: string;
}

export interface NarrativeReviewRequest {
  id: string;
  project_id: string;
  target_type: string;
  target_id: string;
  revision: number;
  title: string;
  status: string;
  quorum_required: number;
  quorum_received: number;
  blockers: string[];
  blocking: boolean;
  approval_ratio: number;
  resolution?: unknown;
  votes: NarrativeReviewVote[];
  created_at?: string;
  updated_at?: string;
}

export interface NarrativeCanonCommit {
  id: string;
  review_request_id: string;
  target_type: string;
  target_id: string;
  status: string;
  actor: string;
  rationale: string;
  committed_at?: string;
}

export interface NarrativeExtensions {
  arcs: NarrativeArc[];
  entities: NarrativeEntity[];
  relationships: NarrativeRelationship[];
  foreshadows: NarrativeForeshadow[];
  contextPacks: NarrativeContextPack[];
  pipelineRuns: NarrativePipelineRun[];
  reviewRequests: NarrativeReviewRequest[];
  canonCommits: NarrativeCanonCommit[];
  warnings: string[];
}

export interface NarrativeStudioStatus {
  status: string;
  ready: boolean;
  plugin?: string;
  canon_policy?: string;
  version?: string;
  capabilities?: string[];
  mcp?: {
    enabled: boolean;
    endpoint: string;
    transport: string;
    auth?: string;
    tool_policy?: string;
    tools: string[];
  };
  packaged_skills?: Array<{
    name: string;
    description: string;
  }>;
}

export interface EchoImportResult {
  available: boolean;
  imported: boolean;
  reason?: string;
  source_root: string;
  world_pack?: NarrativeWorldPack;
  inventory: {
    bible: number;
    characters: number;
    factions: number;
    locations: number;
    technologies: number;
    relationships: number;
    timeline: number;
    stories: number;
    total_files: number;
  };
  truncated: boolean;
  skipped_oversize: number;
}

export interface NarrativeWorkspace {
  project: NarrativeProject;
  counts: NarrativeCounts;
  worldPacks: NarrativeWorldPack[];
  branches: NarrativeBranch[];
  chapters: NarrativeChapter[];
  scenes: NarrativeScene[];
  facts: NarrativeFact[];
  stateChanges: NarrativeStateChange[];
}

export interface CreateProjectInput {
  id?: string;
  title: string;
  premise?: string;
  language?: string;
}

export interface CreateBranchInput {
  id?: string;
  name: string;
  base_branch_id?: string;
  purpose?: string;
}

export interface CreateChapterInput {
  id?: string;
  branch_id: string;
  ordinal: number;
  title: string;
  summary?: string;
  body?: string;
}

export interface UpdateChapterInput {
  ordinal?: number;
  title?: string;
  summary?: string;
  body?: string;
}

export interface CreateSceneInput {
  id?: string;
  branch_id: string;
  ordinal: number;
  title: string;
  goal?: string;
  conflict?: string;
  outcome?: string;
  pov_character_id?: string;
  body?: string;
}

export interface UpdateSceneInput {
  ordinal?: number;
  title?: string;
  goal?: string;
  conflict?: string;
  outcome?: string;
  pov_character_id?: string;
  body?: string;
}

export interface CreateContextPackInput {
  branch_id?: string;
  chapter_id?: string;
  scene_id?: string;
  token_budget?: number;
  max_chars?: number;
  max_items?: number;
  query?: string;
}

export interface CreatePipelineRunInput {
  branch_id?: string;
  chapter_id?: string;
  scene_id?: string;
  context_pack_id?: string;
  objective?: string;
}

export interface SubmitPipelineStageInput {
  actor: string;
  output?: unknown;
  notes?: string;
}

export interface CreateReviewRequestInput {
  target_type: string;
  target_id: string;
  revision?: number;
  branch_id?: string;
  chapter_id?: string;
  title?: string;
  summary?: string;
  blocking?: boolean;
  requested_by?: string;
}

export interface ReviewVoteInput {
  actor: string;
  decision: "approve" | "reject" | "abstain";
  rationale?: string;
}

export interface CanonCommitInput {
  actor: string;
  rationale: string;
  confirm: true;
}
