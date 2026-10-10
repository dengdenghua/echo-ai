import { useCallback } from "react";
import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";

import type { GroupTaskStrategy } from "@/components/workspace/group-task-strategy";
import type { AgentModeName } from "@/components/workspace/mode-selector";
import type { ReasoningMode } from "@/components/workspace/reasoning-mode";
import { primaryPersonaAgentIdOrDefault } from "@/core/agents/persona-policy";
import { groupTaskStrategyAfterSubmit } from "@/core/collaboration/group-task-strategy-context";
import { writeTaskCollaboratorPreset } from "@/core/collaboration/task-collaborator-preset";
import type { CoworkRoomMessage } from "@/core/cowork";
import type { Message } from "@/core/api/types";
import { classifyModeIntent } from "@/core/modes/intent-classifier";
import type { PermissionMode } from "@/core/permissions";
import { taskWorkspaceRoute } from "@/core/router/task-workspace-route";
import type { ReasoningEffort } from "@/core/threads";
import {
  isThreadStale,
  writePendingNewSession,
} from "@/core/threads/pending-new-session";
import type { PromptInputFilePart, UploadedFileInfo } from "@/core/uploads";

import {
  modeLabelFor,
  normalizeReasoningEffortForUi,
  recentHumanMessageTexts,
} from "./page-utils";
import type {
  RealtimeSendMessage,
  RealtimeSettings,
  RealtimeSettingsSetter,
  RealtimeTranslations,
  StateSetter,
} from "./realtime-page-types";
import type { ModeIntentSuggestion } from "./use-project-agent-mode";
import type { useThreadIdentity } from "./use-thread-workspace";

interface RealtimeSubmitInput {
  threadId: string;
  t: RealtimeTranslations;
  navigate: NavigateFunction;
  settings: RealtimeSettings;
  threadIdentityQuery: ReturnType<typeof useThreadIdentity>["threadIdentityQuery"];
  messages: Message[];
  readyForMutations: boolean;
  canWriteConversation: boolean;
  sendMessage: RealtimeSendMessage;
  markSidebarThreadRunning: (id: string) => void;
  activeAgentId: string;
  legacyOnDemandThreadOwnerId: string;
  isEchoAssistant: boolean;
  isGroupConversation: boolean;
  isCodingWorkspaceMode: boolean;
  projectAgentMode: AgentModeName;
  modeManualOverride: boolean;
  setProjectAgentMode: StateSetter<AgentModeName>;
  setModeIntentSuggestion: StateSetter<ModeIntentSuggestion>;
  setGroupTaskStrategy: StateSetter<GroupTaskStrategy>;
  setReplyTarget: StateSetter<CoworkRoomMessage | null>;
}

/**
 * The composer's submit: legacy on-demand hand-off, intent-based mode
 * switching, the Assistant's auto-new-session, then the actual send.
 */
