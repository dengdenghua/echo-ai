import { swallow } from "@/core/utils/log";

import type { LiveToolEvent, TimelineT } from "./live-tool-timeline-types";
import {
  actionStatusLabel,
  asRecord,
  compactMiddle,
  countItems,
  elapsedSeconds,
  extractSourceLabels,
  stringInput,
} from "./live-tool-timeline-format";
import { isSkillToolName } from "./tool-action-kind";

export function getToolLabels(t: TimelineT): Record<string, string> {
  return {
    bash: t.liveTools.terminal,
    exec_shell: t.liveTools.terminal,
    shell_command: t.liveTools.terminal,
    write_file: t.liveTools.writeFile,
    write_text_file: t.liveTools.writeFile,
    create_file: t.liveTools.writeFile,
    edit_code: t.liveTools.editFile,
    edit_text_file: t.liveTools.editFile,
    str_replace: t.liveTools.editFile,
    read_file: t.liveTools.readFile,
    read_text_file: t.liveTools.readFile,
    fetch_url: t.liveToolTimeline.browsingPage,
    list_cwd: t.liveTools.searchFiles,
    glob: t.liveTools.searchFiles,
    grep: t.liveTools.searchContent,
    todo_write: t.todoList.title,
    call_agent: t.liveToolTimeline.callSubAgentShort,
    call_agent_parallel: t.liveToolTimeline.subtaskAggregation,
    bb_read: t.liveToolTimeline.readBlackboardShort,
    bb_write: t.liveToolTimeline.writeBlackboardShort,
    bb_keys: t.liveToolTimeline.readBlackboardDirectory,
    "deep-research-swarm": t.messageGrouping.searchSources,
    "report-writing": t.messageGrouping.runAction,
    docx: t.messageGrouping.updateFile,
    web_search: t.liveTools.webSearch,
    apply_skill: t.liveToolTimeline.invokeSkillProcess,
    list_learned_skills: t.messageGrouping.runAction,
    learn_skill_from_text: t.liveToolTimeline.invokeSkillProcess,
    planning: t.liveToolTimeline.understandTask,
    agent_thought: t.liveToolTimeline.thinking,
    team_swarm: t.liveToolTimeline.subtaskAggregation,
    team_routing: t.liveToolTimeline.focusedDelegation,
    git_status: t.liveTools.gitStatus,
    git_commit: t.liveTools.gitCommit,
    git_diff: t.liveTools.gitDiff,
    stream_recovery: t.liveTools.streamRecovery,
    model_gateway: t.liveToolTimeline.connectRuntime,
    model_reasoning: t.liveToolTimeline.thinking,
  };
}

export function researchLogText(
  event: LiveToolEvent,
  t: TimelineT,
): {
  label: string;
  detail?: string;
  sources?: string[];
} | null {
  if (event.name === "web_search") {
    const query =
      typeof event.input?.query === "string" ? event.input.query.trim() : "";
    const count =
      countItems(event.output, ["results", "items", "sources"]) ??
      (typeof event.input?.max_results === "number"
        ? event.input.max_results
        : null);
    if (event.status === "running") {
      return {
        label: t.liveToolTimeline.searchingWeb,
        detail: query ? t.liveToolTimeline.searchingQuery(query) : undefined,
      };
    }
    return {
      label: t.liveToolTimeline.searchedPages(count ?? undefined),
      detail: query
        ? t.liveToolTimeline.searchResultCovering(query)
        : t.liveToolTimeline.searchResultInContext,
      sources: extractSourceLabels(event.output),
    };
  }

  if (event.name === "fetch_url") {
    const url =
      typeof event.input?.url === "string" ? event.input.url.trim() : "";
    const source = url
      ? (() => {
          try {
            return new URL(url).hostname.replace(/^www\./, "");
          } catch (e) {
            swallow(e);
            return url;
          }
        })()
      : undefined;
    return {
      label:
        event.status === "running"
          ? t.liveToolTimeline.browsingPage
          : t.liveToolTimeline.browsedOnePage,
      detail: source
        ? t.liveToolTimeline.sourceFrom(source)
        : t.liveToolTimeline.pageOpenedAndExtracted,
      sources: source ? [source] : extractSourceLabels(event.output, 1),
    };
  }

  return null;
}

