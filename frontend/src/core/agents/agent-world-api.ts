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

const AGENT_MARKET_API = "/api/agent-market";

// Error wording helpers — each keeps the message the call site used before
// the move to the typed request layer.

/** ``"<label>: HTTP <status>"`` */
function httpStatus(label: string) {
  return (f: ApiFailure): string => `${label}: HTTP ${f.status}`;
}

/** ``"<label>: HTTP <status> <body>"``, trimmed. */
function httpBody(label: string) {
  return (f: ApiFailure): string =>
    `${label}: HTTP ${f.status} ${f.text}`.trim();
}

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
  return (await apiGet("/api/agent-market/cloud/store", {
    query: {
      category: params.category || undefined,
      search: params.search || undefined,
      sort: params.sort || undefined,
      refresh: params.refresh ? 1 : undefined,
      limit: params.limit ?? 500,
    },
    errorMessage: httpStatus("WorkBuddy cloud store failed"),
  })) as CloudStoreResponse;
}

/** 拉取云端商城分类(15 大类)。 */
export async function listCloudStoreCategories(): Promise<CloudStoreCategoriesResponse> {
  return (await apiGet("/api/agent-market/cloud/store/categories", {
    errorMessage: httpStatus("WorkBuddy cloud categories failed"),
  })) as CloudStoreCategoriesResponse;
}

