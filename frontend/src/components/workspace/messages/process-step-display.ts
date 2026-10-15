/**
 * Pure presentation helpers for process-step rows in the conversation lane:
 * localized action verbs and the workbench surface a step's evidence opens.
 */
import type { Translations } from "@/core/i18n/locales/types";

import type { ActionAggregateKind, ActionDisplay } from "./action-display";

export function localizedActionVerb(
  display: ActionDisplay,
  t: Translations,
): string {
  const labels = t.messageGrouping.actionLabels;
  switch (display.labelKey) {
    case "create_file":
      return labels.createFile;
    case "edit_file":
      return labels.editFile;
    case "search_files":
      return labels.searchFiles;
    case "view_directory":
      return labels.viewDirectory;
    case "read_file":
      return labels.readFile;
    case "run_command":
      return labels.runCommand;
    case "search_web":
      return labels.searchWeb;
    case "browse_web":
      return labels.browseWeb;
    case "browser_click":
      return labels.browserClick;
    case "browser_type":
      return labels.browserType;
    case "browser_screenshot":
      return labels.browserScreenshot;
    case "browser_navigate":
      return labels.browserNavigate;
    case "browser_action":
      return labels.browserAction;
    case "update_plan":
      return labels.updatePlan;
    case "use_capability":
      return labels.useCapability;
    case "delegate_task":
      return labels.delegateTask;
    case "submit_result":
      return labels.submitResult;
    case "delete_file":
      return labels.deleteFile;
    case "move_file":
      return labels.moveFile;
    case "start_preview":
      return labels.startPreview;
    case "network_request":
      return labels.networkRequest;
    case "raw":
      return display.verb;
  }
}

export function localizedAggregateVerb(
  kind: ActionAggregateKind,
  count: number,
  t: Translations,
): string {
  const labels = t.messageGrouping.actionLabels;
  switch (kind) {
    case "file_write":
      return labels.aggregateFileWrite(count);
    case "file_read":
      return labels.aggregateFileRead(count);
    case "command":
      return labels.aggregateCommand(count);
    case "web_search":
      return labels.aggregateWebSearch(count);
    case "browser":
      return labels.aggregateBrowser(count);
    case "teammate":
      return labels.aggregateTeammate(count);
    case "todo":
      return labels.aggregateTodo(count);
    case "other":
      return labels.aggregateOther(count);
  }
}

/**
 * Workbench surface for one step's evidence. The workbench terminal tab is the
 * user's own interactive shell: it neither replays nor attaches to a command
 * the agent ran, so sending a recorded shell step there opens a fresh, empty
 * terminal. A shell step therefore lands on its trace (command + output).
 */
export function stepEvidenceTab(
  tab: ActionDisplay["workbenchTab"],
): ActionDisplay["workbenchTab"] {
  return tab === "terminal" ? "agent" : tab;
}
