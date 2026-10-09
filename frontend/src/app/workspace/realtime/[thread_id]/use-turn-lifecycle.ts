import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { useThreadChat } from "@/components/workspace/chats";
import { useThreadStopController } from "@/components/workspace/use-thread-stop-controller";
import { eventBus } from "@/core/events";
import {
  QUICK_REPLY_EVENT,
  quickReplyTextForThread,
  type QuickReplyDetail,
} from "@/core/messages/quick-reply";
import { taskWorkspaceRoute } from "@/core/router/task-workspace-route";
import { usePauseTask, type useTasks } from "@/core/tasks/hooks";
import { consumePendingNewSession } from "@/core/threads/pending-new-session";

import type {
  RealtimeSendMessage,
  RealtimeSettings,
  RealtimeSettingsSetter,
  RealtimeThread,
  RealtimeTranslations,
} from "./realtime-page-types";

/**
 * Thread routes (embedded Design chats keep their query) and the sidebar
 * run-status badges keyed by those routes.
 */
export function useThreadRouting({
  activeAgentId,
  embeddedDesignChat,
  embeddedDesignProject,
  embeddedCreationSpace,
  embeddedCreativeProject,
  embeddedDesignParentOrigin,
}: {
  activeAgentId: string;
  embeddedDesignChat: boolean;
  embeddedDesignProject: string;
  embeddedCreationSpace: string;
  embeddedCreativeProject: string;
  embeddedDesignParentOrigin: string;
}) {
  const threadRouteFor = useCallback(
    (id: string) => {
      const path = `/workspace/realtime/${encodeURIComponent(id)}`;
      if (!embeddedDesignChat) return path;
      const query = new URLSearchParams({ embedded: "design" });
      if (embeddedDesignProject) query.set("project", embeddedDesignProject);
      if (embeddedCreationSpace)
        query.set("creation_space", embeddedCreationSpace);
      if (embeddedCreativeProject)
        query.set("creative_project", embeddedCreativeProject);
      if (embeddedDesignParentOrigin !== window.location.origin) {
        query.set("design_parent_origin", embeddedDesignParentOrigin);
      }
      return `${path}?${query.toString()}`;
    },
    [
      embeddedCreativeProject,
      embeddedCreationSpace,
      embeddedDesignChat,
      embeddedDesignProject,
      embeddedDesignParentOrigin,
    ],
  );
  const markSidebarThreadRunning = useCallback(
    (id: string) => {
      const targetThreadId = id.trim();
      if (!targetThreadId) return;
      eventBus.emit("thread:run-status", {
        href: threadRouteFor(targetThreadId),
        state: "running",
        threadId: targetThreadId,
      });
    },
    [threadRouteFor],
  );
  const clearSidebarThreadStatus = useCallback(
    (id: string) => {
      const targetThreadId = id.trim();
      if (!targetThreadId) return;
      eventBus.emit("thread:run-status", {
        href: threadRouteFor(targetThreadId),
        state: null,
        threadId: targetThreadId,
      });
    },
    [threadRouteFor],
  );
  const newThreadRouteForMode = useCallback(
    (mode: string, prompt?: string) => {
      const agentId =
        mode === "react" || mode === "deep" ? activeAgentId : "general";
      return taskWorkspaceRoute({ agentId, prompt });
    },
    [activeAgentId],
  );
  return {
    threadRouteFor,
    markSidebarThreadRunning,
    clearSidebarThreadStatus,
    newThreadRouteForMode,
  };
}

/**
 * If the first stream fails before onStart fires, isNewThread stays true
 * while a server receipt already rendered, producing a Welcome overlay on top
 * of the live conversation. Promote the /new route once the mapped server
 * state holds a message.
 */
