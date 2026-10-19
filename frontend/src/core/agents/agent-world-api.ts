import {
  EchoAPIError,
  apiDelete,
  apiFetch,
  apiGet,
  apiPost,
  failureDetail,
  untypedApi,
  type ApiFailure,
} from "@/core/api/request";

import type {
  AgentWorldAgent,
  AgentWorldListParams,
  AgentWorldListResponse,
  AgentProfile,
  AgentMemory,
  AgentRating,
  AgentRelationship,
} from "./types";
import { looseBody } from "@/core/api/response";
import * as guards from "./agent-world-guards";

const AGENT_MARKET_API = "/api/agent-market";

// Error wording helpers — each keeps the message the call site used before
// the move to the typed request layer.


/** ``"<label>: <statusText>"`` */
function statusText(label: string) {
  return (f: ApiFailure): string => `${label}: ${f.statusText}`;
}

/** Refresh the local agent roster; failures are deliberately ignored. */
function reloadAgents(): Promise<unknown> {
  return apiFetch("post", "/api/agents/reload").catch(() => undefined);
}

export interface AgentInstallResult {
  installed: boolean;
  agent_id: string;
  key_skills?: string[];
  available_skills?: string[];
  registered_skills?: number;
  tool_registry?: string;
}

// ---------------------------------------------------------------------------
// WorkBuddy 专家商城 · 云端源(替换第三方 octoapk 角色商城)
// 后端: runtime/platform/plugins/cloud_expert_store.py
//   GET  /api/agent-market/cloud/store
//   GET  /api/agent-market/cloud/store/categories
//   POST /api/agent-market/cloud/store/{id}/install
// ---------------------------------------------------------------------------

export interface CloudExpertAgent {
  id: string;
  name: string;
  display_name: string;
  description: string;
  author: string;
  category: string;
  category_id?: string;
  tags: string[];
  icon: string;
  avatar_url?: string;
  is_team?: boolean;
  is_installed?: boolean;
  bundle_url?: string;
  quick_prompts?: string[];
  profession?: string;
  source?: string;
  created_at?: string;
}

export interface CloudStoreResponse {
  agents: CloudExpertAgent[];
  total: number;
  page: number;
  page_size: number;
}

export interface CloudStoreCategory {
  id: string;
  name: { en: string; zh: string };
  description?: { en?: string; zh?: string };
}

export interface CloudStoreCategoriesResponse {
  categories: CloudStoreCategory[];
  meta?: Record<string, unknown>;
}

export interface CloudStoreInstallResult {
  installed: boolean;
  already_exists?: boolean;
  agent_id?: string;
  agent_name?: string;
  agent_path?: string;
  copied_skills?: string[];
  warnings?: string[];
  message?: string;
}

/** 拉取云端 WorkBuddy 专家商城(421 位)。refresh=1 强制清缓存重拉。 */
export async function listCloudStoreExperts(
  params: {
    category?: string;
    search?: string;
    sort?: string;
    refresh?: boolean;
    limit?: number;
  } = {},
): Promise<CloudStoreResponse> {
  return looseBody(await apiGet("/api/agent-market/cloud/store", {
    query: {
      category: params.category || undefined,
      search: params.search || undefined,
      sort: params.sort || undefined,
      refresh: params.refresh ? 1 : undefined,
      limit: params.limit ?? 500,
    },
    errorMessage: httpStatus("WorkBuddy cloud store failed"),
  }), guards.isCloudStoreResponse);
}

/** 拉取云端商城分类(15 大类)。 */
export async function listCloudStoreCategories(): Promise<CloudStoreCategoriesResponse> {
  return looseBody(await apiGet("/api/agent-market/cloud/store/categories", {
    errorMessage: httpStatus("WorkBuddy cloud categories failed"),
  }), guards.isCloudStoreCategoriesResponse);
}

/** 安装云端专家:后端下载 bundle → 解包 → 导入为本地 agent。 */
export async function installCloudExpert(
  expertId: string,
): Promise<CloudStoreInstallResult> {
  return looseBody(await apiPost("/api/agent-market/cloud/store/{expert_id}/install", {
    path: { expert_id: expertId },
    errorMessage: httpBody("WorkBuddy install failed"),
  }), guards.isCloudStoreInstallResult);
}

