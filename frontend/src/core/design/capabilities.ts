import { getBackendBaseURL } from "@/core/config";
import { jsonAuthHeaders } from "@/core/auth/api";

export interface DesignCapabilities {
  mode: "auto" | "manual";
  skills: string[];
  plugins: string[];
  image_model?: string;
  video_model?: string;
}
export const AUTO_DESIGN_CAPABILITIES: DesignCapabilities = {
  mode: "auto",
  skills: [],
  plugins: [],
};
export interface DesignCapabilityPlan {
  media_models?: Record<"image" | "video", { default: string | null; models: string[]; available: boolean }>;
  mode: "auto" | "manual";
  preferences: DesignCapabilities;
  foundations: string;
  tasks: string[];
  skills: string[];
  plugins: string[];
  tools: string[];
  ready: boolean;
  blockers: string[];
  warnings: string[];
  available_skills: { id: string; available: boolean }[];
  available_plugins: { id: string; available: boolean }[];
}

export function parseDesignCapabilities(value: unknown): DesignCapabilities {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return AUTO_DESIGN_CAPABILITIES;
    const ids = (v: unknown) =>
      Array.isArray(v)
        ? [
            ...new Set(
              v.filter(
                (x): x is string =>
                  typeof x === "string" &&
                  /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(x),
              ),
            ),
          ].slice(0, 12)
        : [];
    return {
      mode: parsed.mode === "manual" ? "manual" : "auto",
      skills: ids(parsed.skills),
      plugins: ids(parsed.plugins),
      ...Object.fromEntries(["image_model", "video_model"].filter(key => typeof parsed[key] === "string" && parsed[key].length > 0 && parsed[key].length <= 128 && !/[\u0000-\u001f]/.test(parsed[key])).map(key => [key, parsed[key]])),
    };
  } catch {
    return AUTO_DESIGN_CAPABILITIES;
  }
}

export async function resolveDesignCapabilities(
  goal: string,
  preferences: DesignCapabilities,
  checkConnection = false,
  signal?: AbortSignal,
): Promise<DesignCapabilityPlan> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/design/capabilities/resolve`,
    {
      method: "POST",
      headers: jsonAuthHeaders(),
      signal,
      body: JSON.stringify({
        goal,
        preferences,
        check_connection: checkConnection,
      }),
    },
  );
  if (!response.ok)
    throw new Error(`设计能力检查失败 (${response.status})，请重试`);
  return (await response.json()) as DesignCapabilityPlan;
}
