import { ChevronDownIcon, ChevronUpIcon, UsersIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { LiveToolEvent } from "@/components/workspace/live-tool-timeline";
import { isAIMessage, isToolMessage, type Message } from "@/core/api/types";
import { isTeammateToolName } from "@/components/workspace/messages/action-display";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";
import { isInternalAutoParallelFailure } from "@/components/workspace/agent-workbench-utils";
import { KimiStyleSubagentCard } from "./inline-subagent-card";
import {
  compactSubagentTask,
  estimateProgressFromEventCount,
  firstString,
  parseToolContent,
  recordArrayFromUnknown,
  roleEmoji,
  stableAgentKey,
  type InlineSubagentInfo,
  type InlineSubagentStatus,
} from "./inline-subagent-helpers";
import { mergeInlineSubagentLists } from "./inline-subagent-merge";
export {
  compactSubagentTask,
  deriveSubagentMissionFromMessages,
  type InlineSubagentInfo,
} from "./inline-subagent-helpers";

const MAX_COLLAPSED_AGENTS = 6;

/** Extract progress (0-1) from a LiveToolEvent's input.progress or iteration info.
 *  Priority: input.progress.percent > iteration/iterationCount > null (no info). */
function extractProgressFromEvent(
  event: LiveToolEvent,
  totalIterations?: number,
): number | null {
  // 1. Direct percent from input.progress
  const progressObj = event.input?.progress;
  if (
    progressObj &&
    typeof progressObj === "object" &&
    !Array.isArray(progressObj)
  ) {
    const p = (progressObj as Record<string, unknown>).percent;
    if (typeof p === "number" && Number.isFinite(p)) {
      // Normalize: 0-1 → as-is, 0-100 → divide by 100
      const normalized = p > 1 ? p / 100 : p;
      return Math.max(0, Math.min(1, normalized));
    }
    const current = (progressObj as Record<string, unknown>).current;
    const total = (progressObj as Record<string, unknown>).total;
    if (typeof current === "number" && typeof total === "number" && total > 0) {
      return Math.max(0, Math.min(1, current / total));
    }
  }
  // 2. Iteration-based: event.iteration / totalIterations
  if (
    typeof event.iteration === "number" &&
    typeof totalIterations === "number" &&
    totalIterations > 0
  ) {
    return Math.max(0, Math.min(1, event.iteration / totalIterations));
  }
  return null;
}

export function deriveInlineSubagents(
  events: LiveToolEvent[],
): InlineSubagentInfo[] {
  // Phase 1: Build agentId → stableKey mapping from lifecycle/subagent events.
  // When a subagent is spawned, we get both its runtime agentId (UUID) and its role/codename.
  // We map the UUID to the human-readable role so later tool events (which only carry agentId)
  // get attributed to the same key as the spawn event (and match message-derived specs).
  const idMap = new Map<string, string>(); // runtime/codename alias → requested lane id
  for (const event of events) {
    const key = stableAgentKey(event);
    if (!key) continue;
    for (const alias of [event.agentId, event.subagentCodename]) {
      if (alias && alias !== "__main__" && alias !== key) {
        idMap.set(alias, key);
      }
    }
  }

  /** Resolve any event to its canonical stable key, using the id mapping. */
  const resolveKey = (e: LiveToolEvent): string | null => {
    if (e.agentId && e.agentId !== "__main__") {
      const mapped = idMap.get(e.agentId);
      if (mapped) return mapped;
    }
    if (e.subagentCodename) {
      const mapped = idMap.get(e.subagentCodename);
      if (mapped) return mapped;
    }
    return stableAgentKey(e);
  };

  const byId = new Map<string, InlineSubagentInfo>();
  const activityCount = new Map<string, number>();
  const totalIterations = new Map<string, number>();
  const realProgress = new Map<string, number>();

  // Phase 2: Single pass to accumulate counts and build agent records using resolved keys.
  for (const event of events) {
    if (isInternalAutoParallelFailure(event)) continue;
    const key = resolveKey(event);
    const isLifecycle =
      event.lifecycle === "spawned" || event.lifecycle === "finished";
    const isSubagentMarker = event.name === "subagent";
    const isSubagentEvent =
      isLifecycle ||
      Boolean(event.subagentCodename) ||
      (Boolean(event.parentToolUseId) && Boolean(event.subAgentRole)) ||
      (Boolean(event.agentId) &&
        event.agentId !== "__main__" &&
        Boolean(event.agentId && idMap.has(event.agentId)));

    if (key) {
      if (
        event.lifecycle === "finished" &&
        typeof event.iterationCount === "number"
      ) {
        totalIterations.set(key, event.iterationCount);
      }
      const prog = extractProgressFromEvent(event, totalIterations.get(key));
      if (prog !== null) {
        const existing = realProgress.get(key);
        if (existing === undefined || prog > existing)
          realProgress.set(key, prog);
      }
      if (!isLifecycle && !isSubagentMarker && isSubagentEvent) {
        activityCount.set(key, (activityCount.get(key) ?? 0) + 1);
      }
    }

    if (!isSubagentEvent || !key || key === "__main__") continue;

    const existing = byId.get(key);
    const outputObj = event.output as Record<string, unknown> | undefined;
    const outputIsString = typeof event.output === "string";
    const outputError = firstString(outputObj, ["error", "error_type"]);
    const outputIndicatesError =
      outputObj?.ok === false || Boolean(outputError);
    const isTerminalAgentEvent =
      event.lifecycle === "finished" ||
      (isSubagentMarker &&
        event.lifecycle === undefined &&
        (event.status === "done" || event.status === "error"));
    const status: InlineSubagentStatus = isTerminalAgentEvent
      ? event.status === "error" || outputIndicatesError
        ? "error"
        : "done"
      : event.status === "waiting_approval"
        ? "waiting"
        : "running";

    const task = compactSubagentTask(
      firstString(event.input, [
        "prompt_preview",
        "prompt",
        "task",
        "description",
        "query",
        "message",
      ]) ||
        event.thought ||
        existing?.task ||
        "",
    );
    const summary = isTerminalAgentEvent
      ? (outputIsString
          ? (event.output as string)
          : firstString(outputObj, [
              "summary",
              "result",
              "output",
              "thought",
              "observation",
              "answer",
              "content",
            ])) ||
        event.thought ||
        event.observation ||
        existing?.summary
      : existing?.summary;
    const filesTouched = Array.isArray(outputObj?.files_touched)
      ? (outputObj.files_touched as unknown[]).filter(
          (p): p is string => typeof p === "string",
        )
      : (event.filesTouched ?? existing?.filesTouchedCount ?? 0);
    const inputName = firstString(event.input, ["name", "display_name"]);
    const errorMsg =
      isTerminalAgentEvent && status === "error"
        ? (outputIsString
            ? (event.output as string)
            : outputError || firstString(outputObj, ["message"])) ||
          event.thought ||
          existing?.error
        : existing?.error;

    let progress: number;
    if (status === "done") {
      progress = 1.0;
    } else if (status === "error") {
      progress =
        realProgress.get(key) ??
        (totalIterations.get(key) && typeof event.iteration === "number"
          ? Math.min(0.9, event.iteration / totalIterations.get(key)!)
          : null) ??
        ((activityCount.get(key) ?? 0) > 0
          ? estimateProgressFromEventCount(activityCount.get(key)!)
          : 0.3);
    } else {
      progress =
        realProgress.get(key) ??
        (totalIterations.get(key) && typeof event.iteration === "number"
          ? Math.min(0.9, event.iteration / totalIterations.get(key)!)
          : null) ??
        estimateProgressFromEventCount(activityCount.get(key) ?? 0);
    }

    byId.set(key, {
      id: key,
      name:
        event.subagentRoleDisplayName ||
        inputName ||
        event.subagentCodename ||
        existing?.name ||
        event.subAgentRole ||
        event.agentName ||
        key,
      role: event.subAgentRole ?? existing?.role,
      avatar: event.subagentAvatar ?? existing?.avatar,
      avatarUrl: event.subagentAvatarUrl ?? existing?.avatarUrl,
      status:
        existing?.status === "done" || existing?.status === "error"
          ? existing.status
          : status,
      task: task || existing?.task || "",
      summary:
        summary ||
        event.observation?.slice(0, 200) ||
        (event.thought ? event.thought.slice(0, 200) : existing?.summary),
      filesTouchedCount: Array.isArray(filesTouched)
        ? Math.max(filesTouched.length, existing?.filesTouchedCount ?? 0)
        : typeof filesTouched === "number"
          ? Math.max(filesTouched, existing?.filesTouchedCount ?? 0)
          : (existing?.filesTouchedCount ?? 0),
      iterationCount:
        event.iterationCount ??
        (typeof outputObj?.iteration_count === "number"
          ? outputObj.iteration_count
          : existing?.iterationCount),
      error: isTerminalAgentEvent && status === "done" ? undefined : errorMsg,
      progress,
    });
  }
  return Array.from(byId.values());
}

export function deriveSubagentsFromMessages(
  messages: Message[],
): InlineSubagentInfo[] {
  const results: InlineSubagentInfo[] = [];
  const toolResults = new Map<string, { data: unknown; error: boolean }>();

  for (const msg of messages) {
    if (isToolMessage(msg) && msg.tool_call_id) {
      const parsed = parseToolContent(msg);
      toolResults.set(msg.tool_call_id, {
        data: parsed,
        error: msg.status === "error",
      });
    }
  }

  let agentIndex = 0;
  for (const msg of messages) {
    if (!isAIMessage(msg)) continue;
    const aiMsg = msg;
    const toolCalls = aiMsg.tool_calls ?? [];

    for (const tc of toolCalls) {
      if (!isTeammateToolName(tc.name)) continue;
      // Legacy "task" tools are handled by SubtaskCard/ParallelSubtasksGrid, not here.
      if (tc.name.toLowerCase() === "task") continue;

      const args = tc.args ?? {};
      if (
        tc.name.toLowerCase() === "subagent" &&
        firstString(args, ["error", "error_type"]).toLowerCase() ===
          "empty_result_contract_violation"
      ) {
        continue;
      }
      const toolResult = tc.id ? toolResults.get(tc.id) : undefined;
      let result = toolResult?.data;
      // Realtime history folds command execution back into
      // ``tool_call.args.output`` instead of always retaining a separate tool
      // message. Treat that envelope as a settled result too; otherwise an
      // invalid pre-spawn call remains "running" and is later promoted to a
      // fake completed Agent card when the turn settles.
      const embeddedOutput = firstString(args, ["output"]);
      if (result === undefined && embeddedOutput) {
        try {
          result = JSON.parse(embeddedOutput);
        } catch {
          // Older previews may contain plain text or truncated JSON.
          result = embeddedOutput;
        }
      }
      const embeddedToolErrored =
        /^\s*\((?:工具失败|tool failed)\)/i.test(embeddedOutput) ||
        /\berror=structured_error\b/i.test(embeddedOutput);
      const hasToolResult = Boolean(toolResult) || Boolean(embeddedOutput);
      const toolErrored = Boolean(toolResult?.error) || embeddedToolErrored;

      const resultObj =
        result && typeof result === "object" && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : null;
      const successes = Array.isArray(resultObj?.successes)
        ? (resultObj.successes as Array<Record<string, unknown>>)
        : [];
      const failures = Array.isArray(resultObj?.failures)
        ? (resultObj.failures as Array<Record<string, unknown>>)
        : [];
      const resultIsString = typeof result === "string";

      // Command-execution history stores nested preview values as JSON text.
      // Decode legacy stringified batches here; otherwise the whole parallel
      // call is mistaken for one anonymous fourth Agent.
      const specs = recordArrayFromUnknown(
        args.specs ?? args.agents ?? args.tasks,
      );

      if (specs && specs.length > 0) {
        // The dispatcher rejected the batch before spawning any child. Keep
        // that failure in the execution trace, but do not manufacture one
        // Agent card per unexecuted spec.
        if (
          embeddedToolErrored &&
          successes.length === 0 &&
          failures.length === 0
        ) {
          continue;
        }
        for (let i = 0; i < specs.length; i++) {
          const spec = specs[i];
          if (!spec) continue;
          const agentId =
            typeof spec.agent_id === "string"
              ? spec.agent_id
              : typeof spec.name === "string"
                ? spec.name
                : typeof spec.role === "string"
                  ? spec.role
                  : `spec-${i}`;
          const role = typeof spec.role === "string" ? spec.role : undefined;

          const success = successes.find(
            (s) =>
              (typeof s.agent_id === "string" && s.agent_id === agentId) ||
              (typeof s.spec_index === "number" && s.spec_index === i) ||
              (typeof s.role === "string" && role && s.role === role),
          );
          const failure = failures.find(
            (f) =>
              (typeof f.agent_id === "string" && f.agent_id === agentId) ||
              (typeof f.spec_index === "number" && f.spec_index === i) ||
              (typeof f.role === "string" && role && f.role === role),
          );

          const matched = success || failure;
          const displayName = matched
            ? firstString(matched, ["display_name", "name", "codename"])
            : undefined;
          const codename = matched
            ? typeof matched.codename === "string"
              ? matched.codename
              : undefined
            : undefined;
          const specName =
            typeof spec.name === "string"
              ? spec.name
              : typeof spec.codename === "string"
                ? spec.codename
                : undefined;
          const name = displayName || codename || specName || role || agentId;

          const task = compactSubagentTask(
            firstString(spec, [
              "prompt_preview",
              "prompt",
              "goal",
              "task",
              "description",
              "query",
              "message",
            ]) ||
              (matched
                ? firstString(matched, ["task_label", "task_preview"]) || ""
                : ""),
          );

          let status: InlineSubagentStatus = hasToolResult
            ? failure
              ? "error"
              : success
                ? "done"
                : toolErrored || resultObj?.ok === false
                  ? "error"
                  : hasToolResult
                    ? "done"
                    : "running"
            : "running";

          let summary = "";
          let error = "";
          let iterationCount: number | undefined;
          let filesTouched = 0;

          if (success) {
            summary =
              firstString(success, [
                "output",
                "result",
                "summary",
                "content",
              ]) || "";
            if (typeof success.iteration_count === "number")
              iterationCount = success.iteration_count;
            if (Array.isArray(success.files_touched))
              filesTouched = success.files_touched.length;
          } else if (failure) {
            error =
              firstString(failure, ["error", "message"]) ||
              (typeof failure.error_type === "string"
                ? failure.error_type
                : "");
            summary = firstString(failure, ["partial_output", "output"]) || "";
            if (typeof failure.iteration_count === "number")
              iterationCount = failure.iteration_count;
            if (Array.isArray(failure.files_touched))
              filesTouched = failure.files_touched.length;
          } else if (resultIsString && hasToolResult) {
            summary = result as string;
            if (toolErrored) error = result as string;
          } else if (resultObj && hasToolResult && !success && !failure) {
            summary =
              firstString(resultObj, [
                "output",
                "result",
                "summary",
                "content",
              ]) || "";
            error = firstString(resultObj, ["error", "message"]) || "";
            if (resultObj.ok === false || toolErrored) status = "error";
          }

          const resultAvatar =
            matched && typeof matched.avatar === "string"
              ? matched.avatar
              : undefined;
          const specAvatar =
            typeof spec.avatar === "string" ? spec.avatar : undefined;

          // Progress from message data: done/error → 1.0, running → no info (undefined → show starting state)
          const progress =
            status === "done" ? 1.0 : status === "error" ? 0.5 : undefined;

          results.push({
            id: agentId,
            name,
            role: role !== name ? role : undefined,
            avatar: resultAvatar ?? specAvatar ?? roleEmoji(role ?? name),
            avatarUrl:
              firstString(matched, ["avatar_url"]) ||
              firstString(spec, ["avatar_url"]) ||
              undefined,
            status,
            task,
            summary: summary || undefined,
            filesTouchedCount: filesTouched,
            iterationCount,
            error: error || undefined,
            index: agentIndex++,
            progress,
          });
        }
      } else {
        // Single agent call (call_agent, spawn_agent, delegate_agent, or "subagent" record).
        // Also handles MCP server-prefixed names (e.g. "team.call_agent").
        const agentId =
          typeof args.requested_agent_id === "string"
            ? args.requested_agent_id
            : typeof args.requestedAgentId === "string"
              ? args.requestedAgentId
              : typeof args.agent_id === "string"
                ? args.agent_id
                : typeof args.subagent_id === "string"
                  ? args.subagent_id
                  : (tc.id ??
                    `call-${Math.random().toString(36).slice(2, 10)}`);
        const role = typeof args.role === "string" ? args.role : undefined;
        const name =
          firstString(resultObj ?? undefined, [
            "display_name",
            "role_display_name",
          ]) ||
          (typeof args.name === "string"
            ? args.name
            : typeof args.display_name === "string"
              ? args.display_name
              : typeof args.codename === "string"
                ? args.codename
                : (role ?? agentId));
        const task = compactSubagentTask(
          firstString(args, [
            "prompt_preview",
            "prompt",
            "goal",
            "task",
            "description",
            "query",
            "message",
          ]) ||
            (typeof args.summary === "string"
              ? args.summary.slice(0, 100)
              : "") ||
            "",
        );

        let status: InlineSubagentStatus = hasToolResult ? "done" : "running";
        let summary = typeof args.summary === "string" ? args.summary : "";
        let error = typeof args.error === "string" ? args.error : "";
        let filesTouched = 0;
        let iterationCount: number | undefined;

        // Determine status from args.status (for "subagent" record items) or tool result.
        if (typeof args.status === "string") {
          const argStatus = args.status.toLowerCase();
          if (
            argStatus === "done" ||
            argStatus === "completed" ||
            argStatus === "finished"
          ) {
            status = "done";
          } else if (argStatus === "error" || argStatus === "failed") {
            status = "error";
          } else if (argStatus === "running") {
            status = "running";
          } else if (
            argStatus === "waiting_approval" ||
            argStatus === "waiting"
          ) {
            status = "waiting";
          }
        }

        if (resultObj) {
          if (
            resultObj.ok === false ||
            resultObj.success === false ||
            toolErrored
          )
            status = "error";
          else if (hasToolResult) status = "done";
          summary =
            firstString(resultObj, [
              "output",
              "result",
              "summary",
              "content",
            ]) || summary;
          error = firstString(resultObj, ["error", "message"]) || error;
          if (typeof resultObj.iteration_count === "number")
            iterationCount = resultObj.iteration_count;
          if (Array.isArray(resultObj.files_touched))
            filesTouched = resultObj.files_touched.length;
        } else if (resultIsString) {
          if (toolErrored) {
            status = "error";
            error = result as string;
          } else status = "done";
          summary = result as string;
        } else if (toolErrored) {
          status = "error";
        }

        if (Array.isArray(args.files_touched)) {
          filesTouched = Math.max(
            filesTouched,
            (args.files_touched as unknown[]).length,
          );
        }

        const resultAvatar =
          resultObj && typeof resultObj.avatar === "string"
            ? resultObj.avatar
            : undefined;
        const specAvatar =
          typeof args.avatar === "string" ? args.avatar : undefined;

        const progress =
          status === "done" ? 1.0 : status === "error" ? 0.5 : undefined;

        results.push({
          id: agentId,
          name,
          role: role !== name ? role : undefined,
          avatar: resultAvatar ?? specAvatar ?? roleEmoji(role ?? name),
          avatarUrl:
            firstString(resultObj ?? undefined, ["avatar_url"]) ||
            firstString(args, ["avatar_url"]) ||
            undefined,
          status,
          task,
          summary: summary || undefined,
          filesTouchedCount: filesTouched,
          iterationCount,
          error: error || undefined,
          index: agentIndex++,
          progress,
        });
      }
    }
  }
  // Dispatch specs, spawn markers, child tool rows and finish markers are
  // intentionally redundant transports. Fold all of them onto the requested
  // lane id before rendering so one worker never appears as 2-3 cards.
  const deduplicated = new Map<string, InlineSubagentInfo>();
  for (const candidate of results) {
    const existing = deduplicated.get(candidate.id);
    if (!existing) {
      deduplicated.set(candidate.id, candidate);
      continue;
    }
    const terminal = new Set<InlineSubagentStatus>(["done", "error"]);
    // Failure is sticky. Legacy fan-out history can contain a failed member
    // marker followed by a parent batch envelope that says the overall call
    // completed. The parent completion must never repaint that member green.
    const status =
      candidate.status === "error" || existing.status === "error"
        ? "error"
        : terminal.has(candidate.status)
          ? candidate.status
          : terminal.has(existing.status)
            ? existing.status
            : candidate.status;
    deduplicated.set(candidate.id, {
      ...existing,
      name: candidate.name || existing.name,
      role: candidate.role ?? existing.role,
      avatar: candidate.avatar ?? existing.avatar,
      avatarUrl: candidate.avatarUrl ?? existing.avatarUrl,
      status,
      task: candidate.task || existing.task,
      summary: candidate.summary ?? existing.summary,
      filesTouchedCount: Math.max(
        existing.filesTouchedCount,
        candidate.filesTouchedCount,
      ),
      iterationCount: candidate.iterationCount ?? existing.iterationCount,
      error: candidate.error ?? existing.error,
      progress:
        status === "done" ? 1 : (candidate.progress ?? existing.progress),
    });
  }
  return Array.from(deduplicated.values()).map((agent, index) => ({
    ...agent,
    index,
  }));
}

export function InlineSubagentCards({
  events,
  agents: preDerivedAgents,
  mission,
  settled = false,
  turnIndex,
  className,
  variant = "cluster",
}: {
  events?: LiveToolEvent[];
  agents?: InlineSubagentInfo[];
  mission?: string;
  settled?: boolean;
  turnIndex?: number;
  className?: string;
  variant?: "cluster" | "paired";
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const eventAgents = useMemo(
    () =>
      (events ? deriveInlineSubagents(events) : []).map((agent) =>
        agent.task || !mission ? agent : { ...agent, task: mission },
      ),
    [events, mission],
  );
  const preparedAgents = useMemo(
    () =>
      preDerivedAgents?.map((agent) =>
        agent.task || !mission ? agent : { ...agent, task: mission },
      ),
    [mission, preDerivedAgents],
  );

  const mergedAgents = useMemo(
    () => mergeInlineSubagentLists(eventAgents, preparedAgents),
    [eventAgents, preparedAgents],
  );
  const agents = useMemo(() => {
    if (!settled) return mergedAgents;
    return mergedAgents.map((agent) => {
      if (agent.status === "done" || agent.status === "error") return agent;
      const summary = agent.summary?.trim() ?? "";
      const failed =
        Boolean(agent.error) ||
        /^(?:connecterror|error\b|failed\b|failure\b|exception\b)|\b(?:exceeded round cap|timed out|connection failed)\b|^(?:失败|错误|超时|中断)/i.test(
          summary,
        );
      return {
        ...agent,
        status: failed ? ("error" as const) : ("done" as const),
        progress: failed ? (agent.progress ?? 0.5) : 1,
      };
    });
  }, [mergedAgents, settled]);

  if (agents.length === 0) return null;

  const runningCount = agents.filter(
    (a) => a.status === "running" || a.status === "waiting",
  ).length;
  const errorCount = agents.filter((a) => a.status === "error").length;
  const doneCount = agents.filter((a) => a.status === "done").length;
  const hiddenCount = Math.max(0, agents.length - MAX_COLLAPSED_AGENTS);
  const visibleAgents = expanded
    ? agents
    : agents.slice(0, MAX_COLLAPSED_AGENTS);

  if (variant === "paired") {
    return (
      <div
        data-testid={
          visibleAgents[0]
            ? `agent-task-strip-${visibleAgents[0].id}`
            : undefined
        }
        className={cn("inline-flex", className)}
      >
        {visibleAgents.map((agent) => (
          <KimiStyleSubagentCard
            key={agent.id}
            agent={agent}
            previewEnabled={false}
            turnIndex={turnIndex}
            paired
          />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("my-1.5", className)}>
      {/* Kimi-style container: header + agents in one light card */}
      <div className="rounded-md bg-muted/30 dark:bg-muted/15 px-1 py-1">
        {/* Header inside the card */}
        {agents.length > 1 && (
          <div className="flex items-center gap-1.5 px-2 py-0.5">
            <UsersIcon className="size-[13px] text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {t.message.agentCluster}
            </span>
            <span className="text-xs text-muted-foreground">|</span>
            <span className="text-xs text-muted-foreground">
              {t.message.agentProgressSummary(
                agents.length,
                doneCount,
                errorCount,
              )}
              {runningCount > 0
                ? ` · ${runningCount} ${t.subagents.running}`
                : ""}
            </span>
          </div>
        )}

        {/* Agent rows */}
        <div
          className="mt-0.5"
          onPointerMove={() => {
            if (!previewEnabled) setPreviewEnabled(true);
          }}
          onFocusCapture={() => {
            if (!previewEnabled) setPreviewEnabled(true);
          }}
        >
          {visibleAgents.map((agent) => (
            <KimiStyleSubagentCard
              key={agent.id}
              agent={agent}
              previewEnabled={previewEnabled}
              turnIndex={turnIndex}
            />
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setPreviewEnabled(false);
                setExpanded((value) => !value);
              }}
              className="mt-0.5 flex w-full items-center justify-center gap-1 rounded border border-dashed border-border/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
            >
              {expanded ? (
                <ChevronUpIcon className="size-3.5" />
              ) : (
                <ChevronDownIcon className="size-3.5" />
              )}
              {expanded
                ? t.message.collapseAgents
                : t.message.showMoreAgents(hiddenCount)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