/** 云商城插件目录(我们发布到 GitHub Pages 的 plugin-store.json)。 */
export interface CloudPluginItem {
  id: string;
  plugin: string;
  source: string;
  kind: string;
  name: string;
  name_zh: string;
  description: string;
  category?: string;
  author?: string;
  version?: string;
  skills?: string[];
  connectors?: string[];
  skills_count?: number;
  type?: string;
  auth_mode?: string;
  mcp_servers?: { name?: string; url?: string }[];
  examples_zh?: string[];
  /** UI mount points contributed by an installed plugin. */
  surface_capabilities?: string[];
}

export interface CloudPluginsResponse {
  items: CloudPluginItem[];
  total: number;
  meta?: {
    count?: number;
    codex_plugins?: number;
    workbuddy_connectors?: number;
  };
}

export async function fetchCloudPlugins(
  opts: {
    search?: string;
    kind?: string;
    limit?: number;
  } = {},
): Promise<CloudPluginsResponse> {
  return looseBody(await apiGet("/api/agent-market/cloud/plugins", {
    query: {
      search: opts.search || undefined,
      kind: opts.kind || undefined,
      limit: opts.limit ?? 500,
    },
    errorMessage: httpStatus("Cloud plugins failed"),
  }), guards.isCloudPluginsResponse);
}

/** 云商城技能目录(我们发布到 GitHub Pages 的 skill-registry.json)。 */
export interface CloudSkillItem {
  original_name?: string;
  catalog_only?: boolean;
  external?: boolean;
  repository?: string;
  source_url?: string;
  license?: string;
  compatibility?: string;
  search_match?: string;
  name: string;
  display_name?: string;
  aliases?: string[];
  version?: string;
  author?: string;
  description: string;
  tags?: string[];
  source?: string;
  download_url?: string;
}

export interface CloudSkillsResponse {
  items: CloudSkillItem[];
  total: number;
  meta?: {
    count?: number;
    workbuddy_skills?: number;
    echo_skills?: number;
    sources?: Array<{ source: string; state: string; count: number }>;
  };
}

export async function fetchCloudSkills(
  opts: {
    search?: string;
    limit?: number;
    source?: "external";
    signal?: AbortSignal;
  } = {},
): Promise<CloudSkillsResponse> {
  const items: CloudSkillItem[] = [];
  let page: CloudSkillsResponse;
  do {
    page = looseBody(await apiGet("/api/agent-market/cloud/skills", {
      query: {
        search: opts.search || undefined,
        source: opts.source || undefined,
        limit: opts.limit ?? 500,
        offset: items.length,
      },
      signal: opts.signal,
      errorMessage: httpStatus("Cloud skills failed"),
    }), guards.isCloudSkillsResponse);
    if (!page.items.length) break;
    items.push(...page.items);
  } while (items.length < page.total);
  return { ...page, items };
}

/** 云端已安装状态(本地已落地的技能/插件)。 */
export interface CloudInstalledStatus {
  skills: string[];
  skill_users?: Record<
    string,
    Array<{ id: string; name: string; avatar_url?: string; icon?: string }>
  >;
  local_skills?: UnifiedAsset[];
  skill_states?: Record<
    string,
    { enabled: boolean; can_toggle: boolean; can_uninstall: boolean }
  >;
  plugins: string[];
  plugin_states?: Record<string, RuntimePluginStatus>;
}

export async function manageCloudSkill(
  name: string,
  action: "enable" | "disable" | "uninstall",
): Promise<unknown> {
  return apiPost("/api/agent-market/cloud/skills/{name}/manage", {
    path: { name },
    body: { action },
    errorMessage: (f) => {
      const detail = failureDetail(f);
      return detail ? String(detail) : `技能管理失败：HTTP ${f.status}`;
    },
  });
}

// Installed status scans local skills, roles and plugin health and can take
// several seconds; bound it so callers always leave their pending state.
const CLOUD_INSTALLED_TIMEOUT_MS = 30_000;

export async function fetchCloudInstalled(): Promise<CloudInstalledStatus> {
  return looseBody(await apiGet("/api/agent-market/cloud/installed", {
    signal: AbortSignal.timeout(CLOUD_INSTALLED_TIMEOUT_MS),
    errorMessage: httpStatus("Cloud installed status failed"),
  }), guards.isCloudInstalledStatus);
}

