import type { AgentTile } from "./agent-workbench-utils";
import { isRecord } from "./agent-workbench-utils";
import type { LiveToolEvent } from "./live-tool-timeline";
import { deriveAgentTilesFromEvents } from "./use-agent-workbench-i18n";

export type SwarmOverviewStatus =
  | "running"
  | "waiting_approval"
  | "done"
  | "pending"
  | "error";

export type SwarmPhaseId = "dispatch" | "execute" | "aggregate" | "synthesize";

interface SwarmRunPhase {
  id: SwarmPhaseId;
  status: SwarmOverviewStatus;
  count: number;
}

export interface SwarmRunSynthesis {
  answeredCount: number;
  primaryAgentId?: string;
  primaryReply?: string;
  supportingCount: number;
  retryCount: number;
  nextAction?: string;
  ready: boolean;
  totalCount: number;
}

export interface SwarmRunCapacity {
  requestedMembers: number;
  dispatchedMembers: number;
  droppedMembers: number;
  maxMembers?: number;
  concurrency?: number;
  capacityTier?: string;
}

export interface SwarmRunOverviewModel {
  activePhase: SwarmRunPhase;
  agents: AgentTile[];
  counts: {
    total: number;
    running: number;
    waiting: number;
    done: number;
    error: number;
    pending: number;
  };
  capacity: SwarmRunCapacity;
  currentAgent?: AgentTile;
  eventCount: number;
  evidenceCount: number;
  phases: SwarmRunPhase[];
  progress: number;
  resultCount: number;
  status: SwarmOverviewStatus;
  synthesis?: SwarmRunSynthesis;
  toolCount: number;
}

export function buildSwarmRunOverview(
  events: LiveToolEvent[],
): SwarmRunOverviewModel | null {
  const agents = deriveAgentTilesFromEvents(events);
  if (!hasSwarmSignal(events, agents)) return null;
  if (agents.length === 0) return null;

  const capacity = buildSwarmCapacity(events, agents.length);
  const visibleStatusCount =
    agents.filter((agent) => agent.status === "running").length +
    agents.filter((agent) => agent.status === "waiting_approval").length +
    agents.filter((agent) => agent.status === "done").length +
    agents.filter((agent) => agent.status === "error").length +
    agents.filter((agent) => agent.status === "pending").length;
  const inferredPending = Math.max(
    0,
    capacity.dispatchedMembers - visibleStatusCount,
  );
  const counts = {
    total: capacity.dispatchedMembers,
    running: agents.filter((agent) => agent.status === "running").length,
    waiting: agents.filter((agent) => agent.status === "waiting_approval")
      .length,
    done: agents.filter((agent) => agent.status === "done").length,
    error: agents.filter((agent) => agent.status === "error").length,
    pending:
      agents.filter((agent) => agent.status === "pending").length +
      inferredPending,
  };
  const status: SwarmOverviewStatus =
    counts.error > 0
      ? "error"
      : counts.waiting > 0
        ? "waiting_approval"
        : counts.running > 0
          ? "running"
          : counts.pending > 0
            ? "pending"
            : "done";
  const completed = counts.done + counts.error;
  const progress = Math.max(
    status === "running" ? 0.08 : 0,
    Math.min(1, completed / Math.max(1, counts.total)),
  );
  const currentAgent =
    agents.find((agent) => agent.status === "running") ??
    agents.find((agent) => agent.status === "waiting_approval") ??
    agents.find((agent) => agent.status === "pending") ??
    agents[agents.length - 1];
  const resultCount = countResultRows(events);
  const evidenceCount = countEvidence(events, agents);
  const toolCount = events.filter(
    (event) => event.lifecycle === undefined,
  ).length;
  const phases = buildSwarmPhases({
    counts,
    evidenceCount,
    resultCount,
    status,
  });
  const synthesis = buildSwarmSynthesis(events);

  return {
    activePhase: activePhaseFromPhases(phases),
    agents: sortAgentsForOverview(agents),
    capacity,
    counts,
    currentAgent,
    eventCount: events.length,
    evidenceCount,
    phases,
    progress,
    resultCount,
    status,
    synthesis,
    toolCount,
  };
}

function hasSwarmSignal(events: LiveToolEvent[], agents: AgentTile[]): boolean {
  if (agents.length > 1) return true;
  return events.some((event) => {
    const eventName = event.name.replace(/^mcp:/, "");
    if (
      eventName === "call_agent_parallel" ||
      eventName === "team_swarm" ||
      eventName === "deep-research-swarm"
    ) {
      return true;
    }
    const specs = event.input?.specs;
    if (Array.isArray(specs) && specs.length > 1) return true;
    const output =
      typeof event.output === "string" ? tryParse(event.output) : event.output;
    if (isRecord(output)) {
      const results = output.results;
      if (Array.isArray(results) && results.length > 1) return true;
    }
    return false;
  });
}

