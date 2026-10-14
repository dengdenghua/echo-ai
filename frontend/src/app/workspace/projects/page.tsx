"use client";

/**
 * 项目管理 · PM 驾驶舱（Project OS 的真实项目管理视图）
 *
 * 这一层回答 PM 每天真正会问的问题，而不只是「有哪些项目」：
 *   - 今天要处理：跨全部项目聚合逾期 / 今日到期 / 有风险里程碑（置顶）
 *   - 项目列表：搜索 + 筛选 + 进度 / 健康度 / 逾期徽标（窄屏为横向切换条）
 *   - 项目整体进度 / 剩余估时 / 生命周期时间戳
 *   - 里程碑时间轴（甘特，含今日基准线）
 *   - 里程碑健康度（正常 / 有风险 / 已逾期 / 阻塞 / 完成）
 *   - 风险与阻塞、下一步动作（按优先级排序）、人员指派、里程碑估时
 *   - 完工项目复盘（交付数 / 失败数 / 重试 / 估时 / 耗时 / 建议）
 *
 * 数据来源（全部只读）：
 *   - GET /api/projects            项目列表（导航，恒定可用）
 *   - GET /api/projects/portfolio  跨项目汇总（今天要处理 / 项目总览）
 *   - GET /api/projects/{id}       单项目模型 project + milestones + tasks + pm + retro + action_specs
 *
 * 降级约定：portfolio 是「锦上添花」的聚合接口，它失败时页面必须仍然可用 ——
 * 因此列表退回元数据行、聚合块整体不渲染，且不弹 alert、不打断既有错误态。
 */

import type {
  PmeReport,
  ProjectFull,
  ProjectSummary,
} from "@/core/projects/cockpit-types";
import {
  ProjectLoadFailure,
  ProjectRequestError,
  traceIdFromDetail,
  traceIdFromResponse,
  withTraceId,
} from "@/components/workspace/projects/project-request-feedback";
import {
  EmptyHint,
  MetricCard,
  healthIcon,
} from "@/components/workspace/projects/project-cockpit-metrics";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  CalendarRangeIcon,
  CheckCircle2Icon,
  ClipboardListIcon,
  LayersIcon,
  ListChecksIcon,
  MessageSquareIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  TimerIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import { CreateProjectDialog } from "@/components/workspace/create-project-dialog";
import {
  type Project,
  useEnsureProjectHome,
  usePortfolio,
} from "@/core/projects/hooks";
import { projectCategoryLabel } from "@/core/projects/project-categories";
import { ProjectIcon } from "@/core/projects/project-icons";
import {
  type ProjectRow,
  type ProjectStatusFilter,
  buildTodayQueue,
  countHealth,
  estimateRows,
  portfolioTotals,
  projectRowFromSummary,
  toProjectRow,
} from "@/core/projects/portfolio";
import { TodayQueuePanel } from "@/components/workspace/projects/today-queue";
import { ProjectSwitcher } from "@/components/workspace/projects/project-switcher";
import { ProjectTimeline } from "@/components/workspace/projects/project-timeline";
import {
  projectActionLabel,
  useProjectExecution,
} from "@/components/workspace/projects/use-project-execution";
import { ProjectExecutionStatus } from "@/components/workspace/projects/project-execution-status";
import {
  EstimateStack,
  HealthDonut,
  ProjectProgressBars,
} from "@/components/workspace/projects/project-charts";
import {
  HEALTH_LABEL,
  HEALTH_TONE,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  fmtDate,
} from "@/components/workspace/projects/project-meta";
import { ProjectLifecycleDates } from "@/components/workspace/projects/project-lifecycle-dates";
import { StandingAuthorizationPanel } from "@/components/workspace/projects/standing-authorization-panel";
import { ProjectLifecycleActions } from "@/components/workspace/projects/project-lifecycle-actions";
import {
  ProjectGovernancePanel,
  governanceRunBlock,
} from "@/components/workspace/projects/project-governance-panel";