export function useNewThreadRoutePromotion({
  threadId,
  isNewThread,
  persistedMessageCount,
  isLoading,
  setIsNewThread,
  threadRouteFor,
  stageThreadRoute,
  commitThreadRoute,
}: {
  threadId: string;
  isNewThread: boolean;
  persistedMessageCount: number;
  isLoading: boolean;
  setIsNewThread: ReturnType<typeof useThreadChat>["setIsNewThread"];
  threadRouteFor: (id: string) => string;
  stageThreadRoute: (path: string) => void;
  commitThreadRoute: () => void;
}) {
  // Only the mapped server state is an authoritative receipt here:
  // `thread.messages` also contains locally queued optimistic rows. Promoting
  // one of those rows would commit the UUID route, unmount this `/new`
  // connection, and discard the not-yet-delivered message.
  useEffect(() => {
    if (isNewThread && persistedMessageCount > 0) {
      setIsNewThread(false);
      const targetPath = threadRouteFor(threadId);
      // Same deferred route commit as onStart. This fallback can run before
      // the loading-edge callback on a fast first item; mutating the hash here
      // used to remount the page and interrupt the turn before any answer.
      stageThreadRoute(targetPath);
      eventBus.emit("thread:route-sync", {
        href: targetPath,
        threadId,
      });
      // A fast terminal failure can be reduced in one React batch, so the
      // usual loading edge never invokes onFinish. Commit immediately once
      // the first message is already terminal; otherwise `/new` remounts can
      // discard the only visible failure receipt and leave a ghost draft.
      if (!isLoading) {
        commitThreadRoute();
      }
    }
  }, [
    commitThreadRoute,
    isNewThread,
    persistedMessageCount,
    isLoading,
    setIsNewThread,
    stageThreadRoute,
    threadId,
    threadRouteFor,
  ]);
}

/**
 * 「环境受限」横幅授权：点「授权并重试」先写线程级 network_access，等它落到
 * settings.context 后再触发既有 regenerate —— 否则 sendMessage 的闭包仍拿着旧档。
 */
export function useNetworkAuthorizationRegen({
  threadId,
  settings,
  setSettings,
}: {
  threadId: string;
  settings: RealtimeSettings;
  setSettings: RealtimeSettingsSetter;
}) {
  const [pendingNetworkRegen, setPendingNetworkRegen] = useState<{
    threadId: string;
    tier: "common" | "full";
  } | null>(null);
  const pendingNetworkRegenRef = useRef(pendingNetworkRegen);
  pendingNetworkRegenRef.current = pendingNetworkRegen;
  const handleAuthorizeNetwork = useCallback(
    (tier: "common" | "full") => {
      if (pendingNetworkRegenRef.current?.threadId === threadId) return;
      const pending = { threadId, tier };
      pendingNetworkRegenRef.current = pending;
      setPendingNetworkRegen(pending);
      setSettings("context", {
        ...settings.context,
        network_access: tier,
      });
    },
    [setSettings, settings.context, threadId],
  );
  useEffect(() => {
    const pending = pendingNetworkRegenRef.current;
    if (!pending || pending.threadId === threadId) return;
    pendingNetworkRegenRef.current = null;
    setPendingNetworkRegen((current) => (current === pending ? null : current));
  }, [threadId]);
  useEffect(() => {
    if (!pendingNetworkRegen || pendingNetworkRegen.threadId !== threadId) {
      return;
    }
    if (settings.context.network_access !== pendingNetworkRegen.tier) return;
    if (pendingNetworkRegenRef.current !== pendingNetworkRegen) return;
    pendingNetworkRegenRef.current = null;
    setPendingNetworkRegen(null);
    window.dispatchEvent(
      new CustomEvent("echo:regenerate", { detail: { threadId } }),
    );
  }, [pendingNetworkRegen, settings.context.network_access, threadId]);
  return { pendingNetworkRegen, handleAuthorizeNetwork };
}

interface TurnSenderInput {
  threadId: string;
  isLoading: boolean;
  readyForMutations: boolean;
  sendMessage: RealtimeSendMessage;
  markSidebarThreadRunning: (id: string) => void;
}

/**
 * Auto-send a one-shot hand-off when a fresh thread is opened by the
 * Assistant timeout or a legacy on-demand-owned conversation migration.
 * Session storage is consumed once, so refresh cannot duplicate the send.
 */
