import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { swallow } from "@/core/utils/log";
import { getToken } from "@/core/auth/api";
import { openAuthenticatedWebSocket } from "@/core/auth/websocket";
import { getBackendWebSocketBaseURL } from "@/core/config";
import { readOrCreateTeamParticipantId } from "@/core/teams";
import { eventBus } from "@/core/events";
import { teamTaskQueryKeys } from "@/core/team-tasks/hooks";
import type { TeamTask } from "@/core/team-tasks/types";
import { looseBody } from "@/core/api/response";
import type {
  CoworkMessageReaction,
  CoworkPinnedMessage,
  CoworkRoomReplyReference,
} from "@/core/cowork/types";
import { isCoworkRoomReplyReference } from "@/core/cowork/guards";
import {
  getCollabAnnotations,
  getCollabMessageReactions,
  getCollabPinnedMessages,
} from "@/core/cowork/api";

import {
  createClientMessageId,
  readRoomOutbox,
  enqueueRoomOutbox,
  removeRoomOutboxMessage,
  upsertRoomMessage,
  upsertRoomMessageReceipt,
  markRoomMessageFailed,
  type RoomMessage,
  type RoomMessageReceipt,
} from "./room-message-state";
export {
  upsertRoomMessage,
  upsertRoomMessageReceipt,
} from "./room-message-state";
export type { RoomMessage, RoomMessageReceipt } from "./room-message-state";

import { useRoomTranscript } from "./use-room-transcript";
import {
  DEFAULT_FLOOR,
  appendTaskProgressEvent,
  colorFor,
  floorFrom,
  isRecord,
  mergeTaskIntoList,
  parseMessage,
  parseTaskProgressEvent,
  participantToUser,
  removeTaskFromList,
  teamHasRemovedParticipant,
} from "./collab-protocol";
import type {
  Annotation,
  CollabContextType,
  FloorState,
  TeamTaskProgressEvent,
  User,
} from "./collab-types";
export type {
  Annotation,
  AnnotationAuthor,
  AnnotationReply,
  FloorState,
  TeamTaskProgressEvent,
  User,
} from "./collab-types";
import { useCollabAnnotationActions } from "./use-collab-annotation-actions";

interface CollabProviderProps {
  canWrite?: boolean;
  children: ReactNode;
  teamId?: string | null;
  threadId?: string | null;
  participantId?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  autoConnect?: boolean;
}

const CollabContext = createContext<CollabContextType | null>(null);