/** Workbench navigation needs only this package's current lifecycle checks. */
export async function fetchWorkbenchInstalled(
  packageId: string,
): Promise<Pick<CloudInstalledStatus, "plugins" | "plugin_states">> {
  return looseBody(await apiGet("/api/agent-market/cloud/installed", {
    query: { package_id: packageId },
    errorMessage: httpStatus("Workbench installed status failed"),
  }), guards.hasPlugins);
}

export interface CloudSkillInstallResult {
  installed: boolean;
  already_exists?: boolean;
  name: string;
  path: string;
  source?: string;
}

export interface CloudPluginInstallResult {
  installed: boolean;
  plugin_id: string;
  kind?: string;
  path: string;
  copied_skills?: string[];
  source?: string;
  operation?: "install" | "update" | string;
  transaction_id?: string | null;
  rollback_available?: boolean;
  data?: CloudPluginUninstallResult["data"];
  recoveries?: RuntimePluginStatus["recoveries"];
}

export interface CloudPluginUninstallResult {
  uninstalled: boolean;
  plugin_id: string;
  kind?: string;
  removed_skills?: string[];
  restart_required?: boolean;
  data?: {
    status?: "kept" | "trashed" | "missing" | "restored";
    recovery_id?: string;
    path?: string;
  };
}

export interface RuntimePluginStatus {
  id?: string;
  name?: string;
  plugin_id?: string;
  installed: boolean;
  enabled: boolean;
  loaded?: boolean;
  started?: boolean;
  source?: "factory" | "external" | string;
  restart_required?: boolean;
  data_state?: string;
  lifecycle_state?:
    | "available"
    | "downloading"
    | "installed"
    | "enabling"
    | "enabled"
    | "disabling"
    | "disabled"
    | "uninstalling"
    | "update_available"
    | "broken"
    | "incompatible";
  error?: string | null;
  version?: string;
  available_version?: string;
  rollback_available?: boolean;
  transaction_id?: string | null;
  rollback_operation?: "install" | "update" | string | null;
  recoveries?: Array<{
    recovery_id: string;
    created_at?: string | number;
    path?: string;
  }>;
}

/** 从云端安装技能(下载内容包 → 解包 → 落到 ~/.echo/skills)。 */
export async function installCloudSkill(
  name: string,
): Promise<CloudSkillInstallResult> {
  return looseBody(await apiPost("/api/agent-market/cloud/skills/{name}/install", {
    path: { name },
    errorMessage: httpBody("云技能安装失败"),
  }), guards.isCloudSkillInstallResult);
}

export interface CloudSkillInstallProgress {
  phase: "resolving" | "installing" | "indexing" | "completed" | "failed";
  progress: number;
  message: string;
  result?: CloudSkillInstallResult;
}

/** Install a cloud skill while consuming observable NDJSON progress events. */
export async function streamInstallCloudSkill(
  name: string,
  onProgress: (event: CloudSkillInstallProgress) => void,
): Promise<CloudSkillInstallResult> {
  // NDJSON stream: take the raw Response and read its body incrementally.
  const res = await apiFetch(
    "post",
    "/api/agent-market/cloud/skills/{name}/install/stream",
    { path: { name }, errorMessage: httpBody("云技能安装失败") },
  );
  if (!res.body) throw new Error("云技能安装流不可用");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: CloudSkillInstallResult | undefined;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as CloudSkillInstallProgress;
    onProgress(event);
    if (event.phase === "failed") throw new Error(event.message);
    if (event.result) result = event.result;
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
    if (done) break;
  }
  consumeLine(buffer);
  if (!result) throw new Error("云技能安装流未返回完成结果");
  return result;
}

