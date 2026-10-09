import {
  ChatInputBox,
  type ChatInputBoxProps,
} from "@/components/workspace/chat-input-box";
import { ExecutionEnginePicker } from "@/components/workspace/execution-engine-picker";
import type { AgentModeName } from "@/components/workspace/mode-selector";
import type { resolveGroupProjectCapabilityAction } from "@/components/workspace/realtime/group-project-capability";
import {
  TeamModePicker,
  type TeamMode,
} from "@/components/workspace/team-mode-picker";
import type { AutomationTarget } from "@/core/computer/api";
import type { DesignCanvasAgentContext } from "@/core/design/mode-bridge";
import type { useThreadWorkLocation } from "@/core/execution/work-location";
import { normalizePermissionMode } from "@/core/permissions";
import type { useExecutionEngine } from "@/core/threads/use-execution-engine";

import type {
  RealtimeSettings,
  RealtimeThread,
  RealtimeTranslations,
  StateSetter,
} from "./realtime-page-types";

/** ChatInputBox props the realtime page forwards without any adaptation. */
type ForwardedChatInputProps = Pick<
  ChatInputBoxProps,
  | "mode"
  | "reasoningEffort"
  | "mentionMembers"
  | "groupTaskStrategy"
  | "onGroupTaskStrategyChange"
  | "workDir"
  | "displayAgent"
  | "onWorkDirChange"
  | "onOpenWorkDirInNewTask"
  | "codeModeUnlocked"
  | "projectDetection"
  | "onProjectAgentModeChange"
  | "onProjectAgentModeUserChange"
  | "onProjectDetectionChange"
  | "onManualOverrideChange"
  | "modeIntentSuggestion"
  | "onAcceptModeIntent"
  | "onDismissModeIntent"
  | "contextTokens"
  | "maxContextTokens"
  | "isCompressingContext"
  | "onCompressContext"
  | "contextSegments"
  | "onModelChange"
  | "onModelSwitchNotice"
  | "onReasoningEffortChange"
  | "onModeChange"
  | "onPermissionModeChange"
  | "onSubmit"
  | "onDeepResearch"
  | "onStop"
  | "isUploading"
>;

type ExecutionSelection = ReturnType<typeof useExecutionEngine>;
type WorkLocationState = ReturnType<typeof useThreadWorkLocation>;

export interface RealtimeChatInputProps extends ForwardedChatInputProps {
  threadId: string;
  thread: RealtimeThread;
  t: RealtimeTranslations;
  composerSeed: string;
  isNewThread: boolean;
  welcomeTeamId: string | null;
  settings: RealtimeSettings;
  embeddedDesignChat: boolean;
  embeddedDesignContext: DesignCanvasAgentContext | null;
  executionSelection: ExecutionSelection;
  selectedExecutionEngine: ExecutionSelection["engine"];
  hasCompletedAgentOutput: boolean;
  isEchoAssistant: boolean;
  isGroupConversation: boolean;
  isProjectCodeMode: boolean;
  canWriteConversation: boolean;
  researchLoading: boolean;
  hasBoundProject: boolean;
  projectCapabilityAction: ReturnType<typeof resolveGroupProjectCapabilityAction>;
  openProjectWorkbenchForEntity: () => void;
  setPromoteGroupDialogOpen: StateSetter<boolean>;
  recorderPluginEnabled: boolean;
  openTeachRepeatPanel: () => void;
  visibleCollaboratorCount: number;
  teamModeIntent: TeamMode;
  handleTeamModeIntentChange: (mode: TeamMode) => void;
  isSavingRoster: boolean;
  automationTarget: AutomationTarget | null;
  handleAutomationTargetChange: (target: AutomationTarget | null) => void;
  workLocation: WorkLocationState[0];
  setWorkLocation: WorkLocationState[1];
  projectAgentMode: AgentModeName;
  isStopping: boolean;
  handleRetryTask: (prompt: string) => void;
}

/**
 * The realtime composer: adapts conversation state (connection, group,
 * Design Canvas embedding, project capability) to the shared ChatInputBox.
 */