const BASE = () => `${getBackendBaseURL()}/api/projects`;
const PROJECT_ACTION_ERROR_MESSAGE = "操作失败，请稍后重试。";
// Actions that execute the project: unavailable while governance blocks them.
const RUN_ACTIONS = new Set(["run", "tick", "recover_and_run"]);
function safeRiskDetail(risk: PmeReport["risks"][number]): string {
  if (risk.type === "milestone") {
    return "里程碑存在阻塞或延期，请检查相关任务状态。";
  }
  if (risk.health === "overdue") {
    return "任务已逾期，请重新评估排期。";
  }
  if (risk.health === "blocked" || risk.health === "failed") {
    return "任务执行失败或受阻，请检查配置后重试。";
  }
  return "任务状态需要关注，请检查任务详情。";
}

export default function ProjectsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const ensureProjectHome = useEnsureProjectHome();
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("project"),
  );
  useEffect(() => {
    const id = searchParams.get("project");
    if (id) setSelectedId(id);
  }, [searchParams]);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProjectStatusFilter>("all");
  const [highlightMilestone, setHighlightMilestone] = useState<string | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  // 「今天」在一次挂载内固定：跨零点时重新打开页面即可刷新，避免同一屏内
  // 分组在渲染过程中跳变。
  const [nowMs] = useState(() => Date.now());

  const projectsQuery = useQuery<ProjectSummary[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch(BASE(), { headers: authHeaders() });
      if (!res.ok) throw new ProjectRequestError(traceIdFromResponse(res));
      const data: unknown = await res.json();
      if (Array.isArray(data)) return data as ProjectSummary[];
      if (
        data &&
        typeof data === "object" &&
        "projects" in data &&
        Array.isArray(data.projects)
      ) {
        return data.projects as ProjectSummary[];
      }
      return [];
    },
  });

  const projects = useMemo(
    () => projectsQuery.data ?? [],
    [projectsQuery.data],
  );
  useEffect(() => {
    if (!selectedId && projects.length > 0) {
      const first = projects[0];
      if (first) setSelectedId(first.id);
    }
  }, [projects, selectedId]);

  const portfolioQuery = usePortfolio(projects.length > 0);
  const portfolio = useMemo(
    () => portfolioQuery.data ?? [],
    [portfolioQuery.data],
  );
  // 只有真的拿到非空聚合数据时才渲染跨项目区块：接口失败或返回空时，页面
  // 退回「单项目视图 + 元数据列表」，不显示任何「今天没有逾期」之类的假结论。
  const portfolioReady = portfolioQuery.isSuccess && portfolio.length > 0;

  const rows = useMemo<ProjectRow[]>(
    () =>
      portfolioReady
        ? portfolio.map(toProjectRow)
        : projects.map(projectRowFromSummary),
    [portfolioReady, portfolio, projects],
  );

  const totals = useMemo(() => portfolioTotals(portfolio), [portfolio]);
  const todayQueue = useMemo(
    () => buildTodayQueue(portfolio, nowMs),
    [portfolio, nowMs],
  );

  const detailQuery = useQuery<ProjectFull>({
    queryKey: ["project", selectedId],
    queryFn: async () => {
      const res = await fetch(`${BASE()}/${selectedId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new ProjectRequestError(traceIdFromResponse(res));
      return res.json();
    },
    enabled: !!selectedId,
  });

  const detail = detailQuery.data;
  const detailCategory = projectCategoryLabel(
    detail?.project.category,
    t.createProjectDialog,
  );
  const runBlock = governanceRunBlock(detail?.governance);
  const pm = detail?.pm ?? null;
  const retro = detail?.retro ?? null;

  const refresh = () => {
    void detailQuery.refetch();
    void projectsQuery.refetch();
    void portfolioQuery.refetch();
  };
  const { job, isRunning, executeAction, cancelExecution } =
    useProjectExecution({
      projectId: selectedId,
      refresh,
      errorMessage: (failure) =>
        withTraceId(
          PROJECT_ACTION_ERROR_MESSAGE,
          traceIdFromResponse({ headers: failure.headers ?? new Headers() }),
        ),
    });

  const handleProjectDeleted = (projectId: string) => {
    setSelectedId(projects.find((p) => p.id !== projectId)?.id ?? null);
    refresh();
  };

  const selectProject = (projectId: string) => {
    setSelectedId(projectId);
    setHighlightMilestone(null);
    scrollRef.current?.scrollTo?.({ top: 0, behavior: "smooth" });
  };

  const focusMilestone = (milestoneId: string) => {
    setHighlightMilestone(milestoneId);
    const target = document.getElementById(`milestone-${milestoneId}`);
    target?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };

  const openProjectGroup = (project: Project) => {
    ensureProjectHome.mutate(project, {
      onSuccess: ({ threadId }) =>
        void navigate(`/workspace/realtime/${encodeURIComponent(threadId)}`, {
          state: { openProjectWorkbench: true },
        }),
      onError: () => toast.error("项目工作群打开失败，请重试"),
    });
  };

  return (
    <WorkspaceContainer className="!p-0 md:!px-0">
      <WorkspaceBody className="!p-0">
        <div className="flex h-full w-full min-h-0 flex-col items-stretch">
          {/* Header */}
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-4 md:px-6 md:py-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0 space-y-1">
                <h1 className="text-ui-title font-semibold tracking-tight">
                  {t.sidebar.navProjects}
                </h1>
                <p className="text-ui text-muted-foreground">
                  规划里程碑，跟进风险与团队进度
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-ui text-foreground"
                onClick={() => setCreateOpen(true)}
              >
                <PlusIcon className="size-3.5" />
                新建项目
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-ui text-muted-foreground"
                onClick={refresh}
              >
                <RefreshCwIcon className="size-3.5" />
                刷新
              </Button>
            </div>
          </header>

          {projectsQuery.isLoading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              加载中…
            </div>
          ) : projectsQuery.isError ? (
            <ProjectLoadFailure
              error={projectsQuery.error}
              onRetry={() => void projectsQuery.refetch()}
              className="flex-1"
            />
          ) : projects.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
              <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                <ClipboardListIcon className="size-8" />
              </div>
              <div className="max-w-md space-y-2">
                <h2 className="text-xl font-semibold">把目标变成一个项目</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  为项目起个名字，和助手一起拆解里程碑、安排任务并跟进进度。成员和协作设置可以稍后调整。
                </p>
              </div>
              <Button onClick={() => setCreateOpen(true)}>
                <PlusIcon className="size-4" />
                创建第一个项目
              </Button>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <ProjectSwitcher
                rows={rows}
                selectedId={selectedId}
                onSelect={selectProject}
                query={query}
                onQueryChange={setQuery}
                filter={filter}
                onFilterChange={setFilter}
              />

              {/* Main PM view */}
              <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-5xl space-y-4 p-4">
                  {/* 今天要处理（跨项目，置顶） */}
                  {portfolioReady && (
                    <TodayQueuePanel
                      queue={todayQueue}
                      onSelectProject={selectProject}
                    />
                  )}

                  {/* 项目总览（跨项目，≥2 个项目才有比较意义） */}
                  {portfolioReady && rows.length > 1 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="flex items-center gap-1.5">
                            <LayersIcon className="size-4 text-muted-foreground" />
                            项目总览
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5 text-xs font-normal text-muted-foreground">
                            <Badge variant="outline" className="text-xs">
                              {totals.projects} 个项目
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {totals.doneTasks}/{totals.tasks} 任务
                            </Badge>
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                totals.overdue > 0
                                  ? "border-warning/30 bg-warning/15 text-warning"
                                  : ""
                              }`}
                            >
                              逾期 {totals.overdue}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                totals.atRisk > 0
                                  ? "border-warning/30 bg-warning/15 text-warning"
                                  : ""
                              }`}
                            >
                              风险里程碑 {totals.atRisk}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              剩余估时 {totals.remainingEstimate}d
                            </Badge>
                            {totals.unreadable > 0 && (
                              <Badge
                                variant="outline"
                                className="border-breach/30 bg-breach/15 text-xs text-breach"
                              >
                                {totals.unreadable} 个读取失败
                              </Badge>
                            )}
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ProjectProgressBars
                          rows={rows}
                          selectedId={selectedId}
                          onSelectProject={selectProject}
                        />
                      </CardContent>
                    </Card>
                  )}

                  {detailQuery.isLoading ? (
                    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                      加载中…
                    </div>
                  ) : detailQuery.isError ? (
                    <ProjectLoadFailure
                      error={detailQuery.error}
                      onRetry={() => void detailQuery.refetch()}
                      className="h-40"
                    />
                  ) : detail ? (
                    <>
                      {/* Project header */}
                      <Card>
                        <CardContent className="space-y-3 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <ProjectIcon
                                  icon={detail.project.icon}
                                  className="size-4 text-muted-foreground"
                                />
                                <h2 className="text-base font-semibold">
                                  {detail.project.name || detail.project.id}
                                </h2>
                                {detailCategory && (
                                  <Badge variant="outline">
                                    {detailCategory}
                                  </Badge>
                                )}
                                <Badge
                                  variant="outline"
                                  className={
                                    STATUS_TONE[detail.project.status] ?? ""
                                  }
                                >
                                  {STATUS_LABEL[detail.project.status] ??
                                    detail.project.status}
                                </Badge>
                                {detail.project.owner && (
                                  <Badge
                                    variant="outline"
                                    className="gap-1 bg-muted/40 text-muted-foreground"
                                  >
                                    <UserRoundIcon className="size-3" />
                                    PM · {detail.project.owner}
                                  </Badge>
                                )}
                              </div>
                              {detail.project.goal && (
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {detail.project.goal}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 text-xs"
                                disabled={ensureProjectHome.isPending}
                                onClick={() => openProjectGroup(detail.project)}
                              >
                                <MessageSquareIcon className="size-3.5" />
                                进入项目群
                              </Button>
                              <ProjectExecutionStatus
                                job={job}
                                isRunning={isRunning}
                                cancel={() => void cancelExecution()}
                              />
                              <ProjectLifecycleActions
                                project={detail.project}
                                onDeleted={handleProjectDeleted}
                                onChanged={refresh}
                              />
                              {detail.action_specs.map((spec) => (
                                <Button
                                  key={spec.action}
                                  size="sm"
                                  className="gap-1.5 text-xs"
                                  disabled={
                                    (!!runBlock || isRunning) &&
                                    RUN_ACTIONS.has(spec.action)
                                  }
                                  title={
                                    RUN_ACTIONS.has(spec.action)
                                      ? (runBlock ?? undefined)
                                      : undefined
                                  }
                                  onClick={() => executeAction(spec)}
                                >
                                  {spec.action.startsWith("recover") ? (
                                    <RotateCcwIcon className="size-3.5" />
                                  ) : spec.action === "run" ? (
                                    <PlayIcon className="size-3.5" />
                                  ) : (
                                    <ArrowRightIcon className="size-3.5" />
                                  )}
                                  {projectActionLabel(spec)}
                                </Button>
                              ))}
                            </div>
                          </div>

                          <ProjectGovernancePanel
                            projectId={detail.project.id}
                            governance={detail.governance}
                            onChanged={refresh}
                          />

                          <StandingAuthorizationPanel
                            projectId={detail.project.id}
                            ownerId={detail.project.owner_id}
                            phases={detail.milestones}
                          />
                          <ProjectLifecycleDates project={detail.project} />

                          {pm && (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">
                                  整体进度
                                </span>
                                <span>
                                  {pm.done_tasks}/{pm.total_tasks} 任务 ·
                                  剩余估时 {pm.remaining_estimate}d / 共{" "}
                                  {pm.total_estimate}d
                                </span>
                              </div>
                              <Progress
                                value={Math.round(pm.overall_progress * 100)}
                                className="h-2"
                              />
                              <div className="text-right text-xs text-muted-foreground">
                                {Math.round(pm.overall_progress * 100)}%
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      {pm && (
                        <>
                          {/* Metrics */}
                          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            <MetricCard
                              label="整体进度"
                              value={`${Math.round(pm.overall_progress * 100)}%`}
                              sub={`${pm.done_tasks}/${pm.total_tasks} 任务`}
                              icon={<ActivityIcon className="size-4" />}
                            />
                            <MetricCard
                              label="剩余估时"
                              value={`${pm.remaining_estimate}d`}
                              sub={`总估时 ${pm.total_estimate}d`}
                              icon={<TimerIcon className="size-4" />}
                            />
                            <MetricCard
                              label="风险"
                              value={`${pm.risks.length}`}
                              sub={`${pm.blockers.length} 个阻塞里程碑 · ${pm.overdue.reduce(
                                (sum, group) => sum + group.tasks.length,
                                0,
                              )} 个逾期任务`}
                              tone={pm.risks.length > 0 ? "warn" : undefined}
                              icon={<AlertTriangleIcon className="size-4" />}
                            />
                            <MetricCard
                              label="下一步动作"
                              value={`${pm.next_actions.length}`}
                              sub="就绪待办（按优先级）"
                              icon={<ListChecksIcon className="size-4" />}
                            />
                          </div>

                          {/* 里程碑时间轴（甘特） */}
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="flex items-center gap-1.5 text-sm">
                                <CalendarRangeIcon className="size-4 text-muted-foreground" />
                                里程碑时间轴
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <ProjectTimeline
                                milestones={pm.milestones}
                                now={nowMs}
                                onSelectMilestone={focusMilestone}
                              />
                            </CardContent>
                          </Card>

                          {/* Milestones */}
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                                <span>里程碑健康度</span>
                                {pm.milestones.length > 0 && (
                                  <span className="text-xs font-normal text-muted-foreground">
                                    共 {pm.milestones.length} 个 · 剩余估时{" "}
                                    {pm.remaining_estimate}d
                                  </span>
                                )}
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              {pm.milestones.length === 0 && (
                                <div className="text-sm text-muted-foreground">
                                  还没有里程碑 —— 先执行 Run 让引擎拆解计划。
                                </div>
                              )}
                              {pm.milestones.length > 0 && (
                                <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)]">
                                  <div className="rounded-lg border bg-card/50 p-3 lg:w-52">
                                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                                      健康度分布
                                    </div>
                                    <HealthDonut
                                      counts={countHealth(
                                        pm.milestones.map((m) => m.health),
                                      )}
                                    />
                                  </div>
                                  <div className="space-y-3">
                                    {pm.milestones.map((m) => (
                                      <div
                                        key={m.id}
                                        id={`milestone-${m.id}`}
                                        className={`rounded-lg border bg-card/50 p-3 transition-shadow ${
                                          highlightMilestone === m.id
                                            ? "ring-2 ring-primary/40"
                                            : ""
                                        }`}
                                      >
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">
                                              {m.name}
                                            </span>
                                            <Badge
                                              variant="outline"
                                              className={`gap-1 text-xs ${HEALTH_TONE[m.health] ?? ""}`}
                                            >
                                              {healthIcon(m.health)}
                                              {HEALTH_LABEL[m.health] ??
                                                m.health}
                                            </Badge>
                                            <Badge
                                              variant="outline"
                                              className={`text-xs ${PRIORITY_TONE[m.priority] ?? ""}`}
                                            >
                                              优先级 {m.priority}
                                            </Badge>
                                          </div>
                                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                            <span>
                                              {m.done}/{m.total} 任务
                                            </span>
                                            {m.due_at && (
                                              <span className="inline-flex items-center gap-1">
                                                <CalendarRangeIcon className="size-3" />
                                                截止 {fmtDate(m.due_at)}
                                              </span>
                                            )}
                                            {m.planned_start && (
                                              <span>
                                                计划 {fmtDate(m.planned_start)}
                                              </span>
                                            )}
                                            <span>
                                              剩余 {m.remaining_estimate}d
                                            </span>
                                          </div>
                                        </div>
                                        <div className="mt-2 flex items-center gap-2">
                                          <Progress
                                            value={Math.round(m.progress * 100)}
                                            className="h-1.5 flex-1"
                                          />
                                          <span className="w-10 text-right text-xs text-muted-foreground">
                                            {Math.round(m.progress * 100)}%
                                          </span>
                                        </div>
                                        {m.overdue_tasks.length > 0 && (
                                          <div className="mt-3 space-y-2 border-t border-warning/30 pt-2.5">
                                            <div className="flex items-center gap-1.5 text-xs font-semibold text-warning">
                                              <TimerIcon className="size-3" />
                                              逾期任务 ·{" "}
                                              {m.overdue_tasks.length}
                                            </div>
                                            {m.overdue_tasks.map((o) => (
                                              <div
                                                key={o.id}
                                                className="rounded-lg bg-warning/[0.07] px-3 py-2"
                                              >
                                                <div className="text-xs leading-relaxed text-warning">
                                                  {o.goal}
                                                </div>
                                                <div className="mt-1 flex items-center gap-1 text-xs text-warning">
                                                  <CalendarRangeIcon className="size-3" />
                                                  截止 {fmtDate(o.due_at)} ·
                                                  已逾期
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </CardContent>
                          </Card>

                          {/* Risks & Next actions */}
                          <div className="grid gap-3 lg:grid-cols-2">
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="flex items-center gap-1.5 text-sm">
                                  <AlertTriangleIcon className="size-4 text-breach" />
                                  风险与阻塞
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="space-y-2">
                                {pm.risks.length === 0 && (
                                  <EmptyHint text="暂无风险。下次 Run 前检查里程碑依赖与指派，可以提前暴露阻塞。" />
                                )}
                                {pm.risks.map((r, i) => {
                                  const traceId = traceIdFromDetail(r.detail);
                                  return (
                                    <div
                                      key={`${r.type}-${i}`}
                                      className="flex items-start gap-2 rounded-md border bg-card/50 px-2.5 py-2 text-xs"
                                    >
                                      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
                                      <div className="min-w-0">
                                        <div className="font-medium">
                                          {r.type === "milestone"
                                            ? r.milestone
                                            : r.task}
                                        </div>
                                        <div className="text-muted-foreground">
                                          {safeRiskDetail(r)}
                                        </div>
                                        {traceId && (
                                          <div className="mt-0.5 text-muted-foreground">
                                            追踪 ID：<code>{traceId}</code>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </CardContent>
                            </Card>

                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="flex items-center gap-1.5 text-sm">
                                  <ListChecksIcon className="size-4 text-muted-foreground" />
                                  下一步动作
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="space-y-2">
                                {pm.next_actions.length === 0 && (
                                  <EmptyHint text="当前没有就绪任务。执行 Run 让引擎推进，或到项目群里补充任务描述。" />
                                )}
                                {pm.next_actions.map((a) => (
                                  <div
                                    key={a.task_id}
                                    className="flex items-start gap-2 rounded-md border bg-card/50 px-2.5 py-2 text-xs"
                                  >
                                    <Badge
                                      variant="outline"
                                      className={`mt-0.5 shrink-0 text-xs ${PRIORITY_TONE[a.priority] ?? ""}`}
                                    >
                                      {a.priority}
                                    </Badge>
                                    <div className="min-w-0">
                                      <div className="font-medium">
                                        {a.task}
                                      </div>
                                      <div className="text-muted-foreground">
                                        {a.milestone}
                                        {a.estimate > 0 &&
                                          ` · 估时 ${a.estimate}d`}
                                        {a.due_at &&
                                          ` · 截止 ${fmtDate(a.due_at)}`}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </CardContent>
                            </Card>
                          </div>

                          {/* Assignments + Estimate stack */}
                          <div className="grid gap-3 lg:grid-cols-2">
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="flex items-center gap-1.5 text-sm">
                                  <UsersIcon className="size-4 text-muted-foreground" />
                                  人员指派
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="space-y-2">
                                {Object.keys(pm.assignments).length === 0 && (
                                  <EmptyHint text="暂无指派。任务会在执行时按角色路由，也可以在项目群里指定负责人。" />
                                )}
                                {Object.entries(pm.assignments).map(
                                  ([who, taskIds]) => (
                                    <div
                                      key={who}
                                      className="flex items-center justify-between rounded-md border bg-card/50 px-2.5 py-2 text-xs"
                                    >
                                      <span className="flex items-center gap-1.5 font-medium">
                                        <UserRoundIcon className="size-3.5 text-muted-foreground" />
                                        {who}
                                      </span>
                                      <span className="text-muted-foreground">
                                        {taskIds.length} 个任务
                                      </span>
                                    </div>
                                  ),
                                )}
                              </CardContent>
                            </Card>

                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                                  <span>里程碑估时</span>
                                  <span className="text-xs font-normal text-muted-foreground">
                                    已完成 / 剩余
                                  </span>
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <EstimateStack
                                  rows={estimateRows(pm.milestones)}
                                />
                              </CardContent>
                            </Card>
                          </div>
                        </>
                      )}

                      {/* Retro */}
                      {retro && (
                        <Card className="border-core/30 bg-core/[0.03]">
                          <CardHeader className="pb-2">
                            <CardTitle className="flex items-center gap-1.5 text-sm">
                              <ClipboardListIcon className="size-4 text-core" />
                              项目复盘
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                              <MetricCard
                                label="交付任务"
                                value={`${retro.done_tasks}/${retro.task_count}`}
                                icon={<CheckCircle2Icon className="size-4" />}
                              />
                              <MetricCard
                                label="失败/驳回"
                                value={`${retro.failed_tasks}/${retro.rejected_tasks}`}
                                tone={
                                  retro.failed_tasks + retro.rejected_tasks > 0
                                    ? "warn"
                                    : undefined
                                }
                                icon={<AlertTriangleIcon className="size-4" />}
                              />
                              <MetricCard
                                label="总重试"
                                value={`${retro.attempts_total}`}
                                icon={<RefreshCwIcon className="size-4" />}
                              />
                              <MetricCard
                                label="实际耗时"
                                value={
                                  retro.duration_days === null
                                    ? "—"
                                    : `${retro.duration_days} 天`
                                }
                                sub={`估时 ${retro.total_estimate}d`}
                                icon={<TimerIcon className="size-4" />}
                              />
                            </div>
                            <div>
                              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                                阻塞里程碑：
                                {retro.blocked_milestones.length > 0
                                  ? retro.blocked_milestones.join("、")
                                  : "无"}
                              </div>
                              <div className="text-xs font-medium text-muted-foreground">
                                建议：
                              </div>
                              <ul className="mt-1 space-y-1">
                                {retro.recommendations.map((r, i) => (
                                  <li
                                    key={i}
                                    className="flex items-start gap-1.5 text-xs"
                                  >
                                    <ArrowRightIcon className="mt-0.5 size-3 shrink-0 text-core" />
                                    <span>{r}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
        <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
