"use client";

/**
 * 当前会话所绑定项目的统一右侧工作台。
 *
 * 群聊负责承载讨论，项目工作台负责承载结构化事实。这里把 Project OS
 * 的里程碑、事项、产物与协作席位收口到一个紧凑的五页签视图中，避免
 * 用户在聊天、独立项目驾驶舱与团队工作台之间反复跳转。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  ExternalLinkIcon,
  FileBoxIcon,
  FlagIcon,
  FolderKanbanIcon,
  LayoutDashboardIcon,
  ListTodoIcon,
  Loader2Icon,
  RefreshCwIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { authHeaders, jsonAuthHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import { THREAD_MAP_QUERY_KEY, fetchThreadMap } from "@/core/projects/hooks";
import { cn } from "@/lib/utils";
import { type WorkbenchRosterSeat } from "./helpers";
import type {
  ProjectWorkbenchTabId,
  ProjectActionSpec,
  MilestonePM,
  ProjectFullState,
  MilestoneView,
  ProjectAssetView,
  ProjectMemberView,
} from "./project-workbench-types";
import {
  STATUS_LABEL,
  STATUS_TONE,
  ACTIVE_TASK_STATUSES,
  ATTENTION_TASK_STATUSES,
  normalizeProjectProgress,
  displayActionLabel,
  uniqueProjectRisks,
  projectDecisionViews,
  assetsFromTask,
} from "./project-workbench-model";
import { OverviewTab } from "./project-workbench-overview";
import {
  MilestonesTab,
  TasksTab,
  AssetsTab,
  MembersTab,
} from "./project-workbench-pages";

export type {
  ProjectWorkbenchTabId,
  ProjectActionSpec,
  ProjectTaskReadModel,
  ProjectArtifactReadModel,
  ProjectDecisionReadModel,
  ProjectMemberReadModel,
  ProjectFullState,
} from "./project-workbench-types";
export { normalizeProjectProgress } from "./project-workbench-model";

/** 拉取当前线程绑定的 Project OS 项目；未绑定项目时返回 null。 */
export function boundProjectRefetchInterval(
  data: ProjectFullState | null | undefined,
): number | false {
  // A 404 is the authoritative, normal "not a Project OS thread" state.
  // Project-binding mutations invalidate this query explicitly, so polling a
  // confirmed null only creates duplicate 404 traffic and noisy backend logs.
  return data === null ? false : 15_000;
}

/**
 * Whether the thread map lists this thread, or ``null`` when the map cannot
 * be read. One shared request (the sidebar holds the same query) answers it
 * for every thread, so an ordinary chat does not cost a 404 on open.
 */
async function threadHasProject(
  queryClient: QueryClient,
  threadId: string,
): Promise<boolean | null> {
  try {
    const map = await queryClient.fetchQuery({
      queryKey: THREAD_MAP_QUERY_KEY,
      queryFn: fetchThreadMap,
      staleTime: 30_000,
    });
    return Object.hasOwn(map, threadId);
  } catch {
    return null;
  }
}

