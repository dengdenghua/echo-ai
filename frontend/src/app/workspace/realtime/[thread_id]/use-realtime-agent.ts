import { useEffect, useMemo, useRef } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router-dom";

import { canonicalAgentId } from "@/core/agents/aliases";
import { ACTIVE_AGENT_EVENT, useActiveAgentId } from "@/core/agents/active";
import {
  isPrimaryPersonaAgentId,
  primaryPersonaAgentIdOrDefault,
} from "@/core/agents/persona-policy";
import { useAgent, type Agent } from "@/core/agents";
import { getChannelsStatus, type ChannelName } from "@/core/channels/api";
import {
  consumeTaskCollaboratorPreset,
  type TaskCollaboratorPreset,
  writeTaskCollaboratorPreset,
} from "@/core/collaboration/task-collaborator-preset";
import { emitAgentChanged } from "@/core/events";
import { taskWorkspaceRoute } from "@/core/router/task-workspace-route";
import { swallow } from "@/core/utils/log";
import { isAbsolutePath } from "@/lib/path-utils";

import {
  threadOwnerAgentFromMetadata,
  type ThreadRouteState,
} from "./page-utils";
import type {
  RealtimeSettings,
  RealtimeSettingsSetter,
} from "./realtime-page-types";
import type { useThreadIdentity } from "./use-thread-workspace";

type ThreadIdentityData = ReturnType<
  typeof useThreadIdentity
>["threadIdentityQuery"]["data"];

/**
 * Which persona the route asks for (path, ?agent=, private chats) and which
 * owner the persisted thread already has.
 */
export function useRealtimeAgentRoute({
  searchParams,
  agentNameParam,
  pathname,
  isNewThread,
  routeState,
  threadIdentityData,
}: {
  searchParams: URLSearchParams;
  agentNameParam: string | undefined;
  pathname: string;
  isNewThread: boolean;
  routeState: ThreadRouteState | null;
  threadIdentityData: ThreadIdentityData;
}) {
  const initialPrompt = useMemo(() => {
    return searchParams.get("prompt") ?? "";
  }, [searchParams]);
  // The /new route stays mounted during the first turn, even after onStart
  // clears isNewThread. Keep its private destination until metadata takes over.
  const privateConversation = searchParams.get("private") === "1" || threadIdentityData?.metadata?.private_conversation === true;
  const requestedAgentName = (searchParams.get("agent") ?? "").trim();
  const queryAgentName = canonicalAgentId(requestedAgentName);
  const routeAgentName = useMemo(() => {
    const raw = agentNameParam?.trim();
    if (!raw) return "";
    try {
      return decodeURIComponent(raw);
    } catch (e) {
      swallow(e);
      return raw;
    }
  }, [agentNameParam]);
  const isAgentRoute = !!routeAgentName;
  const isRealtimeRoute = pathname.startsWith("/workspace/realtime");
  const memoryMode = searchParams.get("memory") ?? "";
  const queryWorkspacePath = searchParams.get("workspace_path") ?? "";
  const storedActiveAgentId = useActiveAgentId();

  // Unified task routes carry the selected persona in ?agent= while every chat
  // thread stays on the /workspace/realtime/* surface.
  const requestedTaskAgentId =
    routeAgentName || (queryAgentName === "echo" ? "" : queryAgentName);
  const activeAgentId = isNewThread
    ? (privateConversation && requestedTaskAgentId) || isPrimaryPersonaAgentId(requestedTaskAgentId)
      ? requestedTaskAgentId
      : primaryPersonaAgentIdOrDefault(storedActiveAgentId)
    : requestedTaskAgentId || storedActiveAgentId || "general";
  const { agent: activeAgent } = useAgent(activeAgentId);
  const hintedThreadOwnerAgentId = routeState?.threadOwnerAgentId?.trim() || "";
  const hintedWorkspacePath =
    typeof routeState?.workspacePath === "string" &&
    isAbsolutePath(routeState.workspacePath)
      ? routeState.workspacePath
      : isAbsolutePath(queryWorkspacePath)
        ? queryWorkspacePath
        : "";
  const threadOwnerAgentId = useMemo(
    () =>
      threadOwnerAgentFromMetadata(
        threadIdentityData?.metadata,
        threadIdentityData?.values,
      ),
    [threadIdentityData],
  );
  const resolvedThreadOwnerAgentId =
    threadOwnerAgentId || hintedThreadOwnerAgentId;
  const legacyOnDemandThreadOwnerId =
    !privateConversation &&
    !isNewThread &&
    resolvedThreadOwnerAgentId &&
    resolvedThreadOwnerAgentId !== "echo" &&
    !isPrimaryPersonaAgentId(resolvedThreadOwnerAgentId)
      ? resolvedThreadOwnerAgentId
      : "";
  const allowThreadFork = !legacyOnDemandThreadOwnerId;

  return {
    initialPrompt,
    privateConversation,
    queryAgentName,
    routeAgentName,
    isAgentRoute,
    isRealtimeRoute,
    memoryMode,
    activeAgentId,
    activeAgent,
    hintedWorkspacePath,
    resolvedThreadOwnerAgentId,
    legacyOnDemandThreadOwnerId,
    allowThreadFork,
  };
}

