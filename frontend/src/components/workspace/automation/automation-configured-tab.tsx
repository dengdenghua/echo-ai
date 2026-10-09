import {
  Clock3Icon,
  InfoIcon,
  Loader2Icon,
  MonitorIcon,
  MoreHorizontalIcon,
  PlayCircleIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { getBackendBaseURL } from "@/core/config";
import {
  executionStorageKey,
  getRemoteExecutionId,
} from "@/core/execution-location";
import { useI18n } from "@/core/i18n/hooks";
import type { Translations } from "@/core/i18n/locales/types";
import { requireArray, serviceErrorMessage } from "@/core/utils/service-error";

type IntelligenceSubscription = {
  id: string;
  topic: string;
  display_name?: string;
  keywords?: string[];
  enabled?: boolean;
  last_run?: string | null;
  next_check_at?: string | null;
  cadence?: string;
  schedule_time?: string;
  schedule_day?: string;
  timezone?: string;
  instructions?: string;
  sources?: string[];
};

const subscriptionsKey = ["intelligence", "subscriptions"] as const;
const EMPTY_SUBSCRIPTIONS: IntelligenceSubscription[] = [];
const TIP_DISMISSED_KEY = "echo:automation-tip-dismissed";
const KEEP_AWAKE_KEY = "echo:keep-awake";

function executionTime(
  value: string | null | undefined,
  locale: string,
  timezone?: string,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone || "Asia/Shanghai",
  };
  try {
    return date.toLocaleString(locale, options);
  } catch {
    return date.toLocaleString(locale, { ...options, timeZone: "UTC" });
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getBackendBaseURL()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

function scheduleText(
  item: Pick<
    IntelligenceSubscription,
    "cadence" | "schedule_time" | "schedule_day" | "timezone"
  >,
  t: Translations,
) {
  const cadence = item.cadence || t.intelligencePanel.cadenceDaily;
  const time = item.schedule_time || "09:00";
  const timezone = item.timezone || "Asia/Shanghai";
  if (cadence.includes("高频") || cadence.toLowerCase().includes("hour")) {
    return t.intelligencePanel.scheduleHighFrequency(timezone);
  }
  if (cadence.includes("周") || cadence.toLowerCase().includes("week")) {
    const weekdayMap: Record<string, string> = {
      "1": t.intelligencePanel.weekdayMonday,
      "2": t.intelligencePanel.weekdayTuesday,
      "3": t.intelligencePanel.weekdayWednesday,
      "4": t.intelligencePanel.weekdayThursday,
      "5": t.intelligencePanel.weekdayFriday,
      "6": t.intelligencePanel.weekdaySaturday,
      "7": t.intelligencePanel.weekdaySunday,
    };
    const weekday =
      weekdayMap[String(item.schedule_day || "1")] ??
      t.intelligencePanel.weekdayMonday;
    return t.intelligencePanel.scheduleWeekly(weekday, time, timezone);
  }
  if (cadence.includes("月") || cadence.toLowerCase().includes("month")) {
    return t.intelligencePanel.scheduleMonthly(
      item.schedule_day || "1",
      time,
      timezone,
    );
  }
  return t.intelligencePanel.scheduleDaily(time, timezone);
}

export function AutomationConfiguredTab() {
  const { t, locale } = useI18n();
  const zh = locale.startsWith("zh");
  const remote = Boolean(getRemoteExecutionId());
  const copy = {
    location: remote
      ? zh
        ? "在所选远程电脑运行"
        : "Runs on the selected remote computer"
      : zh
        ? "由当前 Echo 服务运行"
        : "Runs on the current Echo service",
    serviceRequired: zh
      ? "服务所在电脑需保持在线，且 Echo 服务持续运行。关闭网页不会停止已运行的服务。"
      : "Keep that computer online with Echo running. Closing this page does not stop the service.",
    wake: zh ? "保持当前屏幕唤醒" : "Keep this screen awake",
    wakeHint: zh
      ? "仅作用于当前设备的屏幕，不能保证 Echo 服务持续运行。"
      : "This affects only this device's screen; it does not keep the Echo service running.",
    unsupported: zh
      ? "当前浏览器不支持屏幕唤醒"
      : "Screen wake lock is unavailable in this browser",
    enabled: zh ? "已启用" : "Enabled",
    paused: zh ? "已暂停" : "Paused",
    next: zh ? "下次最早检查" : "Next eligible check",
    waiting: zh ? "等待服务调度" : "Waiting for service dispatch",
    serviceScheduled: zh ? "由服务调度" : "Scheduled by the service",
    pauseHint: zh
      ? "暂停后停止自动检查，仍可立即执行一次。"
      : "Pausing stops scheduled checks. You can still run once manually.",
    nextHint: zh
      ? "实际启动时间以服务调度为准。"
      : "Actual start time depends on service dispatch.",
  };
  const queryClient = useQueryClient();
  const [tipVisible, setTipVisible] = useState(true);
  const [keepAwake, setKeepAwake] = useState(false);
  const supportsWakeLock =
    typeof navigator !== "undefined" && "wakeLock" in navigator;
  const [subscriptionToDelete, setSubscriptionToDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    try {
      setTipVisible(
        localStorage.getItem(executionStorageKey(TIP_DISMISSED_KEY)) !== "true",
      );
      setKeepAwake(
        localStorage.getItem(executionStorageKey(KEEP_AWAKE_KEY)) === "true",
      );
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestWakeLock = async () => {
      const wakeLock = (
        navigator as Navigator & {
          wakeLock?: {
            request(type: "screen"): Promise<WakeLockSentinel>;
          };
        }
      ).wakeLock;
      if (!keepAwake || !wakeLock) return;
      try {
        const lock = await wakeLock.request("screen");
        if (cancelled) {
          lock.release?.();
          return;
        }
        wakeLockRef.current = lock;
        lock.addEventListener("release", () => {
          if (wakeLockRef.current === lock) wakeLockRef.current = null;
        });
      } catch {}
    };
    const releaseWakeLock = () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release?.().catch(() => {});
        wakeLockRef.current = null;
      }
    };
    if (keepAwake) {
      requestWakeLock();
      const onVisibility = () => {
        if (
          document.visibilityState === "visible" &&
          keepAwake &&
          !wakeLockRef.current
        ) {
          requestWakeLock();
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        cancelled = true;
        document.removeEventListener("visibilitychange", onVisibility);
        releaseWakeLock();
      };
    } else {
      releaseWakeLock();
      return () => {
        cancelled = true;
      };
    }
  }, [keepAwake]);

  const dismissTip = () => {
    setTipVisible(false);
    try {
      localStorage.setItem(executionStorageKey(TIP_DISMISSED_KEY), "true");
    } catch {}
  };

  const toggleKeepAwake = (checked: boolean) => {
    setKeepAwake(checked);
    try {
      localStorage.setItem(
        executionStorageKey(KEEP_AWAKE_KEY),
        checked ? "true" : "false",
      );
    } catch {}
  };

  const subscriptionsQuery = useQuery({
    queryKey: subscriptionsKey,
    queryFn: async () => {
      const data = await apiFetch<{
        subscriptions?: IntelligenceSubscription[];
      }>("/api/intelligence/subscriptions");
      return requireArray<IntelligenceSubscription>(
        data.subscriptions,
        "subscriptions",
      );
    },
    refetchInterval: 30_000,
  });

  const updateSubscription = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch<IntelligenceSubscription>(
        `/api/intelligence/subscriptions/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: subscriptionsKey });
    },
    onError: () => toast.error(t.intelligence.updateFailed),
  });

  const deleteSubscription = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean; id: string }>(
        `/api/intelligence/subscriptions/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      toast.success(t.intelligence.subscriptionDeleted);
      void queryClient.invalidateQueries({ queryKey: subscriptionsKey });
      setSubscriptionToDelete(null);
    },
    onError: () => toast.error(t.intelligence.deleteFailed),
  });

  const runSubscription = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean; report?: { items_analyzed?: number } }>(
        `/api/intelligence/subscriptions/${encodeURIComponent(id)}/run`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      ),
    onSuccess: () => {
      toast.success(t.intelligence.runNow);
      void queryClient.invalidateQueries({ queryKey: subscriptionsKey });
      void queryClient.invalidateQueries({
        queryKey: ["intelligence", "reports"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["intelligence", "history"],
      });
    },
    onError: () => toast.error(t.intelligence.runSubscriptionFailed),
  });

  const subscriptions = subscriptionsQuery.data ?? EMPTY_SUBSCRIPTIONS;
  const loading = subscriptionsQuery.isLoading;
  const runningSubscriptionId = runSubscription.isPending
    ? runSubscription.variables
    : null;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border border-border-default/50 bg-card/30 px-3 py-2">
          <Skeleton className="codex-skeleton size-4 shrink-0 rounded-full" />
          <Skeleton className="codex-skeleton h-3.5 flex-1 rounded" />
          <Skeleton className="codex-skeleton h-5 w-9 shrink-0 rounded-full" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border border-border-default/50 bg-card/30 px-3 py-2.5"
          >
            <Skeleton className="codex-skeleton size-4 shrink-0 rounded-full" />
            <Skeleton className="codex-skeleton h-4 flex-1 rounded" />
            <Skeleton className="codex-skeleton h-4 w-10 shrink-0 rounded" />
            <Skeleton className="codex-skeleton h-3.5 w-20 shrink-0 rounded" />
            <Skeleton className="codex-skeleton h-5 w-9 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (subscriptionsQuery.isError) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm"
      >
        <p>{serviceErrorMessage(subscriptionsQuery.error, zh)}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={subscriptionsQuery.isFetching}
          onClick={() => void subscriptionsQuery.refetch()}
        >
          <RefreshCwIcon className="mr-1.5 size-3.5" />
          {t.intelligence.retry}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className="rounded-xl border border-border-default bg-muted/30 p-3 text-xs leading-5"
        data-testid="automation-execution-location"
      >
        <div className="flex items-center gap-2 font-medium">
          {remote ? (
            <ServerIcon className="size-3.5 shrink-0" />
          ) : (
            <MonitorIcon className="size-3.5 shrink-0" />
          )}
          {copy.location}
          </div>
        <p className="mt-1 text-muted-foreground">{copy.serviceRequired}</p>
      </div>
      {tipVisible && (
        <div className="flex items-start gap-2 rounded-lg border border-border-default px-3 py-2">
          <InfoIcon className="size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span>{copy.wake}</span>
            <Switch
              checked={keepAwake}
                disabled={!supportsWakeLock}
              onCheckedChange={toggleKeepAwake}
                aria-label={copy.wake}
            />
          </div>
            <p className="mt-1 leading-5 text-muted-foreground">
              {supportsWakeLock ? copy.wakeHint : copy.unsupported}
            </p>
          </div>
          <button
            type="button"
            onClick={dismissTip}
            className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            aria-label={t.common.close}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}

      {subscriptions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-default bg-card/50 py-16 text-center">
          <Clock3Icon className="size-10 text-muted-foreground/60" />
          <div className="mt-4 text-sm font-medium text-foreground">
            {t.intelligence.configuredEmptyTitle}
          </div>
          <p className="mt-1.5 max-w-md text-xs leading-5 text-muted-foreground">
            {t.intelligence.configuredEmptyDescription}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {subscriptions.map((item) => {
            const enabled = item.enabled !== false;
            const title = item.display_name || item.topic;
            const isRunning = runningSubscriptionId === item.id;
            const next = executionTime(
              item.next_check_at,
              locale,
              item.timezone,
            );
            const last = executionTime(item.last_run, locale, item.timezone);
            const nextLabel = next
              ? new Date(item.next_check_at!).getTime() <= Date.now()
                ? copy.waiting
                : next
              : copy.serviceScheduled;

            return (
              <div
                key={item.id}
                className="rounded-xl border border-border-default bg-card/60 p-3 transition-colors hover:bg-card"
                data-testid={`automation-task-${item.id}`}
              >
                <div className="flex items-start gap-2">
                  <Clock3Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-sm font-medium">
                  {title}
                </div>
                    <div className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                  {scheduleText(item, t)}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] ${enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                  >
                    {enabled ? copy.enabled : copy.paused}
                </span>
                </div>
                <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                  <p>
                    {last
                      ? t.intelligence.lastRunPrefix(last)
                      : t.intelligence.neverRun}
                  </p>
                  <p title={enabled ? copy.nextHint : copy.pauseHint}>
                    {enabled ? `${copy.next}：${nextLabel}` : copy.pauseHint}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border-default/60 pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 rounded-md px-2 text-xs"
                    disabled={
                      runSubscription.isPending || updateSubscription.isPending
                    }
                    onClick={() => runSubscription.mutate(item.id)}
                    aria-label={t.intelligence.runSubscription(title)}
                  >
                    {isRunning ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : (
                      <PlayCircleIcon className="size-3.5" />
                    )}
                    {t.intelligence.runNow}
                  </Button>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={enabled}
                      disabled={
                        updateSubscription.isPending ||
                        runSubscription.isPending
                      }
                      aria-label={
                        enabled
                          ? t.intelligence.disableSubscription(title)
                          : t.intelligence.enableSubscription(title)
                      }
                      onCheckedChange={(checked) =>
                        updateSubscription.mutate({
                          id: item.id,
                          enabled: checked,
                        })
                      }
                    />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-md"
                          aria-label={`${t.common.more} · ${title}`}
                          disabled={
                            runSubscription.isPending ||
                            updateSubscription.isPending ||
                            deleteSubscription.isPending
                          }
                        title={t.common.more}
                      >
                        <MoreHorizontalIcon className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() =>
                          setSubscriptionToDelete({ id: item.id, title })
                        }
                      >
                        <Trash2Icon />
                        {t.intelligence.deleteSubscription}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={subscriptionToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setSubscriptionToDelete(null);
        }}
      >
        <DialogContent className="gap-3 rounded-lg p-4 sm:max-w-[420px]">
          <DialogHeader className="gap-1 text-left">
            <DialogTitle className="text-base">
              {t.intelligence.deleteConfirmTitle}
            </DialogTitle>
            <DialogDescription className="text-xs leading-5">
              {subscriptionToDelete
                ? t.intelligence.deleteConfirmDescription(
                    subscriptionToDelete.title,
                  )
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-md"
              onClick={() => setSubscriptionToDelete(null)}
            >
              {t.common.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="rounded-md"
              disabled={deleteSubscription.isPending}
              onClick={() => {
                if (subscriptionToDelete) {
                  deleteSubscription.mutate(subscriptionToDelete.id);
                }
              }}
            >
              {deleteSubscription.isPending ? (
                <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Trash2Icon className="mr-1.5 size-3.5" />
              )}
              {t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