/** 安装云端专家:后端下载 bundle → 解包 → 导入为本地 agent。 */
export async function installCloudExpert(
  expertId: string,
): Promise<CloudStoreInstallResult> {
  return (await apiPost("/api/agent-market/cloud/store/{expert_id}/install", {
    path: { expert_id: expertId },
    errorMessage: httpBody("WorkBuddy install failed"),
  })) as CloudStoreInstallResult;
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
  return (await apiGet("/api/agent-market/cloud/plugins", {
    query: {
      search: opts.search || undefined,
      kind: opts.kind || undefined,
      limit: opts.limit ?? 500,
    },
    errorMessage: httpStatus("Cloud plugins failed"),
  })) as CloudPluginsResponse;
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
    page = (await apiGet("/api/agent-market/cloud/skills", {
      query: {
        search: opts.search || undefined,
        source: opts.source || undefined,
        limit: opts.limit ?? 500,
        offset: items.length,
      },
      signal: opts.signal,
      errorMessage: httpStatus("Cloud skills failed"),
    })) as CloudSkillsResponse;
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

export async function fetchCloudInstalled(): Promise<CloudInstalledStatus> {
  return (await apiGet("/api/agent-market/cloud/installed", {
    errorMessage: httpStatus("Cloud installed status failed"),
  })) as CloudInstalledStatus;
}

/** Workbench navigation needs only this package's current lifecycle checks. */
export async function fetchWorkbenchInstalled(
  packageId: string,
): Promise<Pick<CloudInstalledStatus, "plugins" | "plugin_states">> {
  return (await apiGet("/api/agent-market/cloud/installed", {
    query: { package_id: packageId },
    errorMessage: httpStatus("Workbench installed status failed"),
  })) as Pick<CloudInstalledStatus, "plugins" | "plugin_states">;
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
  return (await apiPost("/api/agent-market/cloud/skills/{name}/install", {
    path: { name },
    errorMessage: httpBody("云技能安装失败"),
  })) as CloudSkillInstallResult;
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
  return (await apiPost("/api/agent-market/cloud/plugins/{plugin_id}/install", {
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
  })) as CloudPluginInstallResult;
}

/** Remove only a mutable cloud-installed package; bundled/core code is never targeted. */
export async function uninstallCloudPlugin(
  pluginId: string,
  options: { dataPolicy?: "keep" | "trash"; confirmDataMove?: boolean } = {},
): Promise<CloudPluginUninstallResult> {
  return (await apiDelete(
    "/api/agent-market/cloud/plugins/{plugin_id}/install",
    {
      path: { plugin_id: pluginId },
      query: {
        data_policy: options.dataPolicy ?? "keep",
        confirm_data_move: Boolean(options.confirmDataMove),
      },
      errorMessage: httpBody("云插件卸载失败"),
    },
  )) as CloudPluginUninstallResult;
}

export async function fetchRuntimePluginStatus(
  pluginName: string,
): Promise<RuntimePluginStatus> {
  return (await apiGet("/api/plugin-hub/plugins/{name}", {
    path: { name: pluginName },
    errorMessage: httpBody("插件状态读取失败"),
  })) as RuntimePluginStatus;
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
  const rows = (await apiGet("/api/plugin-hub/plugins", {
    errorMessage: httpBody("插件状态清单读取失败"),
  })) as RuntimePluginStatus[];
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
  return (await (enabled
    ? apiPost("/api/plugin-hub/plugins/{name}/enable", options)
    : apiPost(
        "/api/plugin-hub/plugins/{name}/disable",
        options,
      ))) as RuntimePluginStatus;
}

/** Activate/deactivate any remote workbench, including frontend-only packages. */
export async function setCloudPluginEnabled(
  pluginId: string,
  enabled: boolean,
): Promise<RuntimePluginStatus> {
  return (await apiPost("/api/agent-market/cloud/plugins/{plugin_id}/{action}", {
    path: { plugin_id: pluginId, action: enabled ? "enable" : "disable" },
    errorMessage: httpBody(`应用${enabled ? "启用" : "停用"}失败`),
  })) as RuntimePluginStatus;
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
  return (await apiPost(
    "/api/agent-market/cloud/plugins/{plugin_id}/rollback",
    {
      path: { plugin_id: pluginId },
      body: transactionId ? { transaction_id: transactionId } : {},
      errorMessage: httpBody("应用回滚失败"),
    },
  )) as CloudPluginRollbackResult;
}

// ---------------------------------------------------------------------------
// Store – browse & search
// ---------------------------------------------------------------------------

export async function listStoreAgents(
  params: AgentWorldListParams = {},
): Promise<AgentWorldListResponse> {
  // Featured agents use a dedicated endpoint
  if (params.featured) {
    return (await apiGet("/api/agent-market/store/featured", {
      query: { limit: params.page_size || undefined },
      errorMessage: statusText("Failed to load featured agents"),
    })) as AgentWorldListResponse;
  }

  return (await apiGet("/api/agent-market/store", {
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
  })) as AgentWorldListResponse;
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
    return (await apiGet("/api/agent-market/enterprise", {
      query: {
        category: params.category || undefined,
        search: params.search || undefined,
      },
    })) as EnterpriseAssetsResponse;
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
  const result = (await apiPost(
    "/api/agent-market/enterprise/{asset_id}/install",
    { path: { asset_id: id }, errorMessage: statusText("安装失败") },
  )) as { installed: boolean; agent_id: string; name?: string };
  await reloadAgents();
  return result;
}

export async function getStoreAgent(id: string): Promise<AgentWorldAgent> {
  return (await apiGet("/api/agent-market/store/{agent_id}", {
    path: { agent_id: id },
    errorMessage: statusText("Agent not found"),
  })) as AgentWorldAgent;
}

// ---------------------------------------------------------------------------
// Install / Uninstall
// ---------------------------------------------------------------------------

export async function installAgent(id: string): Promise<AgentInstallResult> {
  const result = (await apiPost("/api/agent-market/store/{agent_id}/install", {
    path: { agent_id: id },
    errorMessage: statusText("Failed to install agent"),
  })) as AgentInstallResult;
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
  return (await apiGet("/api/agent-market/profile/{agent_name}", {
    path: { agent_name: agentName },
    errorMessage: statusText("Failed to load agent profile"),
  })) as AgentProfile;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export async function listAgentMemories(
  agentName: string,
): Promise<AgentMemory[]> {
  const data = (await apiGet("/api/agent-market/memory/{agent_name}", {
    path: { agent_name: agentName },
    errorMessage: statusText("Failed to load agent memories"),
  })) as { memories: AgentMemory[] };
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
  const data = (await apiGet("/api/agent-market/store/{agent_id}/ratings", {
    path: { agent_id: agentId },
    errorMessage: statusText("Failed to load ratings"),
  })) as { ratings: AgentRating[] };
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
  const data = (await apiGet(
    "/api/agent-market/social/{agent_name}/relationships",
    {
      path: { agent_name: agentName },
      errorMessage: statusText("Failed to load relationships"),
    },
  )) as { relationships: AgentRelationship[] };
  return data.relationships;
}

// ---------------------------------------------------------------------------
// 统一「能力包」市场 —— 连接器 + Codex 插件一个市场
// 后端: runtime/sensing/gateway/capability_router.py
//   GET  /api/capabilities                    统一列表
//   POST /api/capabilities/{id}/install       安装(技能→skills, 连接器+MCP)
//   POST /api/capabilities/{id}/enable|disable
//   POST /api/capabilities/{id}/connect       认证编排
//   GET  /api/capabilities/{id}/status
// ---------------------------------------------------------------------------

const CAPABILITY_API = "/api/capabilities";

export type CapabilitySource = "connector" | "codex_plugin";

/** 连接器/MCP server 端点(含 url,供网页 OAuth 授权使用)。 */
export interface MCPEndpoint {
  name: string;
  url: string;
}

export interface CapabilityInfo {
  execution_owner?: "echo" | "codex";
  ownership_state?: string;
  ownership_label?: string;
  native_verified?: boolean;
  id: string;
  name: string;
  name_zh: string;
  description: string;
  description_zh: string;
  type: string;
  auth_mode: string;
  source: CapabilitySource;
  provider_id?: string;
  model_provider?: {
    schema?: string;
    entry_id: string;
    display_name?: string;
    display_name_zh?: string;
    protocol: "openai-compatible" | string;
    base_url: string;
    models_endpoint?: string;
    dashboard_url?: string;
    docs_url?: string;
    configurable_base_url?: boolean;
    api_key_label_zh?: string;
    login_cta_zh?: string;
    connection_note_zh?: string;
    model_list_label_zh?: string;
    free_models: string[];
    privacy_notices_zh?: string[];
    supports_tool_use?: boolean;
    models_are_free?: boolean;
  } | null;
  author?: string;
  category?: string;
  icon?: string;
  mcp_servers: MCPEndpoint[];
  /** 是否支持网页 OAuth 登录授权(后端探测缓存;null=未知/未探测)。 */
  oauth_supported?: boolean | null;
  /** 服务商直连 OAuth(如 github)的 provider id,存在则走 BYO OAuth App 网页登录。 */
  oauth_provider?: string | null;
  oauth_provider_name?: string | null;
  /** CLI 连接器带 auth 登录命令 → 支持设备流网页授权码登录。 */
  has_cli_auth?: boolean;
  /** 只能手动填 token、不能跳网页登录(后端默认从市场隐藏)。 */
  manual_token_only?: boolean;
  skill_count: number;
  examples_zh?: string[];
  /** Optional UI mount points contributed by this plugin. */
  surface_capabilities?: string[];
  installed: boolean;
  enabled: boolean;
  connected?: boolean;
  version: string;
  /** Codex App Server marketplace row (as opposed to an already-local plugin). */
  is_codex_marketplace?: boolean;
  marketplace_name?: string;
  plugin_name?: string;
  codex_plugin_id?: string;
  featured?: boolean;
  installable?: boolean;
  /** Whether this account may install/uninstall the local capability package. */
  lifecycle_manageable?: boolean;
  /** Signed marketplace requirements and local grant state. */
  host_api?: string | null;
  permissions?: string[];
  permissions_granted?: string[];
  permission_review_required?: boolean;
  permission_active?: boolean;
  auth_modes?: string[];
  dependencies?: string[];
  runtime_dependencies?: string[];
}

export interface CapabilityListResponse {
  capabilities: CapabilityInfo[];
  total: number;
}

export interface CapabilityDeviceFlow {
  /** 服务端生成的不透明会话代际；取消时必须原样回传。 */
  flow_id: string;
  connector_id: string;
  verification_uri: string;
  user_code: string;
  expires_in: number;
  code_embedded_in_uri: boolean;
  message?: string;
}

export interface CapabilityConnectResult {
  connected: boolean;
  message?: string;
  command?: string;
  capability_id?: string;
  /** CLI 设备流(WorkBuddy authDeviceFlow):verification_uri + user_code。 */
  device_flow?: CapabilityDeviceFlow;
}

export interface CapabilityDeviceFlowStatus {
  connector_id: string;
  active: boolean;
  connected?: boolean;
  auth_mode?: string;
  device_flow: CapabilityDeviceFlow | null;
}

export interface CapabilityInstallPlan {
  schema: "echo.capability_install_plan.v1";
  capability_id: string;
  kind: "connector" | "codex";
  version: string;
  host_api: string | null;
  permissions: string[];
  auth_modes: string[];
  dependencies: Array<{
    id: string;
    required_by?: string;
    ready: boolean;
    will_install?: boolean;
    state: string;
  }>;
  runtime_dependencies: Array<{ name: string; bundled: boolean }>;
  changes: string[];
  permission_review_required: boolean;
  can_install: boolean;
  blockers: string[];
  plan_id: string;
}

/** Read-only preflight: no package, skill, state, process, or credential writes. */
export async function getCapabilityInstallPlan(
  capabilityId: string,
): Promise<CapabilityInstallPlan> {
  return (await apiGet("/api/capabilities/{cid}/install-plan", {
    path: { cid: capabilityId },
    errorMessage: httpStatus("Capability install plan failed"),
  })) as CapabilityInstallPlan;
}

/** 统一插件市场列表(WorkBuddy MCP 服务 + Codex 插件)。 */
export async function listCapabilities(
  opts: {
    search?: string;
    source?: CapabilitySource | "";
    limit?: number;
    offset?: number;
    /** 是否包含只能手动填 token 的插件(默认 false,后端已隐藏)。 */
    includeManual?: boolean;
  } = {},
): Promise<CapabilityListResponse> {
  return (await apiGet("/api/capabilities", {
    query: {
      search: opts.search || undefined,
      source: opts.source || undefined,
      limit: opts.limit ?? 500,
      offset: opts.offset || undefined,
      include_manual: Boolean(opts.includeManual),
    },
    errorMessage: httpStatus("Capability list failed"),
  })) as CapabilityListResponse;
}

/** Load a protected plugin asset and convert it into an image-safe data URL. */
export async function loadCapabilityIcon(
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await untypedApi.fetch("get", url, {
    reason: "the caller passes an already-resolved backend asset URL",
    baseUrl: "",
    signal,
    errorMessage: httpStatus("Capability icon failed"),
  });
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () =>
      reject(reader.error || new Error("Capability icon decode failed"));
    reader.readAsDataURL(blob);
  });
}