/** The agent the header, composer and roster present for this conversation. */
export function useRealtimeDisplayAgent({
  effectiveAgentId,
  activeAgentId,
  activeAgent,
  resolvedThreadOwnerAgentId,
}: {
  effectiveAgentId: string;
  activeAgentId: string;
  activeAgent: Agent | null;
  resolvedThreadOwnerAgentId: string;
}) {
  // 助理（echo）是私人助手本体：不走编码/工作空间工作台，固定进入
  // 纯对话长对话，隐藏工作空间选择器。
  const isEchoAssistant = effectiveAgentId === "echo";
  const { agent: effectiveAgent } = useAgent(
    isEchoAssistant ? effectiveAgentId : null,
  );
  const { agent: threadOwnerAgent } = useAgent(
    resolvedThreadOwnerAgentId && resolvedThreadOwnerAgentId !== activeAgentId
      ? resolvedThreadOwnerAgentId
      : null,
  );
  const displayAgent = isEchoAssistant
    ? effectiveAgent
    : resolvedThreadOwnerAgentId && resolvedThreadOwnerAgentId !== activeAgentId
      ? threadOwnerAgent
      : activeAgent;
  const currentTaskAgentName = displayAgent?.name ?? effectiveAgentId;
  const composerDisplayAgent = useMemo(
    () =>
      displayAgent ?? {
        name: effectiveAgentId,
        display_name: effectiveAgentId,
        avatar_url: null,
        icon: null,
      },
    [displayAgent, effectiveAgentId],
  );
  return {
    isEchoAssistant,
    displayAgent,
    currentTaskAgentName,
    composerDisplayAgent,
  };
}

/** IM channels currently bridged to the Assistant (only polled for Echo). */
export function useEchoAssistantChannels(isEchoAssistant: boolean) {
  const channelsStatusQuery = useQuery({
    queryKey: ["channels-status"],
    queryFn: getChannelsStatus,
    enabled: isEchoAssistant,
    refetchInterval: 30000,
    staleTime: 10000,
  });

  return useMemo(() => {
    if (!channelsStatusQuery.data?.channels) return [];
    return Object.entries(channelsStatusQuery.data.channels)
      .filter(([, status]) => status.enabled && status.running)
      .map(([name]) => name as ChannelName);
  }, [channelsStatusQuery.data]);
}

interface ActiveAgentSyncInput {
  isNewThread: boolean;
  routeAgentName: string;
  queryAgentName: string;
  privateConversation: boolean;
  activeAgentId: string;
  effectiveAgentId: string;
  isGroupConversation: boolean;
  mainPerspectiveAgentId: string;
  memoryMode: string;
  settings: RealtimeSettings;
  setSettings: RealtimeSettingsSetter;
  applyTaskCollaboratorPreset: (preset: TaskCollaboratorPreset) => void;
  navigate: NavigateFunction;
  qc: QueryClient;
}

/**
 * Keeps the footer persona, the route's requested agent, the thread owner and
 * the page-agent memory mode in step, and refreshes thread lists when the
 * active persona changes mid-session.
 */
