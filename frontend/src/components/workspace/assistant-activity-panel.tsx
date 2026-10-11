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
import {
  assistantActivityCopy,
  activityReason,
  activityStatusLabel,
  type AssistantActivityCopy,
} from "@/core/i18n/locales/assistant-activity";
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
  const copy = assistantActivityCopy(locale);
  const navigate = useNavigate();
  const activity = useAssistantActivity(open);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [search, setSearch] = useState("");
  const items = activity.data?.items ?? [];
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = items.filter(
    (item) =>
      (filter === "all" || item.state === filter) &&
      matchesActivity(item, terms, copy),
  );
  const loadedAt = localActivityTime(activity.dataUpdatedAt, locale);
  const filters: Array<{
    value: ActivityFilter;
    label: string;
    count: number;
  }> = [
    { value: "all", label: copy.all, count: items.length },
    {
      value: "working",
      label: copy.working,
      count: activity.data?.summary.working ?? 0,
    },
    {
      value: "attention",
      label: copy.attention,
      count: activity.data?.summary.attention ?? 0,
    },
    {
      value: "completed",
      label: copy.completed,
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
            {copy.title}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {copy.description}
          </SheetDescription>
        </SheetHeader>

        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
            <p aria-live="polite">
              {activity.isFetching && activity.data
                ? copy.updating
                : copy.reviewResults}
            </p>
            {activity.data && loadedAt && (
              <p>
                {copy.lastRefresh}
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
            {copy.refresh}
          </Button>
        </div>

        {activity.isError && (
          <div
            role="alert"
            className="mx-4 mb-3 shrink-0 space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs"
          >
            <p className="font-medium text-destructive">
              {activity.data ? copy.stale : copy.loadFailed}
            </p>
            {activity.error && (
              <p className="break-words text-muted-foreground">
                {assistantActivityErrorMessage(activity.error, locale)}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={activity.isFetching}
            >
              {copy.retry}
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
              aria-label={copy.search}
              placeholder={copy.searchPlaceholder}
              className="min-w-0 pr-10 pl-9 text-xs"
            />
            {search && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-1/2 right-1 -translate-y-1/2"
                aria-label={copy.clearSearch}
                onClick={() => setSearch("")}
              >
                <XIcon className="size-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
          {activity.data && (
            <p className="text-[10px] text-muted-foreground" aria-live="polite">
              {terms.length > 0 && copy.matches(visible.length)}
              {copy.counts(items.length)}
            </p>
          )}
        </div>

        <Tabs
          value={filter}
          onValueChange={(value) => {
            if (
              value === "all" ||
              value === "working" ||
              value === "attention" ||
              value === "completed"
            )
              setFilter(value);
          }}
          className="min-h-0 flex-1 gap-0"
        >
          <TabsList
            className="mx-4 grid w-auto grid-cols-4 gap-0"
            aria-label={copy.filter}
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
                {copy.loading}
              </div>
            ) : activity.data && visible.length === 0 ? (
              <p
                role="status"
                className="py-12 text-center text-sm text-muted-foreground"
              >
                {terms.length > 0
                  ? copy.noMatches
                  : filter === "all"
                    ? copy.empty
                    : copy.emptyFilter}
              </p>
            ) : (
              <ul className="space-y-3" aria-label={copy.list}>
                {visible.map((item) => (
                  <ActivityRow
                    key={item.id}
                    item={item}
                    copy={copy}
                    locale={locale}
                    onOpen={() => {
                      const route = assistantActivityRoute(item);
                      if (!route) return;
                      void navigate(route, {
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
                {copy.more(items.length)}
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
  copy,
  locale,
  onOpen,
}: {
  item: AssistantActivityItem;
  copy: AssistantActivityCopy;
  locale: string;
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
      ? copy.run
      : item.source === "project_task"
        ? copy.projectTask
        : copy.collaborationTask;
  const date = new Date(item.updated_at);
  const updated = Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString(locale);

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
              {activityStatusLabel(item.status, copy)}
            </Badge>
          </div>
        </div>
      </div>
      {item.reason && (
        <p className="mt-2 break-words text-xs text-muted-foreground">
          {activityReason(item.reason, copy)}
        </p>
      )}
      <div className="mt-2 space-y-1 break-words text-xs text-muted-foreground">
        {(item.project_name || item.project_id) && (
          <p>
            {copy.project}: {item.project_name || item.project_id}
          </p>
        )}
        {(item.room_name || item.room_id) && (
          <p>
            {copy.room}: {item.room_name || item.room_id}
          </p>
        )}
        {item.agent_ids.length > 0 && (
          <p title={item.agent_ids.join(", ")}>
            {copy.agents}: {item.agent_ids.map(agentDisplayName).join(", ")}
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {updated ? (
          <time
            dateTime={item.updated_at}
            className="text-[10px] text-muted-foreground"
          >
            {copy.updated}
            {updated}
          </time>
        ) : (
          <span />
        )}
        <Button variant="ghost" size="sm" disabled={!route} onClick={onOpen}>
          <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          {copy.openSource}
        </Button>
      </div>
      {!route && (
        <p className="mt-1 text-xs text-muted-foreground">{copy.noSource}</p>
      )}
    </li>
  );
}

function agentDisplayName(id: string): string {
  return builtinPersonaDisplayName(id) || id;
}

function localActivityTime(
  value: number | undefined,
  locale: string,
): string | null {
  if (!value || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString(locale);
}

function matchesActivity(
  item: AssistantActivityItem,
  terms: string[],
  copy: AssistantActivityCopy,
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
    activityStatusLabel(item.status, copy),
  ]
    .join(" ")
    .toLocaleLowerCase();
  return terms.every((term) => text.includes(term));
}
