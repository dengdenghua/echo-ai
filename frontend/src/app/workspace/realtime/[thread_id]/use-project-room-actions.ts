import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import type { ProjectFullState } from "@/components/workspace/agent-workbench-panel/project-os-tab";
import type { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { detachGroupProjectCapability } from "@/components/workspace/realtime/group-project-capability";
import type { TeamMode } from "@/components/workspace/team-mode-picker";
import type {
  CoworkMessageProjectActionInput,
  CoworkRoomEntityRef,
  CoworkRoomMessage,
  useApplyCollabRoomMessageProjectAction,
  useEnsureCollabRoom,
  usePostCollabRoomMessage,
} from "@/core/cowork";
import type { useDetachProjectFromGroup } from "@/core/projects/hooks";

import type {
  BoundProjectQuery,
  CollabSessionQuery,
  RealtimeTranslations,
  StateSetter,
} from "./realtime-page-types";
import type { useHumanInviteRoom } from "./use-collaboration-roster";
import type { WorkbenchSurfaceSetters } from "./use-workbench-surface";

type BoundProjectState = ProjectFullState | null | undefined;

const PROJECT_ACTION_SUCCESS_LABELS: Record<
  CoworkMessageProjectActionInput["action"],
  string
> = {
  link_milestone: "已关联到里程碑",
  create_item: "已创建项目事项",
  record_decision: "已记录项目决策",
  publish_artifact: "已发布到项目资料",
};

/** Opens the workbench's project tab, optionally focusing one project entity. */
export function useProjectWorkbenchOpener({
  boundProjectState,
  closeSpecialUtilityPanels,
  setArtifactsOpen,
  setShowResearch,
  setShowAgentPlan,
  setShowResearchHistory,
  setAgentWorkbenchManuallyOpened,
  setAgentWorkbenchTab,
  setAgentWorkbenchTabTouched,
}: WorkbenchSurfaceSetters & { boundProjectState: BoundProjectState }) {
  return useCallback(
    (entity?: CoworkRoomEntityRef) => {
      closeSpecialUtilityPanels();
      setArtifactsOpen(false);
      setShowAgentPlan(false);
      setShowResearchHistory(false);
      setShowResearch(false);

      setAgentWorkbenchManuallyOpened(true);
      setAgentWorkbenchTab("project");
      setAgentWorkbenchTabTouched(true);
      if (entity && typeof window !== "undefined") {
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("echo:project-entity-focus", {
              detail: {
                ...entity,
                project_id: entity.project_id ?? boundProjectState?.project.id,
              },
            }),
          );
        }, 0);
      }
    },
    [
      boundProjectState?.project.id,
      closeSpecialUtilityPanels,
      setAgentWorkbenchManuallyOpened,
      setAgentWorkbenchTab,
      setAgentWorkbenchTabTouched,
      setArtifactsOpen,
      setShowAgentPlan,
      setShowResearch,
      setShowResearchHistory,
    ],
  );
}

/** Detaches the bound project from this group after explicit confirmation. */
export function useProjectCapabilityDetach({
  threadId,
  isNewThread,
  t,
  boundProjectQuery,
  boundProjectState,
  canManageHumanInvites,
  confirmProjectDetach,
  detachProjectFromGroupMutation,
  setAgentWorkbenchTab,
  setAgentWorkbenchManuallyOpened,
}: {
  threadId: string;
  isNewThread: boolean;
  t: RealtimeTranslations;
  boundProjectQuery: BoundProjectQuery;
  boundProjectState: BoundProjectState;
  canManageHumanInvites: boolean;
  confirmProjectDetach: ReturnType<typeof useConfirmDialog>["confirm"];
  detachProjectFromGroupMutation: ReturnType<typeof useDetachProjectFromGroup>;
  setAgentWorkbenchTab: WorkbenchSurfaceSetters["setAgentWorkbenchTab"];
  setAgentWorkbenchManuallyOpened: StateSetter<boolean>;
}) {
  return useCallback(async () => {
    if (!boundProjectState || !canManageHumanInvites || isNewThread) return;
    const expectedProjectId = boundProjectState.project.id;
    const confirmed = await confirmProjectDetach({
      title: t.projectCapability.detachConfirmTitle,
      description: t.projectCapability.detachConfirmDescription,
      confirmLabel: t.projectCapability.detachConfirmAction,
      destructive: true,
    });
    if (!confirmed) return;

    const outcome = await detachGroupProjectCapability({
      expectedProjectId,
      requestDetach: ({ force, expectedProjectId: guardedProjectId }) =>
        detachProjectFromGroupMutation.mutateAsync({
          threadId,
          expectedProjectId: guardedProjectId,
          force,
        }),
      confirmForce: () =>
        confirmProjectDetach({
          title: t.projectCapability.forceDetachConfirmTitle,
          description: t.projectCapability.forceDetachConfirmDescription,
          confirmLabel: t.projectCapability.forceDetachConfirmAction,
          destructive: true,
        }),
    });
    if (outcome === "cancelled") {
      toast.info(t.projectCapability.detachCancelled);
      return;
    }
    if (outcome === "binding-changed") {
      toast.error(t.projectCapability.detachBindingChanged);
      return;
    }
    if (outcome === "failed") {
      toast.error(t.projectCapability.detachFailed);
      return;
    }

    await boundProjectQuery.refetch().catch(() => undefined);
    setAgentWorkbenchTab("agent");
    setAgentWorkbenchManuallyOpened(false);

    toast.success(t.projectCapability.detached);
  }, [
    boundProjectQuery,
    boundProjectState,
    canManageHumanInvites,
    confirmProjectDetach,
    detachProjectFromGroupMutation,
    isNewThread,
    setAgentWorkbenchManuallyOpened,
    setAgentWorkbenchTab,
    t.projectCapability,
    threadId,
  ]);
}

