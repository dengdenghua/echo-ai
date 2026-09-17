import { canonicalAgentId } from "@/core/agents/aliases";
import {
  type PersonaWorkbenchTab,
  workspacePresetForAgent,
} from "./workspace-presets";

const STORAGE_KEY = "echo.workbench.persona-tabs.v1";

/**
 * Preferences are keyed by canonical persona so the same person resolves to one
 * slot regardless of which id the caller happens to hold. `workspacePresetForAgent`
 * already normalizes; without doing the same here, arriving as `coder` and as
 * `kane` would read and write two unrelated entries.
 */
function preferenceKey(agentId: string | null | undefined): string {
  return canonicalAgentId(agentId?.trim() || "general");
}

const VALID_TABS = new Set<PersonaWorkbenchTab>([
  "agent",
  "terminal",
  "browser",
  "workspace",
]);

function readOverrides(): Record<string, PersonaWorkbenchTab> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, PersonaWorkbenchTab] =>
          typeof entry[0] === "string" &&
          VALID_TABS.has(entry[1] as PersonaWorkbenchTab),
      ),
    );
  } catch {
    return {};
  }
}

export function rememberedWorkbenchTab(
  agentId: string | null | undefined,
): PersonaWorkbenchTab | null {
  return readOverrides()[preferenceKey(agentId)] ?? null;
}

export function rememberWorkbenchTab(
  agentId: string | null | undefined,
  tab: string,
): void {
  if (
    typeof window === "undefined" ||
    !VALID_TABS.has(tab as PersonaWorkbenchTab)
  ) {
    return;
  }
  const key = preferenceKey(agentId);
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readOverrides(), [key]: tab }),
    );
  } catch {
    // Storage is a preference only; private mode must not break the workbench.
  }
}

export function preferredWorkbenchTab(
  agentId: string | null | undefined,
  hasBoundProject: boolean,
): PersonaWorkbenchTab | "project" {
  if (hasBoundProject) return "project";
  return (
    rememberedWorkbenchTab(agentId) ??
    workspacePresetForAgent(agentId).defaultWorkbenchTab
  );
}
