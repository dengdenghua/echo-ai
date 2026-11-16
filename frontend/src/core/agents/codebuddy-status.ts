import type { EngineCapabilityChecks } from "@/core/agents/engine-capability-checks";

/**
 * Runtime parsers for the CodeBuddy config endpoints.
 *
 * These routes are newer than the generated OpenAPI types, so the payloads are
 * narrowed here instead of being asserted at the call site.
 */

export interface CodeBuddyStatus {
  available: boolean;
  reason: string | null;
  login_launch_supported?: boolean;
  capability_checks?: EngineCapabilityChecks;
}

const CAPABILITY_KEYS = ["chat", "web_search", "tools"] as const;

function isCapabilityState(
  value: unknown,
): value is "untested" | "verified" | "failed" {
  return value === "untested" || value === "verified" || value === "failed";
}

function parseCapabilityChecks(
  value: unknown,
): EngineCapabilityChecks | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const checks: EngineCapabilityChecks = {};
  for (const key of CAPABILITY_KEYS) {
    const entry = Reflect.get(value, key);
    if (typeof entry !== "object" || entry === null) continue;
    const state = Reflect.get(entry, "state");
    if (!isCapabilityState(state)) continue;
    const model = Reflect.get(entry, "model");
    const checkedAt = Reflect.get(entry, "checked_at");
    checks[key] = {
      state,
      ...(typeof model === "string" || model === null ? { model } : {}),
      ...(typeof checkedAt === "number" ? { checked_at: checkedAt } : {}),
    };
  }
  return Object.keys(checks).length > 0 ? checks : undefined;
}

export function parseCodeBuddyStatus(payload: unknown): CodeBuddyStatus {
  if (typeof payload !== "object" || payload === null)
    return { available: false, reason: "invalid response" };
  const reason = Reflect.get(payload, "reason");
  const checks = parseCapabilityChecks(
    Reflect.get(payload, "capability_checks"),
  );
  return {
    available: Reflect.get(payload, "available") === true,
    login_launch_supported: Reflect.get(payload, "login_launch_supported") === true,
    reason: typeof reason === "string" ? reason : null,
    ...(checks ? { capability_checks: checks } : {}),
  };
}

export function parseCodeBuddyModels(payload: unknown): {
  models: string[];
  model_capabilities?: Record<string, {context_window?: number | null; context_source?: string; reasoning_efforts: string[]; default_reasoning_effort?: string}>;
  controls?: { effort: boolean; autocompact: boolean };
} {
  if (typeof payload !== "object" || payload === null) return { models: [] };
  const models = Reflect.get(payload, "models");
  if (!Array.isArray(models)) return { models: [] };
  return {
    models: models.filter((model): model is string => typeof model === "string"),
    model_capabilities: parseModelCapabilities(Reflect.get(payload, "model_capabilities")),
    controls: { effort: Reflect.get(payload, "controls")?.effort === true, autocompact: Reflect.get(payload, "controls")?.autocompact === true },
  };
}

function parseModelCapabilities(raw: unknown) {
  const result: Record<string, {context_window?: number; context_source: string; reasoning_efforts: string[]; default_reasoning_effort?: string}> = {};
  if (!raw || typeof raw !== "object") return result;
  for (const [id, row] of Object.entries(raw)) {
    if (!row || typeof row !== "object") continue;
    result[id] = {
      context_window: Number.isSafeInteger(row.context_window) && row.context_window > 0 ? row.context_window : undefined,
      context_source: "engine_input",
      reasoning_efforts: Array.isArray(row.reasoning_efforts) ? row.reasoning_efforts.filter((x: unknown): x is string => typeof x === "string") : [],
      default_reasoning_effort: typeof row.default_reasoning_effort === "string" ? row.default_reasoning_effort : undefined,
    };
  }
  return result;
}
