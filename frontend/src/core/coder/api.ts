import type { EngineCapabilityChecks } from "@/core/agents/engine-capability-checks";
import type { components } from "@/core/api/openapi-types";
import {
  EchoAPIError,
  apiFetch,
  apiGet,
  apiPost,
  apiPut,
  type ApiFailure,
} from "@/core/api/request";

type CodexSchemas = components["schemas"];
type CodexAccountResponseWire = CodexSchemas["CodexAccountResponse"];
type CodexAccountWire = CodexSchemas["CodexAccountWire"];
type CodexDailyUsageBucketWire = CodexSchemas["CodexDailyUsageBucket"];
type CodexLoginResponseWire = CodexSchemas["CodexLoginResponse"];
type CodexModelWire = CodexSchemas["CodexModelWire"];
type CodexModelsResponseWire = CodexSchemas["CodexModelsResponse"];
type CodexRateLimitBucketWire = CodexSchemas["CodexRateLimitBucket"];
type CodexRateLimitWindowWire = CodexSchemas["CodexRateLimitWindow"];
type CodexRateLimitsResponseWire = CodexSchemas["CodexRateLimitsResponse"];
type CodexUsageResponseWire = CodexSchemas["CodexUsageResponse"];
type CodexUsageSummaryWire = CodexSchemas["CodexUsageSummary"];

/** Product-level source name. The App Server wire value is still `chatgpt`,
 * but that bucket can be authenticated by either ChatGPT or an API key. */
export type CoderModelSource = "follow_system" | "codex_account";
export type CoderLoginType = "chatgpt" | "chatgptDeviceCode" | "apiKey";

export interface CoderAccount extends CodexAccountWire {
  email: string | null;
  plan_type: string | null;
}

export interface CoderAccountState extends Omit<
  CodexAccountResponseWire,
  "account"
> {
  account: CoderAccount | null;
  login_id: string | null;
  login_error: string | null;
}

export type CoderLoginResult = CodexLoginResponseWire;

export interface CoderModelOption extends Omit<
  CodexModelWire,
  "reasoning_efforts" | "input_modalities"
> {
  reasoning_efforts: string[];
  input_modalities: string[];
}

export interface CoderModelsResponse extends Omit<
  CodexModelsResponseWire,
  "models"
> {
  models: CoderModelOption[];
}

export type CoderRateLimitWindow = CodexRateLimitWindowWire;

export interface CoderRateLimitBucket extends Omit<
  CodexRateLimitBucketWire,
  "primary" | "secondary"
> {
  limit_name: string | null;
  primary: CoderRateLimitWindow | null;
  secondary: CoderRateLimitWindow | null;
  plan_type: string | null;
  rate_limit_reached_type: string | null;
}

export interface CoderRateLimits extends Omit<
  CodexRateLimitsResponseWire,
  "buckets"
> {
  buckets: CoderRateLimitBucket[];
  reset_credits_available: number | null;
}

export interface CoderUsage extends Omit<CodexUsageResponseWire, "summary"> {
  summary: CodexUsageSummaryWire & {
    lifetime_tokens: number | null;
    peak_daily_tokens: number | null;
    longest_running_turn_sec: number | null;
    current_streak_days: number | null;
    longest_streak_days: number | null;
  };
  daily_usage_buckets: Array<
    CodexDailyUsageBucketWire & { tokens: number | null }
  >;
}

export interface CoderApp {
  id: string;
  name: string;
  description: string;
  logo_url: string | null;
  install_url: string | null;
  is_accessible: boolean;
  is_enabled: boolean;
  selected: boolean;
}

export interface CoderAppsResponse {
  apps: CoderApp[];
}

export interface CoderModelProfile {
  source: CoderModelSource;
  selected_model: string | null;
  effective_model: string | null;
  system_model: string | null;
  reasoning_effort: string | null;
  model_source: "turn" | "role" | "system" | "codex_default";
  compatible: boolean;
  compatibility_reason: string | null;
  provider: string | null;
  proxy_required: boolean;
  execution_available?: boolean;
  capability_checks?: EngineCapabilityChecks;
  execution_unavailable_reason?: string | null;
}

export interface UpdateCoderModelProfile {
  source: CoderModelSource;
  model?: string;
  reasoning_effort?: string | null;
}

export type CoderUpstreamUpdate = Required<
  CodexSchemas["CodexUpdateStatusResponse"]
>;

export const coderUpstreamUpdateQueryKey = [
  "coder",
  "codex",
  "upstream-update",
] as const;

export class CoderAPIError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "CoderAPIError";
  }
}

