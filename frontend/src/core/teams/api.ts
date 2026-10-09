import { swallow } from "@/core/utils/log";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  isApiErrorStatus,
  untypedApi,
  type ApiFailure,
} from "@/core/api/request";
import { eventBus } from "@/core/events";
import type { Agent } from "@/core/agents/types";

export interface TeamParticipant {
  id: string;
  display_name: string;
  role: TeamParticipantRole;
  actor_id?: string | null;
  joined_at: string;
  last_seen_at?: string | null;
  status: string;
  // Governance (see team_rooms_router.py)
  muted?: boolean;
  speak_mode?: SpeakMode;
  twin_agent_id?: string | null;
  host_id?: string | null;
}

export interface Team {
  id: string;
  name: string;
  thread_id?: string | null;
  members: Agent[];
  leaderId: string | null;
  owner_id?: string | null;
  created_at?: string;
  updated_at?: string;
  participants?: TeamParticipant[];
  invite_token?: string | null;
  invite_role?: TeamParticipantRole;
  join_policy?: TeamJoinPolicy;
  is_project_group?: boolean;
  project_id?: string | null;
  // Turn-engine floor state
  speaker_policy?: SpeakerPolicy;
  current_speaker_id?: string | null;
  moderator_id?: string | null;
  floor_requests?: string[];
}

export type TeamParticipantRole = "owner" | "member" | "viewer";
export type TeamInviteRole = Exclude<TeamParticipantRole, "owner">;
export type TeamInviteStatus = "active" | "expired" | "exhausted" | "revoked";
export type TeamJoinPolicy = "direct_join" | "apply_then_join";
export type TeamJoinRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "expired"
  | "cancelled";

// Who may speak in a room. ``free``/``admin_only`` are stateless; the
// trio drive the turn-engine floor. Mirrors the backend _SPEAKER_POLICIES.
export type SpeakerPolicy =
  | "free"
  | "admin_only"
  | "round_robin"
  | "roll_call"
  | "moderated";

// How a participant's turn produces text. Their OWN opt-in only.
export type SpeakMode = "manual" | "twin" | "hosted";

export interface TeamInviteRecord {
  id: string;
  team_id: string;
  role: TeamInviteRole;
  created_by?: string | null;
  created_at: string;
  expires_at?: string | null;
  max_uses?: number | null;
  use_count: number;
  status: TeamInviteStatus;
  revoked_at?: string | null;
  revoked_by?: string | null;
  last_used_at?: string | null;
}

export interface TeamInvite extends Omit<TeamInviteRecord, "id"> {
  id?: string;
  invite_id: string;
  invite_token: string;
  invite_role: TeamInviteRole;
  invite_path: string;
  invite_hash_path: string;
  join_policy?: TeamJoinPolicy;
}

export interface TeamJoinRequest {
  id: string;
  invite_id: string;
  team_id: string;
  display_name: string;
  role: TeamInviteRole;
  status: TeamJoinRequestStatus;
  created_at: string;
  updated_at: string;
  expires_at?: string | null;
  decided_at?: string | null;
  decision_reason?: string | null;
  participant_id?: string | null;
  actor_id?: string | null;
  decided_by?: string | null;
}

export interface TeamJoinPolicyInfo {
  team_id: string;
  join_policy: TeamJoinPolicy;
  is_project_group: boolean;
  project_id?: string | null;
  overridden: boolean;
}

export interface CreateTeamInviteInput {
  role?: TeamInviteRole;
  expires_in_seconds?: number;
  max_uses?: number;
}

export interface TeamInvitePreview {
  invite: {
    id: string;
    role: TeamInviteRole;
    expires_at?: string | null;
    status: TeamInviteStatus;
    remaining_uses?: number | null;
  };
  team: {
    id: string;
    name: string;
    member_count: number;
    participant_count: number;
  };
  join_policy?: TeamJoinPolicy;
  thread_id?: string | null;
}

export interface JoinTeamInviteInput {
  display_name?: string;
  participant_id?: string;
}

export interface JoinedTeamInviteResult {
  outcome: "joined";
  join_policy: TeamJoinPolicy;
  team: Team;
  participant: TeamParticipant;
  invite?: TeamInvitePreview["invite"];
  thread_id?: string | null;
}

