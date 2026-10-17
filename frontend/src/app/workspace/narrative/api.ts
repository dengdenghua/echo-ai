import { jsonAuthHeaders, authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";

import {
  asNumber,
  asString,
  isRecord,
  normalizeArc,
  normalizeBranch,
  normalizeCanonCommit,
  normalizeChapter,
  normalizeContextPack,
  normalizeCounts,
  normalizeEntity,
  normalizeFact,
  normalizeForeshadow,
  normalizePipelineRun,
  normalizeProject,
  normalizeRelationship,
  normalizeReviewRequest,
  normalizeScene,
  normalizeStateChange,
  normalizeWorldPack,
  optionalString,
  stringArray,
  unwrapItems,
} from "./api-normalize";
import type {
  CanonCommitInput,
  CreateBranchInput,
  CreateChapterInput,
  CreateContextPackInput,
  CreatePipelineRunInput,
  CreateProjectInput,
  CreateReviewRequestInput,
  CreateSceneInput,
  EchoImportResult,
  NarrativeCanonCommit,
  NarrativeChapter,
  NarrativeCounts,
  NarrativeExtensions,
  NarrativePipelineRun,
  NarrativeProject,
  NarrativeReviewRequest,
  NarrativeScene,
  NarrativeStudioStatus,
  NarrativeWorkspace,
  ReviewVoteInput,
  SubmitPipelineStageInput,
  UpdateChapterInput,
  UpdateSceneInput,
} from "./api-types";

// Every response/request type stays importable from "./api".
export * from "./api-types";

export const NARRATIVE_STUDIO_API_BASE =
  "/api/plugins/narrative-studio" as const;

export class NarrativeApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "NarrativeApiError";
    this.status = status;
  }
}

async function responseError(response: Response): Promise<NarrativeApiError> {
  let detail = "";
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload)) {
      detail = asString(payload.detail) || asString(payload.message);
    }
  } catch {
    // An empty/non-JSON error response still carries a useful HTTP status.
  }
  return new NarrativeApiError(
    detail || `叙事服务请求失败（${response.status}）`,
    response.status,
  );
}

async function narrativeRequest(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(
    `${getBackendBaseURL()}${NARRATIVE_STUDIO_API_BASE}${path}`,
    {
      ...init,
      headers: init?.body
        ? { ...jsonAuthHeaders(), ...init.headers }
        : { ...authHeaders(), ...init?.headers },
    },
  );
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<unknown>;
}

function entityFromPayload(
  payload: unknown,
  aliases: string[],
): Record<string, unknown> {
  if (!isRecord(payload)) return {};
  for (const alias of aliases) {
    const nested = payload[alias];
    if (isRecord(nested)) return nested;
  }
  return payload;
}

export async function getNarrativeStatus(
  signal?: AbortSignal,
): Promise<NarrativeStudioStatus> {
  const payload = await narrativeRequest("/status", { signal });
  const value = isRecord(payload) ? payload : {};
  const status = asString(value.status, "ready");
  return {
    status,
    ready:
      typeof value.ready === "boolean"
        ? value.ready
        : status === "ok" || status === "ready",
    plugin: optionalString(value.plugin),
    canon_policy: optionalString(value.canon_policy),
    version: optionalString(value.version),
    capabilities: stringArray(value.capabilities),
    mcp: isRecord(value.mcp)
      ? {
          enabled: value.mcp.enabled === true,
          endpoint: asString(value.mcp.endpoint),
          transport: asString(value.mcp.transport),
          auth: optionalString(value.mcp.auth),
          tool_policy: optionalString(value.mcp.tool_policy),
          tools: stringArray(value.mcp.tools),
        }
      : undefined,
    packaged_skills: Array.isArray(value.packaged_skills)
      ? value.packaged_skills
          .filter(isRecord)
          .map((skill) => ({
            name: asString(skill.name),
            description: asString(skill.description),
          }))
          .filter((skill) => skill.name)
      : undefined,
  };
}

export async function listNarrativeProjects(
  signal?: AbortSignal,
): Promise<NarrativeProject[]> {
  const payload = await narrativeRequest("/projects", { signal });
  return unwrapItems(payload, ["projects"]).map(normalizeProject);
}

export async function getNarrativeProject(
  projectId: string,
  signal?: AbortSignal,
): Promise<{ project: NarrativeProject; counts: NarrativeCounts }> {
  const payload = await narrativeRequest(
    `/projects/${encodeURIComponent(projectId)}`,
    { signal },
  );
  const root = isRecord(payload) ? payload : {};
  return {
    project: normalizeProject(entityFromPayload(payload, ["project"])),
    counts: normalizeCounts(root.counts),
  };
}

