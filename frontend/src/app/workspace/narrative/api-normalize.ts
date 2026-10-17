import type {
  CanonStatus,
  NarrativeArc,
  NarrativeBranch,
  NarrativeCanonCommit,
  NarrativeChapter,
  NarrativeContextPack,
  NarrativeContextSource,
  NarrativeCounts,
  NarrativeEntity,
  NarrativeFact,
  NarrativeForeshadow,
  NarrativePipelineRun,
  NarrativePipelineStage,
  NarrativePipelineStageStatus,
  NarrativeProject,
  NarrativeRelationship,
  NarrativeReviewRequest,
  NarrativeReviewVote,
  NarrativeScene,
  NarrativeStateChange,
  NarrativeWorldPack,
} from "./api-types";

// Coerce the narrative-studio plugin's loosely shaped JSON into the typed
// records in ./api-types. Every field falls back to a safe default.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asRatio(value: unknown, fallback = 0): number {
  const number = asNumber(value, fallback);
  return Math.max(0, Math.min(number > 1 ? number / 100 : number, 1));
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function candidateStatus(_value: unknown): CanonStatus {
  return "candidate";
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function unwrapItems(
  value: unknown,
  aliases: string[],
): Record<string, unknown>[] {
  if (Array.isArray(value)) return recordArray(value);
  if (!isRecord(value)) return [];
  const keys = ["items", ...aliases];
  for (const key of keys) {
    if (Array.isArray(value[key])) return recordArray(value[key]);
  }
  return [];
}

export function normalizeProject(
  value: Record<string, unknown>,
): NarrativeProject {
  const governance = isRecord(value.governance) ? value.governance : undefined;
  return {
    id: asString(value.id),
    title: asString(value.title, "未命名叙事项目"),
    premise: asString(value.premise),
    language: asString(value.language, "zh-CN"),
    default_branch_id: optionalString(value.default_branch_id),
    canon_policy: asString(value.canon_policy, "candidate_only"),
    canon_status: candidateStatus(value.canon_status),
    governance: governance
      ? {
          quorum: asNumber(
            governance.quorum,
            asNumber(
              governance.review_quorum,
              asNumber(governance.required_votes, 1),
            ),
          ),
          approval_ratio: asRatio(
            governance.approval_ratio,
            asRatio(governance.threshold, 1),
          ),
        }
      : undefined,
    created_at: optionalString(value.created_at),
    updated_at: optionalString(value.updated_at),
  };
}

export function normalizeWorldPack(
  value: Record<string, unknown>,
): NarrativeWorldPack {
  return {
    id: asString(value.id),
    name: asString(value.name, "未命名世界资料"),
    summary: asString(value.summary),
    resources: Array.isArray(value.resources) ? value.resources : [],
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
    canon_status: candidateStatus(value.canon_status),
  };
}

export function normalizeBranch(
  value: Record<string, unknown>,
): NarrativeBranch {
  return {
    id: asString(value.id),
    name: asString(value.name, "未命名分支"),
    base_branch_id: optionalString(value.base_branch_id),
    purpose: asString(value.purpose),
    canon_status: candidateStatus(value.canon_status),
  };
}

export function normalizeChapter(
  value: Record<string, unknown>,
): NarrativeChapter {
  return {
    id: asString(value.id),
    branch_id: asString(value.branch_id),
    ordinal: asNumber(value.ordinal, 1),
    title: asString(value.title, "未命名章节"),
    summary: asString(value.summary),
    body: asString(value.body),
    canon_status: candidateStatus(value.canon_status),
  };
}

export function normalizeScene(
  value: Record<string, unknown>,
  chapterId = "",
): NarrativeScene {
  return {
    id: asString(value.id),
    chapter_id: asString(value.chapter_id, chapterId),
    branch_id: asString(value.branch_id),
    ordinal: asNumber(value.ordinal, 1),
    title: asString(value.title, "未命名场景"),
    goal: asString(value.goal),
    conflict: asString(value.conflict),
    outcome: asString(value.outcome),
    pov_character_id: optionalString(value.pov_character_id),
    body: asString(value.body),
    canon_status: candidateStatus(value.canon_status),
  };
}

export function normalizeFact(value: Record<string, unknown>): NarrativeFact {
  return {
    id: asString(value.id),
    branch_id: optionalString(value.branch_id),
    subject: asString(value.subject),
    predicate: asString(value.predicate),
    object: asString(value.object),
    scope: asString(value.scope, "universe"),
    source_refs: Array.isArray(value.source_refs)
      ? value.source_refs.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    canon_status: candidateStatus(value.canon_status),
  };
}

export function normalizeStateChange(
  value: Record<string, unknown>,
): NarrativeStateChange {
  return {
    id: asString(value.id),
    branch_id: asString(value.branch_id),
    chapter_id: optionalString(value.chapter_id),
    scene_id: optionalString(value.scene_id),
    entity_id: asString(value.entity_id),
    field: asString(value.field),
    before: value.before,
    after: value.after,
    reason: asString(value.reason),
    canon_status: candidateStatus(value.canon_status),
  };
}

export function normalizeArc(value: Record<string, unknown>): NarrativeArc {
  return {
    id: asString(value.id),
    title: asString(value.title, asString(value.name, "未命名故事弧")),
    summary: asString(value.summary, asString(value.description)),
    status: asString(value.status, "candidate"),
    chapter_ids: stringArray(value.chapter_ids),
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
  };
}

export function normalizeEntity(
  value: Record<string, unknown>,
): NarrativeEntity {
  return {
    id: asString(value.id),
    name: asString(value.name, asString(value.title, "未命名实体")),
    kind: asString(
      value.kind,
      asString(value.type, asString(value.entity_type, "entity")),
    ),
    description: asString(value.description, asString(value.summary)),
    attributes: isRecord(value.attributes)
      ? value.attributes
      : isRecord(value.metadata)
        ? value.metadata
        : {},
    source_refs: stringArray(value.source_refs),
  };
}

export function normalizeRelationship(
  value: Record<string, unknown>,
): NarrativeRelationship {
  return {
    id: asString(value.id),
    source_entity_id: asString(
      value.source_entity_id,
      asString(
        value.from_entity_id,
        asString(value.source_id, asString(value.source)),
      ),
    ),
    target_entity_id: asString(
      value.target_entity_id,
      asString(
        value.to_entity_id,
        asString(value.target_id, asString(value.target)),
      ),
    ),
    kind: asString(
      value.kind,
      asString(value.type, asString(value.relationship_type, "related")),
    ),
    description: asString(value.description, asString(value.summary)),
    status: asString(value.status, "active"),
  };
}

export function normalizeForeshadow(
  value: Record<string, unknown>,
): NarrativeForeshadow {
  return {
    id: asString(value.id),
    title: asString(value.title, asString(value.name, "未命名伏笔")),
    setup: asString(value.setup, asString(value.description)),
    payoff: asString(
      value.payoff,
      asString(value.intended_payoff, asString(value.resolution)),
    ),
    status: asString(value.status, "open"),
    source_refs: stringArray(value.source_refs),
    target_chapter_id: optionalString(
      value.target_chapter_id ?? value.payoff_chapter_id,
    ),
  };
}

function normalizeContextSource(
  value: Record<string, unknown>,
): NarrativeContextSource {
  const charCount = asNumber(
    value.char_count,
    asString(value.content, asString(value.text)).length,
  );
  return {
    id: asString(value.id, asString(value.reference, asString(value.ref))),
    kind: asString(value.kind, asString(value.type, "source")),
    title: asString(
      value.title,
      asString(value.name, asString(value.reference, "未命名来源")),
    ),
    reference: asString(
      value.reference,
      asString(value.ref, asString(value.source_ref)),
    ),
    excerpt: asString(
      value.excerpt,
      asString(value.content, asString(value.text)),
    ),
    tokens: asNumber(
      value.tokens,
      asNumber(value.token_count, Math.ceil(charCount / 4)),
    ),
    char_count: charCount,
    truncated: value.truncated === true,
    included: value.included !== false && value.omitted !== true,
  };
}

export function normalizeContextPack(
  value: Record<string, unknown>,
): NarrativeContextPack {
  const maxChars = asNumber(value.max_chars);
  const totalChars = asNumber(value.total_chars);
  const budget = asNumber(
    value.token_budget,
    asNumber(value.budget, asNumber(value.max_tokens, Math.ceil(maxChars / 4))),
  );
  const sources = unwrapItems(value.sources, ["references", "citations"]).map(
    normalizeContextSource,
  );
  return {
    id: asString(value.id),
    project_id: asString(value.project_id),
    branch_id: optionalString(value.branch_id),
    chapter_id: optionalString(value.chapter_id ?? value.target_chapter_id),
    scene_id: optionalString(value.scene_id),
    token_budget: budget,
    token_count: asNumber(
      value.token_count,
      asNumber(
        value.used_tokens,
        asNumber(
          value.estimated_tokens,
          asNumber(value.total_tokens, Math.ceil(totalChars / 4)),
        ),
      ),
    ),
    max_chars: maxChars,
    max_items: asNumber(value.max_items),
    total_chars: totalChars,
    sources,
    omitted_count: asNumber(
      value.omitted_count,
      sources.filter((source) => !source.included).length,
    ),
    created_at: optionalString(value.created_at),
  };
}

// Built from the status union, then widened so any string can be tested.
const PIPELINE_STATUSES: ReadonlySet<string> =
  new Set<NarrativePipelineStageStatus>([
    "pending",
    "submitted",
    "ready",
    "running",
    "completed",
    "blocked",
    "failed",
    "skipped",
  ]);

function isPipelineStageStatus(
  value: string,
): value is NarrativePipelineStageStatus {
  return PIPELINE_STATUSES.has(value);
}

function normalizePipelineStage(
  value: Record<string, unknown>,
): NarrativePipelineStage {
  const rawStatus = asString(value.status, "pending");
  const stageKey = asString(
    value.id,
    asString(value.stage_id, asString(value.key, asString(value.name))),
  );
  return {
    id: stageKey,
    name: asString(
      value.name,
      asString(value.label, asString(value.id, "stage")),
    ),
    status: isPipelineStageStatus(rawStatus) ? rawStatus : "pending",
    ordinal: asNumber(value.ordinal),
    output: value.output ?? value.result,
    error: optionalString(value.error),
    actor: optionalString(value.actor ?? value.submitted_by),
    updated_at: optionalString(value.updated_at),
  };
}

export function normalizePipelineRun(
  value: Record<string, unknown>,
): NarrativePipelineRun {
  const stages = unwrapItems(value.stages, ["steps", "pipeline_stages"]).map(
    normalizePipelineStage,
  );
  return {
    id: asString(value.id),
    project_id: asString(value.project_id),
    branch_id: optionalString(value.branch_id),
    chapter_id: optionalString(value.chapter_id),
    scene_id: optionalString(value.scene_id),
    status: asString(value.status, "pending"),
    stages,
    created_at: optionalString(value.created_at),
    updated_at: optionalString(value.updated_at),
  };
}

function normalizeReviewVote(
  value: Record<string, unknown>,
): NarrativeReviewVote {
  return {
    id: asString(value.id),
    actor: asString(
      value.actor,
      asString(value.voter_id, asString(value.voter, "未知审核者")),
    ),
    decision: asString(value.decision, asString(value.vote, "abstain")),
    rationale: asString(value.rationale, asString(value.reason)),
    created_at: optionalString(value.created_at),
  };
}

export function normalizeReviewRequest(
  value: Record<string, unknown>,
): NarrativeReviewRequest {
  const quorum = isRecord(value.quorum) ? value.quorum : {};
  const blockers = Array.isArray(value.blockers)
    ? value.blockers.map((item) =>
        typeof item === "string"
          ? item
          : isRecord(item)
            ? asString(
                item.message,
                asString(
                  item.reason,
                  asString(item.title, asString(item.code, asString(item.id))),
                ),
              )
            : String(item),
      )
    : Array.isArray(value.blocking)
      ? value.blocking.map(String)
      : [];
  const votes = unwrapItems(value.votes, ["review_votes"]).map(
    normalizeReviewVote,
  );
  const decidingVotes = votes.filter((vote) =>
    ["approve", "reject"].includes(vote.decision),
  );
  const inferredApprovalRatio = decidingVotes.length
    ? decidingVotes.filter((vote) => vote.decision === "approve").length /
      decidingVotes.length
    : 0;
  return {
    id: asString(value.id),
    project_id: asString(value.project_id),
    target_type: asString(value.target_type, "chapter"),
    target_id: asString(
      value.target_id,
      asString(value.target, asString(value.chapter_id)),
    ),
    revision: asNumber(value.revision, asNumber(value.target_revision, 1)),
    title: asString(value.title, "正典审核"),
    status: asString(value.status, "pending"),
    quorum_required: asNumber(
      value.quorum_required,
      asNumber(quorum.required, asNumber(value.required_votes, 1)),
    ),
    quorum_received: asNumber(
      value.quorum_received,
      asNumber(quorum.received, asNumber(value.approval_count, votes.length)),
    ),
    blockers:
      value.blocking === true && !blockers.filter(Boolean).length
        ? ["存在尚未解决的阻塞项"]
        : blockers.filter(Boolean),
    blocking: value.blocking === true || blockers.filter(Boolean).length > 0,
    approval_ratio: asRatio(
      value.approval_ratio,
      asRatio(quorum.approval_ratio, inferredApprovalRatio),
    ),
    resolution: value.resolution,
    votes,
    created_at: optionalString(value.created_at),
    updated_at: optionalString(value.updated_at),
  };
}

export function normalizeCanonCommit(
  value: Record<string, unknown>,
): NarrativeCanonCommit {
  return {
    id: asString(value.id),
    review_request_id: asString(
      value.review_request_id,
      asString(value.review_id),
    ),
    target_type: asString(value.target_type),
    target_id: asString(value.target_id),
    status: asString(value.status, "committed"),
    actor: asString(value.actor, asString(value.committed_by)),
    rationale: asString(value.rationale, asString(value.message)),
    committed_at: optionalString(value.committed_at ?? value.created_at),
  };
}

export function normalizeCounts(value: unknown): NarrativeCounts {
  const source = isRecord(value) ? value : {};
  return {
    world_packs: asNumber(source.world_packs),
    branches: asNumber(source.branches),
    chapters: asNumber(source.chapters),
    scenes: asNumber(source.scenes),
    facts: asNumber(source.facts),
    state_changes: asNumber(source.state_changes),
  };
}
