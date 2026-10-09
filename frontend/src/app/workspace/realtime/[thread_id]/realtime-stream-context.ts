import type { AgentModeName } from "@/components/workspace/mode-selector";
import type { ReasoningMode } from "@/components/workspace/reasoning-mode";
import { workflowPresetForMode } from "@/core/agent-modes/presets";
import { applyCoderModelProfileBoundary } from "@/core/coder/api";
import type { AutomationTarget } from "@/core/computer/api";
import type { parseDesignCapabilities } from "@/core/design/capabilities";
import type { DesignCanvasAgentContext } from "@/core/design/mode-bridge";
import {
  workLocationContext,
  type useThreadWorkLocation,
} from "@/core/execution/work-location";
import type { useExecutionEngine } from "@/core/threads/use-execution-engine";

import type { buildCollaborationTurnContext } from "./collaboration-roster-utils";
import type { normalizeReasoningEffortForUi } from "./page-utils";
import type { RealtimeSettings } from "./realtime-page-types";
import type { useConversationMode } from "./use-project-agent-mode";

type ConversationMode = ReturnType<typeof useConversationMode>;
type ExecutionSelection = ReturnType<typeof useExecutionEngine>;

export interface RealtimeStreamContextInput {
  settingsContext: RealtimeSettings["context"];
  customInstructions: string;
  effectiveReasoningEffort: ReturnType<typeof normalizeReasoningEffortForUi>;
  streamMode: ReasoningMode | "team";
  effectiveMode: ReasoningMode;
  isProjectCodeMode: boolean;
  isCodingWorkspaceMode: boolean;
  projectWorkspacePath: string;
  personalWorkspacePath: string;
  projectAgentMode: AgentModeName;
  projectModePreset: ConversationMode["projectModePreset"];
  projectSignals: ConversationMode["projectSignals"];
  designCapabilities: ReturnType<typeof parseDesignCapabilities>;
  embeddedDesignChat: boolean;
  embeddedDesignContext: DesignCanvasAgentContext | null;
  executionEnginePreference: ExecutionSelection["preference"];
  selectedExecutionEngine: ExecutionSelection["engine"];
  automationTarget: AutomationTarget | null;
  collaborationContext: ReturnType<typeof buildCollaborationTurnContext>;
  isGroupConversation: boolean;
  activeGroupTaskContext: ConversationMode["activeGroupTaskContext"];
  privateConversation: boolean;
  mainPerspectiveAgentId: string;
  workLocation: ReturnType<typeof useThreadWorkLocation>[0];
}

/**
 * The turn context the realtime stream sends with every message: workspace
 * scope, mode preset, design/automation context, collaboration roster and the
 * first-person executor.
 */
