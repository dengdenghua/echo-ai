import type { WorkbenchRosterSeat } from "@/components/workspace/agent-workbench-panel";
import type { ChatCollaborationRosterEntry } from "@/components/workspace/realtime/task-collaborator-control";
import {
  serveMeshForMode,
  type TeamMode,
} from "@/components/workspace/team-mode-picker";
import type { Agent } from "@/core/agents";
import {
  hydrateCollaborationRoster,
  type ThreadCollaborationRosterEntry,
} from "@/core/collaboration/thread-collaboration";
import type {
  CoworkRoomMessage,
  CoworkRoomParticipant,
  TrustScore,
} from "@/core/cowork";

import type { RealtimeTranslations } from "./realtime-page-types";

/** Pure roster projections shared by the realtime header, timeline and workbench. */

/** A known agent profile, or the placeholder used before the agent loads. */
export type CollaborationProfile =
  | Agent
  | { name: string; display_name: string; avatar_url: null; icon: null };

type RosterEntry = ChatCollaborationRosterEntry | ThreadCollaborationRosterEntry;

/** The current task's leader followed by the selected collaborators. */
export function buildLeaderCollaborationRoster(
  composerDisplayAgent: CollaborationProfile,
  effectiveAgentId: string,
  selectedCollaborators: Agent[],
): ChatCollaborationRosterEntry[] {
  const leaderName = composerDisplayAgent.name?.trim() || effectiveAgentId;
  const roster: ChatCollaborationRosterEntry[] = [
    {
      agent_id: leaderName,
      name: leaderName,
      display_name:
        composerDisplayAgent.display_name?.trim() ||
        composerDisplayAgent.name?.trim() ||
        leaderName,
      avatar_url: composerDisplayAgent.avatar_url ?? null,
      icon: composerDisplayAgent.icon ?? null,
      role: "tl",
    },
  ];
  for (const agent of selectedCollaborators) {
    if (!agent.name || agent.name === leaderName) continue;
    roster.push({
      agent_id: agent.name,
      name: agent.name,
      display_name: agent.display_name?.trim() || agent.name,
      avatar_url: agent.avatar_url ?? null,
      icon: agent.icon ?? null,
      role: "member",
    });
  }
  return roster;
}

/** The draft roster and the saved roster merged (draft first while editing). */
export function mergeVisibleCollaborationRoster({
  privateConversation,
  collaborationEnabled,
  collaborationRoster,
  savedCollaborationRoster,
  coworkCollaborationProfiles,
}: {
  privateConversation: boolean;
  collaborationEnabled: boolean;
  collaborationRoster: ChatCollaborationRosterEntry[];
  savedCollaborationRoster: RosterEntry[];
  coworkCollaborationProfiles: CollaborationProfile[];
}) {
  if (privateConversation) return [];
  const primary =
    collaborationEnabled || savedCollaborationRoster.length === 0
      ? collaborationRoster
      : savedCollaborationRoster;
  const secondary =
    primary === collaborationRoster
      ? savedCollaborationRoster
      : collaborationRoster;
  if (secondary.length === 0) {
    return hydrateCollaborationRoster(primary, coworkCollaborationProfiles);
  }
  const seen = new Map<string, ChatCollaborationRosterEntry>();
  for (const entry of primary) seen.set(entry.agent_id, entry);
  for (const entry of secondary) {
    if (!seen.has(entry.agent_id)) seen.set(entry.agent_id, entry);
  }
  return hydrateCollaborationRoster(
    Array.from(seen.values()),
    coworkCollaborationProfiles,
  );
}

// Keep the compact member records used by the message timeline enriched
// with the same role profile data already available to the HUD. Historical
// thread rosters may only carry a name and avatar, so this is deliberately
// an in-memory projection rather than a migration of old conversation data.
export function enrichMessageAgentRoster(
  visibleCollaborationRoster: ThreadCollaborationRosterEntry[],
  coworkCollaborationProfiles: CollaborationProfile[],
) {
  return visibleCollaborationRoster.map((entry) => {
    const profile = coworkCollaborationProfiles.find(
      (agent) => agent.name === entry.agent_id,
    );
    const profileDetails =
      profile && "description" in profile ? profile : null;
    return {
      ...entry,
      description: profileDetails?.description ?? null,
      model: profileDetails?.model ?? null,
      toolGroups: profileDetails?.tool_groups ?? null,
    };
  });
}