export function CollabProvider({
  canWrite = true,
  children,
  teamId,
  threadId,
  participantId,
  displayName,
  avatar,
  autoConnect = true,
}: CollabProviderProps) {
  const resolvedParticipantId = useMemo(
    () => participantId || readOrCreateTeamParticipantId(),
    [participantId],
  );
  const resolvedDisplayName = displayName?.trim() || "You";
  const normalizedThreadId = useMemo(() => {
    const value = threadId?.trim();
    return value && value !== "new" ? value : "";
  }, [threadId]);
  const wsRef = useRef<WebSocket | null>(null);
  const serverParticipantId = useRef(resolvedParticipantId);
  const getParticipantId = useCallback(() => serverParticipantId.current, []);
  const reconnectTimerRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);
  const queryClient = useQueryClient();
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>([]);
  const [messageReceipts, setMessageReceipts] = useState<RoomMessageReceipt[]>(
    [],
  );
  const [taskEvents, setTaskEvents] = useState<TeamTaskProgressEvent[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [messageReactions, setMessageReactions] = useState<
    CoworkMessageReaction[]
  >([]);
  const [pinnedMessages, setPinnedMessages] = useState<CoworkPinnedMessage[]>(
    [],
  );
  const [floor, setFloor] = useState<FloorState>(DEFAULT_FLOOR);

  const localUser = useMemo<User>(
    () => ({
      id: resolvedParticipantId,
      name: resolvedDisplayName,
      avatar: avatar ?? undefined,
      color: colorFor(resolvedParticipantId),
    }),
    [avatar, resolvedDisplayName, resolvedParticipantId],
  );

  useEffect(() => {
    serverParticipantId.current = resolvedParticipantId;
    setTaskEvents([]);
    setRoomMessages([]);
    setMessageReceipts([]);
    setFloor(DEFAULT_FLOOR);
  }, [teamId, resolvedParticipantId]);

  useEffect(() => {
    if (!teamId || !normalizedThreadId) {
      setAnnotations([]);
      setMessageReactions([]);
      setPinnedMessages([]);
      return;
    }
    let disposed = false;
    void getCollabAnnotations(normalizedThreadId)
      .then((next) => {
        if (!disposed) setAnnotations(next);
      })
      .catch((error) => {
        if (!disposed) swallow(error, "load-collaboration-annotations");
      });
    void getCollabMessageReactions(normalizedThreadId)
      .then((next) => {
        if (!disposed) setMessageReactions(next);
      })
      .catch((error) => {
        if (!disposed) swallow(error, "load-collaboration-message-reactions");
      });
    void getCollabPinnedMessages(normalizedThreadId)
      .then((next) => {
        if (!disposed) setPinnedMessages(next);
      })
      .catch((error) => {
        if (!disposed) swallow(error, "load-collaboration-pinned-messages");
      });
    return () => {
      disposed = true;
    };
  }, [normalizedThreadId, teamId, isConnected]);

  const recoverTranscript = useRoomTranscript({
    teamId,
    participantId: resolvedParticipantId,
    threadId: normalizedThreadId,
    displayName: localUser.name,
    setMessages: setRoomMessages,
    setReceipts: setMessageReceipts,
    getParticipantId,
  });

  const notifyRemoved = useCallback(
    (_reason = "removed") => {
      if (!teamId || typeof window === "undefined") return;
      eventBus.emit("team:removed", { teamId });
    },
    [teamId],
  );

  const closeSocket = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (!teamId || !autoConnect || typeof window === "undefined") {
      setCurrentUser(localUser);
      setUsers(localUser ? [localUser] : []);
      return;
    }

    shouldReconnectRef.current = true;
    let disposed = false;

    const connect = () => {
      if (disposed || !shouldReconnectRef.current) return;
      const wsBase = getBackendWebSocketBaseURL();
      const params = new URLSearchParams({
        participant_id: resolvedParticipantId,
        display_name: resolvedDisplayName,
      });
      if (normalizedThreadId) {
        params.set("thread_id", normalizedThreadId);
      }
      const socket = openAuthenticatedWebSocket(
        `${wsBase}/api/teams/${encodeURIComponent(teamId)}/ws?${params.toString()}`,
        getToken(),
      );
      wsRef.current = socket;

      socket.onopen = () => {
        if (disposed) return;
        setIsConnected(true);
        setCurrentUser(localUser);
        for (const queued of readRoomOutbox(teamId, resolvedParticipantId)) {
          try {
            socket.send(
              JSON.stringify({
                type: "message",
                text: queued.text,
                client_message_id: queued.client_message_id,
                ...(queued.on_behalf_of
                  ? { on_behalf_of: queued.on_behalf_of }
                  : {}),
                ...(queued.thread_id ? { thread_id: queued.thread_id } : {}),
                ...(queued.reply_to ? { reply_to: queued.reply_to } : {}),
              }),
            );
          } catch {
            break;
          }
        }
      };
      socket.onmessage = (event) => {
        if (disposed) return;
        const msg = parseMessage(event.data);
        if (!msg) return;
        if (
          msg.type === "ready" &&
          isRecord(msg.participant) &&
          typeof msg.participant.id === "string"
        ) {
          serverParticipantId.current = msg.participant.id;
          setRoomMessages((messages) =>
            messages.map((message) =>
              !message.seq && !message.on_behalf_of
                ? { ...message, participant_id: getParticipantId() }
                : message,
            ),
          );
        }
        recoverTranscript(msg);
        if (msg.type === "error") {
          const message = String(msg.message ?? "");
          const clientMessageId = String(msg.client_message_id ?? "");
          if (clientMessageId) {
            setRoomMessages((prev) =>
              markRoomMessageFailed(prev, clientMessageId, message),
            );
            if (msg.retryable !== true) {
              removeRoomOutboxMessage(
                teamId,
                resolvedParticipantId,
                clientMessageId,
              );
            }
          }
          if (message.includes("participant removed")) {
            shouldReconnectRef.current = false;
            notifyRemoved("removed");
            socket.close(4403);
          } else if (
            msg.code === "speech_denied" ||
            msg.code === "delegation_denied" ||
            msg.code === "not_moderator"
          ) {
            // The room rejected this send (muted / not your turn / not the
            // moderator / not authorized to speak for someone). Surface it.
            toast.error(message || "You can't speak right now");
          }
        } else if (msg.type === "message:error") {
          const clientMessageId = String(msg.client_message_id ?? "");
          if (clientMessageId) {
            setRoomMessages((prev) =>
              markRoomMessageFailed(
                prev,
                clientMessageId,
                String(msg.message ?? "Message was not saved"),
              ),
            );
            if (msg.retryable !== true) {
              removeRoomOutboxMessage(
                teamId,
                resolvedParticipantId,
                clientMessageId,
              );
            }
          }
        } else if (msg.type === "floor") {
          setFloor(floorFrom(msg));
        } else if (msg.type === "ready" && msg.participant) {
          setCurrentUser(participantToUser(msg.participant, avatar));
          if (isRecord(msg.team)) setFloor(floorFrom(msg.team));
        } else if (msg.type === "presence" && Array.isArray(msg.participants)) {
          setUsers(msg.participants.map((p) => participantToUser(p)));
        } else if (msg.type === "message:receipt") {
          const status = msg.status === "read" ? "read" : "delivered";
          const receipt: RoomMessageReceipt = {
            room_id: String(msg.room_id ?? teamId ?? ""),
            message_id: String(msg.message_id ?? ""),
            participant_id: String(msg.participant_id ?? ""),
            status,
            seq: Number.isFinite(Number(msg.seq)) ? Number(msg.seq) : null,
            updated_at: String(msg.updated_at ?? new Date().toISOString()),
          };
          if (!receipt.message_id || !receipt.participant_id) return;
          setMessageReceipts((prev) => upsertRoomMessageReceipt(prev, receipt));
          if (receipt.participant_id === resolvedParticipantId) {
            setRoomMessages((prev) =>
              prev.map((message) =>
                message.message_id === receipt.message_id
                  ? {
                      ...message,
                      delivery_status:
                        receipt.status === "read" ? "read" : "delivered",
                    }
                  : message,
              ),
            );
          }
        } else if (msg.type === "message" && typeof msg.text === "string") {
          const incomingThreadId =
            typeof msg.thread_id === "string" ? msg.thread_id : "";
          if (normalizedThreadId && incomingThreadId !== normalizedThreadId) {
            return;
          }
          const text = msg.text;
          const clientMessageId = String(msg.client_message_id ?? "");
          if (
            clientMessageId &&
            readRoomOutbox(teamId, resolvedParticipantId).some(
              (item) =>
                item.client_message_id === clientMessageId &&
                (item.on_behalf_of || getParticipantId()) ===
                  String(msg.participant_id ?? ""),
            )
          ) {
            removeRoomOutboxMessage(
              teamId,
              resolvedParticipantId,
              clientMessageId,
            );
          }
          setRoomMessages((prev) =>
            upsertRoomMessage(prev, {
              message_id: String(msg.message_id ?? `room-msg-${Date.now()}`),
              client_message_id: clientMessageId || undefined,
              seq: Number.isFinite(Number(msg.seq))
                ? Number(msg.seq)
                : undefined,
              session_seq: Number.isSafeInteger(msg.session_seq)
                ? Number(msg.session_seq)
                : undefined,
              cursor_epoch:
                typeof msg.cursor_epoch === "string"
                  ? msg.cursor_epoch
                  : undefined,
              thread_id: incomingThreadId || undefined,
              participant_id: String(msg.participant_id ?? ""),
              display_name: String(msg.display_name ?? "Guest"),
              reply_to: isRecord(msg.reply_to)
                ? looseBody(msg.reply_to, isCoworkRoomReplyReference)
                : undefined,
              text,
              created_at: String(msg.created_at ?? new Date().toISOString()),
              delivery_status: "sent",
            }),
          );
          if (
            clientMessageId &&
            String(msg.participant_id ?? "") !== resolvedParticipantId &&
            wsRef.current?.readyState === WebSocket.OPEN
          ) {
            try {
              wsRef.current.send(
                JSON.stringify({
                  type: "message:delivered",
                  message_id: String(msg.message_id ?? ""),
                  seq: Number.isFinite(Number(msg.seq))
                    ? Number(msg.seq)
                    : undefined,
                }),
              );
            } catch {
              // Delivery receipts are best-effort; reconnect catch-up remains
              // authoritative for the message itself.
            }
          }
        } else if (msg.type === "thread:update") {
          const incomingThreadId =
            typeof msg.thread_id === "string" ? msg.thread_id : "";
          if (normalizedThreadId && incomingThreadId !== normalizedThreadId) {
            return;
          }
          const senderId = String(msg.participant_id ?? "");
          if (senderId === resolvedParticipantId) return;
          // Durable room writes can originate from HTTP or another realtime
          // connection without a live room-message frame. Refetch the shared
          // timeline even when this browser is in the background.
          void queryClient.invalidateQueries({
            queryKey: ["cowork", "session", normalizedThreadId],
          });
          if (msg.reason === "annotation" && normalizedThreadId) {
            void getCollabAnnotations(normalizedThreadId)
              .then((next) => {
                if (!disposed) setAnnotations(next);
              })
              .catch((error) =>
                swallow(error, "refresh-collaboration-annotations"),
              );
          }
          if (msg.reason === "reaction" && normalizedThreadId) {
            void getCollabMessageReactions(normalizedThreadId)
              .then((next) => {
                if (!disposed) setMessageReactions(next);
              })
              .catch((error) =>
                swallow(error, "refresh-collaboration-message-reactions"),
              );
          }
          if (msg.reason === "pin" && normalizedThreadId) {
            void getCollabPinnedMessages(normalizedThreadId)
              .then((next) => {
                if (!disposed) setPinnedMessages(next);
              })
              .catch((error) =>
                swallow(error, "refresh-collaboration-pinned-messages"),
              );
          }
          window.dispatchEvent(
            new CustomEvent("echo:team-thread-update", {
              detail: {
                teamId,
                threadId: incomingThreadId,
                participantId: senderId,
                reason: String(msg.reason ?? "updated"),
              },
            }),
          );
        } else if (msg.type === "team:update" && msg.team) {
          eventBus.emit("team:room-updated", { roomId: teamId ?? "" });
          if (isRecord(msg.team)) setFloor(floorFrom(msg.team));
          if (teamHasRemovedParticipant(msg.team, resolvedParticipantId)) {
            shouldReconnectRef.current = false;
            notifyRemoved("removed");
            socket.close(4403);
          }
        } else if (msg.type === "task:progress") {
          const taskEvent = parseTaskProgressEvent(msg, teamId);
          if (!taskEvent) return;
          setTaskEvents((prev) => appendTaskProgressEvent(prev, taskEvent));
          if (taskEvent.event === "task_deleted") {
            queryClient.setQueryData<TeamTask[]>(
              teamTaskQueryKeys.byRoom(taskEvent.room_id),
              (current) => removeTaskFromList(current, taskEvent.task_id),
            );
            void queryClient.invalidateQueries({
              queryKey: teamTaskQueryKeys.byRoom(taskEvent.room_id),
            });
          } else if (taskEvent.task) {
            queryClient.setQueryData<TeamTask[]>(
              teamTaskQueryKeys.byRoom(taskEvent.room_id),
              (current) => mergeTaskIntoList(current, taskEvent.task!),
            );
            void queryClient.invalidateQueries({
              queryKey: teamTaskQueryKeys.byRoom(taskEvent.room_id),
            });
          }
        }
      };
      socket.onclose = (event) => {
        if (disposed) return;
        setIsConnected(false);
        setRoomMessages((prev) =>
          prev.map((message) =>
            message.delivery_status === "sending"
              ? {
                  ...message,
                  delivery_status: "failed",
                  error: "Connection lost before the message was confirmed",
                }
              : message,
          ),
        );
        if (event.code === 4403) {
          shouldReconnectRef.current = false;
          notifyRemoved("removed");
          return;
        }
        if (shouldReconnectRef.current) {
          reconnectTimerRef.current = window.setTimeout(connect, 1500);
        }
      };
      socket.onerror = () => {
        setIsConnected(false);
      };
    };

    connect();

    return () => {
      disposed = true;
      closeSocket();
    };
  }, [
    autoConnect,
    avatar,
    closeSocket,
    localUser,
    normalizedThreadId,
    notifyRemoved,
    queryClient,
    resolvedDisplayName,
    resolvedParticipantId,
    teamId,
    recoverTranscript,
    getParticipantId,
  ]);

  useEffect(() => {
    if (!isConnected) return;
    const timer = window.setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "presence:ping" }));
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [isConnected]);

  const join = useCallback((user: User) => {
    setCurrentUser(user);
    setUsers((prev) => [user, ...prev.filter((u) => u.id !== user.id)]);
    setIsConnected(true);
  }, []);

  const leave = useCallback(() => {
    closeSocket();
    setUsers((prev) => prev.filter((u) => u.id !== currentUser?.id));
    setCurrentUser(null);
  }, [closeSocket, currentUser?.id]);

  const sendJson = useCallback((payload: Record<string, unknown>): boolean => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return false;
    try {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }, []);

  const updateCursor = useCallback(
    (position: { x: number; y: number }) => {
      sendJson({
        type: "cursor",
        position,
        ...(normalizedThreadId ? { thread_id: normalizedThreadId } : {}),
      });
    },
    [normalizedThreadId, sendJson],
  );

  const sendRoomMessage = useCallback(
    (
      text: string,
      onBehalfOf?: string,
      replyTo?: CoworkRoomReplyReference | null,
    ) => {
      const clean = text.trim();
      if (!clean) return null;
      const clientMessageId = createClientMessageId();
      const localMessage: RoomMessage = {
        message_id: `local:${clientMessageId}`,
        client_message_id: clientMessageId,
        thread_id: normalizedThreadId || undefined,
        participant_id: onBehalfOf || getParticipantId(),
        display_name: onBehalfOf ? "Pending" : localUser.name,
        on_behalf_of: onBehalfOf,
        reply_to: replyTo ?? undefined,
        text: clean,
        created_at: new Date().toISOString(),
        delivery_status: "sending",
      };
      enqueueRoomOutbox(teamId, resolvedParticipantId, {
        client_message_id: clientMessageId,
        thread_id: normalizedThreadId || undefined,
        on_behalf_of: onBehalfOf,
        text: clean,
        reply_to: replyTo ?? undefined,
      });
      setRoomMessages((prev) => upsertRoomMessage(prev, localMessage));
      const sent = sendJson({
        type: "message",
        text: clean,
        client_message_id: clientMessageId,
        ...(onBehalfOf ? { on_behalf_of: onBehalfOf } : {}),
        ...(normalizedThreadId ? { thread_id: normalizedThreadId } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      });
      if (!sent) {
        setRoomMessages((prev) =>
          markRoomMessageFailed(prev, clientMessageId, "Not connected"),
        );
      }
      return clientMessageId;
    },
    [
      localUser,
      normalizedThreadId,
      resolvedParticipantId,
      sendJson,
      teamId,
      getParticipantId,
    ],
  );

  const retryRoomMessage = useCallback(
    (messageId: string) => {
      const pending = roomMessages.find(
        (message) =>
          message.message_id === messageId ||
          message.client_message_id === messageId,
      );
      if (!pending?.client_message_id || pending.delivery_status !== "failed") {
        return false;
      }
      setRoomMessages((prev) =>
        prev.map((message) =>
          message.client_message_id === pending.client_message_id
            ? { ...message, delivery_status: "sending", error: undefined }
            : message,
        ),
      );
      const sent = sendJson({
        type: "message",
        text: pending.text,
        client_message_id: pending.client_message_id,
        ...(pending.on_behalf_of ? { on_behalf_of: pending.on_behalf_of } : {}),
        ...(pending.thread_id ? { thread_id: pending.thread_id } : {}),
        ...(pending.reply_to ? { reply_to: pending.reply_to } : {}),
      });
      if (!sent) {
        setRoomMessages((prev) =>
          markRoomMessageFailed(
            prev,
            pending.client_message_id!,
            "Not connected",
          ),
        );
      }
      return sent;
    },
    [roomMessages, sendJson],
  );

  const markRoomMessageRead = useCallback(
    (messageId: string, seq?: number) => {
      const cleanId = messageId.trim();
      if (!cleanId) return false;
      const sent = sendJson({
        type: "message:read",
        message_id: cleanId,
        ...(seq != null ? { seq } : {}),
      });
      if (sent) {
        setMessageReceipts((prev) =>
          upsertRoomMessageReceipt(prev, {
            room_id: teamId ?? "",
            message_id: cleanId,
            participant_id: resolvedParticipantId,
            status: "read",
            seq: seq ?? null,
            updated_at: new Date().toISOString(),
          }),
        );
        setRoomMessages((prev) =>
          prev.map((message) =>
            message.message_id === cleanId
              ? { ...message, delivery_status: "read" }
              : message,
          ),
        );
      }
      return sent;
    },
    [resolvedParticipantId, sendJson, teamId],
  );

  const raiseHand = useCallback(() => {
    sendJson({ type: "floor:request" });
  }, [sendJson]);

  const yieldFloor = useCallback(() => {
    sendJson({ type: "floor:yield" });
  }, [sendJson]);

  const grantFloor = useCallback(
    (targetId: string | null) => {
      sendJson({ type: "floor:grant", target: targetId ?? "" });
    },
    [sendJson],
  );

  const notifyThreadUpdate = useCallback(
    (reason = "updated") => {
      if (!normalizedThreadId) return;
      sendJson({
        type: "thread:update",
        thread_id: normalizedThreadId,
        reason,
      });
    },
    [normalizedThreadId, sendJson],
  );

  const {
    addAnnotation,
    toggleMessageReaction,
    togglePinnedMessage,
    resolveAnnotation,
    unresolveAnnotation,
    deleteAnnotation,
    replyToAnnotation,
  } = useCollabAnnotationActions({
    normalizedThreadId,
    currentUser,
    queryClient,
    notifyThreadUpdate,
    setAnnotations,
    setMessageReactions,
    setPinnedMessages,
  });

  return (
    <CollabContext.Provider
      value={{
        canWrite,
        users,
        currentUser,
        isConnected,
        roomMessages,
        messageReceipts,
        taskEvents,
        floor,
        raiseHand,
        yieldFloor,
        grantFloor,
        join,
        leave,
        updateCursor,
        sendRoomMessage,
        retryRoomMessage,
        markRoomMessageRead,
        notifyThreadUpdate,
        annotations,
        messageReactions,
        pinnedMessages,
        toggleMessageReaction,
        togglePinnedMessage,
        addAnnotation,
        resolveAnnotation,
        unresolveAnnotation,
        deleteAnnotation,
        replyToAnnotation,
      }}
    >
      {children}
    </CollabContext.Provider>
  );
}

export function useCollab() {
  const context = useContext(CollabContext);
  if (!context) {
    throw new Error("useCollab must be used within CollabProvider");
  }
  return context;
}

export function useOptionalCollab() {
  return useContext(CollabContext);
}
