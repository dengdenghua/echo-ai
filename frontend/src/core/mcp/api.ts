import {
  apiDelete,
  apiFetch,
  apiGet,
  apiPost,
  apiPut,
  failureDetail,
  type ApiFailure,
} from "@/core/api/request";

import type { MCPConfig, MCPConfigUpdateResponse } from "./types";

/**
 * Keep this module's historical error wording on ``EchoAPIError``: the JSON
 * ``detail`` when present, else ``label: statusText``; a non-JSON error body
 * yields the bare status text.
 */
function failed(label: string) {
  return (failure: ApiFailure): string => {
    if (failure.payload === undefined) return failure.statusText;
    const detail = failureDetail(failure);
    return detail === undefined || detail === null
      ? `${label}: ${failure.statusText}`
      : String(detail);
  };
}

export async function loadMCPConfig() {
  return (await apiGet("/api/mcp/config", {
    errorMessage: failed("Failed to load MCP config"),
  })) as MCPConfig;
}

export async function updateMCPConfig(config: MCPConfig) {
  return (await apiPut("/api/mcp/config", {
    body: config,
    errorMessage: failed("Failed to update MCP config"),
  })) as MCPConfigUpdateResponse;
}

export async function forgetMCPOAuth(serverName: string): Promise<void> {
  await apiFetch("delete", "/api/mcp/oauth/{server_name}", {
    path: { server_name: serverName },
    errorMessage: failed("Failed to remove MCP OAuth credentials"),
  });
}

// ───────────────────────────── OAuth 网页授权 ─────────────────────────────
//
// 走 /api/mcp/oauth/*(见 mcp_router.py):发现服务商授权端点 → PKCE → 返回
// authorize_url 让前端开浏览器授权;回调后轮询 /status 确认已授权。

export interface MCPOAuthAuthorizeResult {
  ok: boolean;
  authorize_url: string;
  /** Some provider consent pages return through a desktop custom scheme. */
  callback_transport?: "standard" | "desktop-deep-link";
  /** 服务商直连 OAuth(GitHub 等)尚未配置 OAuth App 凭据 → 前端引导填写。 */
  needs_app_credentials?: boolean;
  provider?: string;
  provider_name?: string;
  docs_url?: string;
  redirect_uri?: string;
  requires_client_secret?: boolean;
}

/** 服务商 OAuth App 凭据信息(绝不返回明文 secret)。 */
export interface OAuthAppInfo {
  provider: string;
  provider_name: string;
  has_app: boolean;
  configured: boolean;
  client_id_masked: string;
}

export async function oauthAuthorize(
  server: string,
  url: string,
  provider?: string,
): Promise<MCPOAuthAuthorizeResult> {
  return (await apiPost("/api/mcp/oauth/authorize", {
    body: { server, url, provider },
    errorMessage: failed("OAuth authorize"),
  })) as MCPOAuthAuthorizeResult;
}

export async function getOAuthApp(provider: string): Promise<OAuthAppInfo> {
  return (await apiGet("/api/mcp/oauth/app/{provider}", {
    path: { provider },
    errorMessage: failed("Failed to load OAuth app credentials"),
  })) as OAuthAppInfo;
}

export async function saveOAuthApp(
  provider: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuthAppInfo> {
  return (await apiPost("/api/mcp/oauth/app/{provider}", {
    path: { provider },
    body: {
      client_id: clientId,
      client_secret: clientSecret,
    },
    errorMessage: failed("Failed to save OAuth app credentials"),
  })) as OAuthAppInfo;
}

export async function deleteOAuthApp(provider: string): Promise<void> {
  await apiFetch("delete", "/api/mcp/oauth/app/{provider}", {
    path: { provider },
    errorMessage: failed("Failed to remove OAuth app credentials"),
  });
}

export async function oauthStatus(
  server: string,
): Promise<{ server: string; authorized: boolean }> {
  return (await apiGet("/api/mcp/oauth/status", {
    query: { server },
    errorMessage: failed("Failed to load MCP OAuth status"),
  })) as { server: string; authorized: boolean };
}

// ───────────────────────────── Trust store ─────────────────────────────
//
// MCP servers run arbitrary code on the user's machine. Per ADR-007, the
// runtime refuses to register a server's tools as skills until the user
// explicitly approves it. These wrappers talk to /api/mcp/trust so the
// settings page can show approval state and surface an Approve button.

export interface MCPTrustEntry {
  server_name: string;
  approved: boolean;
  added_ts: number;
  tool_digest: string;
  note: string;
}

export async function listMCPTrust(): Promise<{ entries: MCPTrustEntry[] }> {
  return (await apiGet("/api/mcp/trust", {
    errorMessage: failed("Failed to list MCP trust entries"),
  })) as { entries: MCPTrustEntry[] };
}

export async function approveMCPTrust(
  server_name: string,
  tool_names: string[] = [],
  note = "",
): Promise<{ ok: boolean; entry: MCPTrustEntry }> {
  return (await apiPost("/api/mcp/trust", {
    body: { server_name, tool_names, note },
    errorMessage: failed("Failed to approve MCP trust"),
  })) as { ok: boolean; entry: MCPTrustEntry };
}

export async function revokeMCPTrust(
  server_name: string,
): Promise<{ ok: boolean; server_name: string }> {
  return (await apiDelete("/api/mcp/trust/{server_name}", {
    path: { server_name },
    errorMessage: failed("Failed to revoke MCP trust"),
  })) as { ok: boolean; server_name: string };
}