/** 安装插件(技能→~/.echo/skills;带 MCP 的插件额外登记 MCP)。 */
export async function installCapability(
  capabilityId: string,
  planId?: string,
): Promise<{
  installed: boolean;
  enabled?: boolean;
  permissions?: string[];
  permission_review_required?: boolean;
  copied_skills?: string[];
  cli_lifecycle?: {
    has_cli?: boolean;
    deferred?: boolean;
    detection?: {
      found: boolean;
      command?: string;
      executable?: string;
    };
    detection_before?: {
      found: boolean;
      command?: string;
      executable?: string;
    };
    init?: { ok: boolean; error?: string; output?: string };
    version?: {
      ok: boolean;
      error?: string;
      version?: string;
      min_version?: string;
    };
    runtime?: { ok: boolean; error?: string };
    auth_device_flow?: boolean;
    min_version?: string;
  };
}> {
  return untypedApi.post(
    `${CAPABILITY_API}/${encodeURIComponent(capabilityId)}/install`,
    {
      reason: "the snapshot declares no body for the optional { plan_id }",
      body: planId ? { plan_id: planId } : undefined,
      errorMessage: httpBody("Capability install failed"),
    },
  );
}

/** 卸载能力包。 */
export async function uninstallCapability(capabilityId: string): Promise<void> {
  await apiFetch("delete", "/api/capabilities/{cid}/install", {
    path: { cid: capabilityId },
    errorMessage: (f) => {
      // Plain-text gateway responses are already suitable for display.
      const parsed = failureDetail(f);
      const detail = typeof parsed === "string" ? parsed : f.text.trim();
      return `Capability uninstall failed: HTTP ${f.status}${detail ? ` ${detail}` : ""}`;
    },
  });
}

