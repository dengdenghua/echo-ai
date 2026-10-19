/**
 * 统一「能力包」市场 API —— 连接器 + Codex 插件（对齐 capability_router.py）。
 *
 * Split out of :mod:`agent-world-api` so that file stays under the 1000-line
 * god-file ratchet. Every name here is re-exported from ``agent-world-api.ts``;
 * import sites do not move.
 */

import {
  apiDelete,
  apiFetch,
  apiGet,
  apiPost,
  failureDetail,
  untypedApi,
  type ApiFailure,
} from "@/core/api/request";
import { looseBody } from "@/core/api/response";
import * as guards from "./agent-world-guards";

/** ``"<label>: HTTP <status>"`` */
export function httpStatus(label: string) {
  return (f: ApiFailure): string => `${label}: HTTP ${f.status}`;
}

/** ``"<label>: HTTP <status> <body>"``, trimmed. */
export function httpBody(label: string) {
  return (f: ApiFailure): string =>
    `${label}: HTTP ${f.status} ${f.text}`.trim();
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
  return looseBody(await apiGet("/api/capabilities/{cid}/install-plan", {
    path: { cid: capabilityId },
    errorMessage: httpStatus("Capability install plan failed"),
  }), guards.isCapabilityInstallPlan);
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
  return looseBody(await apiGet("/api/capabilities", {
    query: {
      search: opts.search || undefined,
      source: opts.source || undefined,
      limit: opts.limit ?? 500,
      offset: opts.offset || undefined,
      include_manual: Boolean(opts.includeManual),
    },
    errorMessage: httpStatus("Capability list failed"),
  }), guards.isCapabilityListResponse);
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
  return looseBody(await apiGet("/api/capabilities/{cid}/status", {
    path: { cid: capabilityId },
    errorMessage: httpStatus("Capability status failed"),
  }), guards.hasConnected);
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
  return looseBody(await apiGet("/api/capabilities/{cid}/device-flow", {
    path: { cid: capabilityId },
    errorMessage: httpStatus("Capability device flow failed"),
  }), guards.isCapabilityDeviceFlowStatus);
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
  return looseBody(await apiGet("/api/assets", {
    query: {
      kind: params.kind || undefined,
      source: params.source || undefined,
      search: params.search || undefined,
      limit: params.limit ?? 500,
      offset: params.offset || undefined,
    },
    errorMessage: httpStatus("Unified assets failed"),
  }), guards.isUnifiedAssetsResponse);
}

export async function syncUnifiedAssets(): Promise<{
  root: string;
  counts: Partial<Record<UnifiedAssetKind, number>>;
  files_copied: number;
  updated_at: string;
}> {
  return looseBody(await apiPost("/api/assets/sync", {
    errorMessage: httpStatus("Unified assets sync failed"),
  }), guards.hasRoot);
}
