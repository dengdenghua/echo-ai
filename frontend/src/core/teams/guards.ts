/**
 * Key-field guards for the response bodies read in ``./api``. The
 * OpenAPI snapshot declares those routes as plain dicts, so the module
 * narrows them through ``looseBody`` (see ``@/core/api/response``).
 */
import {
  isBoolean,
  isRecord,
  isString,
  isUnknownArray,
} from "@/core/utils/guards";
import type {
  JoinTeamInviteResult,
  OwnTeamJoinRequestResult,
  RemoveTeamParticipantResult,
  SpeakerPolicy,
  Team,
  TeamInvite,
  TeamInvitePreview,
  TeamInviteRecord,
  TeamJoinPolicyInfo,
  TeamJoinRequest,
  UpdateTeamParticipantResult,
} from "./api";

export function isTeam(value: unknown): value is Team {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isUnknownArray(value.members)
  );
}

export function isTeamInvite(value: unknown): value is TeamInvite {
  return (
    isRecord(value) &&
    isString(value.invite_id) &&
    isString(value.team_id) &&
    isString(value.invite_token)
  );
}

export function hasInvite(
  value: unknown,
): value is { invite: TeamInviteRecord } {
  return isRecord(value) && isRecord(value.invite);
}

export function isTeamJoinPolicyInfo(
  value: unknown,
): value is TeamJoinPolicyInfo {
  return (
    isRecord(value) &&
    isString(value.team_id) &&
    isString(value.join_policy) &&
    isBoolean(value.is_project_group)
  );
}

export function hasJoinRequests(
  value: unknown,
): value is { join_requests?: TeamJoinRequest[] } {
  return isRecord(value);
}

export function hasJoinRequest(
  value: unknown,
): value is { ok: boolean; changed?: boolean; join_request: TeamJoinRequest } {
  return isRecord(value) && isBoolean(value.ok) && isRecord(value.join_request);
}

export function isJoinTeamInviteResult(
  value: unknown,
): value is JoinTeamInviteResult {
  return (
    isRecord(value) && isString(value.outcome) && isString(value.join_policy)
  );
}

export function isOwnTeamJoinRequestResult(
  value: unknown,
): value is OwnTeamJoinRequestResult {
  return (
    isRecord(value) &&
    isString(value.outcome) &&
    isString(value.join_policy) &&
    isRecord(value.join_request)
  );
}

export function hasJoinOutcome(
  value: unknown,
): value is { ok: boolean; outcome: string; join_request: TeamJoinRequest } {
  return (
    isRecord(value) &&
    isBoolean(value.ok) &&
    isString(value.outcome) &&
    isRecord(value.join_request)
  );
}

export function isUpdateTeamParticipantResult(
  value: unknown,
): value is UpdateTeamParticipantResult {
  return isRecord(value) && isRecord(value.team) && isRecord(value.participant);
}

export function hasTeam(
  value: unknown,
): value is { team: Team; speaker_policy: SpeakerPolicy } {
  return (
    isRecord(value) && isRecord(value.team) && isString(value.speaker_policy)
  );
}

export function isRemoveTeamParticipantResult(
  value: unknown,
): value is RemoveTeamParticipantResult {
  return (
    isRecord(value) &&
    isString(value.participant_id) &&
    isBoolean(value.ok) &&
    isRecord(value.team)
  );
}

export function isTeamInviteList(
  value: unknown,
): value is { invites?: TeamInviteRecord[] } | TeamInviteRecord[] {
  return isUnknownArray(value) || isRecord(value);
}

/** The invite preview, or the full room from a backend that predates it. */
export function isTeamInvitePreviewBody(
  value: unknown,
): value is TeamInvitePreview | { team: Team } {
  return isRecord(value) && (isRecord(value.invite) || isTeam(value.team));
}

/** An ``echo:teams`` localStorage entry the migration can recreate. */
export function isLegacyTeam(value: unknown): value is Team {
  return (
    isRecord(value) && Boolean(value.name) && isUnknownArray(value.members)
  );
}
