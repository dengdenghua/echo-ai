/**
 * The 后台任务 section of the chat header's status menu: work in this
 * conversation that is not the reply being written — tasks paused or waiting
 * for a decision (they resume from their checkpoint) and sub-agents still
 * running. Hidden when there is none.
 */
import { BotIcon, PauseIcon } from "lucide-react";
import { useMemo } from "react";

import { DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/core/i18n/hooks";
import { useTasks } from "@/core/tasks/hooks";

import type { LiveToolEvent } from "./live-tool-timeline";

interface BackgroundRow {
  id: string;
  label: string;
  state: "paused" | "waiting" | "running";
}

export function useSessionBackgroundTasks(
  threadId: string | undefined,
  events: LiveToolEvent[],
): BackgroundRow[] {
  const { t } = useI18n();
  const tasks = useTasks("all");
  return useMemo(() => {
    const rows: BackgroundRow[] = [];
    if (threadId) {
      for (const [state, requests] of [
        ["paused", tasks.data?.paused ?? []],
        ["waiting", tasks.data?.pending ?? []],
      ] as const) {
        for (const request of requests) {
          if (request.thread_id !== threadId) continue;
          rows.push({
            id: request.task_id,
            label: request.note.trim() || t.backgroundTasks.unnamedTask,
            state,
          });
        }
      }
    }
    const running = new Map<string, string>();
    for (const event of events) {
      const key = event.subagentCodename || event.subAgentRole;
      if (!key || event.status !== "running") continue;
      running.set(key, event.agentName || event.subAgentRole || key);
    }
    for (const [key, name] of running) {
      rows.push({ id: `agent:${key}`, label: name, state: "running" });
    }
    return rows;
  }, [events, t.backgroundTasks.unnamedTask, tasks.data, threadId]);
}

export function SessionBackgroundTasks({
  rows,
  labelClassName,
}: {
  rows: BackgroundRow[];
  labelClassName: string;
}) {
  const { t } = useI18n();
  if (rows.length === 0) return null;
  const running = rows.filter((row) => row.state === "running").length;
  const stateLabel = {
    paused: t.backgroundTasks.paused,
    waiting: t.backgroundTasks.queued,
    running: t.backgroundTasks.running,
  };
  return (
    <>
      <DropdownMenuLabel
        className={`${labelClassName} flex items-center justify-between gap-3`}
      >
        {t.backgroundTasks.title}
        {running > 0 ? (
          <span>{t.backgroundTasks.activeCount(running)}</span>
        ) : null}
      </DropdownMenuLabel>
      <ul data-testid="session-background-tasks" className="space-y-0.5 px-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex min-h-7 items-center gap-2.5 text-xs"
            title={row.label}
          >
            {row.state === "running" ? (
              <BotIcon
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              <PauseIcon
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span
              className={
                row.state === "running"
                  ? "shrink-0 text-success"
                  : "shrink-0 text-warning"
              }
            >
              {stateLabel[row.state]}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