export interface PendingTeamInviteResult {
  ok: boolean;
  created?: boolean;
  outcome: TeamJoinRequestStatus | "pending_approval";
  join_policy: TeamJoinPolicy;
  join_request: TeamJoinRequest;
  team: Pick<Team, "id" | "name"> & {
    member_count?: number;
    participant_count?: number;
  };
  thread_id?: null;
}

export type JoinTeamInviteResult =
  | JoinedTeamInviteResult
  | PendingTeamInviteResult;

export type OwnTeamJoinRequestResult =
  | (JoinedTeamInviteResult & { join_request: TeamJoinRequest })
  | {
      outcome: TeamJoinRequestStatus;
      join_policy: TeamJoinPolicy;
      join_request: TeamJoinRequest;
      participant?: TeamParticipant | null;
      team: Team | Pick<Team, "id" | "name">;
      thread_id?: string | null;
    };

export interface UpdateTeamParticipantInput {
  display_name?: string;
  role?: TeamParticipantRole;
  status?: "active" | "offline" | "removed";
  muted?: boolean;
}

export interface UpdateDelegationInput {
  speak_mode: SpeakMode;
  twin_agent_id?: string | null;
  host_id?: string | null;
}

export interface UpdateTeamParticipantResult {
  team: Team;
  participant: TeamParticipant;
}

export interface RemoveTeamParticipantResult {
  ok: boolean;
  team: Team;
  participant_id: string;
}

export interface CreateTeamInput {
  id?: string;
  name: string;
  members: Agent[];
  leaderId: string | null;
  thread_id?: string | null;
}

const PARTICIPANT_KEY = "echo:teamParticipantId";

/** Historical wording: the raw error body, else the status. */
function teamError(failure: ApiFailure): string {
  return failure.text || `Request failed: ${failure.status}`;
}

export async function fetchTeams(): Promise<Team[]> {
  const data = (await apiGet("/api/teams", { errorMessage: teamError })) as
    | { teams?: Team[] }
    | Team[];
  return Array.isArray(data) ? data : (data.teams ?? []);
}

export async function createTeam(input: CreateTeamInput): Promise<Team> {
  return (await apiPost("/api/teams", {
    body: input,
    errorMessage: teamError,
  })) as Team;
}

export async function updateTeam(
  teamId: string,
  input: CreateTeamInput,
): Promise<Team> {
  return (await apiPut("/api/teams/{team_id}", {
    path: { team_id: teamId },
    body: input,
    errorMessage: teamError,
  })) as Team;
}

export async function deleteTeam(teamId: string): Promise<void> {
  await apiDelete("/api/teams/{team_id}", {
    path: { team_id: teamId },
    errorMessage: teamError,
  });
}

export async function createTeamInvite(
  teamId: string,
  input: CreateTeamInviteInput = {},
): Promise<TeamInvite> {
  return (await apiPost("/api/teams/{team_id}/invites", {
    path: { team_id: teamId },
    body: input,
    errorMessage: teamError,
  })) as TeamInvite;
}

export async function listTeamInvites(
  teamId: string,
): Promise<TeamInviteRecord[]> {
  const data = (await apiGet("/api/teams/{team_id}/invites", {
    path: { team_id: teamId },
    errorMessage: teamError,
  })) as { invites?: TeamInviteRecord[] } | TeamInviteRecord[];
  return Array.isArray(data) ? data : (data.invites ?? []);
}

export async function revokeTeamInvite(
  teamId: string,
  inviteId: string,
): Promise<TeamInviteRecord> {
  const data = (await apiDelete("/api/teams/{team_id}/invites/{invite_id}", {
    path: { team_id: teamId, invite_id: inviteId },
    errorMessage: teamError,
  })) as { invite: TeamInviteRecord };
  return data.invite;
}

export async function getTeamJoinPolicy(
  teamId: string,
): Promise<TeamJoinPolicyInfo> {
  return (await apiGet("/api/teams/{team_id}/join-policy", {
    path: { team_id: teamId },
    errorMessage: teamError,
  })) as TeamJoinPolicyInfo;
}