export function useBoundProjectState(threadId: string | undefined | null) {
  const queryClient = useQueryClient();
  const queryKey = ["project", "by-thread", threadId ?? ""];
  return useQuery<ProjectFullState | null>({
    queryKey,
    queryFn: async () => {
      // First load only. Refetches (after a binding change, or a manual
      // retry) always ask the server directly.
      if (
        threadId &&
        queryClient.getQueryData(queryKey) === undefined &&
        (await threadHasProject(queryClient, threadId)) === false
      ) {
        return null;
      }
      const res = await fetch(
        `${getBackendBaseURL()}/api/projects/by-thread/${threadId}`,
        { headers: authHeaders() },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Failed to load project: ${res.status}`);
      return (await res.json()) as ProjectFullState;
    },
    enabled: !!threadId,
    retry: false,
    refetchInterval: (query) => boundProjectRefetchInterval(query.state.data),
  });
}

export function ProjectOsTabLoading() {
  return (
    <div
      data-testid="project-workbench-loading"
      className="flex min-h-0 flex-1 flex-col bg-background/70"
    >
      <div className="space-y-3 border-b border-border-subtle p-3">
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-3 w-full animate-pulse rounded bg-muted/70" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-muted/70" />
      </div>
      <div className="grid grid-cols-2 gap-2 p-3">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-20 animate-pulse rounded-xl border border-border-subtle bg-muted/40"
          />
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" />
        正在载入项目工作台…
      </div>
    </div>
  );
}

export function ProjectOsTabError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background/70 p-5">
      <div role="alert" className="max-w-64 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-breach/10 text-breach">
          <AlertTriangleIcon className="size-5" />
        </div>
        <div className="mt-3 text-sm font-medium">项目工作台加载失败</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          项目数据暂时不可用，群聊与其他工作台功能不受影响。
        </p>
        {onRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={onRetry}
          >
            <RefreshCwIcon className="size-3.5" />
            重试
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ProjectOsTab({
  state,
  onRefetch,
  onOpenArtifact,
  onInvitePeople,
  onProjectCommand,
  commandBusy = false,
  rosterSeats = [],
  groupTitle,
  currentThreadTitle,
}: {
  state: ProjectFullState;
  onRefetch?: () => void | Promise<void>;
  onOpenArtifact?: (path: string) => void;
  onInvitePeople?: () => void | Promise<void>;
  onProjectCommand?: (command: string) => void;
  commandBusy?: boolean;
  rosterSeats?: WorkbenchRosterSeat[];
  /** Visible room title. Used only to avoid repeating it in the workbench. */
  groupTitle?: string | null;
  /** Conversation title fallback for non-group project threads. */
  currentThreadTitle?: string | null;
}) {
  const { project, pm } = state;
  const [activeTab, setActiveTab] = useState<ProjectWorkbenchTabId>("overview");
  const [taskFilter, setTaskFilter] = useState<
    "all" | "active" | "done" | "attention"
  >("all");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab("overview");
    setTaskFilter("all");
  }, [project.id]);

  useEffect(() => {
    const handleEntityFocus = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          projectId?: string;
          kind?: string;
        }>
      ).detail;
      if (!detail || (detail.projectId && detail.projectId !== project.id)) {
        return;
      }
      const target: Partial<Record<string, ProjectWorkbenchTabId>> = {
        milestone: "milestones",
        task: "tasks",
        artifact: "assets",
        decision: "overview",
      };
      const tab = detail.kind ? target[detail.kind] : undefined;
      if (tab) setActiveTab(tab);
    };
    window.addEventListener("echo:project-entity-focus", handleEntityFocus);
    return () => {
      window.removeEventListener(
        "echo:project-entity-focus",
        handleEntityFocus,
      );
    };
  }, [project.id]);

  const tasks = useMemo(
    () =>
      Object.entries(state.tasks ?? {}).flatMap(([milestoneId, rows]) =>
        (Array.isArray(rows) ? rows : []).map((task) => ({
          ...task,
          milestone_id: task.milestone_id || milestoneId,
        })),
      ),
    [state.tasks],
  );

  const milestones = useMemo<MilestoneView[]>(() => {
    const rawMilestones = state.milestones ?? [];
    const source = pm?.milestones?.length
      ? pm.milestones
      : rawMilestones.map((milestone): MilestonePM => {
          const milestoneTasks = tasks.filter(
            (task) => task.milestone_id === milestone.id,
          );
          const done = milestoneTasks.filter(
            (task) => task.status === "done",
          ).length;
          const total = milestoneTasks.length;
          const failed = milestoneTasks.filter((task) =>
            ATTENTION_TASK_STATUSES.has(task.status),
          ).length;
          return {
            ...milestone,
            health:
              milestone.status === "done"
                ? "completed"
                : milestone.status === "blocked" || failed > 0
                  ? "blocked"
                  : "on_track",
            done,
            total,
            failed,
            progress:
              total > 0 ? done / total : milestone.status === "done" ? 1 : 0,
            total_estimate: milestoneTasks.reduce(
              (sum, task) => sum + (Number(task.estimate) || 0),
              0,
            ),
            remaining_estimate: milestoneTasks.reduce(
              (sum, task) =>
                sum + (task.status === "done" ? 0 : Number(task.estimate) || 0),
              0,
            ),
          };
        });

    const rawById = new Map(rawMilestones.map((item) => [item.id, item]));
    return source.map((milestone) => ({
      ...rawById.get(milestone.id),
      ...milestone,
      progressPercent: normalizeProjectProgress(milestone.progress),
    }));
  }, [pm?.milestones, state.milestones, tasks]);

  const assets = useMemo<ProjectAssetView[]>(() => {
    const explicit = (state.artifacts ?? []).map((asset) => ({ ...asset }));
    const derived = tasks.flatMap(assetsFromTask);
    const seen = new Set<string>();
    return [...explicit, ...derived].filter((asset) => {
      const key = asset.path || asset.url || asset.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [state.artifacts, tasks]);

  const members = useMemo<ProjectMemberView[]>(() => {
    const byName = new Map<string, ProjectMemberView>();
    const add = (member: ProjectMemberView) => {
      const key = member.name.trim().toLocaleLowerCase();
      if (!key) return;
      const current = byName.get(key);
      byName.set(key, current ? { ...member, ...current } : member);
    };

    if (project.owner) {
      add({
        id: project.owner_id || `owner:${project.owner}`,
        name: project.owner,
        role: "项目负责人",
        kind: "human",
        isOwner: true,
      });
    }
    for (const seat of rosterSeats) {
      const kind = seat.kind || "agent";
      add({
        id: seat.id,
        name: seat.name,
        role:
          seat.role === "tl"
            ? "协作负责人"
            : kind !== "human" && (!seat.role || seat.role === "member")
              ? "AI 成员"
              : seat.role || "项目成员",
        kind,
        driver: seat.driver,
        accountableOwner: seat.accountableOwner,
        avatarUrl: seat.avatarUrl,
        trust: seat.trust ?? null,
      });
    }
    for (const member of state.members ?? []) {
      add({
        id: member.id,
        name: member.name,
        role: member.role || "项目成员",
        kind: member.kind || "human",
        driver: member.driver,
        accountableOwner: member.accountable_owner,
        avatarUrl: member.avatar_url,
        status: member.status,
      });
    }
    return [...byName.values()].sort((left, right) => {
      if (left.isOwner !== right.isOwner) return left.isOwner ? -1 : 1;
      if (left.kind !== right.kind) return left.kind === "human" ? -1 : 1;
      return left.name.localeCompare(right.name, "zh-CN");
    });
  }, [project.owner, project.owner_id, rosterSeats, state.members]);

  const overallProgress = normalizeProjectProgress(pm?.overall_progress ?? 0);
  const doneTasks =
    pm?.done_tasks ?? tasks.filter((task) => task.status === "done").length;
  const totalTasks = pm?.total_tasks ?? tasks.length;
  const riskCount = uniqueProjectRisks(pm).length + (pm?.blockers?.length ?? 0);
  const completedMilestones = milestones.filter(
    (milestone) => milestone.health === "completed",
  ).length;
  const projectGoal = project.goal?.trim();
  const projectName = project.name?.trim();
  const normalizedProjectName = projectName?.replace(/\s+/g, " ").toLowerCase();
  const titleRepeatsConversation = Boolean(
    normalizedProjectName &&
    [groupTitle, currentThreadTitle].some(
      (title) =>
        title?.trim().replace(/\s+/g, " ").toLowerCase() ===
        normalizedProjectName,
    ),
  );
  const hasPmOverviewData = Boolean(
    pm &&
    (normalizeProjectProgress(pm.overall_progress) > 0 ||
      Number(pm.done_tasks) > 0 ||
      Number(pm.total_tasks) > 0 ||
      Number(pm.remaining_estimate) > 0 ||
      pm.milestones?.length ||
      pm.risks?.length ||
      pm.blockers?.length ||
      pm.next_actions?.length),
  );
  const isEmptyProject =
    milestones.length === 0 &&
    tasks.length === 0 &&
    assets.length === 0 &&
    projectDecisionViews(state.decisions).length === 0 &&
    !state.retro &&
    !hasPmOverviewData;

  const taskCounts = useMemo(
    () => ({
      all: tasks.length,
      active: tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status))
        .length,
      done: tasks.filter((task) => task.status === "done").length,
      attention: tasks.filter((task) =>
        ATTENTION_TASK_STATUSES.has(task.status),
      ).length,
    }),
    [tasks],
  );

  const visibleTasks = useMemo(() => {
    if (taskFilter === "all") return tasks;
    if (taskFilter === "active") {
      return tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
    }
    if (taskFilter === "attention") {
      return tasks.filter((task) => ATTENTION_TASK_STATUSES.has(task.status));
    }
    return tasks.filter((task) => task.status === "done");
  }, [taskFilter, tasks]);

  const executeAction = useCallback(
    async (spec: ProjectActionSpec, actionKey: string, task = false) => {
      if (pendingAction || commandBusy) return;
      // In a conversation, execution needs its live approval channel. REST
      // remains the fallback for standalone project views without that channel.
      if (!task && spec.realtime_command && onProjectCommand) {
        onProjectCommand(spec.realtime_command);
        return;
      }
      if (!spec.api) return;
      setPendingAction(actionKey);
      try {
        const res = await fetch(spec.api.path, {
          method: spec.api.method,
          headers: jsonAuthHeaders(),
          body: spec.api.body ? JSON.stringify(spec.api.body) : undefined,
        });
        if (!res.ok) {
          toast.error("操作未完成，请稍后重试");
          return;
        }
        toast.success(`${displayActionLabel(spec, task)}已执行`);
        await onRefetch?.();
      } catch {
        toast.error("操作未完成，请检查连接后重试");
      } finally {
        setPendingAction(null);
      }
    },
    [onRefetch, pendingAction, commandBusy, onProjectCommand],
  );

  const tabs: Array<{
    id: ProjectWorkbenchTabId;
    label: string;
    Icon: ComponentType<{ className?: string }>;
    count?: number;
  }> = [
    { id: "overview", label: "总览", Icon: LayoutDashboardIcon },
    {
      id: "milestones",
      label: "里程碑",
      Icon: FlagIcon,
      count: milestones.length,
    },
    { id: "tasks", label: "事项", Icon: ListTodoIcon, count: tasks.length },
    { id: "assets", label: "资料", Icon: FileBoxIcon, count: assets.length },
    { id: "members", label: "成员", Icon: UsersIcon, count: members.length },
  ];

  return (
    <div
      data-testid="project-workbench"
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background/70"
    >
      <header
        data-testid="project-workbench-context"
        data-project-title-collapsed={titleRepeatsConversation}
        className={cn(
          "shrink-0 border-b border-border-subtle bg-gradient-to-br from-primary/[0.07] via-background to-background px-3",
          titleRepeatsConversation ? "py-2" : "pb-3 pt-3",
        )}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <div
            className={cn(
              "flex shrink-0 items-center justify-center border border-primary/15 bg-primary/10 text-primary shadow-[var(--shadow-xs)]",
              titleRepeatsConversation
                ? "size-7 rounded-lg"
                : "size-9 rounded-xl",
            )}
          >
            <FolderKanbanIcon
              className={titleRepeatsConversation ? "size-3.5" : "size-4.5"}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h3
                className={cn(
                  "min-w-0 flex-1 truncate font-semibold",
                  titleRepeatsConversation ? "text-xs" : "text-sm",
                )}
              >
                {titleRepeatsConversation
                  ? "项目工作台"
                  : project.name || project.id}
              </h3>
              <Badge
                variant="outline"
                className={cn(
                  "h-5 shrink-0 px-1.5 text-[10px]",
                  STATUS_TONE[project.status],
                )}
              >
                {STATUS_LABEL[project.status] ?? project.status}
              </Badge>
            </div>
            {projectGoal && projectGoal !== projectName ? (
              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                {projectGoal}
              </p>
            ) : null}
          </div>
        </div>
        <div
          className={cn(
            "flex items-center gap-2 text-[10px] text-muted-foreground",
            titleRepeatsConversation ? "mt-1.5" : "mt-2.5",
          )}
        >
          {project.owner ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <UserRoundIcon className="size-3" />
              <span className="truncate">负责人 {project.owner}</span>
            </span>
          ) : (
            <span>尚未设置负责人</span>
          )}
          <span
            aria-hidden="true"
            className="h-3 shrink-0 border-l border-border-default"
          />
          <span>{totalTasks} 个事项</span>
          <Link
            to="/workspace/projects"
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="打开完整项目管理页"
          >
            管理页
            <ExternalLinkIcon className="size-3" />
          </Link>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="项目工作台"
        className="shrink-0 overflow-x-auto border-b border-border-subtle bg-background/95 px-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex min-w-max items-center">
          {tabs.map(({ id, label, Icon, count }) => {
            const selected = activeTab === id;
            return (
              <button
                key={id}
                id={`project-workbench-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`project-panel-${id}`}
                data-testid={`project-workbench-tab-${id}`}
                onClick={() => setActiveTab(id)}
                className={cn(
                  "relative flex h-10 min-w-[3.35rem] flex-1 items-center justify-center gap-1 px-1.5 text-[11px] font-medium transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  selected
                    ? "text-primary"
                    : "text-muted-foreground hover:bg-muted/45 hover:text-foreground",
                )}
              >
                <Icon className="size-3.5 shrink-0" />
                <span>{label}</span>
                {typeof count === "number" && count > 0 ? (
                  <span className="sr-only">{count} 项</span>
                ) : null}
                {selected ? (
                  <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div
        id={`project-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`project-workbench-tab-${activeTab}`}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {activeTab === "overview" ? (
          <OverviewTab
            state={state}
            milestones={milestones}
            overallProgress={overallProgress}
            doneTasks={doneTasks}
            totalTasks={totalTasks}
            completedMilestones={completedMilestones}
            riskCount={riskCount}
            assetCount={assets.length}
            isEmptyProject={isEmptyProject}
            pendingAction={pendingAction}
            onAction={(spec, key) => executeAction(spec, key)}
            onNavigate={setActiveTab}
            onProjectCommand={onProjectCommand}
            commandBusy={commandBusy}
          />
        ) : activeTab === "milestones" ? (
          <MilestonesTab milestones={milestones} />
        ) : activeTab === "tasks" ? (
          <TasksTab
            tasks={visibleTasks}
            allTasks={tasks}
            milestones={milestones}
            filter={taskFilter}
            counts={taskCounts}
            pendingAction={pendingAction}
            onFilter={setTaskFilter}
            onAction={(spec, key) => executeAction(spec, key, true)}
          />
        ) : activeTab === "assets" ? (
          <AssetsTab assets={assets} onOpenArtifact={onOpenArtifact} />
        ) : (
          <MembersTab
            members={members}
            tasks={tasks}
            onInvitePeople={onInvitePeople}
          />
        )}
      </div>
    </div>
  );
}