async function listProjectEntities<T>(
  projectId: string,
  collectionPath: string,
  aliases: string[],
  normalize: (value: Record<string, unknown>) => T,
  signal?: AbortSignal,
): Promise<T[]> {
  const payload = await narrativeRequest(
    `/projects/${encodeURIComponent(projectId)}/${collectionPath}`,
    { signal },
  );
  return unwrapItems(payload, aliases).map(normalize);
}

export function listWorldPacks(projectId: string, signal?: AbortSignal) {
  return listProjectEntities(
    projectId,
    "world-packs",
    ["world_packs"],
    normalizeWorldPack,
    signal,
  );
}

export function listBranches(projectId: string, signal?: AbortSignal) {
  return listProjectEntities(
    projectId,
    "branches",
    ["branches"],
    normalizeBranch,
    signal,
  );
}

export function listChapters(projectId: string, signal?: AbortSignal) {
  return listProjectEntities(
    projectId,
    "chapters",
    ["chapters"],
    normalizeChapter,
    signal,
  );
}

export async function listScenes(
  projectId: string,
  chapterId: string,
  signal?: AbortSignal,
): Promise<NarrativeScene[]> {
  const payload = await narrativeRequest(
    `/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/scenes`,
    { signal },
  );
  return unwrapItems(payload, ["scenes"]).map((value) =>
    normalizeScene(value, chapterId),
  );
}

export function listFacts(projectId: string, signal?: AbortSignal) {
  return listProjectEntities(
    projectId,
    "facts",
    ["facts"],
    normalizeFact,
    signal,
  );
}

export function listStateChanges(projectId: string, signal?: AbortSignal) {
  return listProjectEntities(
    projectId,
    "state-changes",
    ["state_changes"],
    normalizeStateChange,
    signal,
  );
}

export async function loadNarrativeWorkspace(
  projectId: string,
  signal?: AbortSignal,
): Promise<NarrativeWorkspace> {
  const [detail, worldPacks, branches, chapters, facts, stateChanges] =
    await Promise.all([
      getNarrativeProject(projectId, signal),
      listWorldPacks(projectId, signal),
      listBranches(projectId, signal),
      listChapters(projectId, signal),
      listFacts(projectId, signal),
      listStateChanges(projectId, signal),
    ]);
  const sceneGroups = await Promise.all(
    chapters.map((chapter) => listScenes(projectId, chapter.id, signal)),
  );
  return {
    ...detail,
    worldPacks,
    branches,
    chapters,
    scenes: sceneGroups.flat(),
    facts,
    stateChanges,
  };
}

