import { swallow } from "@/core/utils/log";
import { apiGet, apiPut } from "@/core/api/request";

export interface Capabilities {
  browser_automation: boolean;
  desktop_automation: boolean;
}

export interface SaveCapabilitiesResponse {
  ok: boolean;
  capabilities: Capabilities;
  restart_required: boolean;
  message: string;
  registry?: {
    registered: string[];
    removed: string[];
  };
}

export interface RestartBackendResponse {
  ok: boolean;
  reason?: string;
}

export async function getCapabilities(): Promise<Capabilities> {
  return apiGet("/api/settings/capabilities", {
    errorMessage: (failure) =>
      `Failed to load capabilities: ${failure.statusText}`,
  });
}

export async function saveCapabilities(
  body: Capabilities,
): Promise<SaveCapabilitiesResponse> {
  return (await apiPut("/api/settings/capabilities", {
    body,
    errorMessage: (failure) =>
      `Failed to save capabilities: ${failure.status} ${
        failure.text || failure.statusText
      }`,
  })) as SaveCapabilitiesResponse;
}

/* Implementation note. */
export async function restartBackend(): Promise<RestartBackendResponse> {
  // Implementation note.
  if (typeof window === "undefined" || !window.echo?.isElectron) {
    return { ok: false, reason: "not in electron environment" };
  }
  try {
    const result = await window.echo.backend?.restart?.();
    return result || { ok: false, reason: "ipc not available" };
  } catch (e) {
    swallow(e);
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
