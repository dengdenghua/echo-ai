import {
  EchoAPIError,
  apiGet,
  apiPost,
  untypedApi,
  type ApiFailure,
  type HttpMethod,
} from "@/core/api/request";
import { getBackendBaseURL } from "@/core/config";
import { looseBody } from "@/core/api/response";
import { isNASServiceStartResponse } from "./guards";

export type NASMode = "efficiency" | "privacy";

export interface NASManifest {
  service: string;
  version: string;
  role: string;
  capabilities: string[];
}

export interface NASPolicy {
  mode: NASMode;
  allow_cloud_answering: boolean;
  allow_snippet_export: boolean;
  max_exported_snippets: number;
  max_snippet_chars: number;
  redact_file_paths_for_cloud: boolean;
}

export interface NASSource {
  source_id: string;
  path: string;
  display_name: string;
  recursive: boolean;
  include_globs: string[];
  exclude_globs: string[];
  status: "authorized" | "indexing" | "ready" | "error";
  file_count: number;
  chunk_count: number;
  last_indexed_at: string | null;
  created_at: string;
}

export interface NASModel {
  model_id: string;
  role: "embedding" | "reranker" | "ocr" | "vision" | "answer";
  display_name: string;
  provider: string;
  status: "not_configured" | "available" | "loading" | "running" | "error";
  endpoint: string | null;
  context_tokens: number | null;
  embedding_dimensions: number | null;
  quantization: string | null;
  notes: string | null;
}

export interface NASIndexJob {
  job_id: string;
  source_ids: string[];
  status: "pending" | "running" | "complete" | "failed";
  full_rescan: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  message: string | null;
}

export interface NASSearchHit {
  chunk_id: string;
  source_id: string;
  path: string;
  title: string;
  snippet: string;
  score: number;
  citation: Record<string, unknown>;
}

export interface NASSearchResponse {
  query: string;
  mode: NASMode;
  hits: NASSearchHit[];
  message: string | null;
}

export interface NASAnswerResponse {
  answer: string;
  mode: NASMode;
  citations: NASSearchHit[];
  cloud_used: boolean;
  message: string;
}

export interface NASServiceStartResponse {
  ok: boolean;
  status: "started" | "already_running" | "not_found" | "error" | string;
  base_url: string;
  auth_token?: string | null;
}

export interface NASDirectoryEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number | null;
}

export class NASRequestError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number,
    detail = "",
  ) {
    super(`NAS ${path} failed: ${status}${detail ? ` - ${detail}` : ""}`);
    this.name = "NASRequestError";
  }
}

export class NASRequestTimeoutError extends Error {
  constructor(public readonly path: string) {
    super(`NAS ${path} timed out`);
    this.name = "NASRequestTimeoutError";
  }
}

export function isNASAuthenticationError(error: unknown): boolean {
  return error instanceof NASRequestError && error.status === 401;
}

export function getNASBaseURL(): string {
  return `${getBackendBaseURL()}/api/storage`;
}

/** These requests always sent a JSON content type, even without a body. */
const JSON_CONTENT_TYPE = { "Content-Type": "application/json" };

/**
 * Run a request-layer call and re-raise its HTTP failure as this module's
 * ``NASRequestError`` (status + raw body text); other errors pass through.
 */
async function nasCall<T>(
  path: string,
  call: (errorMessage: (failure: ApiFailure) => string) => Promise<unknown>,
): Promise<T> {
  const raised: { error?: NASRequestError } = {};
  try {
    return (await call((failure) => {
      raised.error = new NASRequestError(path, failure.status, failure.text);
      return raised.error.message;
    })) as T;
  } catch (error) {
    if (error instanceof EchoAPIError && raised.error) throw raised.error;
    throw error;
  }
}

interface NASRequestInit {
  method?: HttpMethod;
  /** JSON-serialised by the request layer. */
  body?: unknown;
  signal?: AbortSignal;
}

const NAS_GATEWAY_REASON =
  "the NAS service is reached through the catch-all /api/storage/{storage_path} proxy; its sub-path (slashes and query string) is passed verbatim, which the typed {storage_path} param would percent-encode";