interface ProjectMessageActionsInput {
  threadId: string;
  isNewThread: boolean;
  boundProjectQuery: BoundProjectQuery;
  boundProjectState: BoundProjectState;
  collabSessionQuery: CollabSessionQuery;
  currentInviteActor: string;
  currentRoomParticipant: { display_name?: string } | undefined;
  collaborationRoomMemberPayload: ReturnType<
    typeof useHumanInviteRoom
  >["collaborationRoomMemberPayload"];
  collaborationTeamName: string;
  effectiveAgentId: string;
  teamModeIntent: TeamMode;
  ensureCollabRoomMutation: ReturnType<typeof useEnsureCollabRoom>;
  postCollabRoomMessageMutation: ReturnType<typeof usePostCollabRoomMessage>;
  applyRoomMessageProjectActionMutation: ReturnType<
    typeof useApplyCollabRoomMessageProjectAction
  >;
  openProjectWorkbenchForEntity: (entity?: CoworkRoomEntityRef) => void;
}

/**
 * Message → project actions (link milestone, create item, record decision,
 * publish artifact) offered on thread messages of a project group.
 */
export function useProjectMessageActions({
  threadId,
  isNewThread,
  boundProjectQuery,
  boundProjectState,
  collabSessionQuery,
  currentInviteActor,
  currentRoomParticipant,
  collaborationRoomMemberPayload,
  collaborationTeamName,
  effectiveAgentId,
  teamModeIntent,
  ensureCollabRoomMutation,
  postCollabRoomMessageMutation,
  applyRoomMessageProjectActionMutation,
  openProjectWorkbenchForEntity,
}: ProjectMessageActionsInput) {
  const projectMilestoneOptions = useMemo(
    () =>
      (boundProjectState?.milestones ?? []).map((milestone) => ({
        id: milestone.id,
        name: milestone.name,
        status: milestone.status,
      })),
    [boundProjectState?.milestones],
  );
  const defaultProjectMilestoneId = useMemo(() => {
    if (!boundProjectState) return undefined;
    return (
      boundProjectState.project.current_ms ??
      boundProjectState.milestones.find(
        (milestone) => milestone.status !== "done",
      )?.id ??
      boundProjectState.milestones[0]?.id
    );
  }, [boundProjectState]);
  const roomMessageMetadataBySourceId = useMemo(() => {
    const metadataById: Record<string, CoworkRoomMessage["metadata"]> = {};
    for (const message of collabSessionQuery.data?.room_messages ?? []) {
      const sourceId = message.metadata?.source_message_id;
      if (sourceId) metadataById[sourceId] = message.metadata;
    }
    return metadataById;
  }, [collabSessionQuery.data?.room_messages]);
  const handleThreadMessageProjectAction = useCallback(
    async (
      input: CoworkMessageProjectActionInput,
      message: CoworkRoomMessage,
    ) => {
      const project = boundProjectState?.project;
      if (!project) throw new Error("当前群聊尚未绑定项目");
      if (isNewThread || !threadId || threadId === "new") {
        throw new Error("请先创建项目群再执行此操作");
      }

      if (!collabSessionQuery.data?.room_id) {
        await ensureCollabRoomMutation.mutateAsync({
          threadId,
          input: {
            id: `collab-${threadId}`,
            name: collaborationTeamName,
            members: collaborationRoomMemberPayload,
            leaderId:
              collaborationRoomMemberPayload[0]?.name ?? effectiveAgentId,
            mode: teamModeIntent,
          },
        });
      }

      const sourceMessageId = message.metadata?.source_message_id ??
        `thread:${threadId}:${message.seq}`;
      const existingMessage = collabSessionQuery.data?.room_messages.find(
        item => item.metadata?.source_message_id === sourceMessageId,
      );
      const posted = existingMessage ? { message: existingMessage, seq: existingMessage.seq } : await postCollabRoomMessageMutation.mutateAsync({
        threadId,
        input: {
          text: message.text.trim() || "群聊消息",
          participant_id: currentInviteActor,
          display_name: currentRoomParticipant?.display_name || currentInviteActor,
          source_message_id: sourceMessageId,
        },
      });
      const messageSeq = posted.message?.seq ?? posted.seq;
      const normalizedInput: CoworkMessageProjectActionInput = {
        ...input,
        project_id: project.id,
        ...(input.action === "publish_artifact"
          ? {
              artifact: {
                ...(input.artifact ?? {}),
                source_message_seq: messageSeq,
              },
            }
          : {}),
      };
      const response = await applyRoomMessageProjectActionMutation.mutateAsync({
        threadId,
        messageSeq,
        input: normalizedInput,
      });
      await boundProjectQuery.refetch();
      openProjectWorkbenchForEntity(response.target);
      toast.success(
        response.replayed
          ? "该项目记录已存在"
          : PROJECT_ACTION_SUCCESS_LABELS[input.action],
      );
    },
    [
      applyRoomMessageProjectActionMutation,
      boundProjectQuery,
      boundProjectState?.project,
      collabSessionQuery.data?.room_id,
      collabSessionQuery.data?.room_messages,
      currentInviteActor,
      currentRoomParticipant?.display_name,
      collaborationRoomMemberPayload,
      collaborationTeamName,
      effectiveAgentId,
      ensureCollabRoomMutation,
      isNewThread,
      openProjectWorkbenchForEntity,
      postCollabRoomMessageMutation,
      teamModeIntent,
      threadId,
    ],
  );
  const projectMessageActions = useMemo(
    () =>
      boundProjectState
        ? {
            threadId,
            projectId: boundProjectState.project.id,
            milestones: projectMilestoneOptions,
            defaultMilestoneId: defaultProjectMilestoneId,
            messageMetadataBySourceId: roomMessageMetadataBySourceId,
            onActionRequest: handleThreadMessageProjectAction,
            onActionError: (error: Error) => {
              toast.error(error.message || "项目操作失败");
            },
          }
        : undefined,
    [
      boundProjectState,
      defaultProjectMilestoneId,
      handleThreadMessageProjectAction,
      projectMilestoneOptions,
      roomMessageMetadataBySourceId,
      threadId,
    ],
  );
  return { projectMilestoneOptions, defaultProjectMilestoneId, projectMessageActions };
}