function buildSwarmCapacity(
  events: LiveToolEvent[],
  observedAgents: number,
): SwarmRunCapacity {
  const observedSpecs = maxDispatchSpecCount(events);
  for (const event of [...events].reverse()) {
    const explicit = capacityFromRecord(event.input?.capacity);
    if (explicit)
      return normalizeCapacity(explicit, observedAgents, observedSpecs);
    const output =
      typeof event.output === "string" ? tryParse(event.output) : event.output;
    if (isRecord(output)) {
      const fromResult = capacityFromRecord(output.capacity);
      if (fromResult)
        return normalizeCapacity(fromResult, observedAgents, observedSpecs);
    }
  }
  const total = Math.max(observedAgents, observedSpecs);
  return {
    requestedMembers: total,
    dispatchedMembers: observedAgents,
    droppedMembers: Math.max(0, total - observedAgents),
    capacityTier: capacityTier(observedAgents, total),
  };
}

function capacityFromRecord(value: unknown): SwarmRunCapacity | null {
  if (!isRecord(value)) return null;
  const requested =
    numberFromUnknown(value.requested_members) ??
    numberFromUnknown(value.requestedMembers);
  const dispatched =
    numberFromUnknown(value.dispatched_members) ??
    numberFromUnknown(value.dispatchedMembers) ??
    numberFromUnknown(value.planned_dispatch);
  const dropped =
    numberFromUnknown(value.dropped_members) ??
    numberFromUnknown(value.droppedMembers) ??
    numberFromUnknown(value.planned_dropped);
  if (requested === undefined && dispatched === undefined) return null;
  return {
    requestedMembers: Math.max(0, Math.round(requested ?? dispatched ?? 0)),
    dispatchedMembers: Math.max(0, Math.round(dispatched ?? requested ?? 0)),
    droppedMembers: Math.max(0, Math.round(dropped ?? 0)),
    maxMembers: numberFromUnknown(value.max_members ?? value.maxMembers),
    concurrency: numberFromUnknown(value.concurrency),
    capacityTier: stringFromUnknown(value.capacity_tier ?? value.capacityTier),
  };
}

function normalizeCapacity(
  capacity: SwarmRunCapacity,
  observedAgents: number,
  observedSpecs: number,
): SwarmRunCapacity {
  const requestedMembers = Math.max(
    capacity.requestedMembers,
    capacity.dispatchedMembers,
    observedAgents,
    observedSpecs,
  );
  const dispatchedMembers = Math.max(
    capacity.dispatchedMembers,
    observedAgents,
  );
  return {
    ...capacity,
    requestedMembers,
    dispatchedMembers,
    droppedMembers: Math.max(
      capacity.droppedMembers,
      requestedMembers - dispatchedMembers,
    ),
    capacityTier:
      capacity.capacityTier ??
      capacityTier(dispatchedMembers, requestedMembers),
  };
}

function maxDispatchSpecCount(events: LiveToolEvent[]): number {
  let max = 0;
  for (const event of events) {
    const specs = event.input?.specs;
    if (Array.isArray(specs)) max = Math.max(max, specs.length);
  }
  return max;
}

function capacityTier(dispatchedMembers: number, requestedMembers: number) {
  if (requestedMembers >= 300) return "kimi_scale";
  if (dispatchedMembers >= 64) return "large";
  if (dispatchedMembers >= 16) return "team_scale";
  if (dispatchedMembers >= 2) return "room_scale";
  return "single";
}

function buildSwarmPhases({
  counts,
  evidenceCount,
  resultCount,
  status,
}: {
  counts: SwarmRunOverviewModel["counts"];
  evidenceCount: number;
  resultCount: number;
  status: SwarmOverviewStatus;
}): SwarmRunPhase[] {
  const activeCount = counts.running + counts.waiting + counts.pending;
  const completedCount = counts.done + counts.error;
  const executeStatus: SwarmOverviewStatus =
    counts.error > 0 && activeCount === 0
      ? "error"
      : counts.waiting > 0
        ? "waiting_approval"
        : activeCount > 0
          ? "running"
          : "done";
  const aggregateStatus: SwarmOverviewStatus =
    resultCount > 0 || completedCount > 0
      ? activeCount > 0
        ? "running"
        : status === "error"
          ? "error"
          : "done"
      : "pending";
  const synthesizeStatus: SwarmOverviewStatus =
    resultCount > 0 && activeCount === 0
      ? status === "error"
        ? "error"
        : "done"
      : "pending";
  return [
    {
      id: "dispatch",
      status: counts.total > 0 ? "done" : "pending",
      count: counts.total,
    },
    { id: "execute", status: executeStatus, count: completedCount },
    { id: "aggregate", status: aggregateStatus, count: resultCount },
    { id: "synthesize", status: synthesizeStatus, count: evidenceCount },
  ];
}

function countEvidence(events: LiveToolEvent[], agents: AgentTile[]): number {
  const files = new Set<string>();
  const blackboardWrites = new Set<string>();
  for (const agent of agents) {
    for (const file of agent.filesTouched ?? []) files.add(file);
    for (const key of agent.blackboardWrites ?? []) blackboardWrites.add(key);
  }
  const eventEvidence = events.filter(eventHasEvidence).length;
  return files.size + blackboardWrites.size + eventEvidence;
}