export function RealtimeChatInput({
  threadId,
  thread,
  t,
  composerSeed,
  isNewThread,
  welcomeTeamId,
  settings,
  embeddedDesignChat,
  embeddedDesignContext,
  executionSelection,
  selectedExecutionEngine,
  hasCompletedAgentOutput,
  isEchoAssistant,
  isGroupConversation,
  isProjectCodeMode,
  canWriteConversation,
  researchLoading,
  hasBoundProject,
  projectCapabilityAction,
  openProjectWorkbenchForEntity,
  setPromoteGroupDialogOpen,
  recorderPluginEnabled,
  openTeachRepeatPanel,
  visibleCollaboratorCount,
  teamModeIntent,
  handleTeamModeIntentChange,
  isSavingRoster,
  automationTarget,
  handleAutomationTargetChange,
  workLocation,
  setWorkLocation,
  projectAgentMode,
  isStopping,
  handleRetryTask,
  ...forwarded
}: RealtimeChatInputProps) {
  return (
    <ChatInputBox
      {...forwarded}
      key={composerSeed || "empty-composer"}
      status={
        thread.error && !hasCompletedAgentOutput
          ? "error"
          : thread.isLoading
            ? "streaming"
            : "ready"
      }
      readyForMutations={thread.readyForMutations}
      connectionPhase={thread.connectionPhase}
      onRetryConnection={thread.refresh}
      modelName={settings.context.model_name}
      // Keep one selector, but project model ownership by
      // engine: Codex roles use the server-owned profile;
      // native roles serialize the thread's model source.
      modelProfileControl={!embeddedDesignChat}
      executionEngine={selectedExecutionEngine}
      executionEngineControl={
        !embeddedDesignChat ? (
          <RealtimeExecutionEngineControl
            executionSelection={executionSelection}
            selectedExecutionEngine={selectedExecutionEngine}
            disabled={thread.isLoading}
          />
        ) : undefined
      }
      threadId={threadId}
      draftStorageKey={isNewThread ? (welcomeTeamId ? `team:${welcomeTeamId}` : "__new__") : threadId}
      isGroupConversation={isGroupConversation}
      projectCapabilityEnabled={hasBoundProject}
      onProjectCapabilityAction={
        projectCapabilityAction === "open"
          ? () => openProjectWorkbenchForEntity()
          : projectCapabilityAction === "create"
            ? () => setPromoteGroupDialogOpen(true)
            : undefined
      }
      onSwitchPanel={
        recorderPluginEnabled
          ? (panel) => {
              if (panel === "teach-repeat") {
                openTeachRepeatPanel();
              }
            }
          : undefined
      }
      responseModeControl={
        !embeddedDesignChat && isGroupConversation && visibleCollaboratorCount > 1 ? (
          <RealtimeResponseModeControl
            t={t}
            teamModeIntent={teamModeIntent}
            onChange={handleTeamModeIntentChange}
            disabled={thread.isLoading || isSavingRoster}
            visibleCollaboratorCount={visibleCollaboratorCount}
          />
        ) : undefined
      }
      statusTrailing={
        embeddedDesignChat ? (
          <DesignCanvasContextStatus
            embeddedDesignContext={embeddedDesignContext}
          />
        ) : undefined
      }
      automationTarget={
        embeddedDesignChat ? null : automationTarget
      }
      onAutomationTargetChange={
        embeddedDesignChat
          ? undefined
          : handleAutomationTargetChange
      }
      disabled={researchLoading || !canWriteConversation}
      showWorkDirSelector={!embeddedDesignChat}
      workLocation={
        !embeddedDesignChat && !isGroupConversation
          ? { value: workLocation, onChange: setWorkLocation }
          : undefined
      }
      showModeSelector
      lockWorkDirToThread={!isNewThread}
      // The embedded Design Canvas is a distinct surface,
      // so seed the shared mode chip from the route on the
      // very first render. Waiting for the hydration
      // effect would briefly paint General and then
      // switch to Design, which looks like a third mode
      // flicker to the user.
      projectAgentMode={
        embeddedDesignChat ? "uxui" : projectAgentMode
      }
      permissionMode={normalizePermissionMode(
        settings.context.permission_mode,
      )}
      allowAgentModes={!embeddedDesignChat}
      onResume={!thread.isLoading && !isStopping && (thread.lastTurnStatus === "interrupted" || thread.lastTurnStatus === "failed") ? () => handleRetryTask("继续当前任务：保留此前完成的工作，先检查中断位置和现有结果，从未完成部分继续，不要重复已成功的操作。") : undefined}
      isStopping={isStopping}
      autoFocus={isNewThread}
      defaultValue={composerSeed}
      placeholder={
        !canWriteConversation
          ? t.teamMembers.viewerDesc
          : isEchoAssistant
          ? t.realtime.composer.placeholderEcho
          : isProjectCodeMode
            ? t.realtime.composer.placeholderCode
            : isNewThread
              ? t.realtime.composer.placeholderNew
              : undefined
      }
      className={
        isNewThread
          ? "border-border-subtle bg-card/90 shadow-none"
          : undefined
      }
    />
  );
}

function RealtimeExecutionEngineControl({
  executionSelection,
  selectedExecutionEngine,
  disabled,
}: {
  executionSelection: ExecutionSelection;
  selectedExecutionEngine: ExecutionSelection["engine"];
  disabled: boolean;
}) {
  return (
    <ExecutionEnginePicker
      value={executionSelection.preference}
      resolvedEngine={selectedExecutionEngine}
      codexCapabilityChecks={executionSelection.codexCapabilityChecks}
      opencodeCapabilityChecks={executionSelection.opencodeCapabilityChecks}
      onChange={executionSelection.setPreference}
      codexAvailable={
        executionSelection.codexAvailable
      }
      opencodeAvailable={
        executionSelection.opencodeAvailable
      }
      opencodeUnavailableReason={
        executionSelection.opencodeUnavailableReason
      }
      unavailableReason={
        executionSelection.codexUnavailableReason
      }
      disabled={disabled}
    />
  );
}

function RealtimeResponseModeControl({
  t,
  teamModeIntent,
  onChange,
  disabled,
  visibleCollaboratorCount,
}: {
  t: RealtimeTranslations;
  teamModeIntent: TeamMode;
  onChange: (mode: TeamMode) => void;
  disabled: boolean;
  visibleCollaboratorCount: number;
}) {
  return (
    <TeamModePicker
      value={teamModeIntent}
      onChange={onChange}
      ariaLabel={t.chatInputBox.responseMode}
      compact
      disabled={disabled}
      disabledModes={
        visibleCollaboratorCount <= 1
          ? ["cluster", "swarm"]
          : []
      }
      disabledReason={
        t.chatInputBox.responseModeTeamRequired
      }
    />
  );
}

function DesignCanvasContextStatus({
  embeddedDesignContext,
}: {
  embeddedDesignContext: DesignCanvasAgentContext | null;
}) {
  return (
    <span
      data-testid="design-canvas-context-status"
      className="whitespace-nowrap text-[11px] text-violet-600"
    >
      {embeddedDesignContext
        ? embeddedDesignContext.selected_node_ids
            .length > 0
          ? `已连接画布 · 已选 ${embeddedDesignContext.selected_node_ids.length}`
          : "已连接画布"
        : "正在连接画布…"}
    </span>
  );
}