/** 从云端安装插件/连接器(下载内容包 → 解包 → 落地 + 复制捆绑技能)。 */
export async function installCloudPlugin(
  pluginId: string,
  options: { restoreData?: boolean; recoveryId?: string } = {},
): Promise<CloudPluginInstallResult> {
  return looseBody(await apiPost("/api/agent-market/cloud/plugins/{plugin_id}/install", {
    path: { plugin_id: pluginId },
    body: {
      enabled: true,
      restore_data: Boolean(options.restoreData),
      ...(options.recoveryId ? { recovery_id: options.recoveryId } : {}),
    },
    // The backend explains download/compatibility failures in `detail`; show
    // that sentence instead of the raw JSON body. Non-JSON gateway responses
    // fall through to the generic message.
    errorMessage: (f) => {
      const detail = failureDetail(f);
      return (
        (typeof detail === "string" ? detail : "") ||
        httpBody("云插件安装失败")(f)
      );
    },
  }), guards.isCloudPluginInstallResult);
}

/** Remove only a mutable cloud-installed package; bundled/core code is never targeted. */
export async function uninstallCloudPlugin(
  pluginId: string,
  options: { dataPolicy?: "keep" | "trash"; confirmDataMove?: boolean } = {},
): Promise<CloudPluginUninstallResult> {
  return looseBody(await apiDelete(
    "/api/agent-market/cloud/plugins/{plugin_id}/install",
    {
      path: { plugin_id: pluginId },
      query: {
        data_policy: options.dataPolicy ?? "keep",
        confirm_data_move: Boolean(options.confirmDataMove),
      },
      errorMessage: httpBody("云插件卸载失败"),
    },
  ), guards.isCloudPluginUninstallResult);
}

export async function fetchRuntimePluginStatus(
  pluginName: string,
): Promise<RuntimePluginStatus> {
  return looseBody(await apiGet("/api/plugin-hub/plugins/{name}", {
    path: { name: pluginName },
    errorMessage: httpBody("插件状态读取失败"),
  }), guards.isRuntimePluginStatus);
}

/**
 * Read every runtime plugin in one request.
 *
 * Workbench availability is an inventory view: probing each optional plugin
 * with the detail endpoint turns a normal "not installed" state into one 404
 * per app. The list endpoint already includes the same lifecycle fields and
 * lets callers distinguish absence without using failed requests as control
 * flow.
 */
export async function fetchRuntimePluginStatuses(): Promise<
  Map<string, RuntimePluginStatus>
> {
  const rows = looseBody(await apiGet("/api/plugin-hub/plugins", {
    errorMessage: httpBody("插件状态清单读取失败"),
  }), guards.isRuntimePluginStatusList);
  return new Map(
    rows.flatMap((row) => {
      const key = row.plugin_id ?? row.id ?? row.name;
      return key ? [[key, row] as const] : [];
    }),
  );
}

export async function setRuntimePluginEnabled(
  pluginName: string,
  enabled: boolean,
): Promise<RuntimePluginStatus> {
  const options = {
    path: { name: pluginName },
    errorMessage: httpBody(`插件${enabled ? "启用" : "停用"}失败`),
  };
  return looseBody(await (enabled
    ? apiPost("/api/plugin-hub/plugins/{name}/enable", options)
    : apiPost(
        "/api/plugin-hub/plugins/{name}/disable",
        options,
      )), guards.isRuntimePluginStatus);
}

/** Activate/deactivate any remote workbench, including frontend-only packages. */
export async function setCloudPluginEnabled(
  pluginId: string,
  enabled: boolean,
): Promise<RuntimePluginStatus> {
  return looseBody(await apiPost("/api/agent-market/cloud/plugins/{plugin_id}/{action}", {
    path: { plugin_id: pluginId, action: enabled ? "enable" : "disable" },
    errorMessage: httpBody(`应用${enabled ? "启用" : "停用"}失败`),
  }), guards.isRuntimePluginStatus);
}

export interface CloudPluginRollbackResult {
  ok: boolean;
  plugin_id: string;
  installed: boolean;
  operation: "restored_previous" | "removed_new_install" | string;
  transaction_id: string;
  restart_required?: boolean;
}

/** Restore the package generation replaced by the latest successful update. */
export async function rollbackCloudPlugin(
  pluginId: string,
  transactionId?: string,
): Promise<CloudPluginRollbackResult> {
  return looseBody(await apiPost(
    "/api/agent-market/cloud/plugins/{plugin_id}/rollback",
    {
      path: { plugin_id: pluginId },
      body: transactionId ? { transaction_id: transactionId } : {},
      errorMessage: httpBody("应用回滚失败"),
    },
  ), guards.isCloudPluginRollbackResult);
}

