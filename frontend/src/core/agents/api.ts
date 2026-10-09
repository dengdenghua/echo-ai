import { swallow } from "@/core/utils/log";
import {
  EchoAPIError,
  apiFetch,
  apiPost,
  apiPut,
  apiGet,
  failureDetail,
  untypedApi,
  type ApiFailure,
} from "@/core/api/request";
import { getControlPlaneBaseURL } from "@/core/config";

import type { Agent, CreateAgentRequest, UpdateAgentRequest } from "./types";

const BACKEND_UNAVAILABLE_STATUSES = new Set([502, 503, 504]);
const AGENT_LIST_TIMEOUT_MS = 5_000;

/** The body's ``detail`` when present, else ``"<label>: <statusText>"``. */
function detailOr(label: string) {
  return (failure: ApiFailure): string => {
    const detail = failureDetail(failure);
    return detail === undefined || detail === null
      ? `${label}: ${failure.statusText}`
      : String(detail);
  };
}

export class AgentNameCheckError extends Error {
  constructor(
    message: string,
    public readonly reason: "backend_unreachable" | "request_failed",
  ) {
    super(message);
    this.name = "AgentNameCheckError";
  }
}

export async function listAgents(opts?: {
  signal?: AbortSignal;
}): Promise<Agent[]> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(opts?.signal?.reason);
  if (opts?.signal?.aborted) abortFromCaller();
  else opts?.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), AGENT_LIST_TIMEOUT_MS);

  try {
    const data = (await apiGet("/api/agents", {
      baseUrl: getControlPlaneBaseURL(),
      query: { include_visuals: false },
      cache: "no-store",
      signal: controller.signal,
      errorMessage: (f) => `Failed to load agents: ${f.statusText}`,
    })) as Agent[] | { agents?: Agent[] };
    const agents = Array.isArray(data) ? data : (data.agents ?? []);
    // Leon (admin) is a visible squad member. Operation permissions are
    // enforced by the backend for the signed-in user, not by hiding personas.
    return agents;
  } finally {
    clearTimeout(timeout);
    opts?.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function getAgent(
  name: string,
  opts?: { signal?: AbortSignal },
): Promise<Agent> {
  return untypedApi.get<Agent>(`/api/agents/${encodeURIComponent(name)}`, {
    reason: "the cache-busting `v` query param is not declared",
    query: { v: Date.now() },
    cache: "no-store",
    signal: opts?.signal,
    errorMessage: () => `Agent '${name}' not found`,
  });
}

export async function createAgent(request: CreateAgentRequest): Promise<Agent> {
  return (await apiPost("/api/agents", {
    body: request,
    errorMessage: detailOr("Failed to create agent"),
  })) as Agent;
}

export async function updateAgent(
  name: string,
  request: UpdateAgentRequest,
): Promise<Agent> {
  return (await apiPut("/api/agents/{agent_id}", {
    path: { agent_id: name },
    body: request,
    errorMessage: detailOr("Failed to update agent"),
  })) as Agent;
}

export async function generateAgentVisuals(
  name: string,
  request: {
    provider?: string;
    style_prompt?: string;
    reference_images?: string[];
  } = {},
): Promise<GeneratedAgentVisuals> {
  // The contract marks ``visual_urls`` optional; callers have always relied
  // on the server filling it, so keep the narrower client view.
  return (await apiPost("/api/agents/{agent_id}/visuals/generate", {
    path: { agent_id: name },
    body: request,
    errorMessage: detailOr("Failed to generate visuals"),
  })) as GeneratedAgentVisuals;
}

interface GeneratedAgentVisuals {
  agent_id: string;
  provider: string;
  avatar_url?: string | null;
  visual_urls: Record<string, string>;
}

export async function deleteAgent(name: string): Promise<void> {
  await apiFetch("delete", "/api/agents/{agent_id}", {
    path: { agent_id: name },
    errorMessage: (f) => `Failed to delete agent: ${f.statusText}`,
  });
}

export async function checkAgentName(
  name: string,
): Promise<{ available: boolean; name: string }> {
  let res: Response;
  try {
    res = await untypedApi.fetch("get", "/api/agents/check", {
      reason: "the name-check route is not in the OpenAPI snapshot",
      query: { name },
      errorMessage: detailOr("Failed to check agent name"),
    });
  } catch (e) {
    if (e instanceof EchoAPIError && !BACKEND_UNAVAILABLE_STATUSES.has(e.status)) {
      throw new AgentNameCheckError(e.message, "request_failed");
    }
    // Network failure, or a gateway status meaning the backend is down.
    if (!(e instanceof EchoAPIError)) swallow(e);
    throw new AgentNameCheckError(
      "Could not reach the Echo backend.",
      "backend_unreachable",
    );
  }
  return (await res.json()) as { available: boolean; name: string };
}
