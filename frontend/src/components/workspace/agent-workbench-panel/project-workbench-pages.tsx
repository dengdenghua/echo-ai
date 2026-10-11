"use client";

import {
  ArrowRightIcon,
  BotIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  FileBoxIcon,
  FileTextIcon,
  FlagIcon,
  ListChecksIcon,
  ListTodoIcon,
  Loader2Icon,
  PackageOpenIcon,
  UserRoundIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RoutedWebLink } from "@/components/ui/routed-web-link";
import { trustBadgeClass, trustTooltip } from "@/core/cowork/trust";
import { cn } from "@/lib/utils";
import { rosterSeatIdentityLabel } from "./helpers";
import type {
  ProjectActionSpec,
  ProjectTaskReadModel,
  MilestoneView,
  ProjectAssetView,
  ProjectMemberView,
} from "./project-workbench-types";
import {
  STATUS_LABEL,
  STATUS_TONE,
  HEALTH_LABEL,
  HEALTH_TONE,
  HEALTH_DOT,
  PRIORITY_TONE,
  ACTIVE_TASK_STATUSES,
  ATTENTION_TASK_STATUSES,
  HUMAN_TEAM_MODES,
  TEAM_MODE_LABEL,
  fmtDate,
  formatEstimate,
  displayActionLabel,
  isExternalUrl,
} from "./project-workbench-model";
import { SectionTitle, EmptyState } from "./project-workbench-ui";

