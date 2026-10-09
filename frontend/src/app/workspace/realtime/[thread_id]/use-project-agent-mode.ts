import { useCallback, useEffect, useMemo, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";

import type { ProjectFullState } from "@/components/workspace/agent-workbench-panel/project-os-tab";
import type { GroupTaskStrategy } from "@/components/workspace/group-task-strategy";
import {
  persistModeSelection,
  type AgentModeName,
  type DetectResponse,
  type DetectionSignals,
} from "@/components/workspace/mode-selector";
import type { ReasoningMode } from "@/components/workspace/reasoning-mode";
import { modePresetForAgentMode } from "@/core/agent-modes/presets";
import { groupTaskStrategyContext } from "@/core/collaboration/group-task-strategy-context";
import {
  DESIGN_MODE_CHANGE_MESSAGE,
  designWorkspaceRoute,
} from "@/core/design/mode-bridge";

import { modeLabelFor } from "./page-utils";
import type {
  RealtimeSettings,
  RealtimeTranslations,
  StateSetter,
} from "./realtime-page-types";

/** The work mode (General / Design / …) of project and personal workspaces. */
export function useProjectAgentModeState() {
  const [projectAgentMode, setProjectAgentMode] =
    useState<AgentModeName>("develop");
  const [projectDetection, setProjectDetection] =
    useState<DetectResponse | null>(null);
  // Whether the user manually overrode the auto-detected work mode. When true,
  // intent-based auto-switching only suggests (never silently switches).
  const [modeManualOverride, setModeManualOverride] = useState(false);
  // A pending intent-based mode suggestion surfaced above the composer.
  const [modeIntentSuggestion, setModeIntentSuggestion] = useState<{
    mode: AgentModeName;
    label: string;
  } | null>(null);
  return {
    projectAgentMode,
    setProjectAgentMode,
    projectDetection,
    setProjectDetection,
    modeManualOverride,
    setModeManualOverride,
    modeIntentSuggestion,
    setModeIntentSuggestion,
  };
}

export type ModeIntentSuggestion = ReturnType<
  typeof useProjectAgentModeState
>["modeIntentSuggestion"];

/**
 * Resolves the reasoning mode of this conversation (chat / react / deep /
 * code), the project mode preset and the stream mode sent to the runtime.
 */
export function useConversationMode({
  isProjectCodeMode,
  projectWorkspacePath,
  projectDetection,
  projectAgentMode,
  groupTaskStrategy,
  effectiveAgentId,
  isEchoAssistant,
  routeMode,
  isAgentRoute,
  isRealtimeRoute,
  collaborationEnabled,
}: {
  isProjectCodeMode: boolean;
  projectWorkspacePath: string;
  projectDetection: DetectResponse | null;
  projectAgentMode: AgentModeName;
  groupTaskStrategy: GroupTaskStrategy;
  effectiveAgentId: string;
  isEchoAssistant: boolean;
  routeMode: RealtimeSettings["context"]["mode"];
  isAgentRoute: boolean;
  isRealtimeRoute: boolean;
  collaborationEnabled: boolean;
}) {
  // When user has explicitly selected a named agent (not default "general", not echo)
  // via the footer selector, treat it as conversation mode rather than defaulting to code.
  const isExplicitAgentSelected =
    !!effectiveAgentId &&
    effectiveAgentId !== "general" &&
    effectiveAgentId !== "echo";
  const isExplicitConversationMode =
    isEchoAssistant ||
    isExplicitAgentSelected ||
    routeMode === "chat" ||
    routeMode === "flash";
  const isCodingWorkspaceMode =
    isProjectCodeMode ||
    ((isAgentRoute || isRealtimeRoute) && !isExplicitConversationMode);
  // Code mode is available to every agent by default · per-agent unlock
  // flag removed. Tool/permission scoping lives in the skills &
  // permissions system, not a global gate.
  const codeModeUnlocked = true;
  const projectSignals = useMemo(() => {
    if (!isProjectCodeMode || !projectDetection) return undefined;
    const signals = projectDetection.signals;
    const compact: DetectionSignals = {
      workspace_path: projectWorkspacePath,
      exists: signals.exists,
      file_count: signals.file_count,
      manifests: signals.manifests?.slice(0, 8),
      structure_dirs: signals.structure_dirs?.slice(0, 12),
      git_commits: signals.git_commits,
      has_readme: signals.has_readme,
      lock_files: signals.lock_files?.slice(0, 8),
      commands: signals.commands?.slice(0, 8),
    };
    return {
      recommended_mode: projectDetection.recommended_mode,
      confidence: projectDetection.confidence,
      reason: projectDetection.reason,
      signals: compact,
    };
  }, [isProjectCodeMode, projectDetection, projectWorkspacePath]);
  const projectModePreset = useMemo(
    () => modePresetForAgentMode(projectAgentMode),
    [projectAgentMode],
  );
  const activeGroupTaskContext = useMemo(
    () => groupTaskStrategyContext(groupTaskStrategy),
    [groupTaskStrategy],
  );
  const effectiveMode: ReasoningMode = isEchoAssistant
    ? "chat"
    : isCodingWorkspaceMode
      ? "code"
      : isAgentRoute && routeMode === "deep"
        ? routeMode
        : isAgentRoute
          ? "react"
          : "react";
  const streamMode: ReasoningMode | "team" = collaborationEnabled
    ? "team"
    : effectiveMode;
  return {
    isCodingWorkspaceMode,
    codeModeUnlocked,
    projectSignals,
    projectModePreset,
    activeGroupTaskContext,
    effectiveMode,
    streamMode,
  };
}

interface ProjectAgentModeHandlersInput {
  threadId: string;
  sidebarThreadId: string;
  isNewThread: boolean;
  t: RealtimeTranslations;
  navigate: NavigateFunction;
  embeddedDesignChat: boolean;
  embeddedDesignParentOrigin: string;
  effectiveWorkDir: string;
  boundProjectState: ProjectFullState | null | undefined;
  projectAgentMode: AgentModeName;
  modeManualOverride: boolean;
  setProjectAgentMode: StateSetter<AgentModeName>;
  setModeManualOverride: StateSetter<boolean>;
  setModeIntentSuggestion: StateSetter<ModeIntentSuggestion>;
}

/**
 * Mode switches from the composer: Design hands off to the Design workspace
 * (or back to the host canvas when embedded); intent suggestions persist.
 */
export function useProjectAgentModeHandlers({
  threadId,
  sidebarThreadId,
  isNewThread,
  t,
  navigate,
  embeddedDesignChat,
  embeddedDesignParentOrigin,
  effectiveWorkDir,
  boundProjectState,
  projectAgentMode,
  modeManualOverride,
  setProjectAgentMode,
  setModeManualOverride,
  setModeIntentSuggestion,
}: ProjectAgentModeHandlersInput) {
  // A restored Design preference uses the same home as an explicit mode switch.
  // Embedded chats must stay here so the Design host can render its conversation.
  useEffect(() => {
    if (!isNewThread || embeddedDesignChat || projectAgentMode !== "uxui") return;
    navigate(
      designWorkspaceRoute({
        newTask: true,
        projectId: boundProjectState?.project.id,
        projectName: boundProjectState?.project.name,
      }),
      { replace: true },
    );
  }, [isNewThread, embeddedDesignChat, projectAgentMode, navigate,
    boundProjectState?.project.id, boundProjectState?.project.name]);

  const handleAcceptModeIntent = useCallback(
    async (mode: AgentModeName) => {
      const previousMode = projectAgentMode;
      const previousManualOverride = modeManualOverride;
      const label = modeLabelFor(mode, t);
      setModeManualOverride(true);
      setModeIntentSuggestion(null);
      try {
        await persistModeSelection(mode, threadId, effectiveWorkDir);
        setProjectAgentMode(mode);
        toast.success(t.modeIntent.autoSwitched(label));
        if (mode === "uxui" && !embeddedDesignChat) {
          navigate(
            designWorkspaceRoute({
              threadId: sidebarThreadId,
              newTask: isNewThread,
              projectId: boundProjectState?.project.id,
              projectName: boundProjectState?.project.name,
            }),
          );
        }
      } catch (error) {
        setProjectAgentMode(previousMode);
        setModeManualOverride(previousManualOverride);
        setModeIntentSuggestion({ mode, label });
        toast.error("切换模式失败，已还原");
        throw error;
      }
    },
    [
      boundProjectState?.project.id,
      boundProjectState?.project.name,
      effectiveWorkDir,
      embeddedDesignChat,
      isNewThread,
      modeManualOverride,
      navigate,
      projectAgentMode,
      setModeIntentSuggestion,
      setModeManualOverride,
      setProjectAgentMode,
      sidebarThreadId,
      t,
      threadId,
    ],
  );

  const handleProjectAgentModeStateChange = useCallback(
    (mode: AgentModeName) => {
      // The embedded surface is the Design mode itself. A persisted General
      // preference may hydrate here, but only an explicit user action should
      // close the canvas (handled separately below).
      setProjectAgentMode(embeddedDesignChat ? "uxui" : mode);
    },
    [embeddedDesignChat, setProjectAgentMode],
  );

  const handleProjectAgentModeUserChange = useCallback(
    (mode: AgentModeName) => {
      if (embeddedDesignChat) {
        if (mode === "develop" && window.parent !== window) {
          window.parent.postMessage(
            {
              type: DESIGN_MODE_CHANGE_MESSAGE,
              mode: "develop",
              threadId: sidebarThreadId,
            },
            embeddedDesignParentOrigin,
          );
        }
        return;
      }
      if (mode === "uxui") {
        navigate(
          designWorkspaceRoute({
            threadId: sidebarThreadId,
            newTask: isNewThread,
            projectId: boundProjectState?.project.id,
            projectName: boundProjectState?.project.name,
          }),
        );
      }
    },
    [
      boundProjectState?.project.id,
      boundProjectState?.project.name,
      embeddedDesignChat,
      isNewThread,
      embeddedDesignParentOrigin,
      navigate,
      sidebarThreadId,
    ],
  );

  const handleDismissModeIntent = useCallback(() => {
    setModeIntentSuggestion(null);
  }, [setModeIntentSuggestion]);

  return {
    handleAcceptModeIntent,
    handleProjectAgentModeStateChange,
    handleProjectAgentModeUserChange,
    handleDismissModeIntent,
  };
}