export function usePendingNewSessionSend({
  threadId,
  isNewThread,
  readyForMutations,
  sendMessage,
  markSidebarThreadRunning,
}: Omit<TurnSenderInput, "isLoading"> & { isNewThread: boolean }) {
  const pendingNewSessionSentRef = useRef(false);
  useEffect(() => {
    if (!isNewThread) {
      // The page component survives hash-route transitions. Reset the
      // one-shot latch when returning to an existing thread so a later Retry
      // can hand off and auto-send another fresh task.
      pendingNewSessionSentRef.current = false;
      return;
    }
    if (pendingNewSessionSentRef.current) return;
    // Do not consume the one-shot hand-off until this thread has crossed its
    // resume barrier. It stays in session storage across reconnects/reloads.
    if (!readyForMutations) return;
    const timer = window.setTimeout(() => {
      // Consumption happens inside the cancellable ready-state window. If the
      // connection drops during this short hand-off delay, effect cleanup
      // leaves the prompt durable for the next successful resume.
      const pendingText = consumePendingNewSession();
      if (!pendingText || pendingNewSessionSentRef.current) return;
      pendingNewSessionSentRef.current = true;
      markSidebarThreadRunning(threadId);
      void sendMessage(threadId, { text: pendingText, files: [] });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [
    isNewThread,
    threadId,
    sendMessage,
    markSidebarThreadRunning,
    readyForMutations,
  ]);
}

/**
 * One-click sends that bypass the composer: quick-reply chips in messages,
 * follow-up suggestions and the retry/resume affordances.
 */
export function useDirectTurnSenders({
  threadId,
  isLoading,
  readyForMutations,
  sendMessage,
  markSidebarThreadRunning,
}: TurnSenderInput) {
  useEffect(() => {
    const handleQuickReply = (event: Event) => {
      const detail = (event as CustomEvent<QuickReplyDetail>).detail;
      const text = quickReplyTextForThread(detail, threadId);
      if (!text || isLoading || !readyForMutations) return;
      event.preventDefault();
      markSidebarThreadRunning(threadId);
      void sendMessage(threadId, { text, files: [] });
    };
    window.addEventListener(QUICK_REPLY_EVENT, handleQuickReply);
    return () => {
      window.removeEventListener(QUICK_REPLY_EVENT, handleQuickReply);
    };
  }, [
    markSidebarThreadRunning,
    sendMessage,
    isLoading,
    readyForMutations,
    threadId,
  ]);

  // Follow-up suggestion chips: send the picked prompt as if the user typed it.
  const handleSendFollowUp = useCallback(
    (prompt: string) => {
      const text = prompt.trim();
      if (!text || isLoading || !readyForMutations) return;
      markSidebarThreadRunning(threadId);
      void sendMessage(threadId, { text, files: [] });
    },
    [
      markSidebarThreadRunning,
      sendMessage,
      isLoading,
      readyForMutations,
      threadId,
    ],
  );
  const retryDispatchGuardRef = useRef<{ key: string; at: number } | null>(
    null,
  );
  const handleRetryTask = useCallback(
    (prompt: string) => {
      const text = prompt.trim();
      if (!text || isLoading || !readyForMutations) return;
      // React updates the loading flag after this click returns. Guard the
      // short gap so a double click cannot enqueue a second optimistic row
      // before the eager outbound ledger becomes visible to the page.
      const now = Date.now();
      const key = `${threadId}\u0000${text}`;
      const previous = retryDispatchGuardRef.current;
      if (previous?.key === key && now - previous.at < 2_000) return;
      retryDispatchGuardRef.current = { key, at: now };
      // A retry should actually resume the failed conversation. Sending the
      // recovered objective as a new turn preserves the gathered evidence
      // and avoids leaving the user on a pre-filled, unsent "new task" page.
      markSidebarThreadRunning(threadId);
      void sendMessage(threadId, { text, files: [] });
    },
    [
      markSidebarThreadRunning,
      sendMessage,
      isLoading,
      readyForMutations,
      threadId,
    ],
  );
  return { handleSendFollowUp, handleRetryTask };
}

/** Stop pauses this thread's active background task as well as its stream. */
export function useRealtimeStopController({
  threadId,
  t,
  tasks,
  stopThread,
  isLoading,
}: {
  threadId: string;
  t: RealtimeTranslations;
  tasks: ReturnType<typeof useTasks>;
  stopThread: RealtimeThread["stop"];
  isLoading: boolean;
}) {
  const pauseTask = usePauseTask();
  const activeTaskId = useMemo(
    () =>
      (tasks.data?.active ?? []).find((task) => task.thread_id === threadId)
        ?.task_id ?? null,
    [tasks.data?.active, threadId],
  );
  const pauseActiveTask = useCallback(async () => {
    if (!activeTaskId) return;
    await pauseTask.mutateAsync({
      taskId: activeTaskId,
      reason: "user_request",
      note: t.chatPage.stopNote,
    });
  }, [activeTaskId, pauseTask, t.chatPage.stopNote]);
  const reportStopFailure = useCallback(() => {
    toast.error(t.chatPage.stopFailed);
  }, [t.chatPage.stopFailed]);
  return useThreadStopController({
    threadId,
    stopThread,
    pauseActiveTask: activeTaskId ? pauseActiveTask : undefined,
    isRunning: isLoading,
    onFailure: reportStopFailure,
  });
}