async function createEntity<T>(
  projectId: string,
  path: string,
  body: object,
  aliases: string[],
  normalize: (value: Record<string, unknown>) => T,
): Promise<T> {
  const payload = await narrativeRequest(
    `/projects/${encodeURIComponent(projectId)}/${path}`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return normalize(entityFromPayload(payload, aliases));
}

export async function createNarrativeProject(
  input: CreateProjectInput,
): Promise<NarrativeProject> {
  const payload = await narrativeRequest("/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return normalizeProject(entityFromPayload(payload, ["project"]));
}

export function createBranch(projectId: string, input: CreateBranchInput) {
  return createEntity(
    projectId,
    "branches",
    input,
    ["branch"],
    normalizeBranch,
  );
}

export function createChapter(projectId: string, input: CreateChapterInput) {
  return createEntity(
    projectId,
    "chapters",
    input,
    ["chapter"],
    normalizeChapter,
  );
}

export async function updateChapter(
  projectId: string,
  chapterId: string,
  input: UpdateChapterInput,
): Promise<NarrativeChapter> {
  const payload = await narrativeRequest(
    `/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}`,
    { method: "PUT", body: JSON.stringify(input) },
  );
  return normalizeChapter(entityFromPayload(payload, ["chapter"]));
}

export function createScene(
  projectId: string,
  chapterId: string,
  input: CreateSceneInput,
) {
  return createEntity(
    projectId,
    `chapters/${encodeURIComponent(chapterId)}/scenes`,
    input,
    ["scene"],
    (value) => normalizeScene(value, chapterId),
  );
}

export async function updateScene(
  projectId: string,
  chapterId: string,
  sceneId: string,
  input: UpdateSceneInput,
): Promise<NarrativeScene> {
  const payload = await narrativeRequest(
    `/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/scenes/${encodeURIComponent(sceneId)}`,
    { method: "PUT", body: JSON.stringify(input) },
  );
  return normalizeScene(entityFromPayload(payload, ["scene"]), chapterId);
}

export async function importEchoUniverse(
  projectId: string,
  input: { pack_name?: string; include_content?: boolean } = {},
): Promise<EchoImportResult> {
  const payload = await narrativeRequest(
    `/projects/${encodeURIComponent(projectId)}/imports/echo`,
    { method: "POST", body: JSON.stringify(input) },
  );
  const value = isRecord(payload) ? payload : {};
  const inventoryValue = isRecord(value.inventory) ? value.inventory : {};
  const packValue = isRecord(value.world_pack)
    ? normalizeWorldPack(value.world_pack)
    : undefined;
  return {
    available: value.available === true,
    imported: value.imported === true,
    reason: optionalString(value.reason),
    source_root: asString(value.source_root),
    world_pack: packValue,
    inventory: {
      bible: asNumber(inventoryValue.bible),
      characters: asNumber(inventoryValue.characters),
      factions: asNumber(inventoryValue.factions),
      locations: asNumber(inventoryValue.locations),
      technologies: asNumber(inventoryValue.technologies),
      relationships: asNumber(inventoryValue.relationships),
      timeline: asNumber(inventoryValue.timeline),
      stories: asNumber(inventoryValue.stories),
      total_files: asNumber(inventoryValue.total_files),
    },
    truncated: value.truncated === true,
    skipped_oversize: asNumber(value.skipped_oversize),
  };
}

export function listArcs(projectId: string, signal?: AbortSignal) {
  return listProjectEntities(projectId, "arcs", ["arcs"], normalizeArc, signal);
}

export function listEntities(projectId: string, signal?: AbortSignal) {
  return listProjectEntities(
    projectId,
    "entities",
    ["entities"],
    normalizeEntity,
    signal,
  );
}

export function listRelationships(projectId: string, signal?: AbortSignal) {
  return listProjectEntities(
    projectId,
    "relationships",
    ["relationships"],
    normalizeRelationship,
    signal,
  );
}

export function listForeshadows(projectId: string, signal?: AbortSignal) {
  return listProjectEntities(
    projectId,
    "foreshadows",
    ["foreshadows"],
    normalizeForeshadow,
    signal,
  );
}

export function listContextPacks(projectId: string, signal?: AbortSignal) {
  return listProjectEntities(
    projectId,
    "context-packs",
    ["context_packs", "packs"],
    normalizeContextPack,
    signal,
  );
}

export function createContextPack(
  projectId: string,
  input: CreateContextPackInput,
) {
  const body = {
    branch_id: input.branch_id,
    target_chapter_id: input.chapter_id,
    label: input.query || "章节创作上下文",
    max_chars: input.max_chars ?? (input.token_budget ?? 12_000) * 4,
    max_items: input.max_items ?? 48,
  };
  return createEntity(
    projectId,
    "context-packs",
    body,
    ["context_pack", "pack"],
    normalizeContextPack,
  );
}

export function listPipelineRuns(projectId: string, signal?: AbortSignal) {
  return listProjectEntities(
    projectId,
    "pipeline-runs",
    ["pipeline_runs", "runs"],
    normalizePipelineRun,
    signal,
  );
}

export function createPipelineRun(
  projectId: string,
  input: CreatePipelineRunInput,
) {
  const body = {
    branch_id: input.branch_id,
    chapter_id: input.chapter_id,
    context_pack_id: input.context_pack_id,
    goal: input.objective || "",
  };
  return createEntity(
    projectId,
    "pipeline-runs",
    body,
    ["pipeline_run", "run"],
    normalizePipelineRun,
  );
}

export async function submitPipelineStage(
  projectId: string,
  runId: string,
  stageId: string,
  input: SubmitPipelineStageInput,
): Promise<NarrativePipelineRun> {
  const payload = await narrativeRequest(
    `/projects/${encodeURIComponent(projectId)}/pipeline-runs/${encodeURIComponent(runId)}/stages/${encodeURIComponent(stageId)}/submit`,
    {
      method: "POST",
      body: JSON.stringify({
        output:
          typeof input.output === "string"
            ? input.output
            : JSON.stringify(input.output ?? { notes: input.notes || "" }),
        source_refs: [],
        submitted_by: input.actor,
      }),
    },
  );
  const root = entityFromPayload(payload, ["pipeline_run", "run"]);
  if (Array.isArray(root.stages)) return normalizePipelineRun(root);
  const responseRoot = isRecord(payload) ? payload : {};
  const nestedRun = responseRoot.pipeline_run ?? responseRoot.run;
  if (isRecord(nestedRun)) return normalizePipelineRun(nestedRun);
  return normalizePipelineRun(root);
}

export function listReviewRequests(projectId: string, signal?: AbortSignal) {
  return listProjectEntities(
    projectId,
    "review-requests",
    ["review_requests", "reviews"],
    normalizeReviewRequest,
    signal,
  );
}

export function createReviewRequest(
  projectId: string,
  input: CreateReviewRequestInput,
) {
  const body = {
    target_type: input.target_type,
    target_id: input.target_id,
    title: input.title || "候选内容正典审核",
    summary: input.summary || input.title || "请审核当前候选修订。",
    blocking: input.blocking ?? false,
    requested_by: input.requested_by || "human-editor",
  };
  return createEntity(
    projectId,
    "review-requests",
    body,
    ["review_request", "review"],
    normalizeReviewRequest,
  );
}

export async function voteReviewRequest(
  projectId: string,
  reviewId: string,
  input: ReviewVoteInput,
): Promise<NarrativeReviewRequest> {
  const payload = await narrativeRequest(
    `/projects/${encodeURIComponent(projectId)}/review-requests/${encodeURIComponent(reviewId)}/votes`,
    {
      method: "POST",
      body: JSON.stringify({
        voter_id: input.actor,
        decision: input.decision,
        rationale: input.rationale || "",
      }),
    },
  );
  return normalizeReviewRequest(
    entityFromPayload(payload, ["review_request", "review"]),
  );
}

export function listCanonCommits(projectId: string, signal?: AbortSignal) {
  return listProjectEntities(
    projectId,
    "canon-commits",
    ["canon_commits", "commits"],
    normalizeCanonCommit,
    signal,
  );
}

export async function commitCanonReview(
  projectId: string,
  reviewId: string,
  input: CanonCommitInput,
): Promise<NarrativeCanonCommit> {
  if (input.confirm !== true) {
    throw new NarrativeApiError("正典提交必须经过人工确认。", 400);
  }
  const payload = await narrativeRequest(
    `/projects/${encodeURIComponent(projectId)}/review-requests/${encodeURIComponent(reviewId)}/commit`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return normalizeCanonCommit(
    entityFromPayload(payload, ["canon_commit", "commit"]),
  );
}

type ExtensionCollectionKey = Exclude<keyof NarrativeExtensions, "warnings">;

const EMPTY_EXTENSIONS: Omit<NarrativeExtensions, "warnings"> = {
  arcs: [],
  entities: [],
  relationships: [],
  foreshadows: [],
  contextPacks: [],
  pipelineRuns: [],
  reviewRequests: [],
  canonCommits: [],
};

export async function loadNarrativeExtensions(
  projectId: string,
  signal?: AbortSignal,
): Promise<NarrativeExtensions> {
  const requests: Array<readonly [ExtensionCollectionKey, Promise<unknown[]>]> =
    [
      ["arcs", listArcs(projectId, signal)],
      ["entities", listEntities(projectId, signal)],
      ["relationships", listRelationships(projectId, signal)],
      ["foreshadows", listForeshadows(projectId, signal)],
      ["contextPacks", listContextPacks(projectId, signal)],
      ["pipelineRuns", listPipelineRuns(projectId, signal)],
      ["reviewRequests", listReviewRequests(projectId, signal)],
      ["canonCommits", listCanonCommits(projectId, signal)],
    ];
  const settled = await Promise.allSettled(
    requests.map(([, request]) => request),
  );
  const output: NarrativeExtensions = {
    ...EMPTY_EXTENSIONS,
    warnings: [],
  };
  settled.forEach((result, index) => {
    const entry = requests[index];
    if (!entry) return;
    const key = entry[0];
    if (result.status === "fulfilled") {
      // Every collection is normalized before it reaches this aggregation layer.
      (output[key] as unknown[]) = result.value;
    } else if (
      result.reason instanceof DOMException &&
      result.reason.name === "AbortError"
    ) {
      return;
    } else {
      output.warnings.push(
        result.reason instanceof Error
          ? `${key}: ${result.reason.message}`
          : `${key}: 加载失败`,
      );
    }
  });
  return output;
}