/** 启用/禁用能力。 */
export async function setCapabilityEnabled(
  capabilityId: string,
  enabled: boolean,
  grantPermissions?: string[],
  planId?: string,
): Promise<void> {
  await untypedApi.fetch(
    "post",
    `${CAPABILITY_API}/${encodeURIComponent(capabilityId)}/${enabled ? "enable" : "disable"}`,
    {
      reason: "the snapshot declares no body for grant_permissions / plan_id",
      body:
        grantPermissions || planId
          ? {
              ...(grantPermissions
                ? { grant_permissions: grantPermissions }
                : {}),
              ...(planId ? { plan_id: planId } : {}),
            }
          : undefined,
      errorMessage: httpStatus(
        `Capability ${enabled ? "enable" : "disable"} failed`,
      ),
    },
  );
}

/** 能力认证/连接状态。 */
export async function getCapabilityStatus(
  capabilityId: string,
): Promise<{ connected: boolean; auth_mode?: string }> {
  return (await apiGet("/api/capabilities/{cid}/status", {
    path: { cid: capabilityId },
    errorMessage: httpStatus("Capability status failed"),
  })) as { connected: boolean; auth_mode?: string };
}

/** 认证编排:带认证的插件走 tokens / 其余直接就绪。 */
export async function connectCapability(
  capabilityId: string,
  body: {
    tokens?: Record<string, string>;
    run_cli?: boolean;
    grant_permissions?: string[];
  } = {},
): Promise<CapabilityConnectResult> {
  return untypedApi.post<CapabilityConnectResult>(
    `${CAPABILITY_API}/${encodeURIComponent(capabilityId)}/connect`,
    {
      reason: "the snapshot declares no request body for connect",
      body,
      errorMessage: httpBody("Capability connect failed"),
    },
  );
}