/** The error body's ``detail`` (or ``message``) string, else
 * ``"<fallback> (<status>)"`` — this module's historical wording. */
function coderErrorMessage(fallback: string) {
  return (failure: ApiFailure): string => {
    const payload = failure.payload as
      | {
          detail?: unknown;
          message?: unknown;
        }
      | null
      | undefined;
    const detail = payload?.detail ?? payload?.message;
    return typeof detail === "string"
      ? detail
      : `${fallback} (${failure.status})`;
  };
}

/** HTTP failures keep surfacing as ``CoderAPIError`` (callers branch on its
 * ``status``); network errors propagate untouched. */
async function coderRequest<T>(
  fallback: string,
  request: (errorMessage: (failure: ApiFailure) => string) => Promise<T>,
): Promise<T> {
  try {
    return await request(coderErrorMessage(fallback));
  } catch (error) {
    if (error instanceof EchoAPIError) {
      throw new CoderAPIError(error.message, error.status);
    }
    throw error;
  }
}

/** Historically sent on bodiless POSTs too. */
const JSON_CONTENT_TYPE = { "Content-Type": "application/json" };

export async function getCoderAccount(
  signal?: AbortSignal,
): Promise<CoderAccountState> {
  return coderRequest(
    "Coder account unavailable",
    async (errorMessage) =>
      (await apiGet("/api/coder/codex/account", {
        signal,
        errorMessage,
      })) as CoderAccountState,
  );
}

export async function startCoderLogin(
  type: CoderLoginType,
  apiKey?: string,
): Promise<CoderLoginResult> {
  const body: { type: CoderLoginType; api_key?: string } = { type };
  if (type === "apiKey" && apiKey) body.api_key = apiKey;
  return coderRequest("Coder login failed", (errorMessage) =>
    apiPost("/api/coder/codex/login", { body, errorMessage }),
  );
}

export async function cancelCoderLogin(loginId: string): Promise<boolean> {
  const response = await coderRequest(
    "Coder login cancellation failed",
    (errorMessage) =>
      apiFetch("post", "/api/coder/codex/login/{login_id}/cancel", {
        path: { login_id: loginId },
        headers: JSON_CONTENT_TYPE,
        errorMessage,
      }),
  );
  // An empty or non-JSON success body still means "not cancelled".
  const payload = (await response.json().catch(() => null)) as {
    cancelled?: unknown;
  } | null;
  return payload?.cancelled === true;
}

export async function logoutCoderAccount(): Promise<void> {
  await coderRequest("Coder logout failed", (errorMessage) =>
    apiFetch("post", "/api/coder/codex/logout", {
      headers: JSON_CONTENT_TYPE,
      errorMessage,
    }),
  );
}

export async function getCoderModels(
  signal?: AbortSignal,
): Promise<CoderModelsResponse> {
  return coderRequest(
    "Coder models unavailable",
    async (errorMessage) =>
      (await apiGet("/api/coder/codex/models", {
        query: { include_hidden: false },
        signal,
        errorMessage,
      })) as CoderModelsResponse,
  );
}

export async function getCoderRateLimits(
  signal?: AbortSignal,
): Promise<CoderRateLimits> {
  return coderRequest(
    "Coder rate limits unavailable",
    async (errorMessage) =>
      (await apiGet("/api/coder/codex/rate-limits", {
        signal,
        errorMessage,
      })) as CoderRateLimits,
  );
}

export async function getCoderUsage(signal?: AbortSignal): Promise<CoderUsage> {
  return coderRequest(
    "Coder usage unavailable",
    async (errorMessage) =>
      (await apiGet("/api/coder/codex/usage", {
        signal,
        errorMessage,
      })) as CoderUsage,
  );
}

export async function getCoderApps(
  signal?: AbortSignal,
): Promise<CoderAppsResponse> {
  return coderRequest(
    "Coder connectors unavailable",
    async (errorMessage) =>
      (await apiGet("/api/coder/codex/apps", {
        signal,
        errorMessage,
      })) as CoderAppsResponse,
  );
}

export async function updateCoderApps(
  appIds: string[],
): Promise<CoderAppsResponse> {
  return coderRequest(
    "Coder connectors update failed",
    async (errorMessage) =>
      (await apiPut("/api/coder/codex/apps", {
        body: { app_ids: appIds },
        errorMessage,
      })) as CoderAppsResponse,
  );
}

export async function getCoderModelProfile(
  signal?: AbortSignal,
): Promise<CoderModelProfile> {
  return coderRequest("Coder model profile unavailable", async (errorMessage) =>
    normalizeModelProfile(
      await apiGet("/api/coder/codex/model-profile", {
        signal,
        errorMessage,
      }),
    ),
  );
}