export async function updateTeamJoinPolicy(
  teamId: string,
  joinPolicy: TeamJoinPolicy,
): Promise<TeamJoinPolicyInfo> {
  return (await apiPatch("/api/teams/{team_id}/join-policy", {
    path: { team_id: teamId },
    body: { join_policy: joinPolicy },
    errorMessage: teamError,
  })) as TeamJoinPolicyInfo;
}

export async function listTeamJoinRequests(
  teamId: string,
  status: TeamJoinRequestStatus | "all" = "pending",
): Promise<TeamJoinRequest[]> {
  const data = (await apiGet("/api/teams/{team_id}/join-requests", {
    path: { team_id: teamId },
    query: { status: status === "all" ? undefined : status },
    errorMessage: teamError,
  })) as { join_requests?: TeamJoinRequest[] };
  return data.join_requests ?? [];
}

export async function approveTeamJoinRequest(
  teamId: string,
  requestId: string,
): Promise<
  JoinedTeamInviteResult & {
    changed?: boolean;
    join_request: TeamJoinRequest;
  }
> {
  return untypedApi.post(
    `/api/teams/${encodeURIComponent(teamId)}/join-requests/${encodeURIComponent(requestId)}/approve`,
    {
      reason: "the snapshot declares no body, but the client sends {}",
      body: {},
      errorMessage: teamError,
    },
  );
}

export async function rejectTeamJoinRequest(
  teamId: string,
  requestId: string,
  reason = "",
): Promise<{ ok: boolean; changed?: boolean; join_request: TeamJoinRequest }> {
  return (await apiPost(
    "/api/teams/{team_id}/join-requests/{request_id}/reject",
    {
      path: { team_id: teamId, request_id: requestId },
      body: { reason },
      errorMessage: teamError,
    },
  )) as { ok: boolean; changed?: boolean; join_request: TeamJoinRequest };
}

export async function inspectTeamInvite(
  token: string,
): Promise<TeamInvitePreview> {
  const data = (await apiGet("/api/team-invites/{token}", {
    path: { token },
    errorMessage: teamError,
  })) as TeamInvitePreview | { team: Team };
  if ("invite" in data) return data;

  // Transitional compatibility for a backend that still returns the full
  // room. Consumers only receive the minimum preview shape either way.
  const team = data.team;
  return {
    invite: {
      id: "legacy",
      role: team.invite_role === "viewer" ? "viewer" : "member",
      status: "active",
    },
    team: {
      id: team.id,
      name: team.name,
      member_count: team.members.length,
      participant_count: team.participants?.length ?? 0,
    },
  };
}

export async function joinTeamInvite(
  token: string,
  input: JoinTeamInviteInput,
): Promise<JoinTeamInviteResult> {
  return (await apiPost("/api/team-invites/{token}/join", {
    path: { token },
    body: input,
    errorMessage: teamError,
  })) as JoinTeamInviteResult;
}

export async function getOwnTeamJoinRequest(
  token: string,
): Promise<OwnTeamJoinRequestResult | null> {
  try {
    return (await apiGet("/api/team-invites/{token}/join-request", {
      path: { token },
      errorMessage: teamError,
    })) as OwnTeamJoinRequestResult;
  } catch (error) {
    if (isApiErrorStatus(error, 404)) return null;
    throw error;
  }
}

export async function withdrawOwnTeamJoinRequest(
  token: string,
): Promise<{ ok: boolean; outcome: string; join_request: TeamJoinRequest }> {
  return (await apiDelete("/api/team-invites/{token}/join-request", {
    path: { token },
    errorMessage: teamError,
  })) as { ok: boolean; outcome: string; join_request: TeamJoinRequest };
}

export async function updateTeamParticipant(
  teamId: string,
  participantId: string,
  input: UpdateTeamParticipantInput,
): Promise<UpdateTeamParticipantResult> {
  return (await apiPatch(
    "/api/teams/{team_id}/participants/{participant_id}",
    {
      path: { team_id: teamId, participant_id: participantId },
      body: input,
      errorMessage: teamError,
    },
  )) as UpdateTeamParticipantResult;
}

