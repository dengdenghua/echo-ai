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
import { ModelSwitchTimelineEntry } from "@/components/workspace/messages/model-switch-timeline-entry";
import type { Message } from "@/core/api/types";
import type { CoworkRoomEntityRef } from "@/core/cowork";
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
  thread,
  models,
  modelName,
  t,
}: {
  threadId: string;
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
  const contextTokens = useMemo(() => estimateCurrentContextTokens(thread.messages), [thread.messages]);
  const contextSegments = useThreadContextSegments(threadId, thread.messages, thread.lastTurnStatus, t);
  const compactThread = (thread as typeof thread & CompactableThread).compact;
  const handleCompressContext = useCallback(async () => {
    if (!compactThread || isCompressingContext) {
      if (!compactThread) {
        toast.error("Context compression is not available for this thread");
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
          ? `Only ${result.turnCount} turns; keeping the latest ${result.keepRecent}.`
          : "Nothing to compress yet.";
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
        err instanceof Error ? err.message : "Failed to compress context",
      );
    } finally {
      setIsCompressingContext(false);
    }
  }, [compactThread, isCompressingContext, t.contextCompressor]);
  return {
    isCompressingContext,
    maxContextTokens,
    contextTokens,
    contextSegments,
    handleCompressContext,
  };
}
