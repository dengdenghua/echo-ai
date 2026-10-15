import type { ExecutionSnapshot } from "./items";

export type ExecutionEngine = ExecutionSnapshot["engine"];
export type ExecutionEnginePreference = "auto" | ExecutionEngine;

export function executionEnginePreference(
  value: unknown,
): ExecutionEnginePreference {
  return value === "codex" || value === "echo" || value === "opencode"
    ? value
    : "auto";
}

/** Preview of the server policy. The runtime validates again before effects. */
export function previewExecutionEngine({
  preference,
  roleBackend,
  orchestrated,
  codexAvailable,
  opencodeMissing = false,
  opencodeNoModel = false,
  echoReady = true,
}: {
  preference: ExecutionEnginePreference;
  roleBackend?: unknown;
  codingTask: boolean;
  orchestrated: boolean;
  codexAvailable: boolean;
  /** OpenCode is not installed: Auto runs on Echo's own models instead. */
  opencodeMissing?: boolean;
  /** OpenCode runs but has no model for this pick (no Zen/Go connection). */
  opencodeNoModel?: boolean;
  /** Echo's own catalog has a model; unknown counts as yes. */
  echoReady?: boolean;
}): ExecutionEngine {
  if (preference !== "auto") return preference;
  if (!orchestrated && roleBackend === "codex_app_server") return "codex";
  if (!opencodeMissing && !opencodeNoModel) return "opencode";
  // Auto settles on Echo's own models when OpenCode cannot answer — or on a
  // signed-in Codex when Echo has none either, as on a new computer.
  return !echoReady && codexAvailable ? "codex" : "echo";
}
