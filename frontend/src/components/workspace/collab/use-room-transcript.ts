import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";

import { apiGet } from "@/core/api/request";
import { isObjectLike } from "@/core/utils/guards";
import { isCoworkRoomReplyReference } from "@/core/cowork/guards";
import { swallow } from "@/core/utils/log";
import {
  readRoomOutbox,
  removeRoomOutboxMessage,
  upsertRoomMessage,
  upsertRoomMessageReceipt,
  type RoomMessage,
  type RoomMessageReceipt,
} from "./room-message-state";

type Setter<T> = Dispatch<SetStateAction<T[]>>;

export function decodeTranscriptMessage(
  value: unknown,
  epoch: string,
): RoomMessage | null {
  if (
    !isObjectLike(value) ||
    typeof value.message_id !== "string" ||
    typeof value.text !== "string" ||
    !Number.isSafeInteger(value.seq) ||
    Number(value.seq) < 1
  )
    return null;
  return {
    message_id: value.message_id,
    text: value.text,
    seq: Number(value.seq),
    cursor_epoch: epoch,
    session_seq: Number.isSafeInteger(value.session_seq)
      ? Number(value.session_seq)
      : undefined,
    thread_id:
      typeof value.session_id === "string" ? value.session_id : undefined,
    client_message_id:
      typeof value.client_message_id === "string"
        ? value.client_message_id
        : undefined,
    participant_id:
      typeof value.participant_id === "string" ? value.participant_id : "",
    display_name:
      typeof value.display_name === "string" ? value.display_name : "Guest",
    reply_to: isCoworkRoomReplyReference(value.reply_to)
      ? value.reply_to
      : undefined,
    created_at: typeof value.ts === "string" ? value.ts : "",
    delivery_status: "sent",
  };
}

function decodeReceipt(
  value: unknown,
  teamId: string,
): RoomMessageReceipt | null {
  if (
    !isObjectLike(value) ||
    typeof value.message_id !== "string" ||
    typeof value.participant_id !== "string" ||
    (value.status !== "read" && value.status !== "delivered")
  )
    return null;
  return {
    room_id: teamId,
    message_id: value.message_id,
    participant_id: value.participant_id,
    status: value.status,
    seq: Number.isSafeInteger(value.seq) ? Number(value.seq) : null,
    updated_at:
      typeof value.updated_at === "string" ? value.updated_at : undefined,
  };
}

export function useRoomTranscript({
  teamId,
  participantId,
  threadId,
  displayName,
  setMessages,
  setReceipts,
  getParticipantId,
}: {
  teamId?: string | null;
  participantId: string;
  threadId: string;
  displayName: string;
  setMessages: Setter<RoomMessage>;
  setReceipts: Setter<RoomMessageReceipt>;
  getParticipantId?: () => string;
}) {
  const scope = `${teamId}\0${participantId}\0${threadId}`;
  const state = useRef({ scope, epoch: "", cursor: 0, generation: 0 });

  useEffect(() => {
    state.current = {
      scope,
      epoch: "",
      cursor: 0,
      generation: state.current.generation + 1,
    };
    setReceipts([]);
    setMessages(
      readRoomOutbox(teamId, participantId).map((item) => ({
        message_id: `local:${item.client_message_id}`,
        client_message_id: item.client_message_id,
        thread_id: item.thread_id,
        participant_id: item.on_behalf_of || participantId,
        display_name: item.on_behalf_of ? "Pending" : displayName,
        on_behalf_of: item.on_behalf_of,
        reply_to: item.reply_to,
        text: item.text,
        created_at: item.created_at,
        delivery_status: "sending",
      })),
    );
    return () => {
      state.current.generation++;
    };
  }, [scope, teamId, participantId, displayName, setMessages, setReceipts]);

  return useCallback(
    (event: Record<string, unknown>) => {
      if (!teamId || state.current.scope !== scope) return;
      const eventEpoch =
        typeof event.cursor_epoch === "string"
          ? event.cursor_epoch
          : event.type === "thread:update"
            ? state.current.epoch
            : "";
      if (!eventEpoch) return;
      const changed = eventEpoch !== state.current.epoch;
      if (changed) {
        state.current.epoch = eventEpoch;
        state.current.cursor = 0;
        setMessages((messages) =>
          messages.filter((m) => m.message_id.startsWith("local:")),
        );
        setReceipts([]);
      }
      if (event.type !== "ready" && !changed && event.type !== "thread:update")
        return;
      const generation = ++state.current.generation;
      const active = () =>
        state.current.scope === scope &&
        state.current.generation === generation;
      void (async () => {
        let cursor = state.current.cursor;
        let epoch = state.current.epoch;
        do {
          const page: unknown = await apiGet("/api/teams/{team_id}/messages", {
            path: { team_id: teamId },
            query: { limit: 200, after_seq: cursor, cursor_epoch: epoch },
          });
          if (!active()) return;
          if (
            !isObjectLike(page) ||
            !Array.isArray(page.messages) ||
            typeof page.cursor_epoch !== "string" ||
            !Number.isSafeInteger(page.next_after_seq)
          )
            throw new Error("Invalid Room transcript page");
          if (page.cursor_reset === true || page.cursor_epoch !== epoch) {
            setMessages((messages) =>
              messages.filter((m) => m.message_id.startsWith("local:")),
            );
            setReceipts([]);
          }
          epoch = page.cursor_epoch;
          const messages = page.messages
            .map((item) => decodeTranscriptMessage(item, epoch))
            .filter((item): item is RoomMessage => item !== null);
          const queued = readRoomOutbox(teamId, participantId);
          for (const message of messages) {
            if (
              message.client_message_id &&
              queued.some(
                (item) =>
                  item.client_message_id === message.client_message_id &&
                  (item.on_behalf_of ||
                    getParticipantId?.() ||
                    participantId) === message.participant_id,
              )
            ) {
              removeRoomOutboxMessage(
                teamId,
                participantId,
                message.client_message_id,
              );
            }
          }
          setMessages((current) => messages.reduce(upsertRoomMessage, current));
          const receipts = page.messages
            .flatMap((item) =>
              isObjectLike(item) && Array.isArray(item.receipts)
                ? item.receipts
                : [],
            )
            .map((item) => decodeReceipt(item, teamId))
            .filter((item): item is RoomMessageReceipt => item !== null);
          setReceipts((current) =>
            receipts.reduce(upsertRoomMessageReceipt, current),
          );
          const next = Number(page.next_after_seq);
          if (page.has_more === true && next <= cursor)
            throw new Error("Room cursor did not advance");
          cursor = next;
          state.current.epoch = epoch;
          state.current.cursor = cursor;
          if (page.has_more !== true) return;
        } while (active());
      })().catch((error) => {
        if (active()) swallow(error, "recover-room-transcript");
      });
    },
    [scope, teamId, participantId, setMessages, setReceipts, getParticipantId],
  );
}