/** Reply / @-mention / project actions on room messages in the timeline. */
export function useRoomTimelineMessageActions({
  threadId,
  canWriteConversation,
  boundProjectQuery,
  boundProjectState,
  collabSessionQuery,
  projectMilestoneOptions,
  defaultProjectMilestoneId,
  openProjectWorkbenchForEntity,
  setReplyTarget,
  setComposerSeed,
}: {
  threadId: string;
  canWriteConversation: boolean;
  boundProjectQuery: BoundProjectQuery;
  boundProjectState: BoundProjectState;
  collabSessionQuery: CollabSessionQuery;
  projectMilestoneOptions: ReturnType<
    typeof useProjectMessageActions
  >["projectMilestoneOptions"];
  defaultProjectMilestoneId: string | undefined;
  openProjectWorkbenchForEntity: (entity?: CoworkRoomEntityRef) => void;
  setReplyTarget: StateSetter<CoworkRoomMessage | null>;
  setComposerSeed: StateSetter<string>;
}) {
  return useMemo(
    () => ({
      disabled: !canWriteConversation,
      onReply: (message: CoworkRoomMessage) => {
        setReplyTarget(message);
        const quoted = message.text.replace(/\s+/g, " ").trim().slice(0, 160);
        setComposerSeed(`> ${quoted}\n\n`);
      },
      onMentionAuthor: (message: CoworkRoomMessage) => {
        const member = collabSessionQuery.data?.roster.find(
          (candidate) => candidate.id === message.participant_id,
        );
        const mention =
          member && member.kind !== "human" && message.participant_id
            ? `@agent:${message.participant_id}`
            : `@${message.display_name || message.participant_id || "成员"}`;
        setComposerSeed(`${mention} `);
      },
      ...(boundProjectState
        ? {
            threadId,
            projectId: boundProjectState.project.id,
            milestones: projectMilestoneOptions,
            defaultMilestoneId: defaultProjectMilestoneId,
            onActionApplied: (
              response: { target?: CoworkRoomEntityRef } | undefined,
              input: CoworkMessageProjectActionInput,
            ) => {
              void boundProjectQuery.refetch();
              if (response?.target) {
                openProjectWorkbenchForEntity(response.target);
              }
              toast.success(PROJECT_ACTION_SUCCESS_LABELS[input.action]);
            },
            onActionError: (error: Error) => {
              toast.error(error.message || "项目操作失败");
            },
          }
        : {}),
    }),
    [
      boundProjectQuery,
      boundProjectState,
      collabSessionQuery.data?.roster,
      canWriteConversation,
      defaultProjectMilestoneId,
      openProjectWorkbenchForEntity,
      projectMilestoneOptions,
      setComposerSeed,
      setReplyTarget,
      threadId,
    ],
  );
}
