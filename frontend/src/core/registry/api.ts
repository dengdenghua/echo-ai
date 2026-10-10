// 资产 Registry 消费端 API(母体接 registry · echo-runtime)。
// 走后端 /api/registry/* 路由(registry_consumer_router),浏览/安装公网 registry 技能。
import { apiGet, apiPost, type ApiFailure } from "@/core/api/request";
import { looseBody } from "@/core/api/response";
import {
  isInstallResult,
  isPluginInstallResult,
  isRegistryPluginsResponse,
  isRegistryRolesResponse,
  isRegistrySkillsResponse,
  isRoleInstallResult,
} from "./guards";

/** ``"install failed: HTTP <status> <body>"``, trimmed when the body is empty. */
function installFailed(failure: ApiFailure): string {
  return `install failed: HTTP ${failure.status} ${failure.text}`.trim();
}

export interface RegistrySkill {
  id: string; // "skill/<slug>"
  type: string;
  kind: string; // data | code
  version: string;
  name: string;
  description: string;
  category?: string | null;
  tags?: string[] | null;
  icon?: string | null;
  logo_url?: string | null;
  icon_url?: string | null;
  platforms?: string[] | null;
  content?: { checksum?: string | null } | null;
}

export interface RegistrySkillsResponse {
  skills: RegistrySkill[];
  total: number;
  offset: number;
  limit: number;
  source: string;
}

export interface InstallResult {
  installed: string;
  path: string | null;
  registered_now: number;
}

export function registrySlug(id: string): string {
  return id.split("/").pop() ?? id;
}

export async function listRegistrySkills(params?: {
  search?: string;
  category?: string;
  limit?: number;
}): Promise<RegistrySkillsResponse> {
  return looseBody(
    await apiGet("/api/registry/skills", {
      query: {
        search: params?.search || undefined,
        category: params?.category || undefined,
        limit: params?.limit ?? 300,
      },
      errorMessage: (f) => `registry list failed: HTTP ${f.status}`,
    }),
    isRegistrySkillsResponse,
  );
}

export async function installRegistrySkill(
  slug: string,
): Promise<InstallResult> {
  return looseBody(
    await apiPost("/api/registry/skills/{slug}/install", {
      path: { slug: registrySlug(slug) },
      errorMessage: installFailed,
    }),
    isInstallResult,
  );
}

// 角色(role / twin-role · 数字分身岗位模板)——同一 registry,单独端点。
export interface RegistryRole {
  id: string; // "role/<slug>" | "twin-role/<slug>"
  type: string;
  kind: string;
  version: string;
  name: string;
  description: string;
  category?: string | null;
  tags?: string[] | null;
  icon?: string | null;
  logo_url?: string | null;
  icon_url?: string | null;
}

export interface RegistryRolesResponse {
  roles: RegistryRole[];
  total: number;
  offset: number;
  limit: number;
  source: string;
}

export interface RoleInstallResult {
  installed: boolean;
  agent_id: string;
  name: string;
  path: string | null;
}

export async function listRegistryRoles(params?: {
  search?: string;
  category?: string;
  type?: "role" | "twin-role";
  limit?: number;
}): Promise<RegistryRolesResponse> {
  return looseBody(
    await apiGet("/api/registry/roles", {
      query: {
        search: params?.search || undefined,
        category: params?.category || undefined,
        type: params?.type || undefined,
        limit: params?.limit ?? 300,
      },
      errorMessage: (f) => `registry roles list failed: HTTP ${f.status}`,
    }),
    isRegistryRolesResponse,
  );
}

export async function installRegistryRole(
  id: string,
): Promise<RoleInstallResult> {
  return looseBody(
    await apiPost("/api/registry/roles/{asset_id}/install", {
      path: { asset_id: id },
      errorMessage: installFailed,
    }),
    isRoleInstallResult,
  );
}

// 插件(plugin)——安装为 prompt-only 本地能力；不会下载或执行远程代码。
export interface RegistryPlugin {
  id: string; // "plugin/<slug>"
  type: string;
  kind: string;
  version: string;
  name: string;
  description: string;
  category?: string | null;
  tags?: string[] | null;
  /** Publisher fallback icon (usually an emoji) when no trusted local logo exists. */
  icon?: string | null;
  /** Trusted local plugin asset URLs, added by the runtime consumer route. */
  logo_url?: string | null;
  icon_url?: string | null;
  brand_color?: string | null;
  local_plugin_id?: string | null;
  bundle?: {
    ref?: string | null;
    checksum?: string | null;
    size?: number | null;
  } | null;
  install_mode?: "plugin-bundle" | "prompt-only" | string;
}

export interface RegistryPluginsResponse {
  plugins: RegistryPlugin[];
  total: number;
  offset: number;
  limit: number;
  source: string;
  installable: boolean;
  install_mode?: "prompt-only" | string;
}

export interface PluginInstallResult {
  installed: string;
  installed_name: string;
  path: string;
  registered_now: number;
  install_mode: "prompt-only" | string;
}

export async function listRegistryPlugins(params?: {
  search?: string;
  category?: string;
  limit?: number;
}): Promise<RegistryPluginsResponse> {
  return looseBody(
    await apiGet("/api/registry/plugins", {
      query: {
        search: params?.search || undefined,
        category: params?.category || undefined,
        limit: params?.limit ?? 300,
      },
      errorMessage: (f) => `registry plugins list failed: HTTP ${f.status}`,
    }),
    isRegistryPluginsResponse,
  );
}

export async function installRegistryPlugin(
  slug: string,
): Promise<PluginInstallResult> {
  return looseBody(
    await apiPost("/api/registry/plugins/{slug}/install", {
      path: { slug: registrySlug(slug) },
      errorMessage: installFailed,
    }),
    isPluginInstallResult,
  );
}
