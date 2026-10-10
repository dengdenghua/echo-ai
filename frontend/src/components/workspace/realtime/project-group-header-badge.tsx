import { useState } from "react";
import {
  BookmarkIcon,
  FolderKanbanIcon,
  MoreHorizontalIcon,
  PanelRightOpenIcon,
  UnlinkIcon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";
import {
  ProjectDecisionsModal,
  type ProjectDecisionItem,
} from "./project-decisions-modal";

const PROJECT_STATUS_DOT: Record<string, string> = {
  planning: "bg-amber-500",
  running: "bg-emerald-500",
  blocked: "bg-amber-500",
  done: "bg-sky-500",
  failed: "bg-destructive",
};

/** A lightweight Project OS capability marker for a normal work group.
 *
 * Project/member identity deliberately stays out of this component: the
 * canonical group title, roster, invitations, chat and AI participation live
 * in the shared header. This marker only opens or detaches the workbench.
 */
export interface ProjectGroupHeaderBadgeProps {
  name: string;
  status?: string;
  activeMilestone?: {
    id: string;
    name: string;
    progress?: number;
    status?: string;
  };
  decisionsCount?: number;
  decisions?: ProjectDecisionItem[];
  onOpenWorkbench: () => void;
  canDetach?: boolean;
  onDetach?: () => void;
  isDetaching?: boolean;
}

export function ProjectGroupHeaderBadge({
  name,
  status,
  activeMilestone,
  decisionsCount,
  decisions,
  onOpenWorkbench,
  canDetach = false,
  onDetach,
  isDetaching = false,
}: ProjectGroupHeaderBadgeProps) {
  const [showDecisionsModal, setShowDecisionsModal] = useState(false);
  const { t } = useI18n();
  const copy = t.projectCapability;
  const safeName = name.trim();
  const safeStatus = status?.trim().toLowerCase() || "planning";
  const statusLabel =
    safeStatus === "running"
      ? copy.statusRunning
      : safeStatus === "blocked"
        ? copy.statusBlocked
        : safeStatus === "done"
          ? copy.statusDone
          : safeStatus === "failed"
            ? copy.statusFailed
            : copy.statusPlanning;

  return (
    <div
      data-testid="project-capability-badge"
      className="inline-flex min-w-0 shrink-0 items-center rounded-md border border-primary/15 bg-primary/[0.06] text-primary"
    >
      <button
        type="button"
        data-slot="project-capability-button"
        onClick={onOpenWorkbench}
        aria-label={`${copy.openWorkbench}：${safeName}`}
        title={`${copy.openWorkbench}：${safeName}${activeMilestone ? ` · 当前里程碑：${activeMilestone.name}${typeof activeMilestone.progress === "number" ? ` (${activeMilestone.progress}%)` : ""}` : ""}${decisionsCount ? ` · 已沉淀 ${decisionsCount} 条核心决议` : ""}`}
        className={cn(
          "inline-flex h-7 min-w-0 items-center gap-1.5 rounded-l-md px-2 text-[11px] font-medium transition-colors hover:bg-primary/10",
          activeMilestone ? "max-w-72" : "max-w-52",
        )}
      >
        <FolderKanbanIcon
          data-slot="project-capability-icon"
          className="size-3.5 shrink-0"
          aria-hidden="true"
        />
        {activeMilestone ? (
          <>
            <span className="truncate max-w-28 text-foreground/85 font-medium">
              {activeMilestone.name}
            </span>
            {typeof activeMilestone.progress === "number" && (
              <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-micro font-mono font-semibold text-primary">
                {activeMilestone.progress}%
              </span>
            )}
          </>
        ) : (
          <>
            <span data-slot="project-capability-label" className="truncate">
              {copy.enabled}
            </span>
            <span data-slot="project-capability-separator" aria-hidden="true">
              ·
            </span>
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                PROJECT_STATUS_DOT[safeStatus] || "bg-muted-foreground/55",
              )}
            />
            <span className="truncate text-foreground/70">{statusLabel}</span>
          </>
        )}
      </button>

      {decisionsCount != null && decisionsCount > 0 && (
        <button
          type="button"
          onClick={() => setShowDecisionsModal(true)}
          className="hidden sm:inline-flex h-7 shrink-0 items-center gap-0.5 border-l border-primary/15 px-2 text-[10px] text-muted-foreground hover:bg-amber-500/15 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
          title={`${decisionsCount} 条已沉淀项目决议（点击查看详情）`}
        >
          🏛️ {decisionsCount}
        </button>
      )}

      {canDetach && onDetach ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${copy.moreActions}：${safeName}`}
              title={copy.moreActions}
              disabled={isDetaching}
              className="flex size-7 shrink-0 items-center justify-center border-l border-primary/15 text-primary/75 transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-wait disabled:opacity-50"
            >
              {isDetaching ? (
                <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" />
              ) : (
                <MoreHorizontalIcon className="size-3.5" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onSelect={onOpenWorkbench}>
              <PanelRightOpenIcon />
              <span>{copy.openWorkbench}</span>
            </DropdownMenuItem>
            {decisionsCount != null && decisionsCount > 0 && (
              <DropdownMenuItem onSelect={() => setShowDecisionsModal(true)}>
                <BookmarkIcon className="size-3.5" />
                <span>查看核心事实与决议 ({decisionsCount})</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={isDetaching}
              onSelect={onDetach}
            >
              <UnlinkIcon />
              <span>{copy.detach}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <ProjectDecisionsModal
        isOpen={showDecisionsModal}
        onClose={() => setShowDecisionsModal(false)}
        projectName={safeName}
        decisions={decisions}
        onOpenWorkbench={onOpenWorkbench}
      />
    </div>
  );
}
