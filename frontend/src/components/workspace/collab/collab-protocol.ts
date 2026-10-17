// Pure helpers behind CollabProvider: parsing team-room WebSocket frames
// (participants, removal, floor state, task progress), folding task updates
// into the React Query task list, and stable collaborator colours.

import { swallow } from "@/core/utils/log";
import type { SpeakerPolicy } from "@/core/teams";
import { isTeamTask } from "@/core/team-tasks/guards";
import type { TeamTask } from "@/core/team-tasks/types";
import { looseBody } from "@/core/api/response";
import { isObjectLike, isOneOf } from "@/core/utils/guards";
import {
  categoricalSlot,
  categoricalSnowHex,
  categoricalVar,
} from "@/lib/categorical-palette";

import type { FloorState, TeamTaskProgressEvent, User } from "./collab-types";

export const DEFAULT_FLOOR: FloorState = {
  speakerPolicy: "free",
  currentSpeakerId: null,
  moderatorId: null,
  floorRequests: [],
};

export function parseMessage(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(data);
    return isObjectLike(parsed) ? parsed : null;
  } catch (e) {
    swallow(e);
    return null;
  }
}

export function participantToUser(
  participant: unknown,
  avatar?: string | null,
): User {
  const item = isObjectLike(participant) ? participant : {};
  const id = String(item.id ?? `guest-${Date.now()}`);
  const name = String(item.display_name ?? "Guest");
  return {
    id,
    name,
    avatar: avatar ?? undefined,
    color: colorFor(id),
  };
}

export function teamHasRemovedParticipant(
  team: unknown,
  participantId: string,
): boolean {
  const item = isObjectLike(team) ? team : {};
  const participants = Array.isArray(item.participants)
    ? item.participants
    : [];
  return participants.some((participant) => {
    if (!isObjectLike(participant)) return false;
    return participant.id === participantId && participant.status === "removed";
  });
}

export function parseTaskProgressEvent(
  msg: Record<string, unknown>,
  expectedTeamId?: string | null,
): TeamTaskProgressEvent | null {
  const task = isRecord(msg.task) ? looseBody(msg.task, isTeamTask) : null;
  const taskId = stringOr(msg.task_id) || task?.id || "";
  const roomId =
    stringOr(msg.room_id) || stringOr(msg.team_id) || task?.room_id || "";
  if (!taskId || !roomId) return null;
  // Require an explicit expectedTeamId and force a strict match. A
  // permissive fallback (when expectedTeamId is falsy) used to let
  // global subscribers swallow task:progress for arbitrary rooms,
  // which corrupted React Query cache and could clear UI for tasks
  // the user owns. WS messages MUST be scoped to the current team.
  if (!expectedTeamId || roomId !== expectedTeamId) return null;
  const event = stringOr(msg.event) || "progress";
  const serverTime = stringOr(msg.server_time) || new Date().toISOString();
  return {
    id: [
      taskId,
      event,
      serverTime,
      stringOr(msg.role),
      stringOr(msg.completed_roles),
    ].join(":"),
    team_id: stringOr(msg.team_id) || roomId,
    room_id: roomId,
    task_id: taskId,
    task,
    event,
    role: stringOr(msg.role) || null,
    role_status: stringOr(msg.role_status) || null,
    completed_roles: numberOr(msg.completed_roles),
    total_roles: numberOr(msg.total_roles),
    progress: numberOr(msg.progress),
    server_time: serverTime,
    error: stringOr(msg.error) || null,
    runner_event: isRecord(msg.runner_event) ? msg.runner_event : null,
  };
}

export function appendTaskProgressEvent(
  prev: TeamTaskProgressEvent[],
  event: TeamTaskProgressEvent,
) {
  const filtered = prev.filter((item) => item.id !== event.id);
  return [...filtered, event].slice(-80);
}

export function mergeTaskIntoList(
  current: TeamTask[] | undefined,
  task: TeamTask,
): TeamTask[] {
  const existing = current ?? [];
  const next = existing.some((item) => item.id === task.id)
    ? existing.map((item) => (item.id === task.id ? task : item))
    : [task, ...existing];
  return [...next].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function removeTaskFromList(
  current: TeamTask[] | undefined,
  taskId: string,
): TeamTask[] {
  return (current ?? []).filter((item) => item.id !== taskId);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const FLOOR_POLICIES = [
  "free",
  "admin_only",
  "round_robin",
  "roll_call",
  "moderated",
] as const satisfies readonly SpeakerPolicy[];

// Extract floor state from either a dedicated ``floor`` event or a team
// object (which carries the same fields). Tolerant of missing keys.
export function floorFrom(source: unknown): FloorState {
  const item = isRecord(source) ? source : {};
  const policy = String(item.speaker_policy ?? "free");
  return {
    speakerPolicy: isOneOf(policy, FLOOR_POLICIES) ? policy : "free",
    currentSpeakerId:
      typeof item.current_speaker_id === "string"
        ? item.current_speaker_id
        : null,
    moderatorId:
      typeof item.moderator_id === "string" ? item.moderator_id : null,
    floorRequests: Array.isArray(item.floor_requests)
      ? item.floor_requests.filter((x): x is string => typeof x === "string")
      : [],
  };
}

function stringOr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOr(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** Collaborator identity colour: a stable ECHO categorical slot. */
export function colorFor(id: string): string {
  return categoricalVar(categoricalSlot(id));
}

/** Snow hex for annotation authors: readable under white initials anywhere. */
export function avatarHex(id: string): string {
  return categoricalSnowHex(categoricalSlot(id));
}
