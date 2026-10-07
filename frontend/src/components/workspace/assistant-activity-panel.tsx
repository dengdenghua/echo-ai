import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ActivityIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  ExternalLinkIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  assistantActivityErrorMessage,
  assistantActivityRoute,
  useAssistantActivity,
  type AssistantActivityItem,
  type AssistantActivityState,
} from "@/core/assistant/activity";
import { builtinPersonaDisplayName } from "@/core/agents/persona-display";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

type ActivityFilter = "all" | AssistantActivityState;

export function AssistantActivityPanel({
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const navigate = useNavigate();
  const activity = useAssistantActivity(open);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [search, setSearch] = useState("");
  const items = activity.data?.items ?? [];
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = items.filter(
    (item) =>
      (filter === "all" || item.state === filter) &&
      matchesActivity(item, terms, zh),
  );
  const loadedAt = localActivityTime(activity.dataUpdatedAt);
  const filters: Array<{
    value: ActivityFilter;
    label: string;
    count: number;
  }> = [
    { value: "all", label: zh ? "全部" : "All", count: items.length },
    {
      value: "working",
      label: zh ? "正在处理" : "Working",
      count: activity.data?.summary.working ?? 0,
    },
    {
      value: "attention",
      label: zh ? "需关注" : "Needs attention",
      count: activity.data?.summary.attention ?? 0,
    },
    {
      value: "completed",
      label: zh ? "已完成" : "Completed",
      count: activity.data?.summary.completed ?? 0,
    },
  ];
  const refresh = () => void activity.refetch();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full min-w-0 gap-0 sm:max-w-lg"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <SheetHeader className="shrink-0 border-b border-border pr-12">
          <SheetTitle className="flex items-center gap-2 text-base">
            <ActivityIcon className="size-4" aria-hidden="true" />
            {zh ? "助手活动" : "Assistant activity"}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {zh
              ? "查看运行、项目和协作任务的进度及待处理问题。"
              : "Review progress and issues across runs, projects and collaboration tasks."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
            <p aria-live="polite">
              {activity.isFetching && activity.data
                ? zh
                  ? "更新活动中…"
                  : "Updating activity…"
                : zh
                  ? "完成后仍可打开来源核对结果。"
                  : "Open completed sources to review their results."}
            </p>
            {activity.data && loadedAt && (
              <p>
                {zh ? "上次成功读取：" : "Last successful refresh: "}
                <time dateTime={new Date(activity.dataUpdatedAt).toISOString()}>
                  {loadedAt}
                </time>
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={activity.isFetching}
          >
            <RefreshCwIcon
              className={cn("size-3.5", activity.isFetching && "animate-spin")}
              aria-hidden="true"
            />
            {zh ? "刷新" : "Refresh"}
          </Button>
        </div>

        {activity.isError && (
          <div
            role="alert"
            className="mx-4 mb-3 shrink-0 space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs"
          >
            <p className="font-medium text-destructive">
              {activity.data
                ? zh
                  ? "刷新失败，以下保留上次读取的活动。"
                  : "Refresh failed. Previously loaded activity is shown below."
                : zh
                  ? "无法读取助手活动"
                  : "Could not load assistant activity"}
            </p>
            {activity.error && (
              <p className="break-words text-muted-foreground">
                {assistantActivityErrorMessage(activity.error, zh)}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={activity.isFetching}
            >
              {zh ? "重试" : "Retry"}
            </Button>
          </div>
        )}

        <div className="mx-4 mb-3 shrink-0 space-y-2">
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={zh ? "搜索活动" : "Search activity"}
              placeholder={
                zh
                  ? "搜索任务、项目、群组、角色或状态"
                  : "Search task, project, room, agent or status"
              }
              className="min-w-0 pr-10 pl-9 text-xs"
            />
            {search && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-1/2 right-1 -translate-y-1/2"
                aria-label={zh ? "清除搜索" : "Clear search"}
                onClick={() => setSearch("")}
              >
                <XIcon className="size-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
          {activity.data && (
            <p className="text-[10px] text-muted-foreground" aria-live="polite">
              {terms.length > 0 &&
                (zh
                  ? `匹配 ${visible.length} 条 · `
                  : `${visible.length} matches · `)}
              {zh
                ? `筛选计数基于最近 ${items.length} 条记录`
                : `Filter counts cover the latest ${items.length} records`}
            </p>
          )}
        </div>

        <Tabs
          value={filter}
          onValueChange={(value) => setFilter(value as ActivityFilter)}
          className="min-h-0 flex-1 gap-0"
        >
          <TabsList
            className="mx-4 grid w-auto grid-cols-4 gap-0"
            aria-label={zh ? "活动筛选" : "Filter activity"}
          >
            {filters.map(({ value, label, count }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="min-w-0 gap-1 px-1 text-xs"
              >
                <span className="truncate">{label}</span>
                {activity.data && (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {count}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent
            value={filter}
            className="min-h-0 overflow-y-auto overscroll-contain px-4 py-3"
          >
            {activity.isPending && !activity.data ? (
              <div
                role="status"
                className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
              >
                <Loader2Icon
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
                {zh ? "读取活动中…" : "Loading activity…"}
              </div>
            ) : activity.data && visible.length === 0 ? (
              <p
                role="status"
                className="py-12 text-center text-sm text-muted-foreground"
              >
                {terms.length > 0
                  ? zh
                    ? "未找到匹配活动，请调整搜索或筛选。"
                    : "No matching activity. Try another search or filter."
                  : filter === "all"
                    ? zh
                      ? "暂无助手活动"
                      : "No assistant activity yet"
                    : zh
                      ? "当前筛选下暂无活动"
                      : "No activity in this filter"}
              </p>
            ) : (
              <ul
                className="space-y-3"
                aria-label={zh ? "活动列表" : "Activity list"}
              >
                {visible.map((item) => (
                  <ActivityRow
                    key={item.id}
                    item={item}
                    zh={zh}
                    onOpen={() => {
                      const route = assistantActivityRoute(item);
                      if (!route) return;
                      navigate(route, {
                        state: {
                          openProjectWorkbench: Boolean(item.project_id),
                        },
                      });
                      onOpenChange(false);
                    }}
                  />
                ))}
              </ul>
            )}
            {activity.data?.has_more && (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                {zh
                  ? `仅展示最近 ${items.length} 条活动，可打开来源查看完整记录。`
                  : `Showing the latest ${items.length} activities. Open a source for its full history.`}
              </p>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function ActivityRow({
  item,
  zh,
  onOpen,
}: {
  item: AssistantActivityItem;
  zh: boolean;
  onOpen: () => void;
}) {
  const route = assistantActivityRoute(item);
  const Icon =
    item.state === "attention"
      ? CircleAlertIcon
      : item.state === "completed"
        ? CheckCircle2Icon
        : ActivityIcon;
  const source =
    item.source === "run"
      ? zh
        ? "运行"
        : "Run"
      : item.source === "project_task"
        ? zh
          ? "项目任务"
          : "Project task"
        : zh
          ? "协作任务"
          : "Collaboration task";
  const date = new Date(item.updated_at);
  const updated = Number.isNaN(date.getTime()) ? null : date.toLocaleString();

  return (
    <li className="min-w-0 rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            item.state === "attention"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">
            {item.title || source}
          </p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{source}</span>
            <Badge
              variant="outline"
              className="max-w-full whitespace-normal break-all text-[10px]"
              title={item.status}
            >
              {activityStatusLabel(item.status, zh)}
            </Badge>
          </div>
        </div>
      </div>
      {item.reason && (
        <p className="mt-2 break-words text-xs text-muted-foreground">
          {activityReason(item.reason, zh)}
        </p>
      )}
      <div className="mt-2 space-y-1 break-words text-xs text-muted-foreground">
        {(item.project_name || item.project_id) && (
          <p>
            {zh ? "项目" : "Project"}: {item.project_name || item.project_id}
          </p>
        )}
        {(item.room_name || item.room_id) && (
          <p>
            {zh ? "群组" : "Room"}: {item.room_name || item.room_id}
          </p>
        )}
        {item.agent_ids.length > 0 && (
          <p title={item.agent_ids.join(", ")}>
            {zh ? "角色" : "Agents"}:{" "}
            {item.agent_ids.map(agentDisplayName).join(", ")}
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {updated ? (
          <time
            dateTime={item.updated_at}
            className="text-[10px] text-muted-foreground"
          >
            {zh ? "更新于 " : "Updated "}
            {updated}
          </time>
        ) : (
          <span />
        )}
        <Button variant="ghost" size="sm" disabled={!route} onClick={onOpen}>
          <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          {zh ? "打开来源" : "Open source"}
        </Button>
      </div>
      {!route && (
        <p className="mt-1 text-xs text-muted-foreground">
          {zh
            ? "这条记录没有关联可打开的来源会话。"
            : "No source conversation is linked to this activity."}
        </p>
      )}
    </li>
  );
}

function activityReason(reason: string, zh: boolean): string {
  if (reason === "execution_completed") {
    return zh
      ? "本次执行已结束，项目任务尚未完成。"
      : "This execution has ended; the project task is not yet complete.";
  }
  const labels: Record<string, [string, string]> = {
    pending: ["等待开始", "Waiting to start"],
    running: ["正在执行", "Running"],
    verifying: ["正在验证", "Verifying"],
    repairing: ["正在修复", "Repairing"],
    waiting_approval: ["等待确认", "Waiting for approval"],
    waiting_input: ["等待输入", "Waiting for input"],
    waiting_review: ["等待审核", "Waiting for review"],
    paused: ["已暂停", "Paused"],
    failed: ["已失败", "Failed"],
    interrupted: ["已中断", "Interrupted"],
    disconnected: ["已断开连接", "Disconnected"],
    cancelled: ["已取消", "Cancelled"],
    canceled: ["已取消", "Cancelled"],
    blocked: ["受阻", "Blocked"],
    timed_out: ["执行超时", "Timed out"],
    stopped: ["已停止", "Stopped"],
    completed: ["已结束", "Ended"],
    done: ["已结束", "Ended"],
  };
  const linked = reason.startsWith("run:");
  const status = linked ? reason.slice(4) : reason;
  const label = Object.hasOwn(labels, status) ? labels[status] : undefined;
  if (!label) return reason;
  return linked
    ? zh
      ? `关联运行${label[0]}`
      : `Linked run: ${label[1]}`
    : label[zh ? 0 : 1];
}

function agentDisplayName(id: string): string {
  return builtinPersonaDisplayName(id) || id;
}

function localActivityTime(value: number | undefined): string | null {
  if (!value || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

function matchesActivity(
  item: AssistantActivityItem,
  terms: string[],
  zh: boolean,
): boolean {
  if (terms.length === 0) return true;
  const text = [
    item.title,
    item.project_name,
    item.project_id,
    item.room_name,
    item.room_id,
    ...item.agent_ids,
    ...item.agent_ids.map(agentDisplayName),
    item.status,
    activityStatusLabel(item.status, zh),
  ]
    .join(" ")
    .toLocaleLowerCase();
  return terms.every((term) => text.includes(term));
}

function activityStatusLabel(status: string, zh: boolean): string {
  const labels: Record<string, [string, string]> = {
    pending: ["待开始", "Pending"],
    ready: ["待开始", "Ready"],
    queued: ["排队中", "Queued"],
    running: ["执行中", "Running"],
    in_progress: ["进行中", "In progress"],
    active: ["进行中", "Active"],
    planning: ["规划中", "Planning"],
    verifying: ["验证中", "Verifying"],
    repairing: ["修复中", "Repairing"],
    waiting_approval: ["等待确认", "Waiting for approval"],
    waiting_input: ["等待输入", "Waiting for input"],
    waiting_review: ["等待审核", "Waiting for review"],
    paused: ["已暂停", "Paused"],
    blocked: ["受阻", "Blocked"],
    failed: ["失败", "Failed"],
    interrupted: ["已中断", "Interrupted"],
    disconnected: ["连接断开", "Disconnected"],
    cancelled: ["已取消", "Cancelled"],
    canceled: ["已取消", "Cancelled"],
    timed_out: ["已超时", "Timed out"],
    stopped: ["已停止", "Stopped"],
    done: ["已完成", "Completed"],
    completed: ["已完成", "Completed"],
  };
  const label = Object.hasOwn(labels, status) ? labels[status] : undefined;
  return label?.[zh ? 0 : 1] || status || "—";
}