/** 恢复进行中的 CLI 设备流，供弹窗刷新/重开后继续轮询。 */
export async function getCapabilityDeviceFlow(
  capabilityId: string,
): Promise<CapabilityDeviceFlowStatus> {
  return (await apiGet("/api/capabilities/{cid}/device-flow", {
    path: { cid: capabilityId },
    errorMessage: httpStatus("Capability device flow failed"),
  })) as CapabilityDeviceFlowStatus;
}

/** 幂等取消 CLI 设备流；关闭弹窗或卸载能力前必须先回收后台进程。 */
export async function cancelCapabilityDeviceFlow(
  capabilityId: string,
  expectedFlowId: string,
): Promise<{
  cancelled: boolean;
  connector_id: string;
  // Per the OpenAPI contract the server may send an explicit null.
  reason?: string | null;
}> {
  return apiDelete("/api/capabilities/{cid}/device-flow", {
    path: { cid: capabilityId },
    query: { expected_flow_id: expectedFlowId },
    errorMessage: httpStatus("Capability device flow cancel failed"),
  });
}

/** 断开插件(清除已存凭据)。 */
export async function disconnectCapability(
  capabilityId: string,
): Promise<void> {
  await apiFetch("post", "/api/capabilities/{cid}/disconnect", {
    path: { cid: capabilityId },
    errorMessage: httpStatus("Capability disconnect failed"),
  });
}

// ---------------------------------------------------------------------------
// 统一资产仓库(插件 / 技能 / 角色,WorkBuddy + Codex + 本地 + 内置 归一)
// 后端: runtime/platform/assets/asset_registry.py
//   GET  /api/assets                统一资产列表(kind/source/search 过滤)+ 汇总
//   GET  /api/assets/{kind}/{id}    单个资产详情
//   POST /api/assets/sync           重建统一仓库(幂等)
// ---------------------------------------------------------------------------

export type UnifiedAssetKind = "plugin" | "skill" | "agent" | "team";

export type UnifiedAssetSource =
  | "codex"
  | "workbuddy"
  | "local"
  | "builtin"
  | "imported";

export interface UnifiedAsset {
  id: string;
  kind: UnifiedAssetKind;
  source: UnifiedAssetSource;
  type?: string;
  name: string;
  name_zh?: string;
  description?: string;
  version?: string;
  author?: string;
  category?: string;
  skills?: string[];
  skills_count?: number;
  auth_mode?: string;
  mcp_servers?: string[];
  origin?: string;
  /** 平铺目录名(冲突时带 -source 后缀)。 */
  dir?: string;
}

export interface UnifiedAssetsSummary {
  root: string;
  title: string;
  sources: UnifiedAssetSource[];
  updated_at: string;
  counts: Partial<Record<UnifiedAssetKind, number>>;
}

export interface UnifiedAssetsResponse {
  summary: UnifiedAssetsSummary;
  total: number;
  items: UnifiedAsset[];
  kind_filter?: string | null;
  source_filter?: string | null;
}

export async function fetchUnifiedAssets(
  params: {
    kind?: UnifiedAssetKind;
    source?: UnifiedAssetSource;
    search?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<UnifiedAssetsResponse> {
  return (await apiGet("/api/assets", {
    query: {
      kind: params.kind || undefined,
      source: params.source || undefined,
      search: params.search || undefined,
      limit: params.limit ?? 500,
      offset: params.offset || undefined,
    },
    errorMessage: httpStatus("Unified assets failed"),
  })) as UnifiedAssetsResponse;
}

export async function syncUnifiedAssets(): Promise<{
  root: string;
  counts: Partial<Record<UnifiedAssetKind, number>>;
  files_copied: number;
  updated_at: string;
}> {
  return (await apiPost("/api/assets/sync", {
    errorMessage: httpStatus("Unified assets sync failed"),
  })) as {
    root: string;
    counts: Partial<Record<UnifiedAssetKind, number>>;
    files_copied: number;
    updated_at: string;
  };
}
