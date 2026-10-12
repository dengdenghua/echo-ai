import { useMemo } from "react";

import { useI18n } from "@/core/i18n/hooks";
import { useProjects } from "@/core/projects/hooks";
import { basename } from "@/lib/path-utils";
import type { Project } from "@/core/projects/hooks";
import { useAuth } from "@/providers/AuthProvider";

export function managedWorkdirThreadId(path: string): string | undefined {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .match(
      /(?:^|\/)data\/workspaces\/[a-f0-9]{24}\/[a-f0-9]{24}\/([^/]+)$/i,
    )?.[1];
}

export function workdirDisplayName(
  path: string,
  projects: Project[],
  fallback: string,
): string {
  const threadId = managedWorkdirThreadId(path);
  if (!threadId) return path ? basename(path) : "";
  const project = projects.find(
    (item) =>
      item.execution_thread_id === threadId ||
      item.thread_ids?.includes(threadId),
  );
  return project?.name?.trim() || fallback;
}

/** Labels for a work directory as the muted workspace chip shows them:
 * the personal (or creative) space when empty, otherwise the folder or the
 * managed task workspace's project name. Shared so a summary elsewhere
 * reads exactly like the selector. */
export function useWorkDirLabels(workDir: string, designSpace = false) {
  const { t, locale } = useI18n();
  const { authStatus, isAuthenticated, isLoading: authLoading } = useAuth();
  const personalSpaceLabel = designSpace
    ? locale.toLowerCase().startsWith("zh")
      ? "创作空间"
      : "Creative space"
    : t.codeMode.personalSpace;
  const { data: projects = [] } = useProjects(
    Boolean(managedWorkdirThreadId(workDir)) &&
      !authLoading &&
      (isAuthenticated || authStatus?.enabled === false),
  );
  const managedLabel = locale.startsWith("zh")
    ? "任务工作区"
    : locale.startsWith("ja")
      ? "タスクのワークスペース"
      : locale.startsWith("ko")
        ? "작업 공간"
        : "Task workspace";
  const folderName = useMemo(
    () => workdirDisplayName(workDir, projects, managedLabel),
    [workDir, projects, managedLabel],
  );
  return { personalSpaceLabel, folderName };
}
