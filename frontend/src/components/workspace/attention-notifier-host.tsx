/**
 * Mounts the long-task attention notifier for the workspace shell: system
 * notifications when a task completes, fails, needs approval or pauses while
 * the user is elsewhere, plus the "unseen" sidebar markers.
 *
 * Inputs are what the frontend already receives — the realtime page's
 * ``thread:run-status`` events and the shared ``/api/tasks`` query — so no
 * backend protocol is involved. Renders nothing.
 */
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { eventBus } from "@/core/events";
import { useI18n } from "@/core/i18n/hooks";
import {
  attentionBody,
  attentionPrefsFromSettings,
  attentionTitle,
  createAttentionTracker,
  threadIdFromPathname,
  type AttentionTracker,
} from "@/core/notification/attention";
import {
  markThreadAttentionSeen,
  threadAttentionSink,
} from "@/core/notification/attention-store";
import {
  desktopNotificationBridge,
  showSystemNotification,
} from "@/core/notification/system-notify";
import { useLocalSettings } from "@/core/settings";
import { useTasks } from "@/core/tasks/hooks";
import { deriveThreadTitle } from "@/core/threads/sidebar";
import type { AgentThread } from "@/core/threads/types";
import { isRecord } from "@/core/utils/guards";
import { swallow } from "@/core/utils/log";

/** ``/api/tasks`` only polls itself while a task is active. A slow idle
 * poll catches work started outside this window (background loops,
 * another tab) so its pauses and completions are not missed. */
export const IDLE_TASKS_POLL_MS = 30_000;

function appFocused(): boolean {
  return (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    document.hasFocus()
  );
}

function isAppRoute(href: unknown): href is string {
  return (
    typeof href === "string" && href.startsWith("/") && !href.startsWith("//")
  );
}

function cachedThreadTitle(
  queryClient: QueryClient,
  threadId: string,
): string | undefined {
  for (const [, data] of queryClient.getQueriesData<AgentThread[]>({
    queryKey: ["threads", "search"],
  })) {
    if (!Array.isArray(data)) continue;
    const thread = data.find((candidate) => candidate?.thread_id === threadId);
    if (thread) return deriveThreadTitle(thread);
  }
  return undefined;
}

export function AttentionNotifierHost() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const [settings] = useLocalSettings();
  const tasks = useTasks("all");
  const visibleThreadId = threadIdFromPathname(pathname);

  const latest = useRef({
    copy: t.attentionNotifications,
    navigate,
    notification: settings.notification,
    queryClient,
    visibleThreadId,
  });
  latest.current = {
    copy: t.attentionNotifications,
    navigate,
    notification: settings.notification,
    queryClient,
    visibleThreadId,
  };

  const trackerRef = useRef<AttentionTracker | null>(null);

  // Layout effect: subscribed before any page's passive effect publishes its
  // first run status.
  useLayoutEffect(() => {
    const tracker = createAttentionTracker({
      getContext: () => ({
        appFocused: appFocused(),
        visibleThreadId: latest.current.visibleThreadId,
      }),
      getPrefs: () => attentionPrefsFromSettings(latest.current.notification),
      deliver: (event) => {
        const { copy, navigate: go, queryClient: client } = latest.current;
        const title = event.title ?? cachedThreadTitle(client, event.threadId);
        showSystemNotification(
          {
            title: attentionTitle(copy, event.kind, event.reason),
            body: attentionBody(copy, { kind: event.kind, title }),
            // One notification per thread: a newer one replaces it.
            tag: `echo-attention:${event.threadId}`,
            href: event.href,
            threadId: event.threadId,
          },
          { onClick: () => void go(event.href) },
        );
      },
      deliverSummary: (count) => {
        const { copy } = latest.current;
        showSystemNotification({
          title: copy.summaryTitle(count),
          body: copy.summaryBody,
          tag: "echo-attention:summary",
        });
      },
      sink: threadAttentionSink,
    });
    trackerRef.current = tracker;
    const unsubscribe = eventBus.on("thread:run-status", (payload) =>
      tracker.ingestRunStatus(payload),
    );
    return () => {
      unsubscribe();
      tracker.dispose();
      if (trackerRef.current === tracker) trackerRef.current = null;
    };
  }, []);

  useEffect(() => {
    trackerRef.current?.ingestTasks(tasks.data);
  }, [tasks.data]);

  const notificationsEnabled = settings.notification.enabled;
  const hasActiveTasks = (tasks.data?.active?.length ?? 0) > 0;
  const refetchTasks = tasks.refetch;
  useEffect(() => {
    if (!notificationsEnabled || hasActiveTasks) return;
    const timer = window.setInterval(() => {
      void refetchTasks();
    }, IDLE_TASKS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [hasActiveTasks, notificationsEnabled, refetchTasks]);

  // Looking at a thread (route + focused window) retires its unseen marker.
  useEffect(() => {
    const markSeen = () => {
      if (visibleThreadId && appFocused()) {
        markThreadAttentionSeen(visibleThreadId);
      }
    };
    markSeen();
    window.addEventListener("focus", markSeen);
    document.addEventListener("visibilitychange", markSeen);
    return () => {
      window.removeEventListener("focus", markSeen);
      document.removeEventListener("visibilitychange", markSeen);
    };
  }, [visibleThreadId]);

  // Desktop: the main process focuses the window, then names the route.
  useEffect(() => {
    if (!desktopNotificationBridge()) return;
    try {
      return window.echo?.on("notification:clicked", (payload) => {
        const href = isRecord(payload) ? payload.href : undefined;
        if (isAppRoute(href)) void navigate(href);
      });
    } catch (error) {
      swallow(error, "notification-click-channel");
      return undefined;
    }
  }, [navigate]);

  return null;
}
