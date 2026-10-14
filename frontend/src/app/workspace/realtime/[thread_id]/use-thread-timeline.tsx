import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from "react";
import { toast } from "sonner";

import {
  CoworkRoomTimelineEntry,
  dedupeCoworkRoomMessages,
} from "@/components/workspace/collab";
import type { MessageListTimelineEntry } from "@/components/workspace/messages";
import type { SessionContextStatus } from "@/components/workspace/session-status-sections";
import { ModelSwitchTimelineEntry } from "@/components/workspace/messages/model-switch-timeline-entry";
import type { Message } from "@/core/api/types";
import type { CoworkRoomEntityRef } from "@/core/cowork";
import { useI18n } from "@/core/i18n/hooks";
import { sessionStatusCopy } from "@/core/i18n/locales/session-status";
import { resolveModelContextWindow } from "@/core/models/context-window";
import type { useModels } from "@/core/models/hooks";
import {
  loadModelSwitchEvents,
  recordModelSwitchEvent,
  type ModelSwitchEvent,
} from "@/core/threads/model-switch-events";

import {
  estimateCurrentContextTokens,
  useThreadContextSegments,
  type CompactableThread,
} from "./page-utils";
import type {
  CollabSessionQuery,
  RealtimeThread,
  RealtimeTranslations,
} from "./realtime-page-types";

/** Model switches recorded in this thread, rendered as timeline separators. */
export function useModelSwitchTimeline({
  threadId,
  isNewThread,
  messageCount,
}: {
  threadId: string;
  isNewThread: boolean;
  messageCount: number;
}) {
  const [modelSwitchTimeline, setModelSwitchTimeline] = useState<{
    threadId: string;
    events: ModelSwitchEvent[];
  }>(() => ({
    threadId,
    events: loadModelSwitchEvents(threadId),
  }));
  useEffect(() => {
    setModelSwitchTimeline({
      threadId,
      events: loadModelSwitchEvents(threadId),
    });
  }, [threadId]);
  const modelSwitchTimelineEntries = useMemo<MessageListTimelineEntry[]>(() => {
    const visibleEvents =
      modelSwitchTimeline.threadId === threadId
        ? modelSwitchTimeline.events
        : [];
    return visibleEvents.map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      content: <ModelSwitchTimelineEntry modelName={event.modelName} />,
    }));
  }, [modelSwitchTimeline, threadId]);
  const handleModelSwitchNotice = useCallback(
    (modelName: string) => {
      if (
        isNewThread ||
        !threadId ||
        threadId === "new" ||
        messageCount === 0
      ) {
        return;
      }
      setModelSwitchTimeline((current) => {
        const currentEvents =
          current.threadId === threadId
            ? current.events
            : loadModelSwitchEvents(threadId);
        return {
          threadId,
          events: recordModelSwitchEvent(threadId, currentEvents, {
            modelName,
            afterMessageCount: messageCount,
          }),
        };
      });
    },
    [isNewThread, messageCount, threadId],
  );
  return { modelSwitchTimelineEntries, handleModelSwitchNotice };
}

/** Linked-room messages and model switches interleaved into the conversation. */
export function useConversationTimelineEntries({
  collabSessionQuery,
  loadedItemIds,
  messages,
  currentInviteActor,
  roomTimelineMessageActions,
  openProjectWorkbenchForEntity,
  modelSwitchTimelineEntries,
}: {
  collabSessionQuery: CollabSessionQuery;
  loadedItemIds: string[] | undefined;
  messages: Message[];
  currentInviteActor: string;
  roomTimelineMessageActions: ComponentProps<
    typeof CoworkRoomTimelineEntry
  >["messageActions"];
  openProjectWorkbenchForEntity: (entity?: CoworkRoomEntityRef) => void;
  modelSwitchTimelineEntries: MessageListTimelineEntry[];
}) {
  const visibleRoomMessages = useMemo(
    () =>
      dedupeCoworkRoomMessages(
        collabSessionQuery.data?.room_messages ?? [],
        loadedItemIds ?? messages.map(message => message.id).filter((id): id is string => Boolean(id)),
      ),
    [collabSessionQuery.data?.room_messages, loadedItemIds, messages],
  );
  const roomTimelineEntries = useMemo(
    () =>
      visibleRoomMessages.map((message) => ({
        id: `${message.room_id ?? collabSessionQuery.data?.room_id ?? "room"}:${message.seq}`,
        createdAt: message.ts,
        content: (
          <CoworkRoomTimelineEntry
            message={message}
            participants={collabSessionQuery.data?.room_participants ?? []}
            currentParticipantId={currentInviteActor}
            messageActions={roomTimelineMessageActions}
            onEntityClick={openProjectWorkbenchForEntity}
            className="my-1"
          />
        ),
      })),
    [
      collabSessionQuery.data?.room_id,
      collabSessionQuery.data?.room_participants,
      currentInviteActor,
      openProjectWorkbenchForEntity,
      roomTimelineMessageActions,
      visibleRoomMessages,
    ],
  );
  return useMemo<MessageListTimelineEntry[]>(
    () => [...roomTimelineEntries, ...modelSwitchTimelineEntries], [modelSwitchTimelineEntries, roomTimelineEntries],
  );
}

