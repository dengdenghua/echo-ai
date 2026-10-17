import { RefreshCwIcon, XIcon } from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import type { RemoteTaskRecord, TaskResult } from "./a2a-agents-types";

// ---------------------------------------------------------------------------
// Task result · status, agent response and artifacts
// ---------------------------------------------------------------------------

export function TaskResultView({ taskResult }: { taskResult: TaskResult }) {
  const { t } = useI18n();
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium",
            (taskResult.lifecycle_status ?? taskResult.status.state) ===
              "completed" || taskResult.status.state === "3"
              ? "bg-success/10 text-success"
              : (taskResult.lifecycle_status ?? taskResult.status.state) ===
                    "failed" || taskResult.status.state === "4"
                ? "bg-destructive/10 text-destructive"
                : "bg-info/10 text-info",
          )}
        >
          {taskResult.lifecycle_status ?? taskResult.status.state}
        </span>
        <span className="text-muted-foreground text-xs">
          Task {taskResult.id.slice(0, 8)}
        </span>
      </div>

      {/* Show agent response */}
      {taskResult.messages
        .filter((m) => m.role.toLowerCase().includes("agent"))
        .map((msg, i) => (
          <div key={i} className="mt-2 rounded-lg bg-muted/30 px-3 py-2">
            {msg.parts.map((part, j) => (
              <p key={j} className="text-xs leading-relaxed">
                {part.text || t.a2a.nonTextContent}
              </p>
            ))}
          </div>
        ))}

      {/* Show artifacts */}
      {taskResult.artifacts.length > 0 && (
        <div className="mt-2">
          <span className="text-muted-foreground text-xs">
            {t.a2a.artifacts}: {taskResult.artifacts.length}
          </span>
          {taskResult.artifacts.map((artifact, i) => (
            <div key={i} className="mt-1 rounded-lg border px-3 py-2 text-xs">
              <span className="font-medium">
                {artifact.name || `Artifact ${i + 1}`}
              </span>
              {artifact.parts.map((part, j) =>
                part.type === "file" && part.raw !== undefined ? (
                  <button
                    key={j}
                    type="button"
                    className="mt-1 block text-primary underline"
                    onClick={() => {
                      const bytes = Uint8Array.from(atob(part.raw!), (char) =>
                        char.charCodeAt(0),
                      );
                      const url = URL.createObjectURL(
                        new Blob([bytes], {
                          type: "application/octet-stream",
                        }),
                      );
                      const link = document.createElement("a");
                      link.href = url;
                      link.download =
                        (part.filename || artifact.name || "download")
                          .split(/[\\/]/)
                          .pop() || "download";
                      link.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}
                  >
                    ↓ {part.filename || artifact.name || t.a2a.binaryContent}
                  </button>
                ) : (
                  <p
                    key={j}
                    className="text-muted-foreground mt-1 leading-relaxed"
                  >
                    {part.text || t.a2a.binaryContent}
                  </p>
                ),
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Durable task lifecycle · history with refresh / cancel
// ---------------------------------------------------------------------------

export function TaskHistoryList({
  tasks,
  tasksLoading,
  taskAction,
  onRefresh,
  onSelectResult,
  onTaskAction,
}: {
  tasks: RemoteTaskRecord[];
  tasksLoading: boolean;
  taskAction: string | null;
  onRefresh: () => void;
  onSelectResult: (result: TaskResult | null) => void;
  onTaskAction: (localTaskId: string, action: "refresh" | "cancel") => void;
}) {
  const { t } = useI18n();
  return (
    <div className="border-t px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {t.a2a.taskHistory}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={tasksLoading}
          className="text-muted-foreground hover:text-foreground rounded p-1"
          aria-label={t.a2a.refresh}
        >
          <RefreshCwIcon
            className={cn("size-3", tasksLoading && "animate-spin")}
          />
        </button>
      </div>
      {tasks.length === 0 && !tasksLoading ? (
        <p className="text-muted-foreground mt-2 text-xs">{t.a2a.noTasks}</p>
      ) : (
        <div className="mt-2 divide-y">
          {tasks.map((task) => {
            const terminal = Boolean(task.terminal_at);
            const busy = taskAction?.endsWith(`:${task.local_task_id}`);
            return (
              <div key={task.local_task_id} className="py-2.5 first:pt-0">
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-1 size-1.5 shrink-0 rounded-full",
                      task.status === "completed"
                        ? "bg-success"
                        : task.status === "failed" || task.status === "rejected"
                          ? "bg-destructive"
                          : task.status === "canceled"
                            ? "bg-muted-foreground"
                            : "bg-info",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="block max-w-full truncate text-left text-xs font-medium hover:underline"
                      disabled={!task.result}
                      onClick={() => onSelectResult(task.result)}
                    >
                      {task.request.text || task.local_task_id}
                    </button>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {task.status} · {task.remote_task_id.slice(0, 12) || "—"}
                    </p>
                    {task.error && (
                      <p className="mt-1 line-clamp-2 text-xs text-destructive">
                        {task.error}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        onTaskAction(task.local_task_id, "refresh")
                      }
                      disabled={busy || !task.remote_task_id}
                      className="text-muted-foreground hover:text-foreground rounded p-1 disabled:opacity-40"
                      aria-label={t.a2a.refreshTask}
                    >
                      <RefreshCwIcon
                        className={cn(
                          "size-3",
                          taskAction === `refresh:${task.local_task_id}` &&
                            "animate-spin",
                        )}
                      />
                    </button>
                    {!terminal && (
                      <button
                        type="button"
                        onClick={() =>
                          onTaskAction(task.local_task_id, "cancel")
                        }
                        disabled={busy || !task.remote_task_id}
                        className="rounded p-1 text-destructive disabled:opacity-40"
                        aria-label={t.a2a.cancelTask}
                      >
                        <XIcon className="size-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
