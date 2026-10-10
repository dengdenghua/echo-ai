import { swallow } from "@/core/utils/log";
import {
  EchoAPIError,
  apiGet,
  apiPost,
  failureDetail,
} from "@/core/api/request";
import type { SubagentRouteDecision } from "@/core/parallel-agents/api";
import { looseBody } from "@/core/api/response";
import { hasJobs, isResearchJob } from "./guards";

export type ResearchDepth = "quick" | "standard" | "deep";

export type ResearchSourceProvider =
  | "web_search"
  | "fetch_url"
  | "uploaded_file"
  | "local_file"
  | "manual_material";

export type ResearchSourceKind =
  | "web"
  | "news"
  | "academic"
  | "company_site"
  | "ecommerce"
  | "social"
  | "forum"
  | "uploaded_file"
  | "provided_url"
  | "local_file";

export interface ResearchMaterial {
  id: string;
  kind: "file" | "url" | "text" | "site";
  title: string;
  path?: string | null;
  url?: string | null;
  text?: string | null;
  notes?: string | null;
}

export interface ResearchSource {
  id: string;
  kind: ResearchSourceKind;
  label: string;
  query_hint: string;
  provider: ResearchSourceProvider;
  query_templates: string[];
  site_filters: string[];
  freshness_days?: number | null;
  url?: string | null;
  enabled: boolean;
}

export interface ResearchEvidence {
  id: string;
  job_id?: string | null;
  step_id?: string | null;
  role_id?: string | null;
  title: string;
  url?: string | null;
  source_kind?: ResearchSourceKind | null;
  published_at?: string | null;
  quote_or_summary: string;
  claim: string;
  stance: "support" | "contradict" | "context";
  confidence: number;
}

export interface ResearchPrefetchLog {
  id: string;
  source_id?: string | null;
  source_kind?: ResearchSourceKind | null;
  source_label: string;
  provider: ResearchSourceProvider;
  action: "search" | "fetch" | "material" | "skip";
  query?: string | null;
  url?: string | null;
  status: "completed" | "failed" | "skipped";
  result_count: number;
  evidence_count: number;
  error?: string | null;
  created_at: string;
}

export interface ResearchRole {
  id: string;
  name: string;
  subagent_name: string;
  focus: string;
  deliverable: string;
  search_angles: string[];
}

export interface ResearchStep {
  id: string;
  title: string;
  role_id: string;
  status: "pending" | "running" | "completed" | "failed";
  source_ids: string[];
  expected_searches: number;
  prompt: string;
  route_decision?: SubagentRouteDecision | null;
}

export interface ResearchJob {
  job_id: string;
  thread_id?: string | null;
  lead_agent_name?: string | null;
  topic: string;
  status: "planned" | "running" | "completed" | "failed" | "cancelled";
  depth: ResearchDepth;
  locale: string;
  created_at: string;
  materials: ResearchMaterial[];
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
  prefetch_logs: ResearchPrefetchLog[];
  route_decisions?: SubagentRouteDecision[];
  roles: ResearchRole[];
  steps: ResearchStep[];
  max_searches: number;
  dispatch_batch_id?: string | null;
  final_report_format: string;
  final_report?: string | null;
  completed_at?: string | null;
  memory_entry?: string | null;
  memory_written_at?: string | null;
  memory_path?: string | null;
}

export interface DeepResearchRequest {
  topic: string;
  thread_id?: string | null;
  lead_agent_name?: string | null;
  depth?: ResearchDepth;
  locale?: string;
  materials?: Partial<ResearchMaterial>[];
  urls?: string[];
  source_kinds?: ResearchSourceKind[];
  roles?: ResearchRole[];
  max_subagents?: number;
  max_searches?: number;
  include_thread_uploads?: boolean;
  prefetch_sources?: boolean;
  task_risk_level?: "low" | "medium" | "high" | "critical" | null;
  final_report_format?: "markdown" | "brief" | "slides_outline";
}

/** The client sent ``Content-Type: application/json`` on these bodiless GETs. */
const JSON_CONTENT_TYPE = { "Content-Type": "application/json" };

async function postResearch(
  path: "/api/research/deep/plan" | "/api/research/deep/start",
  body: DeepResearchRequest,
): Promise<ResearchJob> {
  return looseBody(
    await apiPost(path, {
      body,
      errorMessage: (failure) => {
        const detail = failureDetail(failure);
        return detail === undefined || detail === null
          ? `Deep research request failed: ${failure.status}`
          : String(detail);
      },
    }),
    isResearchJob,
  );
}

export function planDeepResearch(
  body: DeepResearchRequest,
): Promise<ResearchJob> {
  return postResearch("/api/research/deep/plan", body);
}

export function startDeepResearch(
  body: DeepResearchRequest,
): Promise<ResearchJob> {
  return postResearch("/api/research/deep/start", body);
}

export async function fetchDeepResearchJob(
  jobId: string,
): Promise<ResearchJob | null> {
  try {
    return looseBody(
      await apiGet("/api/research/deep/jobs/{job_id}", {
        path: { job_id: jobId },
        headers: JSON_CONTENT_TYPE,
      }),
      isResearchJob,
    );
  } catch (e) {
    // Any HTTP failure means "no job" (silently, as before); network and
    // parse errors are swallowed too.
    if (!(e instanceof EchoAPIError)) swallow(e);
    return null;
  }
}

export async function listDeepResearchJobs(): Promise<ResearchJob[]> {
  try {
    const data = looseBody(
      await apiGet("/api/research/deep/jobs", {
        headers: JSON_CONTENT_TYPE,
      }),
      hasJobs,
    );
    return data.jobs ?? [];
  } catch (e) {
    // Any HTTP failure means "no jobs" (silently, as before); network and
    // parse errors are swallowed too.
    if (!(e instanceof EchoAPIError)) swallow(e);
    return [];
  }
}