export async function updateCoderModelProfile(
  input: UpdateCoderModelProfile,
): Promise<CoderModelProfile> {
  return coderRequest(
    "Coder model profile update failed",
    async (errorMessage) =>
      normalizeModelProfile(
        // Keep reads and writes on the same origin: cookie-backed sessions
        // cannot authenticate an alternate localhost/127.0.0.1 host.
        await apiPut("/api/coder/codex/model-profile", {
          body: {
            mode:
              input.source === "codex_account" ? "chatgpt" : "follow_system",
            ...(input.model ? { model: input.model } : {}),
            ...(input.reasoning_effort !== undefined
              ? { reasoning_effort: input.reasoning_effort }
              : {}),
          },
          errorMessage,
        }),
      ),
  );
}

export async function getCoderUpstreamUpdate(
  signal?: AbortSignal,
): Promise<CoderUpstreamUpdate> {
  return coderRequest(
    "Codex update status unavailable",
    async (errorMessage) =>
      (await apiGet("/api/coder/codex/upstream-update", {
        signal,
        errorMessage,
      })) as CoderUpstreamUpdate,
  );
}

export async function checkCoderUpstreamUpdate(): Promise<CoderUpstreamUpdate> {
  return coderRequest(
    "Codex update check failed",
    async (errorMessage) =>
      (await apiPost("/api/coder/codex/upstream-update/check", {
        errorMessage,
      })) as CoderUpstreamUpdate,
  );
}

export async function approveCoderUpstreamUpdate(
  version: string,
): Promise<CoderUpstreamUpdate> {
  return coderRequest(
    "Codex update approval failed",
    async (errorMessage) =>
      (await apiPost("/api/coder/codex/upstream-update/approve", {
        body: { version },
        errorMessage,
      })) as CoderUpstreamUpdate,
  );
}

function normalizeModelProfile(payload: unknown): CoderModelProfile {
  const row = (payload ?? {}) as Record<string, unknown>;
  const rawModelSource = row.model_source;
  return {
    source: row.mode === "chatgpt" ? "codex_account" : "follow_system",
    selected_model:
      typeof row.selected_model === "string" ? row.selected_model : null,
    effective_model:
      typeof row.effective_model === "string" ? row.effective_model : null,
    system_model:
      typeof row.system_model === "string" ? row.system_model : null,
    reasoning_effort:
      typeof row.reasoning_effort === "string" ? row.reasoning_effort : null,
    model_source:
      rawModelSource === "turn" ||
      rawModelSource === "role" ||
      rawModelSource === "system" ||
      rawModelSource === "codex_default"
        ? rawModelSource
        : "codex_default",
    compatible: row.compatible === true,
    compatibility_reason:
      typeof row.compatibility_reason === "string"
        ? row.compatibility_reason
        : null,
    provider: typeof row.provider === "string" ? row.provider : null,
    proxy_required: row.proxy_required === true,
    execution_available: row.execution_available === true,
    capability_checks:
      row.capability_checks as CoderModelProfile["capability_checks"],
    execution_unavailable_reason:
      typeof row.execution_unavailable_reason === "string"
        ? row.execution_unavailable_reason
        : null,
  };
}

/**
 * Coder's model source is owned by its principal-scoped model profile. Remove
 * ordinary conversation-picker overrides before the realtime hook can copy
 * them into top-level App Server fields. The backend repeats this check as an
 * authorization boundary; this client-side projection keeps the wire honest.
 */
export function applyCoderModelProfileBoundary<
  T extends Record<string, unknown>,
>(
  agentId: string | null | undefined,
  context: T,
  executionEngine?: "echo" | "codex" | "opencode",
): T {
  if (executionEngine === "opencode") return context;
  if (executionEngine !== "codex" && agentId !== "coder") return context;
  const next = { ...context };
  delete next.model_name;
  delete next.reasoning_effort;
  delete next.partner_model;
  return next;
}

export function coderQueryKeys(principalKey: string) {
  const principal = principalKey.trim() || "local";
  const root = ["coder", "codex", principal] as const;
  return {
    root,
    account: [...root, "account"] as const,
    models: [...root, "models"] as const,
    rateLimits: [...root, "rate-limits"] as const,
    usage: [...root, "usage"] as const,
    apps: [...root, "apps"] as const,
    profile: [...root, "model-profile"] as const,
    upstreamUpdate: coderUpstreamUpdateQueryKey,
  };
}