export function buildRealtimeStreamContext({
  settingsContext,
  customInstructions,
  effectiveReasoningEffort,
  streamMode,
  effectiveMode,
  isProjectCodeMode,
  isCodingWorkspaceMode,
  projectWorkspacePath,
  personalWorkspacePath,
  projectAgentMode,
  projectModePreset,
  projectSignals,
  designCapabilities,
  embeddedDesignChat,
  embeddedDesignContext,
  executionEnginePreference,
  selectedExecutionEngine,
  automationTarget,
  collaborationContext,
  isGroupConversation,
  activeGroupTaskContext,
  privateConversation,
  mainPerspectiveAgentId,
  workLocation,
}: RealtimeStreamContextInput) {
  // Spread settings.context FIRST so our agent_name wins. Otherwise any
  // stale `agent_name` in the shared settings store (shared across
  // threads) clobbers the current page's pick — which is how turn 2+
  // started sending the wrong id before this fix.
  return applyCoderModelProfileBoundary(
    mainPerspectiveAgentId,
    {
      ...settingsContext,
      reasoning_effort: effectiveReasoningEffort,
      // Opt-in guardian independent review for high-risk actions. Only
      // sent when the user enabled it; the backend gate reads these and
      // degrades to the rule engine on review failure. The review model
      // is left to the backend (conversation's own model) unless the
      // user explicitly picked one.
      guardian_review_enabled: settingsContext.guardian_review_enabled
        ? true
        : undefined,
      guardian_review_model:
        settingsContext.guardian_review_enabled &&
        settingsContext.guardian_review_model
          ? settingsContext.guardian_review_model
          : undefined,
      mode: streamMode,
      workspace_path: isProjectCodeMode ? projectWorkspacePath : undefined,
      workspace_scope: isProjectCodeMode
        ? "project"
        : isCodingWorkspaceMode
          ? "personal"
          : undefined,
      personal_workspace_enabled:
        !isProjectCodeMode && isCodingWorkspaceMode ? true : undefined,
      // Personal space keeps one user-selected root while each role gets a
      // readable, isolated child folder. The UI still presents this as
      // personal space; only an explicitly picked folder is a project.
      personal_workspace_path:
        !isProjectCodeMode && isCodingWorkspaceMode
          ? personalWorkspacePath || undefined
          : undefined,
      capability_mode: isCodingWorkspaceMode ? "code" : undefined,
      code_mode: isCodingWorkspaceMode ? "solo" : undefined,
      // Personal and project workspaces share one mode contract. Scope only
      // decides which directory is bound; it no longer swaps in a second
      // general/build/research vocabulary.
      agent_mode: isCodingWorkspaceMode ? projectAgentMode : undefined,
      design_capabilities: isCodingWorkspaceMode && projectAgentMode === "uxui"
        ? designCapabilities : undefined,
      mode_preset: isCodingWorkspaceMode ? projectModePreset.id : undefined,
      workflow_preset: isCodingWorkspaceMode
        ? workflowPresetForMode(projectAgentMode)
        : undefined,
      // UX/UI is not just a prompt label: enable the runtime's browser
      // regression contract so visual work must be inspected after changes.
      browser_regression_enabled:
        isCodingWorkspaceMode && projectAgentMode === "uxui"
          ? true
          : undefined,
      // Same-origin Design Canvas sends a compact, structured snapshot of
      // the live selection. The runtime turns it into grounded design
      // instructions instead of making the model infer canvas state from
      // a lossy prose prompt.
      design_canvas_context:
        embeddedDesignChat && projectAgentMode === "uxui"
          ? (embeddedDesignContext ?? undefined)
          : undefined,
      personal_instructions: !isProjectCodeMode
        ? customInstructions.trim() || undefined
        : undefined,
      skill_pack_profile: isCodingWorkspaceMode
        ? projectModePreset.skillPackProfile
        : undefined,
      verification_policy: isCodingWorkspaceMode
        ? projectModePreset.verificationPolicy
        : undefined,
      default_skill_packs: isCodingWorkspaceMode
        ? projectModePreset.defaultSkillPacks
        : undefined,
      default_plugins: isCodingWorkspaceMode
        ? projectModePreset.defaultPlugins
        : undefined,
      mode_contract: isCodingWorkspaceMode
        ? projectModePreset.promptContract
        : undefined,
      project_signals: projectSignals,
      execution_engine_preference: executionEnginePreference,
      // A stable, user-visible browser tab / desktop window reference. The
      // runtime receives structured identity instead of guessing from prose.
      automation_target:
        !embeddedDesignChat && automationTarget
          ? automationTarget
          : undefined,
      interaction_mode:
        effectiveMode === "react" ||
        effectiveMode === "deep" ||
        effectiveMode === "code"
          ? "office"
          : undefined,
      ...collaborationContext,
      // Group strategy owns the work contract for this turn. Spread it last
      // so hidden personal/project selectors cannot leak stale constraints
      // into a project group (including Project OS groups without workDir).
      ...(isGroupConversation ? activeGroupTaskContext : {}),
      // Collaboration context describes the roster and its leader; the
      // current first-person viewpoint is deliberately last so it remains
      // the actual executor for this turn without mutating that roster.
      private_conversation: privateConversation,
      agent_name: mainPerspectiveAgentId,
      execution_engine: selectedExecutionEngine,
      work_location: isGroupConversation
        ? undefined
        : workLocationContext(workLocation),
    },
    selectedExecutionEngine,
  );
}