export function useActiveAgentSync({
  isNewThread,
  routeAgentName,
  queryAgentName,
  privateConversation,
  activeAgentId,
  effectiveAgentId,
  isGroupConversation,
  mainPerspectiveAgentId,
  memoryMode,
  settings,
  setSettings,
  applyTaskCollaboratorPreset,
  navigate,
  qc,
}: ActiveAgentSyncInput) {
  const prevAgentRef = useRef<string | null>(null);
  useEffect(() => {
    // Only a fresh-task route may select a persona. Historical thread URLs
    // intentionally carry no agent query: their persisted owner is the source
    // of truth and must not be overwritten by a localStorage/default fallback.
    if (!isNewThread) return;
    const selectedAgent = routeAgentName || queryAgentName;
    if (!selectedAgent) return;
    // Echo is the global assistant entry point — it sits ABOVE the
    // persona picker, not as a selectable role. Navigating to the assistant
    // thread MUST NOT mutate the footer's active persona, otherwise the
    // footer drifts to a random task collaborator
    // because "echo" is filtered out of switcherAgents.
    if (selectedAgent === "echo") return;
    if (!privateConversation && !isPrimaryPersonaAgentId(selectedAgent)) {
      const leaderId = primaryPersonaAgentIdOrDefault(activeAgentId);
      const preset: TaskCollaboratorPreset = {
        leaderId,
        collaboratorIds: [selectedAgent],
        mode: "cluster",
        label: selectedAgent,
        openPicker: true,
      };
      // Preserve old/deep links, but reinterpret the requested expert as a
      // current-task member instead of reviving a standalone identity lane.
      writeTaskCollaboratorPreset(preset);
      applyTaskCollaboratorPreset(preset);
      consumeTaskCollaboratorPreset();
      navigate(taskWorkspaceRoute({ agentId: leaderId }), { replace: true });
      return;
    }
    // 统一走 emitAgentChanged：同时写 localStorage + 派发 eventBus 事件，
    // 保证左下角 AgentFooter（只订阅 eventBus agent:changed）能立即同步，
    // 不再出现仅写 localStorage/发 window CustomEvent 导致两边角色不一致。
    // source: "system" 表示这是路由/URL 驱动的同步，不触发 navigate 循环。
    if (privateConversation) return;
    emitAgentChanged(selectedAgent, "system");
    try {
      window.dispatchEvent(
        new CustomEvent(ACTIVE_AGENT_EVENT, {
          detail: { name: selectedAgent },
        }),
      );
    } catch (e) {
      swallow(e, "storage");
    }
  }, [
    activeAgentId,
    applyTaskCollaboratorPreset,
    isNewThread,
    navigate,
    queryAgentName,
    privateConversation,
    routeAgentName,
  ]);
  useEffect(() => {
    // 在群对话中，当前主视角以 mainPerspectiveAgentId 为准，避免强制切回群创建人；
    // 单聊则以 effectiveAgentId 为准。
    const target = isGroupConversation ? mainPerspectiveAgentId : effectiveAgentId;
    if (!target || target === activeAgentId || target === "echo") return;
    try {
      window.dispatchEvent(
        new CustomEvent(ACTIVE_AGENT_EVENT, { detail: { name: target, source: "thread" } }),
      );
    } catch (e) {
      swallow(e, "event");
    }
    emitAgentChanged(target, "thread");
  }, [activeAgentId, effectiveAgentId, isGroupConversation, mainPerspectiveAgentId]);
  useEffect(() => {
    const context = settings.context as typeof settings.context & {
      page_agent_memory_mode?: string;
    };
    if (!memoryMode || context.page_agent_memory_mode === memoryMode) {
      return;
    }
    setSettings("context", {
      ...settings.context,
      page_agent_memory_mode: memoryMode,
    } as Partial<typeof settings.context>);
  }, [memoryMode, setSettings, settings, settings.context]);
  useEffect(() => {
    const prev = prevAgentRef.current;
    prevAgentRef.current = activeAgentId;
    if (prev === null || prev === activeAgentId) return;
    // Agent actually changed mid-session → flush both views.
    qc.invalidateQueries({ queryKey: ["threads", "search"] });
    // The visible route stays on the unified realtime surface; the selected
    // agent is carried by ?agent= for fresh tasks and by thread metadata for
    // history.
  }, [activeAgentId, qc]);
}