/** Context-window size, usage estimate, segments and manual compaction. */
export function useContextWindow({
  threadId,
  isNewThread,
  thread,
  models,
  modelName,
  t,
}: {
  threadId: string;
  /** A pending id the server has not created yet; nothing to measure. */
  isNewThread: boolean;
  thread: RealtimeThread;
  models: ReturnType<typeof useModels>["models"];
  modelName: string | undefined;
  t: RealtimeTranslations;
}) {
  const [isCompressingContext, setIsCompressingContext] = useState(false);
  const selectedModel = useMemo(() => {
    return (
      models.find(
        (model) =>
          model.selection_id === modelName ||
          model.name === modelName ||
          model.id === modelName ||
          model.model === modelName,
      ) ?? models[0]
    );
  }, [models, modelName]);
  const maxContextTokens = useMemo(() => resolveModelContextWindow(selectedModel), [selectedModel]);
  const { segments: contextSegments, measured: contextMeasured } = useThreadContextSegments(isNewThread ? null : threadId, thread.messages, thread.lastTurnStatus, t);
  const turnCount = useMemo(() => thread.messages.filter((message) => message.type === "human").length, [thread.messages]);
  // The visible-message estimate misses the system prompt and tools; a
  // measured breakdown counts them, so the total never trails its own bar.
  const contextTokens = useMemo(
    () =>
      Math.max(
        estimateCurrentContextTokens(thread.messages),
        contextSegments.reduce((sum, segment) => sum + segment.tokens, 0),
      ),
    [contextSegments, thread.messages],
  );
  // "auto" (or nothing) routes per turn, so no single model name is true.
  const modelLabel =
    !modelName || modelName === "auto"
      ? null
      : (models.find((model) => model.selection_id === modelName || model.name === modelName || model.id === modelName)?.display_name ?? modelName);
  const compactThread = (thread as typeof thread & CompactableThread).compact;
  const compressCopy = sessionStatusCopy(useI18n().locale);
  const handleCompressContext = useCallback(async () => {
    if (!compactThread || isCompressingContext) {
      if (!compactThread) {
        toast.error(compressCopy.compressUnavailable);
      }
      return;
    }
    setIsCompressingContext(true);
    try {
      const result = await compactThread();
      if (result.compacted) {
        toast.success(
          t.contextCompressor?.autoCompressed ?? "Context compressed",
        );
        return;
      }
      const kept =
        result.keepRecent != null && result.turnCount != null
          ? compressCopy.tooFewTurns(result.turnCount, result.keepRecent)
          : compressCopy.nothingToCompress;
      toast.message(
        t.contextCompressor?.compressContext ?? "Compress context",
        {
          description:
            result.reason === "below_keep_recent"
              ? kept
              : (result.reason ?? kept),
        },
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : compressCopy.compressFailed,
      );
    } finally {
      setIsCompressingContext(false);
    }
  }, [compactThread, compressCopy, isCompressingContext, t.contextCompressor]);
  // The header status menu's 上下文 section, as one stable object.
  const sessionContext = useMemo<SessionContextStatus>(
    () => ({
      contextTokens,
      maxContextTokens,
      contextSegments,
      isCompressingContext,
      onCompressContext: handleCompressContext,
      modelLabel,
      turnCount,
      measured: contextMeasured,
    }),
    [contextMeasured, contextSegments, contextTokens, handleCompressContext, isCompressingContext, maxContextTokens, modelLabel, turnCount],
  );
  return {
    isCompressingContext,
    maxContextTokens,
    contextTokens,
    contextSegments,
    sessionContext,
    handleCompressContext,
  };
}