function eventHasEvidence(event: LiveToolEvent): boolean {
  if (event.name === "web_search" || event.name === "fetch_url") return true;
  const path = stringFromUnknown(event.input?.path);
  const query = stringFromUnknown(event.input?.query);
  const url = stringFromUnknown(event.input?.url);
  if (path || query || url) return true;
  const output =
    typeof event.output === "string" ? tryParse(event.output) : event.output;
  if (!isRecord(output)) return Boolean(event.output);
  return [
    "result",
    "results",
    "successes",
    "failures",
    "replies",
    "arbitration",
    "synthesis",
    "summary",
  ].some((key) => output[key] !== undefined);
}

function countResultRows(events: LiveToolEvent[]): number {
  let count = 0;
  for (const event of events) {
    const output =
      typeof event.output === "string" ? tryParse(event.output) : event.output;
    if (!isRecord(output)) continue;
    count += arrayLength(output.results);
    count += arrayLength(output.successes);
    count += arrayLength(output.failures);
    count += arrayLength(output.replies);
    const arbitration = output.arbitration;
    if (isRecord(arbitration)) {
      count += arrayLength(arbitration.outcomes);
    }
    if (isRecord(output.synthesis)) {
      count += 1;
    }
  }
  return count;
}

function buildSwarmSynthesis(
  events: LiveToolEvent[],
): SwarmRunSynthesis | undefined {
  for (const event of [...events].reverse()) {
    const output =
      typeof event.output === "string" ? tryParse(event.output) : event.output;
    if (!isRecord(output)) continue;
    if (isRecord(output.synthesis)) {
      return synthesisFromRecord(output.synthesis);
    }
    const fallback = synthesisFromLegacyEnvelope(output);
    if (fallback) return fallback;
  }
  return undefined;
}

function synthesisFromRecord(
  synthesis: Record<string, unknown>,
): SwarmRunSynthesis {
  const primaryAgentId = stringFromUnknown(synthesis.primary_agent_id);
  const primaryReply = stringFromUnknown(synthesis.primary_reply);
  const supportingCount = arrayLength(synthesis.supporting_agent_ids);
  const retryCount = arrayLength(synthesis.retry_agent_ids);
  const answeredCount =
    numberFromUnknown(synthesis.answered_count) ??
    supportingCount + (primaryAgentId ? 1 : 0);
  const totalCount =
    numberFromUnknown(synthesis.total_count) ??
    Math.max(answeredCount + retryCount, answeredCount, retryCount);
  const nextAction = stringFromUnknown(synthesis.recommended_next_action);
  return {
    answeredCount,
    primaryAgentId,
    primaryReply,
    supportingCount,
    retryCount,
    nextAction,
    ready: synthesis.ready === true,
    totalCount,
  };
}

function synthesisFromLegacyEnvelope(
  output: Record<string, unknown>,
): SwarmRunSynthesis | undefined {
  const arbitration = isRecord(output.arbitration) ? output.arbitration : null;
  const replies = Array.isArray(output.replies)
    ? output.replies.filter(isRecord)
    : [];
  if (!arbitration || replies.length === 0) return undefined;
  const primaryAgentId = stringFromUnknown(arbitration.primary_agent_id);
  const answeredIds = arrayOfStrings(arbitration.answered_agent_ids);
  const failedIds = arrayOfStrings(arbitration.failed_agent_ids);
  const emptyIds = arrayOfStrings(arbitration.empty_agent_ids);
  const primaryReply = primaryAgentId
    ? stringFromUnknown(
        replies.find(
          (reply) => stringFromUnknown(reply.agent_id) === primaryAgentId,
        )?.reply,
      )
    : undefined;
  const retryCount = failedIds.length + emptyIds.length;
  const supportingCount = answeredIds.filter(
    (id) => id !== primaryAgentId,
  ).length;
  const answeredCount = answeredIds.length;
  return {
    answeredCount,
    primaryAgentId,
    primaryReply,
    supportingCount,
    retryCount,
    nextAction: stringFromUnknown(arbitration.recommended_next_action),
    ready: Boolean(primaryAgentId && primaryReply && retryCount === 0),
    totalCount: Math.max(replies.length, answeredCount + retryCount),
  };
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function activePhaseFromPhases(phases: SwarmRunPhase[]): SwarmRunPhase {
  const fallback: SwarmRunPhase = {
    id: "dispatch",
    status: "pending",
    count: 0,
  };
  return (
    phases.find((phase) => phase.status === "running") ??
    phases.find((phase) => phase.status === "waiting_approval") ??
    phases.find((phase) => phase.status === "pending") ??
    phases[phases.length - 1] ??
    fallback
  );
}

function sortAgentsForOverview(agents: AgentTile[]): AgentTile[] {
  const rank: Record<AgentTile["status"], number> = {
    running: 0,
    waiting_approval: 1,
    error: 2,
    pending: 3,
    done: 4,
  };
  return [...agents].sort((a, b) => {
    const byStatus = rank[a.status] - rank[b.status];
    if (byStatus !== 0) return byStatus;
    return a.startedAt - b.startedAt;
  });
}

function tryParse(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