// ---------------------------------------------------------------------------
// Store – browse & search
// ---------------------------------------------------------------------------

export async function listStoreAgents(
  params: AgentWorldListParams = {},
): Promise<AgentWorldListResponse> {
  // Featured agents use a dedicated endpoint
  if (params.featured) {
    return looseBody(await apiGet("/api/agent-market/store/featured", {
      query: { limit: params.page_size || undefined },
      errorMessage: statusText("Failed to load featured agents"),
    }), guards.isAgentWorldListResponse);
  }

  return looseBody(await apiGet("/api/agent-market/store", {
    query: {
      category: params.category || undefined,
      search: params.search || undefined,
      sort: params.sort_by || undefined,
      offset:
        params.page !== undefined
          ? ((params.page ?? 1) - 1) * (params.page_size ?? 50)
          : undefined,
      limit: params.page_size,
    },
    errorMessage: statusText("Failed to load store agents"),
  }), guards.isAgentWorldListResponse);
}

// ── 企业版角色资产(消费侧)─────────────────────
export type EnterpriseAsset = {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  icon: string;
  source: string;
  kind: string;
};

export type EnterpriseAssetsResponse = {
  available: boolean;
  items: EnterpriseAsset[];
  error?: string | null;
};

/** 列举企业版托管的角色资产。未配 ECHO_ENTERPRISE_URL → available:false。 */
export async function listEnterpriseAssets(
  params: { category?: string; search?: string } = {},
): Promise<EnterpriseAssetsResponse> {
  try {
    return looseBody(await apiGet("/api/agent-market/enterprise", {
      query: {
        category: params.category || undefined,
        search: params.search || undefined,
      },
    }), guards.isEnterpriseAssetsResponse);
  } catch (error) {
    // Any HTTP failure means "enterprise catalog unavailable"; network
    // errors still propagate as before.
    if (error instanceof EchoAPIError) return { available: false, items: [] };
    throw error;
  }
}

/** 把企业版角色导入本地(后端 scaffold + load+register),并刷新本地角色名册。 */
export async function installEnterpriseAsset(
  id: string,
): Promise<{ installed: boolean; agent_id: string; name?: string }> {
  const result = looseBody(await apiPost(
    "/api/agent-market/enterprise/{asset_id}/install",
    { path: { asset_id: id }, errorMessage: statusText("安装失败") },
  ), guards.hasInstalled);
  await reloadAgents();
  return result;
}

export async function getStoreAgent(id: string): Promise<AgentWorldAgent> {
  return looseBody(await apiGet("/api/agent-market/store/{agent_id}", {
    path: { agent_id: id },
    errorMessage: statusText("Agent not found"),
  }), guards.isAgentWorldAgent);
}

// ---------------------------------------------------------------------------
// Install / Uninstall
// ---------------------------------------------------------------------------

export async function installAgent(id: string): Promise<AgentInstallResult> {
  const result = looseBody(await apiPost("/api/agent-market/store/{agent_id}/install", {
    path: { agent_id: id },
    errorMessage: statusText("Failed to install agent"),
  }), guards.isAgentInstallResult);
  await reloadAgents();
  return result;
}

