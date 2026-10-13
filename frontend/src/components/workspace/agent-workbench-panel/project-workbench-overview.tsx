"use client";

import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleDotDashedIcon,
  ClipboardListIcon,
  FileBoxIcon,
  ListChecksIcon,
  ListTodoIcon,
  Loader2Icon,
  PlayIcon,
  RotateCcwIcon,
  TimerIcon,
  XCircleIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type {
  ProjectWorkbenchTabId,
  ProjectActionSpec,
  ProjectFullState,
  MilestoneView,
} from "./project-workbench-types";
import {
  PRIORITY_TONE,
  ACTIVE_TASK_STATUSES,
  fmtDate,
  fmtDecisionTime,
  formatEstimate,
  displayActionLabel,
  safeRiskDetail,
  uniqueProjectRisks,
  projectDecisionViews,
} from "./project-workbench-model";
import { SectionTitle, MetricCard, RetroMetric } from "./project-workbench-ui";

export function OverviewTab({
  state,
  milestones,
  overallProgress,
  doneTasks,
  totalTasks,
  completedMilestones,
  riskCount,
  assetCount,
  isEmptyProject,
  pendingAction,
  onAction,
  onNavigate,
  onProjectCommand,
  commandBusy,
}: {
  state: ProjectFullState;
  milestones: MilestoneView[];
  overallProgress: number;
  doneTasks: number;
  totalTasks: number;
  completedMilestones: number;
  riskCount: number;
  assetCount: number;
  isEmptyProject: boolean;
  pendingAction: string | null;
  onAction: (spec: ProjectActionSpec, key: string) => void;
  onNavigate: (tab: ProjectWorkbenchTabId) => void;
  onProjectCommand?: (command: string) => void;
  commandBusy: boolean;
}) {
  const { project, pm, retro, action_specs: actionSpecs = [] } = state;
  const nextActions = pm?.next_actions ?? [];
  const risks = uniqueProjectRisks(pm);
  const blockers = pm?.blockers ?? [];
  const decisions = projectDecisionViews(state.decisions);
  const hasRemainingEstimate = Number(pm?.remaining_estimate) > 0;

  if (isEmptyProject) {
    return (
      <div className="p-3">
        <section
          data-testid="project-empty-launch-card"
          className="overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.08] via-card to-card p-4 shadow-[var(--shadow-xs)]"
        >
          <div className="flex size-10 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
            <CircleDotDashedIcon className="size-5" />
          </div>
          <h4 className="mt-3 text-sm font-semibold text-foreground">
            从第一个里程碑开始
          </h4>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            在群聊中明确项目计划，或打开管理页创建里程碑和事项；后续进展会自动汇总到这里。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {actionSpecs.length > 0 ? (
              actionSpecs.map((spec, index) => {
                const key = `project:${spec.action}:${index}`;
                const loading = pendingAction === key;
                return (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={index === 0 ? "default" : "outline"}
                    className="h-8 rounded-lg px-2.5 text-xs"
                    disabled={!!pendingAction}
                    onClick={() => onAction(spec, key)}
                  >
                    {loading ? (
                      <Loader2Icon className="size-3 animate-spin" />
                    ) : spec.action.startsWith("recover") ? (
                      <RotateCcwIcon className="size-3" />
                    ) : (
                      <PlayIcon className="size-3" />
                    )}
                    {displayActionLabel(spec)}
                  </Button>
                );
              })
            ) : (
              <Button asChild size="sm" className="h-8 rounded-lg text-xs">
                <Link to="/workspace/projects">
                  打开项目管理
                  <ArrowRightIcon className="size-3" />
                </Link>
              </Button>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      <section className="rounded-xl border border-border-default bg-card/70 p-3 shadow-[var(--shadow-xs)]">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground">
              交付进度
            </div>
            <div className="mt-0.5 text-2xl font-semibold tracking-tight">
              {overallProgress}
              <span className="ml-0.5 text-sm font-medium text-muted-foreground">
                %
              </span>
            </div>
          </div>
          <div className="text-right text-xs leading-relaxed text-muted-foreground">
            <div>
              {doneTasks}/{totalTasks} 个事项完成
            </div>
            <div>
              {completedMilestones}/{milestones.length} 个里程碑达成
            </div>
          </div>
        </div>
        <Progress
          value={overallProgress}
          aria-label={`项目交付进度 ${overallProgress}%`}
          className="mt-2.5 h-1.5 rounded-full"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          按全部里程碑平均计算，未开始阶段也计入。
          {nextActions.some((action) => action.type === "owner_acceptance")
            ? "交付待你验收，通过后才推进后续阶段。"
            : "里程碑达成情况单独统计。"}
        </p>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          label="待推进事项"
          value={String(
            Object.values(state.tasks ?? {})
              .flat()
              .filter((task) => ACTIVE_TASK_STATUSES.has(task.status)).length,
          )}
          icon={<ListTodoIcon className="size-3.5" />}
          onClick={() => onNavigate("tasks")}
        />
        <MetricCard
          label="风险与阻塞"
          value={String(riskCount)}
          icon={<AlertTriangleIcon className="size-3.5" />}
          tone={riskCount > 0 ? "warning" : "default"}
        />
        <MetricCard
          label={hasRemainingEstimate ? "剩余估时" : "项目资料"}
          value={
            hasRemainingEstimate
              ? formatEstimate(pm?.remaining_estimate)
              : String(assetCount)
          }
          icon={
            hasRemainingEstimate ? (
              <TimerIcon className="size-3.5" />
            ) : (
              <FileBoxIcon className="size-3.5" />
            )
          }
          onClick={
            hasRemainingEstimate ? undefined : () => onNavigate("assets")
          }
        />
        <MetricCard
          label="下一步"
          value={String(nextActions.length)}
          icon={<ListChecksIcon className="size-3.5" />}
        />
      </div>

      {decisions.length > 0 ? (
        <section
          className="space-y-2"
          aria-labelledby="project-decisions-title"
        >
          <SectionTitle
            icon={<CheckCircle2Icon className="size-3.5" />}
            title="项目决策"
            meta={`${decisions.length} 条沉淀`}
            titleId="project-decisions-title"
          />
          <div className="space-y-1.5">
            {decisions.slice(0, 3).map((decision) => {
              const meta = [
                decision.actor ? `记录者 ${decision.actor}` : undefined,
                fmtDecisionTime(decision.createdAt),
                decision.milestoneId
                  ? `里程碑 ${decision.milestoneId}`
                  : undefined,
              ].filter((item): item is string => !!item);
              return (
                <article
                  key={decision.id}
                  className="rounded-lg border border-core/30 bg-core/[0.045] px-2.5 py-2"
                >
                  <h5 className="text-xs font-medium leading-relaxed text-foreground">
                    {decision.title}
                  </h5>
                  {decision.body ? (
                    <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                      {decision.body}
                    </p>
                  ) : null}
                  {meta.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-micro text-muted-foreground/85">
                      {meta.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {actionSpecs.length > 0 ? (
        <section className="space-y-2">
          <SectionTitle
            icon={<PlayIcon className="size-3.5" />}
            title="项目操作"
          />
          <div className="flex flex-wrap gap-1.5">
            {actionSpecs.map((spec, index) => {
              const key = `project:${spec.action}:${index}`;
              const loading = pendingAction === key;
              return (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={index === 0 ? "default" : "outline"}
                  className="h-7 rounded-md px-2 text-xs"
                  disabled={!!pendingAction}
                  onClick={() => onAction(spec, key)}
                >
                  {loading ? (
                    <Loader2Icon className="size-3 animate-spin" />
                  ) : spec.action.startsWith("recover") ? (
                    <RotateCcwIcon className="size-3" />
                  ) : (
                    <PlayIcon className="size-3" />
                  )}
                  {displayActionLabel(spec)}
                </Button>
              );
            })}
          </div>
        </section>
      ) : null}

      {nextActions.length > 0 ? (
        <section className="space-y-2">
          <SectionTitle
            icon={<ListChecksIcon className="size-3.5" />}
            title="接下来做什么"
            meta={`${nextActions.length} 项可推进`}
          />
          <div className="space-y-1.5">
            {nextActions.slice(0, 4).map((action) => (
              <button
                type="button"
                key={`${action.type ?? "task"}:${action.milestone_id ?? action.milestone}:${action.task_id}`}
                disabled={
                  action.type === "owner_acceptance" &&
                  (commandBusy || !onProjectCommand)
                }
                onClick={() => {
                  if (
                    action.type === "owner_acceptance" &&
                    action.milestone_id &&
                    /^[a-zA-Z0-9_-]+$/.test(action.milestone_id) &&
                    milestones.some((ms) => ms.id === action.milestone_id)
                  ) {
                    onProjectCommand?.(
                      `/project accept ${action.milestone_id}`,
                    );
                  } else onNavigate("tasks");
                }}
                className="group flex w-full items-start gap-2 rounded-lg border border-border-subtle bg-card/50 px-2.5 py-2 text-left transition-colors hover:border-border-default hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Badge
                  variant="outline"
                  className={cn(
                    "mt-px h-4 px-1 text-micro",
                    PRIORITY_TONE[action.priority],
                  )}
                >
                  {action.priority}
                </Badge>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {action.type === "owner_acceptance"
                      ? "审阅交付物并验收"
                      : action.task}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {action.milestone || "未关联里程碑"}
                    {action.due_at ? ` · ${fmtDate(action.due_at)} 截止` : ""}
                  </span>
                </span>
                <ArrowRightIcon className="mt-1 size-3 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </section>
      ) : !pm && project.status === "planning" ? (
        <div className="rounded-xl border border-dashed border-border-default bg-muted/25 px-3 py-4 text-center">
          <CircleDotDashedIcon className="mx-auto size-5 text-muted-foreground" />
          <div className="mt-2 text-xs font-medium">项目正在等待拆解</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            开始推进后，这里会出现里程碑、下一步事项和风险提醒。
          </p>
        </div>
      ) : null}

      {risks.length > 0 || blockers.length > 0 ? (
        <section className="space-y-2">
          <SectionTitle
            icon={<AlertTriangleIcon className="size-3.5" />}
            title="需要关注"
            meta={`${risks.length + blockers.length} 条`}
          />
          <div className="space-y-1.5">
            {blockers.map((blocker, index) => (
              <div
                key={`blocker:${index}`}
                className="flex items-start gap-2 rounded-lg border border-breach/30 bg-breach/[0.06] px-2.5 py-2 text-xs text-breach"
              >
                <XCircleIcon className="mt-px size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{blocker}</span>
              </div>
            ))}
            {risks.slice(0, 4).map((risk, index) => (
              <div
                key={`risk:${risk.task_id ?? risk.milestone ?? index}`}
                className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.06] px-2.5 py-2 text-xs text-warning"
              >
                <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{safeRiskDetail(risk)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {retro ? (
        <section className="space-y-2 rounded-xl border border-core/30 bg-core/[0.05] p-3">
          <SectionTitle
            icon={<ClipboardListIcon className="size-3.5 text-core" />}
            title="项目复盘"
            meta={
              retro.duration_days == null
                ? undefined
                : `${retro.duration_days} 天`
            }
          />
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <RetroMetric
              label="交付"
              value={`${retro.done_tasks}/${retro.task_count}`}
            />
            <RetroMetric label="失败" value={String(retro.failed_tasks)} />
            <RetroMetric label="尝试" value={String(retro.attempts_total)} />
          </div>
          {retro.recommendations.length > 0 ? (
            <ul className="space-y-1.5 pt-0.5">
              {retro.recommendations.map((recommendation, index) => (
                <li
                  key={`${recommendation}:${index}`}
                  className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"
                >
                  <ArrowRightIcon className="mt-0.5 size-3 shrink-0 text-core" />
                  <span>{recommendation}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