/** Workbench roster seats: AI members first, then linked-room humans. */
export function buildCollaborationRosterSeats({
  visibleCollaborationRoster,
  coworkCollaborationProfiles,
  roomParticipants,
  trustByMemberId,
}: {
  visibleCollaborationRoster: ThreadCollaborationRosterEntry[];
  coworkCollaborationProfiles: CollaborationProfile[];
  roomParticipants: CoworkRoomParticipant[] | undefined;
  trustByMemberId: Map<string, TrustScore>;
}): WorkbenchRosterSeat[] {
  const seats = new Map<string, WorkbenchRosterSeat>();
  const profileByAgentId = new Map(
    coworkCollaborationProfiles.map((agent) => [agent.name, agent]),
  );
  for (const agent of visibleCollaborationRoster) {
    const profile = profileByAgentId.get(agent.agent_id);
    const profileDetails =
      profile && "description" in profile ? profile : null;
    seats.set(`agent:${agent.agent_id}`, {
      id: agent.agent_id,
      name: agent.display_name,
      avatarUrl: agent.avatar_url ?? null,
      icon: agent.icon ?? null,
      role: agent.role,
      kind: agent.kind ?? "agent",
      driver: agent.driver,
      accountableOwner: agent.accountable_owner ?? null,
      description: profileDetails?.description ?? null,
      model: profileDetails?.model ?? null,
      toolGroups: profileDetails?.tool_groups ?? null,
      trust: trustByMemberId.get(agent.agent_id) ?? null,
    });
  }
  for (const participant of roomParticipants ?? []) {
    const rawId =
      participant.id ?? participant.participant_id ?? participant.name;
    const id = typeof rawId === "string" ? rawId.trim() : "";
    if (!id) continue;
    const rawName = participant.display_name ?? participant.name;
    const name =
      typeof rawName === "string" && rawName.trim() ? rawName.trim() : id;
    const rawRole = participant.role;
    const role =
      rawRole === "owner"
        ? "群主"
        : rawRole === "viewer"
          ? "访客"
          : rawRole === "member"
            ? "群成员"
            : typeof rawRole === "string"
              ? rawRole
              : "群成员";
    const rawAvatar = participant.avatar_url;
    seats.set(`human:${id}`, {
      id,
      name,
      avatarUrl: typeof rawAvatar === "string" ? rawAvatar : null,
      role,
      kind: participant.kind ?? "human",
      driver:
        participant.kind === "human" ? "human" : (participant.driver ?? undefined),
      accountableOwner: participant.accountable_owner ?? null,
      trust: trustByMemberId.get(id) ?? null,
    });
  }
  return Array.from(seats.values());
}

/** Turn context describing the collaboration roster, its leader and reply target. */
export function buildCollaborationTurnContext({
  collaborationEnabled,
  collaborationRoster,
  collaborationTeamName,
  effectiveAgentId,
  selectedCollaborators,
  t,
  teamModeIntent,
  threadId,
  replyTarget,
}: {
  collaborationEnabled: boolean;
  collaborationRoster: ChatCollaborationRosterEntry[];
  collaborationTeamName: string;
  effectiveAgentId: string;
  selectedCollaborators: Agent[];
  t: RealtimeTranslations;
  teamModeIntent: TeamMode;
  threadId: string;
  replyTarget: CoworkRoomMessage | null;
}) {
  if (!collaborationEnabled) return {};
  const isCoworkMode = teamModeIntent !== "chat";
  return {
    agent_name: effectiveAgentId,
    subagent_enabled: isCoworkMode,
    is_plan_mode: isCoworkMode,
    team_mode: isCoworkMode ? "cowork" : "chat",
    response_mode_override: teamModeIntent,
    serve_mesh: serveMeshForMode(teamModeIntent),
    topology_id: teamModeIntent === "cluster" ? "cowork" : undefined,
    agent_roster: collaborationRoster,
    team_members: collaborationRoster.map((agent) => agent.display_name),
    team_leader: collaborationRoster[0]?.display_name ?? effectiveAgentId,
    team_id: `thread:${threadId}`,
    team_name: collaborationTeamName,
    project: t.collab.projectPrefix(collaborationTeamName),
    task_agent_refs: selectedCollaborators.map((agent) => agent.name),
    task_agent_names: selectedCollaborators.map(
      (agent) => agent.display_name ?? agent.name,
    ),
    ...(replyTarget
      ? {
          cowork_reply_to: {
            message_id: replyTarget.metadata?.source_message_id,
            seq: replyTarget.seq,
            participant_id: replyTarget.participant_id,
            display_name: replyTarget.display_name,
            text: replyTarget.text.slice(0, 240),
          },
        }
      : {}),
  };
}
