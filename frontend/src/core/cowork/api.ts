import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  type ApiFailure,
} from "@/core/api/request";

import type {
  CollabRoomMessageInput,
  CollabRoomMessageResponse,
  CollabRoomInput,
  CollabRoomResponse,
  CollaborationSession,
  CoworkAnnotation,
  CoworkAnnotationInput,
  CoworkAnnotationReplyInput,
  CoworkMessageReaction,
  CoworkMessageReactionInput,
  CoworkPinnedMessage,
  CoworkGroupResponse,
  CoworkInviteInput,
  CoworkMessageProjectActionInput,
  CoworkMessageProjectActionResponse,
  CoworkMode,
  CoworkPresenceResponse,
  CoworkRosterInput,
  CoworkRosterResponse,
  CoworkSearchKind,
  CoworkSearchResponse,
} from "./types";
import type { CoworkTrustResponse } from "./trust";

type CoworkState = CoworkGroupResponse["state"];

/** Keep this module's historical error wording on ``EchoAPIError``. */
function failed(action: string) {
  return (failure: ApiFailure): string =>
    `${action} failed: ${failure.status}${
      failure.text ? ` ${failure.text}` : ` ${failure.statusText}`
    }`;
}

export async function getCoworkGroup(
  threadId: string,
): Promise<CoworkGroupResponse> {
  return (await apiGet("/api/cowork/{thread_id}", {
    path: { thread_id: threadId },
    errorMessage: failed("Load cowork group"),
  })) as CoworkGroupResponse;
}

export async function getCoworkTrust(
  threadId: string,
): Promise<CoworkTrustResponse> {
  return (await apiGet("/api/cowork/{thread_id}/trust", {
    path: { thread_id: threadId },
    errorMessage: failed("Load cowork trust scores"),
  })) as CoworkTrustResponse;
}

export async function inviteCoworkMember(
  threadId: string,
  input: CoworkInviteInput,
): Promise<CoworkState> {
  const data = (await apiPost("/api/cowork/{thread_id}/members", {
    path: { thread_id: threadId },
    body: {
      kind: "agent",
      role: "participant",
      grant: { scope: "all", ...(input.grant ?? {}) },
      ...input,
    },
    errorMessage: failed("Invite cowork member"),
  })) as { ok: boolean; state: CoworkState };
  return data.state;
}

export async function removeCoworkMember(
  threadId: string,
  memberId: string,
): Promise<CoworkState> {
  const data = (await apiDelete("/api/cowork/{thread_id}/members/{member_id}", {
    path: { thread_id: threadId, member_id: memberId },
    errorMessage: failed("Remove cowork member"),
  })) as { ok: boolean; state: CoworkState };
  return data.state;
}

/**
 * 接管 / 交还: hand a member's wheel to its AI (`"ai"`, 托管) or to a person
 * (`"human"`, 接管). While a person holds the wheel the member stops being an
 * automatic responder — the AI stands down so no utterance has two drivers.
 */
export async function setCoworkMemberDriver(
  threadId: string,
  memberId: string,
  driver: "ai" | "human",
): Promise<CoworkState> {
  const data = (await apiPost(
    "/api/cowork/{thread_id}/members/{member_id}/driver",
    {
      path: { thread_id: threadId, member_id: memberId },
      body: { driver },
      errorMessage: failed("Set cowork member driver"),
    },
  )) as { ok: boolean; state: CoworkState };
  return data.state;
}

export async function setCoworkMode(
  threadId: string,
  mode: CoworkMode,
): Promise<CoworkState> {
  const data = (await apiPost("/api/cowork/{thread_id}/mode", {
    path: { thread_id: threadId },
    body: { mode },
    errorMessage: failed("Set cowork mode"),
  })) as { ok: boolean; state: CoworkState };
  return data.state;
}

export async function replaceCoworkRoster(
  threadId: string,
  input: CoworkRosterInput,
): Promise<CoworkRosterResponse> {
  return (await apiPut("/api/cowork/{thread_id}/roster", {
    path: { thread_id: threadId },
    body: input,
    // The payload is tiny and this is the user's explicit roster save. Let the
    // browser finish it when a refresh immediately follows the click.
    keepalive: true,
    errorMessage: failed("Replace cowork roster"),
  })) as CoworkRosterResponse;
}

