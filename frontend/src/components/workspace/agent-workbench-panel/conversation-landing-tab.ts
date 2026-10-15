import type { AgentWorkbenchTabId } from "../agent-workbench-utils";

/**
 * Where a chat workbench (no main overview) lands when it is opened without
 * a target, e.g. from the header button: a project's home first, then what
 * this conversation produced, then its file changes, then the persona's
 * workbench home. A tab the user closed is skipped so closing it does not
 * immediately bring it back.
 */
export function conversationLandingTab({
  mergeProjectHome,
  isDevelopmentWorkbench,
  hasArtifacts,
  hasDiff,
  dismissed,
}: {
  mergeProjectHome: boolean;
  isDevelopmentWorkbench: boolean;
  hasArtifacts: boolean;
  hasDiff: boolean;
  dismissed: ReadonlySet<AgentWorkbenchTabId>;
}): "project" | "artifacts" | "diff" | "workspace" {
  if (mergeProjectHome) return "project";
  if (hasArtifacts && !dismissed.has("artifacts")) return "artifacts";
  if (hasDiff && !dismissed.has("diff")) return "diff";
  return isDevelopmentWorkbench ? "diff" : "workspace";
}
