/**
 * Key-field guards for cowork / collab response bodies. The routes return
 * plain dicts in the OpenAPI snapshot, so ``./api`` narrows them with these
 * through ``looseBody``.
 */
import {
  isArrayOf,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  isUnknownArray,
} from "@/core/utils/guards";

import type { CoworkTrustResponse } from "./trust";
import type {
  CollabRoomMessageResponse,
  CollabRoomResponse,
  CollaborationSession,
  CoworkAnnotation,
  CoworkAnnotationReply,
  CoworkGroupResponse,
  CoworkMessageProjectActionResponse,
  CoworkMessageReaction,
  CoworkPinnedMessage,
  CoworkPresenceResponse,
  CoworkRoomReplyReference,
  CoworkRosterResponse,
  CoworkSearchResponse,
  CoworkState,
} from "./types";

export function isCoworkState(value: unknown): value is CoworkState {
  return (
    isRecord(value) && isUnknownArray(value.roster) && isString(value.mode)
  );
}

export function hasCoworkState(
  value: unknown,
): value is { ok: boolean; state: CoworkState } {
  return isRecord(value) && isCoworkState(value.state);
}

export function isCoworkGroupResponse(
  value: unknown,
): value is CoworkGroupResponse {
  return (
    isRecord(value) &&
    isCoworkState(value.state) &&
    isUnknownArray(value.events)
  );
}

export function isCoworkRosterResponse(
  value: unknown,
): value is CoworkRosterResponse {
  return (
    isRecord(value) &&
    isCoworkState(value.state) &&
    isUnknownArray(value.events)
  );
}

export function isCoworkTrustResponse(
  value: unknown,
): value is CoworkTrustResponse {
  return isRecord(value) && isUnknownArray(value.scores);
}

export function isCoworkSearchResponse(
  value: unknown,
): value is CoworkSearchResponse {
  return isRecord(value) && isUnknownArray(value.hits);
}

export function isCoworkPresenceResponse(
  value: unknown,
): value is CoworkPresenceResponse {
  return isRecord(value) && isUnknownArray(value.members);
}

export function isCollaborationSession(
  value: unknown,
): value is CollaborationSession {
  return (
    isRecord(value) &&
    isString(value.session_id) &&
    isUnknownArray(value.roster) &&
    isUnknownArray(value.room_messages)
  );
}

export function isCollabRoomResponse(
  value: unknown,
): value is CollabRoomResponse {
  return (
    isRecord(value) &&
    isRecord(value.room) &&
    isCollaborationSession(value.session)
  );
}

export function isCollabRoomMessageResponse(
  value: unknown,
): value is CollabRoomMessageResponse {
  return isRecord(value) && isString(value.room_id) && isNumber(value.seq);
}

/** Every field is optional; the ones present must have their wire types. */
export function isCoworkRoomReplyReference(
  value: unknown,
): value is CoworkRoomReplyReference {
  return (
    isRecord(value) &&
    (value.message_id === undefined || isString(value.message_id)) &&
    (value.seq === undefined || isNumber(value.seq)) &&
    (value.text === undefined || isString(value.text))
  );
}

export function isCoworkAnnotation(value: unknown): value is CoworkAnnotation {
  return (
    isRecord(value) &&
    isString(value.annotation_id) &&
    isString(value.message_id) &&
    isUnknownArray(value.replies)
  );
}

export function isCoworkAnnotationReply(
  value: unknown,
): value is CoworkAnnotationReply {
  return isRecord(value) && isString(value.reply_id);
}

export function isCoworkMessageReaction(
  value: unknown,
): value is CoworkMessageReaction {
  return isRecord(value) && isString(value.message_id) && isString(value.emoji);
}

export function isCoworkPinnedMessage(
  value: unknown,
): value is CoworkPinnedMessage {
  return isRecord(value) && isString(value.message_id);
}

export function isCoworkMessageProjectActionResponse(
  value: unknown,
): value is CoworkMessageProjectActionResponse {
  return (
    isRecord(value) &&
    isString(value.action_id) &&
    isRecord(value.receipt) &&
    isRecord(value.source_message)
  );
}

export function hasAnnotations(
  value: unknown,
): value is { annotations: CoworkAnnotation[] } {
  return isRecord(value) && isArrayOf(value.annotations, isCoworkAnnotation);
}

export function hasAnnotation(
  value: unknown,
): value is { annotation: CoworkAnnotation } {
  return isRecord(value) && isCoworkAnnotation(value.annotation);
}

export function hasAnnotationReply(
  value: unknown,
): value is { reply: CoworkAnnotationReply } {
  return isRecord(value) && isCoworkAnnotationReply(value.reply);
}

export function hasReactions(
  value: unknown,
): value is { reactions: CoworkMessageReaction[] } {
  return isRecord(value) && isArrayOf(value.reactions, isCoworkMessageReaction);
}

export function hasReaction(
  value: unknown,
): value is { reaction: CoworkMessageReaction } {
  return isRecord(value) && isCoworkMessageReaction(value.reaction);
}

export function hasPinnedMessages(
  value: unknown,
): value is { pinned_messages: CoworkPinnedMessage[] } {
  return (
    isRecord(value) && isArrayOf(value.pinned_messages, isCoworkPinnedMessage)
  );
}

export function hasPin(
  value: unknown,
): value is { pin: { message_id: string; pinned: boolean } } {
  return (
    isRecord(value) &&
    isRecord(value.pin) &&
    isString(value.pin.message_id) &&
    isBoolean(value.pin.pinned)
  );
}