export function swarmLogText(
  event: LiveToolEvent,
  t: TimelineT,
): {
  label: string;
  detail?: string;
} | null {
  if (event.name === "call_agent_parallel") {
    const specs = Array.isArray(event.input?.specs) ? event.input.specs : [];
    const roles = specs
      .map((spec) => asRecord(spec))
      .map((spec) => {
        const role = spec?.agent_id ?? spec?.role ?? spec?.name;
        return typeof role === "string" ? role : "";
      })
      .filter(Boolean)
      .slice(0, 5);
    const count = specs.length;
    return {
      label:
        event.status === "error"
          ? t.liveToolTimeline.parallelDispatchFailed(count || undefined)
          : event.status === "running"
            ? t.liveToolTimeline.parallelDispatching(count || undefined)
            : t.liveToolTimeline.parallelTasksReturned(count || undefined),
      detail:
        event.status === "error"
          ? undefined
          : roles.length > 0
            ? t.liveToolTimeline.rolesWithNextStep(roles.join(" / "))
            : t.liveToolTimeline.subtaskAggregation,
    };
  }

  if (event.name === "call_agent") {
    const role = stringInput(event.input, ["agent_id", "role", "name"]);
    return {
      label: role
        ? t.liveToolTimeline.callSubAgent(role)
        : t.liveToolTimeline.callSubAgentShort,
      detail: t.liveToolTimeline.focusedDelegation,
    };
  }

  if (event.name === "bb_write") {
    const key = stringInput(event.input, ["key"]);
    return {
      label: key
        ? t.liveToolTimeline.writeBlackboard(compactMiddle(key, 60))
        : t.liveToolTimeline.writeBlackboardShort,
      detail: t.liveToolTimeline.saveBlackboardFinding,
    };
  }

  if (event.name === "bb_read" || event.name === "bb_keys") {
    const key = stringInput(event.input, ["key"]);
    return {
      label:
        event.name === "bb_keys"
          ? t.liveToolTimeline.readBlackboardDirectory
          : key
            ? t.liveToolTimeline.readBlackboard(compactMiddle(key, 60))
            : t.liveToolTimeline.readBlackboardShort,
      detail: t.liveToolTimeline.pullParallelResults,
    };
  }

  return null;
}

export function codeLogText(
  event: LiveToolEvent,
  t: TimelineT,
): {
  label: string;
  detail?: string;
} | null {
  if (event.name === "agent_thought") {
    return {
      label: t.liveToolTimeline.thoughtDetailLabel(
        event.iteration || undefined,
      ),
      detail: event.thought ?? t.liveToolTimeline.modelPublicReasoningFragment,
    };
  }

  if (event.name === "model_reasoning") {
    const outputRecord = asRecord(event.output);
    const content =
      typeof outputRecord?.content === "string"
        ? outputRecord.content
        : typeof event.output === "string"
          ? event.output
          : "";
    return {
      label: t.liveToolTimeline.modelPublicReasoningStream,
      detail: content
        ? compactMiddle(content, 220)
        : t.liveToolTimeline.modelOutputtingReasoning,
    };
  }

  if (isSkillToolName(event.name)) {
    const skillName =
      stringInput(event.input, ["skill", "skill_name", "name"]) || event.name;
    const request = stringInput(event.input, [
      "user_request",
      "request",
      "query",
      "task",
      "prompt",
    ]);
    return {
      label: actionStatusLabel(
        event,
        t.liveToolTimeline.applyingSkill,
        compactMiddle(skillName, 80),
      ),
      detail: request
        ? compactMiddle(request, 180)
        : t.liveToolTimeline.invokeSkillProcess,
    };
  }

  if (event.name === "planning") {
    const request = stringInput(event.input, [
      "task",
      "prompt",
      "description",
      "summary",
    ]);
    return {
      label: actionStatusLabel(event, t.liveToolTimeline.planningNextStep),
      detail: request
        ? compactMiddle(request, 180)
        : t.liveToolTimeline.modelOrganizingNextStep,
    };
  }

  if (event.name === "turn_request") {
    return {
      label: t.liveToolTimeline.understandTask,
      detail: t.liveToolTimeline.readingUserRequirements,
    };
  }

  if (event.name === "stream_connection") {
    return {
      label: t.liveToolTimeline.connectRuntime,
      detail: t.liveToolTimeline.establishingCallbackChannel,
    };
  }

  if (event.name === "response_stream") {
    return {
      label: t.liveToolTimeline.renderingModelOutput,
      detail: t.liveToolTimeline.incrementalTextReceived,
    };
  }

  if (event.name === "model_gateway") {
    const seconds = elapsedSeconds(event.input);
    if (event.status === "running") {
      return {
        label: actionStatusLabel(event, t.liveToolTimeline.planningNextStep),
        detail:
          seconds > 0
            ? t.liveToolTimeline.modelOrganizingNextStepWithWait(seconds)
            : t.liveToolTimeline.modelOrganizingNextStep,
      };
    }
    if (event.status === "error") {
      return {
        label: t.liveToolTimeline.modelOutputIncomplete,
        detail: t.liveToolTimeline.providerRejected,
      };
    }
    return {
      label: t.liveToolTimeline.modelOutputReceived,
      detail: t.liveToolTimeline.modelStartedReturning,
    };
  }

  const path = stringInput(event.input, [
    "path",
    "file_path",
    "target_path",
    "cwd",
  ]);
  const command = stringInput(event.input, ["command", "cmd", "script"]);
  const pattern = stringInput(event.input, ["pattern", "query"]);
  const description = stringInput(event.input, ["description", "summary"]);
  const lineStart = stringInput(event.input, [
    "line_start",
    "start_line",
    "start",
  ]);
  const lineEnd = stringInput(event.input, ["line_end", "end_line", "end"]);
  const lineSuffix =
    lineStart && lineEnd
      ? ` (lines ${lineStart}-${lineEnd})`
      : lineStart
        ? ` (line ${lineStart})`
        : "";

  if (event.name === "read_file" || event.name === "read_text_file") {
    return {
      label: actionStatusLabel(
        event,
        t.liveToolTimeline.readingFile,
        `${compactMiddle(path || "file")}${lineSuffix}`,
      ),
      detail: path ? undefined : t.liveToolTimeline.readFileToUnderstand,
    };
  }

  if (event.name === "list_cwd") {
    return {
      label: actionStatusLabel(
        event,
        t.liveToolTimeline.browsingDirectory,
        compactMiddle(path || "."),
      ),
      detail: t.liveToolTimeline.viewDirectoryStructure,
    };
  }

  if (event.name === "glob") {
    return {
      label: actionStatusLabel(
        event,
        t.liveToolTimeline.searchingFiles,
        compactMiddle(pattern || path || "*"),
      ),
      detail: path ? t.liveToolTimeline.scopePath(path) : undefined,
    };
  }

  if (event.name === "grep") {
    return {
      label: actionStatusLabel(
        event,
        t.liveToolTimeline.searchingText,
        compactMiddle(pattern || "pattern"),
      ),
      detail: path ? t.liveToolTimeline.scopePath(path) : undefined,
    };
  }

  if (
    event.name === "bash" ||
    event.name === "exec_shell" ||
    event.name === "shell_command"
  ) {
    return {
      label: actionStatusLabel(
        event,
        t.liveToolTimeline.runningCommand,
        compactMiddle(description || command || "command"),
      ),
      detail: command && description ? command : undefined,
    };
  }

  if (
    event.name === "write_file" ||
    event.name === "write_text_file" ||
    event.name === "create_file"
  ) {
    const creating = event.name === "create_file";
    return {
      label: actionStatusLabel(
        event,
        creating
          ? t.liveToolTimeline.creatingFile
          : t.liveToolTimeline.writingFile,
        compactMiddle(path || "file"),
      ),
      detail: t.liveToolTimeline.writeFileContent,
    };
  }

  if (
    event.name === "edit_code" ||
    event.name === "edit_text_file" ||
    event.name === "str_replace"
  ) {
    return {
      label: actionStatusLabel(
        event,
        t.liveToolTimeline.editingFile,
        compactMiddle(path || "file"),
      ),
      detail: pattern
        ? t.liveToolTimeline.matchPattern(compactMiddle(pattern))
        : undefined,
    };
  }

  if (event.name === "git_status") {
    return {
      label: actionStatusLabel(event, t.liveToolTimeline.readingGitStatus),
    };
  }
  if (event.name === "git_diff") {
    return {
      label: actionStatusLabel(event, t.liveToolTimeline.readingGitDiff),
    };
  }
  if (event.name === "git_commit") {
    return {
      label: actionStatusLabel(event, t.liveToolTimeline.committingGit),
    };
  }

  return null;
}

