import type { AgentWorkbenchTabId } from "@/components/workspace/agent-workbench-utils";
import type { RightPanelPage } from "@/components/workspace/realtime/right-panel-menu";

const STORAGE_KEY = "echo:right-panel:v1";

export interface RightPanelPreference {
  threadId: string;
  page: RightPanelPage;
  tab: AgentWorkbenchTabId;
}

function isPreference(value: unknown): value is RightPanelPreference {
  return !!value && typeof value === "object" &&
    "threadId" in value && typeof value.threadId === "string" &&
    "page" in value && typeof value.page === "string" &&
    ["agent", "artifacts", "plan", "preview", "research", "history"].includes(value.page) &&
    "tab" in value && typeof value.tab === "string" &&
    ["agent", "subagents", "artifacts", "plan", "diff", "terminal", "browser", "workspace", "design", "project"].includes(value.tab);
}

function readPreferences(): RightPanelPreference[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(isPreference).slice(-32) : [];
  } catch {
    return [];
  }
}

export function readRightPanelPreference(threadId: string) {
  return readPreferences().find((entry) => entry.threadId === threadId) ?? null;
}

export function rememberRightPanel(preference: RightPanelPreference) {
  if (!preference.threadId || preference.threadId === "new") return;
  try {
    const entries = readPreferences().filter((entry) => entry.threadId !== preference.threadId);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...entries, preference].slice(-32)));
  } catch {
    // The mounted toolbar still remembers its selection without browser storage.
  }
}