export async function searchCowork(
  threadId: string,
  query: string,
  opts: { kinds?: CoworkSearchKind[]; limit?: number; untilSeq?: number } = {},
): Promise<CoworkSearchResponse> {
  return (await apiGet("/api/cowork/{thread_id}/search", {
    path: { thread_id: threadId },
    query: {
      q: query,
      kinds: opts.kinds?.length ? opts.kinds.join(",") : undefined,
      limit: opts.limit,
      until_seq: opts.untilSeq,
    },
    errorMessage: failed("Search cowork group"),
  })) as CoworkSearchResponse;
}

export async function getCoworkPresence(
  threadId: string,
): Promise<CoworkPresenceResponse> {
  return (await apiGet("/api/cowork/{thread_id}/presence", {
    path: { thread_id: threadId },
    errorMessage: failed("Load cowork presence"),
  })) as CoworkPresenceResponse;
}

export async function markCoworkRead(
  threadId: string,
  memberId: string,
  seq?: number,
  messageSeq?: number,
): Promise<void> {
  await apiPost("/api/cowork/{thread_id}/read", {
    path: { thread_id: threadId },
    body: {
      member_id: memberId,
      ...(seq != null ? { seq } : {}),
      ...(messageSeq != null ? { message_seq: messageSeq } : {}),
    },
    errorMessage: failed("Mark cowork read"),
  });
}

export async function coworkHeartbeat(
  threadId: string,
  memberId: string,
): Promise<void> {
  await apiPost("/api/cowork/{thread_id}/heartbeat", {
    path: { thread_id: threadId },
    body: { member_id: memberId },
    errorMessage: failed("Cowork heartbeat"),
  });
}

export async function getCollabSession(
  threadId: string,
): Promise<CollaborationSession> {
  return (await apiGet("/api/collab/{thread_id}", {
    path: { thread_id: threadId },
    errorMessage: failed("Load collaboration session"),
  })) as CollaborationSession;
}

export async function linkCoworkRoom(
  threadId: string,
  roomId: string,
): Promise<void> {
  await apiPost("/api/collab/{thread_id}/link-room", {
    path: { thread_id: threadId },
    body: { room_id: roomId },
    errorMessage: failed("Link cowork room"),
  });
}

export async function ensureCollabRoom(
  threadId: string,
  input: CollabRoomInput,
): Promise<CollabRoomResponse> {
  return (await apiPost("/api/collab/{thread_id}/room", {
    path: { thread_id: threadId },
    body: {
      name: input.name ?? "",
      members: input.members ?? [],
      leaderId: input.leaderId ?? null,
      mode: input.mode ?? null,
      ...(input.id ? { id: input.id } : {}),
    },
    errorMessage: failed("Ensure collab room"),
  })) as CollabRoomResponse;
}

export async function postCollabRoomMessage(
  threadId: string,
  input: CollabRoomMessageInput,
): Promise<CollabRoomMessageResponse> {
  return (await apiPost("/api/collab/{thread_id}/room-message", {
    path: { thread_id: threadId },
    body: {
      text: input.text,
      participant_id: input.participant_id ?? "",
      display_name: input.display_name ?? "",
      ...(input.source_message_id
        ? { source_message_id: input.source_message_id }
        : {}),
      ...(input.message_type ? { message_type: input.message_type } : {}),
      ...(input.entity_refs?.length ? { entity_refs: input.entity_refs } : {}),
      ...(input.system_card ? { system_card: input.system_card } : {}),
      ...(input.reply_to ? { reply_to: input.reply_to } : {}),
      ...(input.metadata && Object.keys(input.metadata).length > 0
        ? { metadata: input.metadata }
        : {}),
    },
    errorMessage: failed("Post collab room message"),
  })) as CollabRoomMessageResponse;
}