export async function uninstallAgent(id: string): Promise<void> {
  await apiFetch("delete", "/api/agent-market/store/{agent_id}/install", {
    path: { agent_id: id },
    errorMessage: statusText("Failed to uninstall agent"),
  });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getAgentProfile(
  agentName: string,
): Promise<AgentProfile> {
  return looseBody(await apiGet("/api/agent-market/profile/{agent_name}", {
    path: { agent_name: agentName },
    errorMessage: statusText("Failed to load agent profile"),
  }), guards.isAgentProfile);
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export async function listAgentMemories(
  agentName: string,
): Promise<AgentMemory[]> {
  const data = looseBody(await apiGet("/api/agent-market/memory/{agent_name}", {
    path: { agent_name: agentName },
    errorMessage: statusText("Failed to load agent memories"),
  }), guards.hasMemories);
  return data.memories;
}

export async function addAgentMemory(
  agentName: string,
  memory: { memory_type: AgentMemory["memory_type"]; content: string },
): Promise<AgentMemory> {
  return untypedApi.post<AgentMemory>(
    `${AGENT_MARKET_API}/memory/${agentName}/remember`,
    {
      reason: "memory write routes are not in the OpenAPI snapshot",
      body: memory,
      errorMessage: statusText("Failed to add memory"),
    },
  );
}

export async function deleteAgentMemory(
  agentName: string,
  memoryId: string,
): Promise<void> {
  await untypedApi.fetch(
    "delete",
    `${AGENT_MARKET_API}/memory/${agentName}/${memoryId}`,
    {
      reason: "memory write routes are not in the OpenAPI snapshot",
      errorMessage: statusText("Failed to delete memory"),
    },
  );
}

// ---------------------------------------------------------------------------
// Implementation note.
// ---------------------------------------------------------------------------

export type JournalMood =
  | "insight"
  | "mistake"
  | "pride"
  | "tired"
  | "question";

export interface AgentJournalEntry {
  timestamp: string;
  thread_id: string | null;
  title: string;
  body: string;
  mood: JournalMood;
  /**
   * True when the backend sanitiser redacted the body because it looked like
   * it quoted private user content (names, emails, long verbatim quotes).
   * The `body` field in that case is a neutral placeholder; callers should
   * render a hint so the user knows the entry was dropped on purpose.
   */
  body_redacted?: boolean;
}

export async function listAgentJournal(
  agentName: string,
  limit = 50,
): Promise<AgentJournalEntry[]> {
  const data = await untypedApi.get<{ entries: AgentJournalEntry[] }>(
    `/api/agents/${agentName}/journal`,
    {
      reason: "the agent journal route is not in the OpenAPI snapshot",
      query: { limit },
      errorMessage: statusText("Failed to load agent journal"),
    },
  );
  return data.entries;
}

// ---------------------------------------------------------------------------
// Ratings / Reviews
// ---------------------------------------------------------------------------

export async function listAgentRatings(
  agentId: string,
): Promise<AgentRating[]> {
  const data = looseBody(await apiGet("/api/agent-market/store/{agent_id}/ratings", {
    path: { agent_id: agentId },
    errorMessage: statusText("Failed to load ratings"),
  }), guards.hasRatings);
  return data.ratings;
}

export async function submitAgentRating(
  agentId: string,
  rating: { rating: number; review_text?: string },
): Promise<AgentRating> {
  return untypedApi.post<AgentRating>(
    `${AGENT_MARKET_API}/store/${agentId}/rate`,
    {
      reason: "the rating write route is not in the OpenAPI snapshot",
      body: rating,
      errorMessage: statusText("Failed to submit rating"),
    },
  );
}

// ---------------------------------------------------------------------------
// Social / Relationships
// ---------------------------------------------------------------------------

export async function listAgentRelationships(
  agentName: string,
): Promise<AgentRelationship[]> {
  const data = looseBody(await apiGet(
    "/api/agent-market/social/{agent_name}/relationships",
    {
      path: { agent_name: agentName },
      errorMessage: statusText("Failed to load relationships"),
    },
  ), guards.hasRelationships);
  return data.relationships;
}

import type { UnifiedAsset } from "./agent-world-capabilities";
import { httpBody, httpStatus } from "./agent-world-capabilities";
// 统一能力包市场 API 已拆分至 agent-world-capabilities.ts —— 保留再导出，import 点不变。
export type {
  CapabilitySource,
  MCPEndpoint,
  CapabilityInfo,
  CapabilityListResponse,
  CapabilityDeviceFlow,
  CapabilityConnectResult,
  CapabilityDeviceFlowStatus,
  CapabilityInstallPlan,
  UnifiedAssetKind,
  UnifiedAssetSource,
  UnifiedAsset,
  UnifiedAssetsSummary,
  UnifiedAssetsResponse,
} from "./agent-world-capabilities";
export {
  getCapabilityInstallPlan,
  listCapabilities,
  loadCapabilityIcon,
  installCapability,
  uninstallCapability,
  setCapabilityEnabled,
  getCapabilityStatus,
  connectCapability,
  getCapabilityDeviceFlow,
  cancelCapabilityDeviceFlow,
  disconnectCapability,
  fetchUnifiedAssets,
  syncUnifiedAssets,
} from "./agent-world-capabilities";
