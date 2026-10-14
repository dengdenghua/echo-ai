import { FolderIcon, SquareKanbanIcon } from "lucide-react";

import { CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProjectIcon } from "@/core/projects/project-icons";
import { isGeneratedWorkspaceProject } from "@/core/threads/sidebar";
import { cn } from "@/lib/utils";

/** The icon picked at creation; otherwise the folder-vs-milestone kind. */
function ProjectGroupIcon({
  hasBoundFolder,
  icon,
}: {
  hasBoundFolder: boolean;
  icon?: string | null;
}) {
  if (icon?.trim()) {
    return (
      <ProjectIcon icon={icon} className="size-[18px] shrink-0 opacity-70" />
    );
  }
  return hasBoundFolder ? (
    <FolderIcon
      data-project-kind="folder"
      className="size-[18px] shrink-0 opacity-70"
    />
  ) : (
    <SquareKanbanIcon
      data-project-kind="milestone"
      className="size-[18px] shrink-0 opacity-70"
    />
  );
}

/** Sidebar project-group header: icon, name, thread count and a tooltip. */
export function ProjectGroupTrigger({
  project,
  threadCount,
  deletable,
  hasBoundFolder,
  boundWorkspacePath,
  icon,
}: {
  project: string;
  threadCount: number;
  deletable: boolean;
  hasBoundFolder: boolean;
  boundWorkspacePath?: string;
  /** Project OS icon id picked when the project was created. */
  icon?: string | null;
}) {
  const generatedWorkspace = isGeneratedWorkspaceProject(
    project,
    boundWorkspacePath,
  );
  const displayName = generatedWorkspace ? "任务文件" : project;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <CollapsibleTrigger
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-lg px-1 text-sm",
            deletable ? "pr-8" : "pr-1",
            "text-foreground/85 hover:text-foreground hover:bg-muted/40 transition-colors",
            "outline-none focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:ring-inset",
          )}
        >
          <ProjectGroupIcon hasBoundFolder={hasBoundFolder} icon={icon} />
          <span className="min-w-0 truncate">{displayName}</span>
          {/* Zero-count badges are noise: hide them instead of dimming to a
              sub-AA contrast. Full muted-foreground keeps non-zero counts
              legible in both themes (5.1:1 light / 7.0:1 dark). */}
          {threadCount > 0 ? (
            <span
              className={cn(
                "ml-auto shrink-0 text-xs text-muted-foreground transition-opacity",
                deletable && "group-hover/project:opacity-0",
              )}
            >
              {threadCount}
            </span>
          ) : null}
        </CollapsibleTrigger>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        className="max-w-72 break-words"
      >
        <span className="block font-medium">{displayName}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {generatedWorkspace
            ? "此任务自动创建的文件空间"
            : hasBoundFolder
              ? boundWorkspacePath || "本地目录项目"
              : "里程碑项目 · 不绑定本地目录"}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
