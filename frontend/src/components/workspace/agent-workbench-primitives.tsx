import { MonitorIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import type { AgentPhaseStatus } from "./agent-phases";
import { statusIcon } from "./agent-workbench-utils";
import type { WorkBlockStatus } from "./work-blocks";

// ── Shared UI primitives ──────────────────────────────────────────────

export function StatusGlyph({
  status,
  className,
}: {
  status: WorkBlockStatus | AgentPhaseStatus;
  className?: string;
}) {
  const Icon = statusIcon(status);
  return (
    <Icon
      className={cn(
        "size-4 shrink-0",
        status === "running" && "animate-spin text-foreground",
        status === "done" && "text-success",
        status === "warning" && "text-warning",
        status === "error" && "text-destructive",
        status === "pending" && "text-muted-foreground",
        status === "waiting_approval" && "text-warning",
        className,
      )}
    />
  );
}

export function WorkbenchEmptyPage({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="workbench-empty-page flex min-h-0 flex-1 items-center justify-center bg-muted/30 p-6 text-center">
      <div className="workbench-empty-page-content flex max-w-xs flex-col items-center gap-3">
        <div className="workbench-empty-page-icon relative">
          <div className="relative flex size-12 items-center justify-center rounded-lg border border-border bg-card">
            <MonitorIcon
              className="size-5 text-muted-foreground"
              strokeWidth={1.5}
            />
          </div>
        </div>
        <div className="text-sm font-medium text-foreground/90">{title}</div>
        <p className="workbench-empty-page-description text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
