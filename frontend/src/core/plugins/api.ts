import {
  apiGet,
  apiPost,
  apiPut,
  failureDetail,
  untypedApi,
  type ApiFailure,
} from "@/core/api/request";

import type {
  CapabilityInfo,
  PluginMigrationReadiness,
  PluginInfo,
  PluginLifecycleHistory,
  PluginRuntimeProfile,
  PluginRegistryUpdates,
  PluginSmokeSummary,
  PluginPublisherTrustReport,
} from "./types";
import type { HubPluginInfo, DiscoveredPlugin } from "./types";

/** ``"<label>: <statusText>"`` — this module's historical error wording. */
function failed(label: string) {
  return (failure: ApiFailure): string => `${label}: ${failure.statusText}`;
}

// ── Legacy API (Codex plugins) ────────────────────────────

export async function listPlugins(): Promise<PluginInfo[]> {
  return (await apiGet("/api/plugins", {
    errorMessage: failed("Failed to list plugins"),
  })) as PluginInfo[];
}

export async function getPlugin(pluginId: string): Promise<PluginInfo> {
  return (await apiGet("/api/plugins/{plugin_id}", {
    path: { plugin_id: pluginId },
    errorMessage: failed("Failed to get plugin"),
  })) as PluginInfo;
}

export async function listCapabilities(
  type?: string,
): Promise<CapabilityInfo[]> {
  return untypedApi.get<CapabilityInfo[]>("/api/plugins/capabilities", {
    reason: "the `type` filter is read from the raw query, not declared",
    query: { type: type || undefined },
    errorMessage: failed("Failed to list capabilities"),
  });
}

export async function fetchPluginSmokeSummary(): Promise<PluginSmokeSummary> {
  return (await apiGet("/api/plugins/smoke-summary", {
    errorMessage: failed("Failed to get plugin smoke summary"),
  })) as PluginSmokeSummary;
}

export async function fetchPluginMigrationReadiness(): Promise<PluginMigrationReadiness> {
  return (await apiGet("/api/plugins/migration-readiness", {
    errorMessage: failed("Failed to get plugin migration readiness"),
  })) as PluginMigrationReadiness;
}

export async function fetchPluginPublisherTrust(): Promise<PluginPublisherTrustReport> {
  return (await apiGet("/api/plugins/publisher-trust", {
    errorMessage: failed("Failed to get publisher trust"),
  })) as PluginPublisherTrustReport;
}

export async function fetchPluginLifecycleHistory(): Promise<PluginLifecycleHistory> {
  return (await apiGet("/api/plugins/lifecycle/history", {
    errorMessage: failed("Failed to get plugin lifecycle history"),
  })) as PluginLifecycleHistory;
}

export async function fetchPluginRegistryUpdates(): Promise<PluginRegistryUpdates> {
  return (await apiGet("/api/plugins/registry/updates", {
    errorMessage: failed("Failed to get plugin registry updates"),
  })) as PluginRegistryUpdates;
}

export async function installPluginFromRegistry(
  pluginId: string,
): Promise<{ plugin_id: string; status: string; version: string }> {
  return (await apiPost("/api/plugins/registry/install", {
    body: { plugin_id: pluginId, confirm_install: true },
    errorMessage: failed("Failed to install registry plugin"),
  })) as { plugin_id: string; status: string; version: string };
}

export async function rotatePluginPublisherKey(input: {
  publisher_id: string;
  previous_key_id?: string;
  new_key_id: string;
  new_public_key: string;
  reason: string;
}): Promise<{ status: string; trust: PluginPublisherTrustReport }> {
  return (await apiPost("/api/plugins/publisher-trust/rotate", {
    body: { ...input, confirm_rotation: true },
    errorMessage: failed("Failed to rotate publisher key"),
  })) as { status: string; trust: PluginPublisherTrustReport };
}

export async function revokePluginPublisherKey(input: {
  publisher_id: string;
  key_id: string;
  reason: string;
}): Promise<{ status: string; trust: PluginPublisherTrustReport }> {
  return (await apiPost("/api/plugins/publisher-trust/revoke", {
    body: { ...input, confirm_revocation: true },
    errorMessage: failed("Failed to revoke publisher key"),
  })) as { status: string; trust: PluginPublisherTrustReport };
}