async function request<T>(path: string, init: NASRequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8_000);
  const abortFromCaller = () => controller.abort();
  init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    return await nasCall<T>(path, (errorMessage) =>
      untypedApi[init.method ?? "get"](`/api/storage${path}`, {
        reason: NAS_GATEWAY_REASON,
        body: init.body,
        signal: controller.signal,
        headers: JSON_CONTENT_TYPE,
        errorMessage,
      }),
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new NASRequestTimeoutError(path);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function startNASService(): Promise<NASServiceStartResponse> {
  return looseBody(
    await apiPost("/api/local-brain/storage/start", {
      credentials: "include",
      errorMessage: (failure) =>
        `Storage start failed: ${failure.status}${
          failure.text ? ` - ${failure.text}` : ""
        }`,
    }),
    isNASServiceStartResponse,
  );
}

export function getNASManifest(): Promise<NASManifest> {
  return request("/v1/manifest");
}

export function getNASPolicy(): Promise<NASPolicy> {
  return request("/v1/policy");
}

export function listNASModels(): Promise<NASModel[]> {
  return request("/v1/models");
}

export function downloadNASModel(modelId: string): Promise<NASModel> {
  return request(`/v1/models/${encodeURIComponent(modelId)}/download`, {
    method: "post",
  });
}

export function enableNASModel(modelId: string): Promise<NASModel> {
  return request(`/v1/models/${encodeURIComponent(modelId)}/enable`, {
    method: "post",
  });
}

export function disableNASModel(modelId: string): Promise<NASModel> {
  return request(`/v1/models/${encodeURIComponent(modelId)}/disable`, {
    method: "post",
  });
}

export function updateNASPolicy(policy: NASPolicy): Promise<NASPolicy> {
  return request("/v1/policy", {
    method: "put",
    body: policy,
  });
}

export function listNASSources(): Promise<NASSource[]> {
  return request("/v1/sources");
}

export function listNASDirectory(path: string): Promise<NASDirectoryEntry[]> {
  return request(`/v1/browse?path=${encodeURIComponent(path)}`);
}

export function createNASSource(path: string): Promise<NASSource> {
  return request("/v1/sources", {
    method: "post",
    body: { path },
  });
}

export function deleteNASSource(sourceId: string): Promise<void> {
  return request(`/v1/sources/${encodeURIComponent(sourceId)}`, {
    method: "delete",
  });
}

export function createNASIndexJob(
  sourceIds: string[] = [],
): Promise<NASIndexJob> {
  return request("/v1/index/jobs", {
    method: "post",
    body: { source_ids: sourceIds, full_rescan: false },
  });
}

export function getNASIndexJob(jobId: string): Promise<NASIndexJob> {
  return request(`/v1/index/jobs/${encodeURIComponent(jobId)}`);
}

export function searchNAS(query: string): Promise<NASSearchResponse> {
  return request("/v1/search", {
    method: "post",
    body: { query, top_k: 8, source_ids: [] },
  });
}

export interface NASApp {
  app_id: string;
  name: string;
  path: string;
  category: string;
  bundle_id: string | null;
  icon_available: boolean;
}

export interface NASFileAsset {
  asset_id: string;
  source_id: string;
  name: string;
  path: string;
  extension: string;
  kind: "document" | "image" | "video";
  size: number;
  mtime_ns: number;
  indexed?: boolean;
  ai_labels?: string[];
}

export interface NASAlbum {
  label: string;
  count: number;
  cover_asset_id?: string;
}

export function listNASAlbums(): Promise<NASAlbum[]> {
  return request("/v1/albums");
}

export function listNASApps(): Promise<NASApp[]> {
  return request("/v1/apps");
}

export function openNASApp(
  appId: string,
): Promise<{ ok: boolean; app_id: string }> {
  return request(`/v1/apps/${encodeURIComponent(appId)}/open`, {
    method: "post",
  });
}

export function revealNASApp(
  appId: string,
): Promise<{ ok: boolean; app_id: string }> {
  return request(`/v1/apps/${encodeURIComponent(appId)}/reveal`, {
    method: "post",
  });
}

export function listNASFiles(
  kind: "document" | "image" | "video" = "document",
  limit = 500,
): Promise<NASFileAsset[]> {
  return request(`/v1/files?kind=${kind}&limit=${limit}`);
}

export function getNASAppIconURL(appId: string): string {
  return `${getNASBaseURL()}/v1/apps/${encodeURIComponent(appId)}/icon`;
}

export function getNASFileContentURL(assetId: string): string {
  return `${getNASBaseURL()}/v1/files/${encodeURIComponent(assetId)}/content`;
}

export async function loadNASAssetURL(path: string): Promise<string> {
  // Binary asset read as a blob: no JSON content type and no timeout here.
  const response = await nasCall<Response>(path, (errorMessage) =>
    untypedApi.fetch("get", `/api/storage${path}`, {
      reason: NAS_GATEWAY_REASON,
      errorMessage,
    }),
  );
  return URL.createObjectURL(await response.blob());
}

export function answerNAS(query: string): Promise<NASAnswerResponse> {
  return request("/v1/answer", {
    method: "post",
    body: { query, top_k: 8, source_ids: [] },
  });
}

export interface NASVideoIndexResponse {
  ok: boolean;
  video_count?: number;
  keyframe_count?: number;
  duration_sec?: number;
  incremental?: boolean;
  skipped?: number;
  message?: string;
}

/*
 * The video calls below go to the echo-ai backend (where the video
 * media_router is mounted at `/media`), NOT the NAS storage service — the
 * video semantic index lives in the agent's data dir. They always sent a JSON
 * content type and raise NASRequestError on HTTP failures, but have no timeout.
 */
export function triggerVideoIndex(
  incremental = true,
): Promise<NASVideoIndexResponse> {
  const path = "/media/video/index";
  return nasCall(path, (errorMessage) =>
    apiPost(path, { body: { directory: ".", incremental }, errorMessage }),
  );
}

export interface NASVideoSearchHit {
  video_path: string;
  time_sec: number;
  score: number;
}

export interface NASVideoAppearance {
  video_path: string;
  time_sec: number;
}

export interface NASVideoFaceGroup {
  person: number;
  count_faces: number;
  appearances: NASVideoAppearance[];
}

export interface NASVideoTag {
  label: string;
  score: number;
}

export interface NASVideoClassifyResult {
  video_path: string;
  tags: NASVideoTag[];
}

export interface NASVideoSpeechHit {
  video_path: string;
  start_sec: number;
  end_sec: number;
  text: string;
  score: number;
}

export interface NASVideoOcrHit {
  video_path: string;
  time_sec: number;
  text: string;
  score: number;
}

export interface NASVideoSearchResponse {
  ok: boolean;
  hits: NASVideoSearchHit[];
}

export interface NASVideoFaceGroupsResponse {
  ok: boolean;
  groups: NASVideoFaceGroup[];
}

export interface NASVideoClassifyResponse {
  ok: boolean;
  results: NASVideoClassifyResult[];
}

export interface NASVideoSpeechResponse {
  ok: boolean;
  hits: NASVideoSpeechHit[];
}

export interface NASVideoOcrResponse {
  ok: boolean;
  hits: NASVideoOcrHit[];
}

export function searchVideoByText(
  query: string,
  top_k = 10,
): Promise<NASVideoSearchResponse> {
  const path = "/media/video/search";
  return nasCall(path, (errorMessage) =>
    apiPost(path, { body: { query, directory: ".", top_k }, errorMessage }),
  );
}

export function searchVideoByFace(
  imagePath: string,
  top_k = 10,
): Promise<NASVideoSearchResponse> {
  const path = "/media/video/search/face";
  return nasCall(path, (errorMessage) =>
    apiPost(path, {
      body: { image_path: imagePath, directory: ".", top_k },
      errorMessage,
    }),
  );
}

export function searchVideoByImage(
  imagePath: string,
  top_k = 10,
): Promise<NASVideoSearchResponse> {
  const path = "/media/video/search/image";
  return nasCall(path, (errorMessage) =>
    apiPost(path, {
      body: { image_path: imagePath, directory: ".", top_k },
      errorMessage,
    }),
  );
}

export function searchVideoBySpeech(
  query: string,
  top_k = 10,
): Promise<NASVideoSpeechResponse> {
  const path = "/media/video/search/speech";
  return nasCall(path, (errorMessage) =>
    untypedApi.post(path, {
      reason:
        "VideoSpeechSearchRequest in the OpenAPI snapshot has no top_k field; the client has always sent it",
      body: { query, directory: ".", top_k },
      errorMessage,
    }),
  );
}

export function listVideoFaceGroups(): Promise<NASVideoFaceGroupsResponse> {
  // ``path`` keeps the query string so NASRequestError reads as before.
  const path = "/media/video/faces?directory=.&threshold=0.45";
  return nasCall(path, (errorMessage) =>
    apiGet("/media/video/faces", {
      query: { directory: ".", threshold: 0.45 },
      headers: JSON_CONTENT_TYPE,
      errorMessage,
    }),
  );
}

export function classifyVideoTags(): Promise<NASVideoClassifyResponse> {
  const path = "/media/video/classify";
  return nasCall(path, (errorMessage) =>
    apiPost(path, { body: { directory: ".", top_k: 5 }, errorMessage }),
  );
}

export function ocrVideoKeyframes(
  query: string,
  top_k = 20,
): Promise<NASVideoOcrResponse> {
  const path = "/media/video/ocr";
  return nasCall(path, (errorMessage) =>
    apiPost(path, { body: { query, directory: ".", top_k }, errorMessage }),
  );
}

/**
 * Get the full URL for the video cover image from the agent backend.
 * Covers are generated dynamically on demand from the video file.
 */
export function getVideoCoverURL(videoPath: string, timeSec = 0): string {
  return `${getBackendBaseURL()}/media/video/cover?video_path=${encodeURIComponent(videoPath)}&time_sec=${timeSec}`;
}