export async function getCollabAnnotations(
  threadId: string,
): Promise<CoworkAnnotation[]> {
  const payload = (await apiGet("/api/collab/{thread_id}/annotations", {
    path: { thread_id: threadId },
    errorMessage: failed("Load collaboration annotations"),
  })) as { annotations: CoworkAnnotation[] };
  return payload.annotations ?? [];
}

export async function getCollabMessageReactions(
  threadId: string,
): Promise<CoworkMessageReaction[]> {
  const payload = (await apiGet("/api/collab/{thread_id}/reactions", {
    path: { thread_id: threadId },
    errorMessage: failed("Load collaboration message reactions"),
  })) as { reactions: CoworkMessageReaction[] };
  return payload.reactions ?? [];
}

export async function toggleCollabMessageReaction(
  threadId: string,
  input: CoworkMessageReactionInput,
): Promise<CoworkMessageReaction> {
  const payload = (await apiPost("/api/collab/{thread_id}/reactions", {
    path: { thread_id: threadId },
    body: input,
    errorMessage: failed("Toggle collaboration message reaction"),
  })) as { reaction: CoworkMessageReaction };
  return payload.reaction;
}

export async function getCollabPinnedMessages(
  threadId: string,
): Promise<CoworkPinnedMessage[]> {
  const payload = (await apiGet("/api/collab/{thread_id}/pinned-messages", {
    path: { thread_id: threadId },
    errorMessage: failed("Load collaboration pinned messages"),
  })) as { pinned_messages: CoworkPinnedMessage[] };
  return payload.pinned_messages ?? [];
}

export async function toggleCollabPinnedMessage(
  threadId: string,
  messageId: string,
): Promise<{ message_id: string; pinned: boolean }> {
  const payload = (await apiPost("/api/collab/{thread_id}/pinned-messages", {
    path: { thread_id: threadId },
    body: { message_id: messageId },
    errorMessage: failed("Toggle pinned message"),
  })) as { pin: { message_id: string; pinned: boolean } };
  return payload.pin;
}

export async function createCollabAnnotation(
  threadId: string,
  input: CoworkAnnotationInput,
): Promise<CoworkAnnotation> {
  const payload = (await apiPost("/api/collab/{thread_id}/annotations", {
    path: { thread_id: threadId },
    body: input,
    errorMessage: failed("Create collaboration annotation"),
  })) as { annotation: CoworkAnnotation };
  return payload.annotation;
}

export async function setCollabAnnotationResolved(
  threadId: string,
  annotationId: string,
  resolved: boolean,
): Promise<CoworkAnnotation> {
  const payload = (await apiPatch(
    "/api/collab/{thread_id}/annotations/{annotation_id}",
    {
      path: { thread_id: threadId, annotation_id: annotationId },
      body: { resolved },
      errorMessage: failed("Update collaboration annotation"),
    },
  )) as { annotation: CoworkAnnotation };
  return payload.annotation;
}

export async function deleteCollabAnnotation(
  threadId: string,
  annotationId: string,
): Promise<void> {
  await apiDelete("/api/collab/{thread_id}/annotations/{annotation_id}", {
    path: { thread_id: threadId, annotation_id: annotationId },
    errorMessage: failed("Delete collaboration annotation"),
  });
}

export async function createCollabAnnotationReply(
  threadId: string,
  annotationId: string,
  input: CoworkAnnotationReplyInput,
) {
  return (await apiPost(
    "/api/collab/{thread_id}/annotations/{annotation_id}/replies",
    {
      path: { thread_id: threadId, annotation_id: annotationId },
      body: input,
      errorMessage: failed("Reply to collaboration annotation"),
    },
  )) as { reply: CoworkAnnotation["replies"][number] };
}

/** Promote one timeline message into the bound Project OS project. */
export async function applyCollabRoomMessageProjectAction(
  threadId: string,
  messageSeq: number,
  input: CoworkMessageProjectActionInput,
): Promise<CoworkMessageProjectActionResponse> {
  return (await apiPost(
    "/api/collab/{thread_id}/room-messages/{message_seq}/project-actions",
    {
      path: { thread_id: threadId, message_seq: messageSeq },
      body: input,
      errorMessage: failed("Apply room message project action"),
    },
  )) as CoworkMessageProjectActionResponse;
}