export function MilestonesTab({ milestones }: { milestones: MilestoneView[] }) {
  if (milestones.length === 0) {
    return (
      <EmptyState
        icon={<FlagIcon className="size-5" />}
        title="还没有里程碑"
        description="项目开始推进后，拆解出的阶段目标会显示在这里。"
      />
    );
  }

  return (
    <div className="space-y-2.5 p-3">
      <SectionTitle
        icon={<FlagIcon className="size-3.5" />}
        title="里程碑计划"
        meta={`${milestones.length} 个阶段`}
      />
      {milestones.map((milestone, index) => (
        <article
          key={milestone.id}
          className="rounded-xl border border-border-default bg-card/60 p-3 shadow-[var(--shadow-xs)]"
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="relative mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border-default bg-background text-[10px] font-semibold text-muted-foreground">
              {milestone.health === "completed" ? (
                <CheckCircle2Icon className="size-3.5 text-sky-600" />
              ) : (
                index + 1
              )}
              <span
                className={cn(
                  "absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-card",
                  HEALTH_DOT[milestone.health],
                )}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <h5 className="min-w-0 flex-1 truncate text-xs font-semibold">
                  {milestone.name}
                </h5>
                <Badge
                  variant="outline"
                  className={cn(
                    "h-4 px-1.5 text-micro",
                    HEALTH_TONE[milestone.health],
                  )}
                >
                  {HEALTH_LABEL[milestone.health]}
                </Badge>
              </div>
              {milestone.goal ? (
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                  {milestone.goal}
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Progress
              value={milestone.progressPercent}
              aria-label={`${milestone.name}进度 ${milestone.progressPercent}%`}
              className="h-1.5 rounded-full"
            />
            <span className="w-8 shrink-0 text-right text-[10px] font-medium text-muted-foreground">
              {milestone.progressPercent}%
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span>
              {milestone.total > 0
                ? `${milestone.done}/${milestone.total} 个事项`
                : "事项待拆解"}
            </span>
            {milestone.failed > 0 ? (
              <span className="text-rose-600">{milestone.failed} 个异常</span>
            ) : null}
            {milestone.due_at ? (
              <span className="inline-flex items-center gap-1">
                <CalendarDaysIcon className="size-3" />
                {fmtDate(milestone.due_at)} 截止
              </span>
            ) : null}
            {(milestone.remaining_estimate ?? 0) > 0 ? (
              <span>剩余 {formatEstimate(milestone.remaining_estimate)}</span>
            ) : null}
          </div>
          {(milestone.success_criteria?.length ?? 0) > 0 ? (
            <div className="mt-2.5 border-t border-border-subtle pt-2">
              <div className="text-micro font-medium uppercase tracking-wide text-muted-foreground">
                达成标准
              </div>
              <ul className="mt-1 space-y-1">
                {milestone.success_criteria
                  ?.slice(0, 3)
                  .map((criterion, criterionIndex) => (
                    <li
                      key={`${criterion}:${criterionIndex}`}
                      className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground"
                    >
                      <CheckCircle2Icon className="mt-0.5 size-3 shrink-0 text-emerald-600/70" />
                      <span>{criterion}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function TasksTab({
  tasks,
  allTasks,
  milestones,
  filter,
  counts,
  pendingAction,
  onFilter,
  onAction,
}: {
  tasks: ProjectTaskReadModel[];
  allTasks: ProjectTaskReadModel[];
  milestones: MilestoneView[];
  filter: "all" | "active" | "done" | "attention";
  counts: Record<"all" | "active" | "done" | "attention", number>;
  pendingAction: string | null;
  onFilter: (filter: "all" | "active" | "done" | "attention") => void;
  onAction: (spec: ProjectActionSpec, key: string) => void;
}) {
  const milestoneNames = new Map(
    milestones.map((milestone) => [milestone.id, milestone.name]),
  );
  const filters: Array<{
    id: "all" | "active" | "done" | "attention";
    label: string;
  }> = [
    { id: "all", label: "全部" },
    { id: "active", label: "进行中" },
    { id: "done", label: "已完成" },
    { id: "attention", label: "需关注" },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border-subtle bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {filters.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={filter === item.id}
              onClick={() => onFilter(item.id)}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter === item.id
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted/55 hover:text-foreground",
              )}
            >
              {item.label}
              <span className="text-micro opacity-70">{counts[item.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {allTasks.length === 0 ? (
        <EmptyState
          icon={<ListTodoIcon className="size-5" />}
          title="还没有事项"
          description="里程碑拆解出的人员与 AI 工作项会统一显示在这里。"
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<ListChecksIcon className="size-5" />}
          title="这个筛选下没有事项"
          description="切换筛选条件，查看项目中的其他工作项。"
        />
      ) : (
        <div className="space-y-2 p-3">
          {tasks.map((task) => {
            const availableActions = (task.action_specs ?? []).filter(
              (spec) => (spec.requires?.length ?? 0) === 0,
            );
            return (
              <article
                key={task.id}
                className="rounded-xl border border-border-default bg-card/60 p-3 shadow-[var(--shadow-xs)]"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <span
                    className={cn(
                      "mt-1 size-2 shrink-0 rounded-full",
                      task.status === "done"
                        ? "bg-sky-500"
                        : task.status === "running"
                          ? "animate-pulse bg-emerald-500"
                          : ATTENTION_TASK_STATUSES.has(task.status)
                            ? "bg-rose-500"
                            : "bg-muted-foreground/45",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start gap-1.5">
                      <h5 className="min-w-0 flex-1 text-xs font-medium leading-relaxed">
                        {task.goal || task.id}
                      </h5>
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-4 px-1.5 text-micro",
                          STATUS_TONE[task.status],
                        )}
                      >
                        {STATUS_LABEL[task.status] ?? task.status}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-muted-foreground">
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-4 px-1 text-micro",
                          PRIORITY_TONE[task.priority],
                        )}
                      >
                        {task.priority || "P2"}
                      </Badge>
                      <span className="truncate">
                        {milestoneNames.get(task.milestone_id) ||
                          "未关联里程碑"}
                      </span>
                      {task.estimate > 0 ? (
                        <span>{formatEstimate(task.estimate)}</span>
                      ) : null}
                      {task.due_at ? (
                        <span>{fmtDate(task.due_at)} 截止</span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      {task.assigned_agent &&
                      !HUMAN_TEAM_MODES.has(task.team_mode) ? (
                        <BotIcon className="size-3" />
                      ) : (
                        <UserRoundIcon className="size-3" />
                      )}
                      <span className="truncate">
                        {task.team_mode === "human"
                          ? task.assigned_agent || "待真人认领"
                          : task.assigned_agent ||
                            task.assigned_role ||
                            "待指派"}
                      </span>
                      {task.team_mode && task.team_mode !== "single" ? (
                        <span className="rounded bg-muted px-1 py-px text-micro uppercase">
                          {TEAM_MODE_LABEL[task.team_mode] ?? task.team_mode}
                        </span>
                      ) : null}
                      {task.status === "done" && task.review_mode ? (
                        <span
                          className={cn(
                            "rounded px-1 py-px text-micro",
                            task.review_mode === "operator"
                              ? "bg-emerald-500/15 text-emerald-700"
                              : task.review_mode === "human_run"
                                ? "bg-amber-500/15 text-amber-700"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {task.review_mode === "operator"
                            ? `已人工审核${task.reviewed_by ? `·${task.reviewed_by}` : ""}`
                            : task.review_mode === "human_run"
                              ? `真人执行${task.reviewed_by && task.reviewed_by !== "human" ? `·${task.reviewed_by}` : ""}`
                              : "AI 自动交付"}
                        </span>
                      ) : null}
                    </div>
                    {(task.acceptance_criteria?.length ?? 0) > 0 ? (
                      <div className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                        完成标准：{task.acceptance_criteria.join("；")}
                      </div>
                    ) : null}
                    {availableActions.length > 0 ? (
                      <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border-subtle pt-2">
                        {availableActions
                          .slice(0, 3)
                          .map((spec, actionIndex) => {
                            const key = `task:${task.id}:${spec.action}:${actionIndex}`;
                            const loading = pendingAction === key;
                            return (
                              <Button
                                key={key}
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-6 rounded-md px-2 text-micro"
                                disabled={!!pendingAction}
                                onClick={() => onAction(spec, key)}
                              >
                                {loading ? (
                                  <Loader2Icon className="size-3 animate-spin" />
                                ) : (
                                  <ArrowRightIcon className="size-3" />
                                )}
                                {displayActionLabel(spec, true)}
                              </Button>
                            );
                          })}
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AssetsTab({
  assets,
  onOpenArtifact,
}: {
  assets: ProjectAssetView[];
  onOpenArtifact?: (path: string) => void;
}) {
  if (assets.length === 0) {
    return (
      <EmptyState
        icon={<PackageOpenIcon className="size-5" />}
        title="还没有项目资料"
        description="事项完成后产生的文档、文件和链接会自动汇总到这里。"
      />
    );
  }

  return (
    <div className="space-y-2.5 p-3">
      <SectionTitle
        icon={<FileBoxIcon className="size-3.5" />}
        title="项目资料"
        meta={`${assets.length} 项`}
      />
      {assets.map((asset) => {
        const path = asset.path;
        const canOpenInWorkbench = !!path && !!onOpenArtifact;
        const card = (
          <>
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-primary">
              <FileTextIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <h5 className="min-w-0 flex-1 truncate text-xs font-medium">
                  {asset.name}
                </h5>
                {asset.kind ? (
                  <Badge
                    variant="outline"
                    className="h-4 px-1 text-micro text-muted-foreground"
                  >
                    {asset.kind}
                  </Badge>
                ) : null}
              </div>
              {asset.summary ? (
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                  {asset.summary}
                </p>
              ) : null}
              <div className="mt-1.5 flex min-w-0 items-center gap-1 text-micro text-muted-foreground">
                {asset.sourceTask ? (
                  <span className="min-w-0 truncate">
                    来自：{asset.sourceTask}
                  </span>
                ) : (
                  <span>项目资料</span>
                )}
                {asset.path || asset.url ? (
                  <ExternalLinkIcon className="ml-auto size-3 shrink-0" />
                ) : null}
              </div>
            </div>
          </>
        );

        if (isExternalUrl(asset.url)) {
          return (
            <RoutedWebLink
              key={asset.id}
              href={asset.url}
              openTargetSource="project-asset"
              className="flex w-full items-start gap-2.5 rounded-xl border border-border-default bg-card/60 p-3 text-left shadow-[var(--shadow-xs)] transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {card}
            </RoutedWebLink>
          );
        }
        return (
          <button
            key={asset.id}
            type="button"
            disabled={!canOpenInWorkbench}
            onClick={() => {
              if (path) onOpenArtifact?.(path);
            }}
            className={cn(
              "flex w-full items-start gap-2.5 rounded-xl border border-border-default bg-card/60 p-3 text-left shadow-[var(--shadow-xs)]",
              canOpenInWorkbench &&
                "transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              !canOpenInWorkbench && "cursor-default",
            )}
          >
            {card}
          </button>
        );
      })}
    </div>
  );
}

export function MembersTab({
  members,
  tasks,
  onInvitePeople,
}: {
  members: ProjectMemberView[];
  tasks: ProjectTaskReadModel[];
  onInvitePeople?: () => void | Promise<void>;
}) {
  return (
    <div className="space-y-2.5 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <SectionTitle
            icon={<UsersIcon className="size-3.5" />}
            title="项目成员"
            meta={`${members.length} 位`}
          />
        </div>
        {onInvitePeople ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1.5 rounded-lg px-2 text-[10px]"
            onClick={() => void onInvitePeople()}
          >
            <UserPlusIcon className="size-3.5" />
            邀请真人
          </Button>
        ) : null}
      </div>
      {members.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="size-5" />}
          title="还没有项目成员"
          description="成员加入工作群或被加入项目后，会统一显示在这里。"
        />
      ) : null}
      {members.map((member) => {
        const ownedTasks = tasks.filter(
          (task) =>
            task.assigned_agent === member.name ||
            (!task.assigned_agent && task.assigned_role === member.name),
        );
        const activeCount = ownedTasks.filter((task) =>
          ACTIVE_TASK_STATUSES.has(task.status),
        ).length;
        const doneCount = ownedTasks.filter(
          (task) => task.status === "done",
        ).length;
        return (
          <article
            key={member.id}
            className="flex items-center gap-2.5 rounded-xl border border-border-default bg-card/60 p-2.5 shadow-[var(--shadow-xs)]"
          >
            <Avatar className="size-9 rounded-xl border border-border-subtle">
              {member.avatarUrl ? (
                <AvatarImage src={member.avatarUrl} alt={member.name} />
              ) : null}
              <AvatarFallback
                className={cn(
                  "rounded-xl text-xs font-semibold",
                  member.kind === "agent"
                    ? "bg-violet-500/10 text-violet-600"
                    : member.kind === "role"
                      ? "bg-amber-500/10 text-amber-700"
                      : "bg-sky-500/10 text-sky-600",
                )}
              >
                {member.kind === "agent" ? (
                  <BotIcon className="size-4" />
                ) : member.kind === "role" ? (
                  <UsersIcon className="size-4" />
                ) : (
                  member.name.charAt(0).toLocaleUpperCase()
                )}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <h5 className="min-w-0 truncate text-xs font-medium">
                  {member.name}
                </h5>
                {member.isOwner ? (
                  <Badge className="h-4 bg-primary/10 px-1 text-micro text-primary">
                    负责人
                  </Badge>
                ) : null}
                {member.kind === "role" ? (
                  <Badge
                    className={cn(
                      "h-4 px-1 text-micro",
                      member.driver === "human"
                        ? "bg-amber-500/15 text-amber-700"
                        : "bg-violet-500/10 text-violet-600",
                    )}
                  >
                    {rosterSeatIdentityLabel(member)}
                  </Badge>
                ) : null}
                {member.trust ? (
                  <Badge
                    className={cn(
                      "h-4 cursor-help px-1 text-micro font-semibold",
                      trustBadgeClass(member.trust.score),
                    )}
                    title={trustTooltip(member.trust)}
                  >
                    信任 {member.trust.score} · {member.trust.label}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {member.role}
                {member.status ? ` · ${member.status}` : ""}
              </div>
            </div>
            <div className="shrink-0 text-right text-micro leading-relaxed text-muted-foreground">
              {ownedTasks.length > 0 ? (
                <>
                  <div>{activeCount} 项进行中</div>
                  <div>{doneCount} 项已完成</div>
                </>
              ) : (
                <div>暂无事项</div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
