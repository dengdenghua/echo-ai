import { useEffect, useMemo, useRef, useState } from "react";

import type { finalOutputArtifactEntries } from "@/components/workspace/agent-workbench-utils";
import type { AgentModeName } from "@/components/workspace/mode-selector";
import type { Message } from "@/core/api/types";
import { parseDesignCapabilities } from "@/core/design/capabilities";
import {
  DESIGN_CANVAS_CONTEXT_MESSAGE,
  DESIGN_RESULT_MESSAGE,
  DESIGN_THREAD_STATE_MESSAGE,
  type DesignCanvasAgentContext,
} from "@/core/design/mode-bridge";

import { latestSettledDesignAnswer } from "./realtime-turn-utils";
import type { StateSetter } from "./realtime-page-types";

/**
 * The conversation embedded in the same-origin Design Canvas: its route
 * parameters, the live canvas selection it receives, and its capabilities.
 */
export function useEmbeddedDesignChat({
  searchParams,
  designCapabilitiesMetadata,
  setProjectAgentMode,
}: {
  searchParams: URLSearchParams;
  designCapabilitiesMetadata: unknown;
  setProjectAgentMode: StateSetter<AgentModeName>;
}) {
  const embeddedDesignChat =
    searchParams.get("embedded") === "design" ||
    (typeof window !== "undefined" &&
      window.parent !== window &&
      window.frameElement?.getAttribute("data-echo-design-chat") === "true");
  const embeddedDesignProject = searchParams.get("project")?.trim() || "";
  const embeddedCreationSpace =
    searchParams.get("creation_space")?.trim() || "";
  const embeddedCreativeProject =
    searchParams.get("creative_project")?.trim() || "";
  const embeddedDesignStageNodeId =
    searchParams.get("design_stage")?.trim() || "";
  // Design Canvas lives in this application. A query parameter must never
  // authorize an unrelated embedding website to inject or receive chat data.
  const embeddedDesignParentOrigin = window.location.origin;
  const [embeddedDesignContext, setEmbeddedDesignContext] =
    useState<DesignCanvasAgentContext | null>(null);
  const designCapabilities = useMemo(() => parseDesignCapabilities(
    searchParams.get("design_capabilities") ?? designCapabilitiesMetadata,
  ), [searchParams, designCapabilitiesMetadata]);
  useEffect(() => {
    if (!embeddedDesignChat) {
      setEmbeddedDesignContext(null);
      return;
    }
    // A Design Canvas conversation always executes the Design preset. This is
    // a surface contract, not a stale preference inherited from another task.
    setProjectAgentMode("uxui");
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.origin !== embeddedDesignParentOrigin ||
        event.data?.type !== DESIGN_CANVAS_CONTEXT_MESSAGE ||
        !event.data?.context ||
        typeof event.data.context !== "object"
      ) {
        return;
      }
      setEmbeddedDesignContext(event.data.context as DesignCanvasAgentContext);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embeddedDesignChat, embeddedDesignParentOrigin, setProjectAgentMode]);

  return {
    embeddedDesignChat,
    embeddedDesignProject,
    embeddedCreationSpace,
    embeddedCreativeProject,
    embeddedDesignStageNodeId,
    embeddedDesignParentOrigin,
    embeddedDesignContext,
    designCapabilities,
  };
}

interface DesignThreadBridgeInput {
  embeddedDesignChat: boolean;
  embeddedDesignParentOrigin: string;
  embeddedDesignStageNodeId: string;
  sidebarThreadId: string;
  agentRunInterrupted: boolean;
  agentRunFailed: boolean;
  hasCompletedAgentOutput: boolean;
  sidebarRunState: "running" | "waiting" | "error" | null;
  lastTurnMessages: Message[];
  threadTitle: string | undefined;
  resultPreviewUrl: string | null | undefined;
  finalArtifactEntries: ReturnType<typeof finalOutputArtifactEntries>;
}

/** Reports run state and the settled design answer to the hosting canvas. */
export function useDesignThreadBridge({
  embeddedDesignChat,
  embeddedDesignParentOrigin,
  embeddedDesignStageNodeId,
  sidebarThreadId,
  agentRunInterrupted,
  agentRunFailed,
  hasCompletedAgentOutput,
  sidebarRunState,
  lastTurnMessages,
  threadTitle,
  resultPreviewUrl,
  finalArtifactEntries,
}: DesignThreadBridgeInput) {
  useEffect(() => {
    if (!embeddedDesignChat || window.parent === window) return;
    window.parent.postMessage(
      {
        type: DESIGN_THREAD_STATE_MESSAGE,
        threadId: sidebarThreadId,
        targetStageNodeId: embeddedDesignStageNodeId || undefined,
        runState: agentRunInterrupted
          ? "interrupted"
          : agentRunFailed
            ? "failed"
            : hasCompletedAgentOutput
              ? "completed"
              : sidebarRunState || "idle",
      },
      embeddedDesignParentOrigin,
    );
  }, [
    agentRunFailed,
    agentRunInterrupted,
    embeddedDesignChat,
    embeddedDesignParentOrigin,
    embeddedDesignStageNodeId,
    hasCompletedAgentOutput,
    sidebarRunState,
    sidebarThreadId,
  ]);

  const latestDesignAnswer = useMemo(
    () => latestSettledDesignAnswer(lastTurnMessages),
    [lastTurnMessages],
  );
  const postedDesignResultRef = useRef("");
  useEffect(() => {
    if (
      !embeddedDesignChat ||
      !hasCompletedAgentOutput ||
      !latestDesignAnswer ||
      window.parent === window
    ) {
      return;
    }
    const key = `${sidebarThreadId}:${latestDesignAnswer.messageId}`;
    if (postedDesignResultRef.current === key) return;
    postedDesignResultRef.current = key;
    window.parent.postMessage(
      {
        type: DESIGN_RESULT_MESSAGE,
        threadId: sidebarThreadId,
        messageId: latestDesignAnswer.messageId,
        title: String(threadTitle || "").trim() || "设计 Agent 输出",
        text: latestDesignAnswer.text,
        previewUrl: resultPreviewUrl || undefined,
        artifacts: finalArtifactEntries.slice(0, 12).map((entry) => ({
          path: entry.path,
          title: entry.title,
        })),
        targetStageNodeId: embeddedDesignStageNodeId || undefined,
      },
      embeddedDesignParentOrigin,
    );
  }, [
    embeddedDesignChat,
    embeddedDesignParentOrigin,
    embeddedDesignStageNodeId,
    finalArtifactEntries,
    hasCompletedAgentOutput,
    latestDesignAnswer,
    resultPreviewUrl,
    sidebarThreadId,
    threadTitle,
  ]);
}