export function researchAdjustmentSummary(
  event: LiveToolEvent,
  t: TimelineT,
): string | undefined {
  if (event.name !== "web_search") return undefined;
  if (event.status === "running") {
    return t.liveToolTimeline.collectingEvidence;
  }
  if (event.status === "error") {
    return t.liveToolTimeline.searchRoundFailed;
  }
  const query = typeof event.input?.query === "string" ? event.input.query : "";
  if (/规模|增[长長]|CAGR|market size|forecast/i.test(query)) {
    return t.liveToolTimeline.marketSizeLeads;
  }
  if (
    /品牌|竞争|格局|company|companies|Oura|Eight Sleep|床垫|床墊/i.test(query)
  ) {
    return t.liveToolTimeline.competitionLeads;
  }
  if (/技术|technology|AI|sensor|wearable|产品|product/i.test(query)) {
    return t.liveToolTimeline.technologyLeads;
  }
  if (/消费|需求|痛点|睡眠经济|consumer|demand|pain/i.test(query)) {
    return t.liveToolTimeline.demandLeads;
  }
  return t.liveToolTimeline.roundResultsRead;
}

export function statusText(event: LiveToolEvent, t: TimelineT): string {
  switch (event.status) {
    case "running":
      return t.liveToolTimeline.statusRunning;
    case "done":
      return t.liveToolTimeline.statusDone;
    case "interrupted":
      return t.liveToolTimeline.statusInterrupted;
    case "error":
      return t.liveToolTimeline.statusFailed;
    case "waiting_approval":
      return t.liveToolTimeline.statusWaitingApproval;
    default:
      return "";
  }
}

export function detailTitle(
  t: TimelineT,
  key:
    | "input"
    | "thought"
    | "publicReasoning"
    | "result"
    | "observation"
    | "preview",
): string {
  return t.liveToolTimeline.detailTitles[key];
}