export async function getPluginRuntime(
  pluginId: string,
): Promise<PluginRuntimeProfile> {
  return (await apiGet("/api/plugins/{plugin_id}/runtime", {
    path: { plugin_id: pluginId },
    errorMessage: failed("Failed to get plugin runtime"),
  })) as PluginRuntimeProfile;
}

// ── PluginHub API (new pluggable module architecture) ─────

export type HubLifecycleAction = "install" | "enable" | "disable" | "uninstall";

export interface AutomationDiagnostics {
  plugin_id: string;
  lifecycle_active: boolean;
  execution_status: "blocked" | "unverified";
  checks: { id: string; status: string }[];
  verification: "dependencies_and_connections_only";
}

export async function hubAutomationDiagnostics(
  name: string,
): Promise<AutomationDiagnostics> {
  return (await apiGet("/api/plugin-hub/plugins/{name}/diagnostics", {
    path: { name },
    errorMessage: (failure) => `Diagnostics unavailable (${failure.status})`,
  })) as AutomationDiagnostics;
}

/** Persist lifecycle changes; factory uninstall keeps user data by default. */
export async function hubChangeLifecycle(
  name: string,
  action: HubLifecycleAction,
): Promise<void> {
  // The success body is intentionally ignored, so read nothing from it.
  await untypedApi.fetch(
    "post",
    `/api/plugin-hub/plugins/${encodeURIComponent(name)}/${action}`,
    {
      reason:
        "dynamic lifecycle action; POST …/uninstall and the {} bodies sent " +
        "to enable/disable are not in the OpenAPI snapshot",
      body: {},
      errorMessage: (failure) => {
        const detail = failureDetail(failure);
        return typeof detail === "string"
          ? detail
          : `Plugin update failed (${failure.status})`;
      },
    },
  );
}

/** List all loaded plugins via PluginHub. */
export async function hubListPlugins(): Promise<HubPluginInfo[]> {
  return (await apiGet("/api/plugin-hub/plugins", {
    errorMessage: failed("Failed to list hub plugins"),
  })) as HubPluginInfo[];
}

/** Scan for unloaded plugin candidates. */
export async function hubDiscoverPlugins(): Promise<DiscoveredPlugin[]> {
  return (await apiGet("/api/plugin-hub/plugins/discover", {
    errorMessage: failed("Failed to discover plugins"),
  })) as DiscoveredPlugin[];
}

/** Load a discovered plugin. */
export async function hubLoadPlugin(name: string): Promise<{ ok: boolean }> {
  return (await apiPost("/api/plugin-hub/plugins/{name}/load", {
    path: { name },
    errorMessage: failed("Failed to load plugin"),
  })) as { ok: boolean };
}

/** Start a loaded plugin. */
export async function hubStartPlugin(name: string): Promise<{ ok: boolean }> {
  return (await apiPost("/api/plugin-hub/plugins/{name}/start", {
    path: { name },
    errorMessage: failed("Failed to start plugin"),
  })) as { ok: boolean };
}

/** Stop a started plugin. */
export async function hubStopPlugin(name: string): Promise<{ ok: boolean }> {
  return (await apiPost("/api/plugin-hub/plugins/{name}/stop", {
    path: { name },
    errorMessage: failed("Failed to stop plugin"),
  })) as { ok: boolean };
}

/** Unload a plugin. */
export async function hubUnloadPlugin(name: string): Promise<{ ok: boolean }> {
  return (await apiPost("/api/plugin-hub/plugins/{name}/unload", {
    path: { name },
    errorMessage: failed("Failed to unload plugin"),
  })) as { ok: boolean };
}

/** Get a plugin's configuration. */
export async function hubGetPluginConfig(
  name: string,
): Promise<Record<string, unknown>> {
  return (await apiGet("/api/plugin-hub/plugins/{name}/config", {
    path: { name },
    errorMessage: failed("Failed to get plugin config"),
  })) as Record<string, unknown>;
}

/** Update a plugin's configuration. */
export async function hubUpdatePluginConfig(
  name: string,
  config: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  return (await apiPut("/api/plugin-hub/plugins/{name}/config", {
    path: { name },
    body: config,
    errorMessage: failed("Failed to update plugin config"),
  })) as { ok: boolean };
}

/** Get full details for a single plugin. */
export async function hubGetPlugin(name: string): Promise<HubPluginInfo> {
  return (await apiGet("/api/plugin-hub/plugins/{name}", {
    path: { name },
    errorMessage: failed("Failed to get plugin detail"),
  })) as HubPluginInfo;
}
