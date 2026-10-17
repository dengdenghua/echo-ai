// CollabProvider's message-annotation, reaction and pin mutations. Each
// writes through the cowork API, folds the result into the provider's
// state, and tells the room via ``notifyThreadUpdate`` so peers refetch.

import {
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { QueryClient } from "@tanstack/react-query";

import type {
  CoworkMessageReaction,
  CoworkPinnedMessage,
} from "@/core/cowork/types";
import {
  createCollabAnnotation,
  createCollabAnnotationReply,
  deleteCollabAnnotation,
  setCollabAnnotationResolved,
  toggleCollabMessageReaction,
  toggleCollabPinnedMessage,
} from "@/core/cowork/api";

import { avatarHex } from "./collab-protocol";
import type { Annotation, AnnotationAuthor, User } from "./collab-types";

export function useCollabAnnotationActions({
  normalizedThreadId,
  currentUser,
  queryClient,
  notifyThreadUpdate,
  setAnnotations,
  setMessageReactions,
  setPinnedMessages,
}: {
  normalizedThreadId: string;
  currentUser: User | null;
  queryClient: QueryClient;
  notifyThreadUpdate: (reason?: string) => void;
  setAnnotations: Dispatch<SetStateAction<Annotation[]>>;
  setMessageReactions: Dispatch<SetStateAction<CoworkMessageReaction[]>>;
  setPinnedMessages: Dispatch<SetStateAction<CoworkPinnedMessage[]>>;
}) {
  const author = useMemo<AnnotationAuthor | null>(
    () =>
      currentUser
        ? {
            display_name: currentUser.name,
            avatar_color: avatarHex(currentUser.id),
          }
        : null,
    [currentUser],
  );

  const addAnnotation = useCallback(
    async (messageId: string, body: string) => {
      if (!normalizedThreadId) throw new Error("请先创建协作会话");
      const annotation = await createCollabAnnotation(normalizedThreadId, {
        message_id: messageId,
        body,
        display_name: author?.display_name,
        avatar_color: author?.avatar_color,
      });
      setAnnotations((prev) =>
        prev.some((item) => item.annotation_id === annotation.annotation_id)
          ? prev
          : [...prev, annotation],
      );
      void queryClient.invalidateQueries({
        queryKey: ["cowork", "session", normalizedThreadId],
      });
      notifyThreadUpdate("annotation");
    },
    [
      author,
      normalizedThreadId,
      notifyThreadUpdate,
      queryClient,
      setAnnotations,
    ],
  );

  const toggleMessageReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!normalizedThreadId) throw new Error("请先创建协作会话");
      const reaction = await toggleCollabMessageReaction(normalizedThreadId, {
        message_id: messageId,
        emoji,
      });
      setMessageReactions((previous) => {
        const withoutCurrent = previous.filter(
          (item) =>
            !(
              item.message_id === reaction.message_id &&
              item.emoji === reaction.emoji
            ),
        );
        return reaction.count > 0
          ? [...withoutCurrent, reaction]
          : withoutCurrent;
      });
      notifyThreadUpdate("reaction");
    },
    [normalizedThreadId, notifyThreadUpdate, setMessageReactions],
  );

  const togglePinnedMessage = useCallback(
    async (messageId: string) => {
      if (!normalizedThreadId) throw new Error("请先创建协作会话");
      const pin = await toggleCollabPinnedMessage(
        normalizedThreadId,
        messageId,
      );
      setPinnedMessages((previous) =>
        pin.pinned
          ? [
              ...previous.filter((item) => item.message_id !== pin.message_id),
              {
                message_id: pin.message_id,
                pinned_by: currentUser?.id ?? "",
                created_at: Date.now() / 1000,
              },
            ]
          : previous.filter((item) => item.message_id !== pin.message_id),
      );
      notifyThreadUpdate("pin");
    },
    [
      currentUser?.id,
      normalizedThreadId,
      notifyThreadUpdate,
      setPinnedMessages,
    ],
  );

  const resolveAnnotation = useCallback(
    async (annotationId: string) => {
      if (!normalizedThreadId) throw new Error("请先创建协作会话");
      const annotation = await setCollabAnnotationResolved(
        normalizedThreadId,
        annotationId,
        true,
      );
      setAnnotations((prev) =>
        prev.map((item) =>
          item.annotation_id === annotationId ? annotation : item,
        ),
      );
      notifyThreadUpdate("annotation");
    },
    [normalizedThreadId, notifyThreadUpdate, setAnnotations],
  );

  const unresolveAnnotation = useCallback(
    async (annotationId: string) => {
      if (!normalizedThreadId) throw new Error("请先创建协作会话");
      const annotation = await setCollabAnnotationResolved(
        normalizedThreadId,
        annotationId,
        false,
      );
      setAnnotations((prev) =>
        prev.map((item) =>
          item.annotation_id === annotationId ? annotation : item,
        ),
      );
      notifyThreadUpdate("annotation");
    },
    [normalizedThreadId, notifyThreadUpdate, setAnnotations],
  );

  const deleteAnnotation = useCallback(
    async (annotationId: string) => {
      if (!normalizedThreadId) throw new Error("请先创建协作会话");
      await deleteCollabAnnotation(normalizedThreadId, annotationId);
      setAnnotations((prev) =>
        prev.filter((item) => item.annotation_id !== annotationId),
      );
      notifyThreadUpdate("annotation");
    },
    [normalizedThreadId, notifyThreadUpdate, setAnnotations],
  );

  const replyToAnnotation = useCallback(
    async (annotationId: string, body: string) => {
      if (!normalizedThreadId) throw new Error("请先创建协作会话");
      const { reply } = await createCollabAnnotationReply(
        normalizedThreadId,
        annotationId,
        {
          body,
          display_name: author?.display_name,
          avatar_color: author?.avatar_color,
        },
      );
      setAnnotations((prev) =>
        prev.map((item) =>
          item.annotation_id === annotationId
            ? {
                ...item,
                replies: item.replies.some(
                  (existing) => existing.reply_id === reply.reply_id,
                )
                  ? item.replies
                  : [...item.replies, reply],
              }
            : item,
        ),
      );
      notifyThreadUpdate("annotation");
    },
    [author, normalizedThreadId, notifyThreadUpdate, setAnnotations],
  );

  return {
    addAnnotation,
    toggleMessageReaction,
    togglePinnedMessage,
    resolveAnnotation,
    unresolveAnnotation,
    deleteAnnotation,
    replyToAnnotation,
  };
}