export async function updateSpeakerPolicy(
  teamId: string,
  speakerPolicy: SpeakerPolicy,
): Promise<{ team: Team; speaker_policy: SpeakerPolicy }> {
  return (await apiPatch("/api/teams/{team_id}/speaker-policy", {
    path: { team_id: teamId },
    body: { speaker_policy: speakerPolicy },
    errorMessage: teamError,
  })) as { team: Team; speaker_policy: SpeakerPolicy };
}

export async function updateDelegation(
  teamId: string,
  participantId: string,
  input: UpdateDelegationInput,
): Promise<UpdateTeamParticipantResult> {
  return (await apiPatch(
    "/api/teams/{team_id}/participants/{participant_id}/delegation",
    {
      path: { team_id: teamId, participant_id: participantId },
      body: input,
      errorMessage: teamError,
    },
  )) as UpdateTeamParticipantResult;
}

export async function removeTeamParticipant(
  teamId: string,
  participantId: string,
): Promise<RemoveTeamParticipantResult> {
  return (await apiDelete(
    "/api/teams/{team_id}/participants/{participant_id}",
    {
      path: { team_id: teamId, participant_id: participantId },
      errorMessage: teamError,
    },
  )) as RemoveTeamParticipantResult;
}

export async function migrateLegacyTeamsIfNeeded(
  existing: Team[],
): Promise<Team[]> {
  if (existing.length > 0 || typeof window === "undefined") return existing;
  const raw = window.localStorage.getItem("echo:teams");
  if (!raw) return existing;
  let legacy: Team[];
  try {
    const parsed = JSON.parse(raw);
    legacy = Array.isArray(parsed) ? (parsed as Team[]) : [];
  } catch (e) {
    swallow(e);
    return existing;
  }
  const migrated: Team[] = [];
  for (const team of legacy) {
    if (
      !team?.name ||
      !Array.isArray(team.members) ||
      team.members.length === 0
    ) {
      continue;
    }
    try {
      migrated.push(
        await createTeam({
          id: team.id,
          name: team.name,
          members: team.members,
          leaderId: team.leaderId ?? team.members[0]?.name ?? null,
        }),
      );
    } catch (e) {
      swallow(e);
    }
  }
  return migrated.length > 0 ? migrated : existing;
}

export function readPreferredTeamId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const direct = window.localStorage.getItem("echo:currentTeamId");
    if (direct) return direct;
    const raw = window.localStorage.getItem("echo:currentTeam");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string };
    return parsed.id ?? null;
  } catch (e) {
    swallow(e);
    return null;
  }
}

export function writePreferredTeam(team: Team | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!team) {
      window.localStorage.removeItem("echo:currentTeamId");
      window.localStorage.removeItem("echo:currentTeam");
      return;
    }
    window.localStorage.setItem("echo:currentTeamId", team.id);
    window.localStorage.setItem("echo:currentTeam", JSON.stringify(team));
  } catch (e) {
    swallow(e, "storage");
  }
}

export function dispatchTeamUpdated(team?: Team | null): void {
  if (typeof window === "undefined") return;
  eventBus.emit(
    "team:updated",
    team ? { id: team.id, name: team.name } : { id: "", name: "" },
  );
  eventBus.emit("teams:changed");
}

export function readOrCreateTeamParticipantId(): string {
  if (typeof window === "undefined") return `guest-${Date.now()}`;
  try {
    const existing = window.localStorage.getItem(PARTICIPANT_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `guest-${Date.now()}`;
    window.localStorage.setItem(PARTICIPANT_KEY, id);
    return id;
  } catch (e) {
    swallow(e);
    return `guest-${Date.now()}`;
  }
}

export function readTeamParticipantIdForTeam(team?: Team | null): string {
  if (typeof window === "undefined") return `guest-${Date.now()}`;
  try {
    const existing = window.localStorage.getItem(PARTICIPANT_KEY);
    if (
      existing &&
      team?.participants?.some(
        (p) => p.id === existing && p.status !== "removed",
      )
    ) {
      return existing;
    }

    const localOwner = team?.participants?.find(
      (p) =>
        p.status !== "removed" &&
        p.role === "owner" &&
        (p.actor_id === "local" || p.id === "owner-local"),
    );
    if (localOwner) {
      return localOwner.id;
    }
  } catch (e) {
    swallow(e);
  }
  return readOrCreateTeamParticipantId();
}