export function useRealtimeSubmit({
  threadId,
  t,
  navigate,
  settings,
  threadIdentityQuery,
  messages,
  readyForMutations,
  canWriteConversation,
  sendMessage,
  markSidebarThreadRunning,
  activeAgentId,
  legacyOnDemandThreadOwnerId,
  isEchoAssistant,
  isGroupConversation,
  isCodingWorkspaceMode,
  projectAgentMode,
  modeManualOverride,
  setProjectAgentMode,
  setModeIntentSuggestion,
  setGroupTaskStrategy,
  setReplyTarget,
}: RealtimeSubmitInput) {
  return useCallback(
    (message: {
      text: string;
      images?: File[];
      files?: File[];
      uploaded?: UploadedFileInfo[];
    }) => {
      // The socket may have dropped after the composer rendered but before
      // this click reached the mutation boundary. Returning false tells the
      // composer to preserve the complete draft for the recovered session.
      if (!readyForMutations || !canWriteConversation) return false;
      const images = message.images ?? [];
      const attachedFiles = message.files ?? [];
      const browserFiles = [...attachedFiles, ...images];
      if (legacyOnDemandThreadOwnerId) {
        const leaderId = primaryPersonaAgentIdOrDefault(activeAgentId);
        writeTaskCollaboratorPreset({
          leaderId,
          collaboratorIds: [legacyOnDemandThreadOwnerId],
          mode: "cluster",
          label: legacyOnDemandThreadOwnerId,
          openPicker: true,
        });
        if (browserFiles.length === 0 && message.text.trim()) {
          writePendingNewSession(message.text);
          toast.info(t.realtime.composer.legacyOnDemandContinued);
          void navigate(taskWorkspaceRoute({ agentId: leaderId }));
        } else {
          toast.info(t.realtime.composer.legacyOnDemandAttachments);
          void navigate(
            taskWorkspaceRoute({ agentId: leaderId, prompt: message.text }),
          );
        }
        return;
      }
      // Intent-based mode auto-switch: only in project/code mode, and never
      // for the echo assistant (fixed chat persona). Manual override wins —
      // when the user has hand-picked a mode we only suggest, never silently
      // switch. High-confidence verdicts auto-switch + toast; medium ones
      // surface the lightweight suggestion bar above the composer.
      if (
        isCodingWorkspaceMode &&
        !isEchoAssistant &&
        !isGroupConversation
      ) {
        const verdict = classifyModeIntent(
          recentHumanMessageTexts(messages),
        );
        if (
          verdict.handle !== "none" &&
          verdict.mode &&
          verdict.mode !== projectAgentMode
        ) {
          const label = modeLabelFor(verdict.mode, t);
          if (modeManualOverride) {
            setModeIntentSuggestion({ mode: verdict.mode, label });
          } else if (verdict.handle === "auto") {
            setProjectAgentMode(verdict.mode);
            toast.success(t.modeIntent.autoSwitched(label));
          } else if (verdict.handle === "suggest") {
            setModeIntentSuggestion({ mode: verdict.mode, label });
          }
        }
      }
      // The auto-new-session preference belongs only to the fixed Assistant
      // window. Project threads and role/personal-space threads keep their
      // own continuity regardless of this setting.
      // Attachments can't travel through the hand-off, so we only auto-start
      // for text-only messages; everything else stays in the current thread.
      const autoNewSessionHours = settings.session?.auto_new_session_hours ?? 0;
      if (
        isEchoAssistant &&
        autoNewSessionHours > 0 &&
        message.text.trim().length > 0 &&
        browserFiles.length === 0 &&
        isThreadStale(threadIdentityQuery.data?.updated_at, autoNewSessionHours)
      ) {
        writePendingNewSession(message.text);
        toast.info(
          `已为你开启新会话（距上次对话已超过 ${autoNewSessionHours} 小时）`,
        );
        void navigate(
          taskWorkspaceRoute({ agentId: activeAgentId, prompt: message.text }),
          { replace: false },
        );
        return;
      }

      markSidebarThreadRunning(threadId);
      if (browserFiles.length === 0) {
        void sendMessage(threadId, { text: message.text, files: [] });
        setReplyTarget(null);
        if (isGroupConversation) {
          // Task strategy is a one-turn intent. Returning to auto avoids a
          // later conversational follow-up silently running a heavy workflow.
          setGroupTaskStrategy(groupTaskStrategyAfterSubmit());
        }
        return;
      }
      // Composer-side uploads already happened on attach; align them back onto
      // the parts by filename so the send path can skip the network.
      const uploadedByName = new Map(
        (message.uploaded ?? []).map((info) => [info.filename, info]),
      );
      // Keep submit synchronous and hand the original File objects to the
      // realtime adapter. It owns upload/base64 enrichment already; eagerly
      // reading images here created a gap where the composer cleared its
      // attachments before the message had even entered the outbound ledger.
      const files: PromptInputFilePart[] = browserFiles.map((file) => ({
        type: "file",
        mediaType: file.type || "application/octet-stream",
        filename: file.name,
        // FileUIPart requires a URL, but the adapter deliberately prefers the
        // attached browser File and generates image data URLs when needed.
        url: "",
        file,
        uploaded: uploadedByName.get(file.name),
      }));
      void sendMessage(threadId, { text: message.text, files });
      setReplyTarget(null);
      if (isGroupConversation) {
        setGroupTaskStrategy(groupTaskStrategyAfterSubmit());
      }
    },
    [
      isEchoAssistant,
      isGroupConversation,
      isCodingWorkspaceMode,
      legacyOnDemandThreadOwnerId,
      markSidebarThreadRunning,
      modeManualOverride,
      projectAgentMode,
      sendMessage,
      t,
      messages,
      readyForMutations,
      canWriteConversation,
      threadId,
      activeAgentId,
      navigate,
      settings,
      threadIdentityQuery,
      setGroupTaskStrategy,
      setModeIntentSuggestion,
      setProjectAgentMode,
      setReplyTarget,
    ],
  );
}

/** Composer controls that write the thread's settings (mode, model, effort, permissions). */
export function useComposerSettingsHandlers({
  settings,
  setSettings,
  effectiveMode,
  isAgentRoute,
  isCodingWorkspaceMode,
  navigate,
  newThreadRouteForMode,
}: {
  settings: RealtimeSettings;
  setSettings: RealtimeSettingsSetter;
  effectiveMode: ReasoningMode;
  isAgentRoute: boolean;
  isCodingWorkspaceMode: boolean;
  navigate: NavigateFunction;
  newThreadRouteForMode: (mode: string, prompt?: string) => string;
}) {
  const handleModeChange = useCallback(
    (mode: ReasoningMode, draft?: string) => {
      if (mode === effectiveMode) return;
      if (mode === "code" && !isCodingWorkspaceMode) return;
      if (!isAgentRoute) return;
      setSettings("context", {
        ...settings.context,
        mode,
      });
      if (
        mode === "react" ||
        mode === "deep" ||
        (isAgentRoute && mode === "chat")
      ) {
        void navigate(newThreadRouteForMode(mode, draft), { replace: false });
      }
    },
    [
      effectiveMode,
      isAgentRoute,
      isCodingWorkspaceMode,
      navigate,
      newThreadRouteForMode,
      setSettings,
      settings.context,
    ],
  );

  const handleModelChange = useCallback(
    (modelName: string) => {
      setSettings("context", {
        ...settings.context,
        model_name: modelName,
      });
    },
    [setSettings, settings.context],
  );

  const handleReasoningEffortChange = useCallback(
    (reasoningEffort: ReasoningEffort) => {
      setSettings("context", {
        ...settings.context,
        reasoning_effort: normalizeReasoningEffortForUi(reasoningEffort),
      });
    },
    [setSettings, settings.context],
  );

  const handlePermissionModeChange = useCallback(
    (permissionMode: PermissionMode) => {
      // Full access is an inclusive preset rather than only an approval
      // toggle. Keep the persisted settings page in sync with the effective
      // runtime contract shown in the composer.
      const fullAccess = permissionMode === "bypassPermissions";
      setSettings("context", {
        ...settings.context,
        permission_mode: permissionMode,
        approval_policy: fullAccess ? "never" : "on-request",
        ...(fullAccess
          ? {
              execution_environment: "local" as const,
              sandbox_mode: "full" as const,
              network_access: "full" as const,
            }
          : {}),
      });
    },
    [setSettings, settings.context],
  );

  return {
    handleModeChange,
    handleModelChange,
    handleReasoningEffortChange,
    handlePermissionModeChange,
  };
}
