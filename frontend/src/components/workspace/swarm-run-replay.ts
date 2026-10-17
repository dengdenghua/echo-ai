import {
  appendControlSessionAction,
  appendControlSessionEvidence,
  ensureControlSession,
  updateControlSessionAction,
} from "@/core/control-session";

import type { AgentTile } from "./agent-workbench-utils";
import { compactDetail, isRecord } from "./agent-workbench-utils";
import type { LiveToolEvent } from "./live-tool-timeline";
import type {
  SwarmOverviewStatus,
  SwarmPhaseId,
  SwarmRunCapacity,
  SwarmRunOverviewModel,
  SwarmRunSynthesis,
} from "./swarm-run-overview-model";
import { stringFromUnknown } from "./swarm-run-overview-model";

export interface SwarmReplayPackage {
  schema: "echo.swarm_replay_package.v1";
  exportedAt: string;
  overview: {
    activePhase: SwarmPhaseId;
    capacity: SwarmRunCapacity;
    counts: SwarmRunOverviewModel["counts"];
    evidenceCount: number;
    phaseCount: number;
    progress: number;
    resultCount: number;
    status: SwarmOverviewStatus;
    toolCount: number;
  };
  agents: Array<{
    id: string;
    name: string;
    role?: string;
    status: AgentTile["status"];
    task?: string;
    currentTool?: string;
    filesTouched: string[];
    blackboardWrites: string[];
  }>;
  phases: Array<{
    id: SwarmPhaseId;
    status: SwarmOverviewStatus;
    count: number;
  }>;
  timeline: Array<{
    id: string;
    at: string;
    agentId?: string;
    agentName?: string;
    event: string;
    lifecycle?: LiveToolEvent["lifecycle"];
    parentToolUseId?: string;
    status: LiveToolEvent["status"];
    summary: string;
  }>;
  synthesis?: SwarmRunSynthesis;
  events: LiveToolEvent[];
}

export async function appendSwarmReplayEvidence(
  controlSessionId: string | undefined,
  replayPackage: SwarmReplayPackage,
) {
  if (!controlSessionId) return;
  const control = {
    sessionId: controlSessionId,
    backendSync: true,
    ownerId: "swarm-overview",
    ownerLabel: "Swarm Overview",
    surface: "backend_preview" as const,
    targetId: "agent-collaboration",
  };
  await ensureControlSession(control, "running", {
    source: "swarm_replay_export",
    schema: replayPackage.schema,
  });
  const actionId =
    `${controlSessionId}-swarm-replay-export-${safeTimestamp(replayPackage.exportedAt)}`.slice(
      0,
      220,
    );
  await appendControlSessionAction(
    control,
    {
      type: "swarm_replay_export",
      schema: replayPackage.schema,
      agent_count: replayPackage.agents.length,
      timeline_count: replayPackage.timeline.length,
    },
    "running",
    actionId,
  );
  await appendControlSessionEvidence(control, {
    id: `${controlSessionId}-swarm-replay-${safeTimestamp(replayPackage.exportedAt)}`,
    actionId,
    kind: "log",
    action: "swarm_replay_export",
    ok: true,
    summary: `swarm replay package exported · ${replayPackage.agents.length} agents · ${replayPackage.timeline.length} events`,
    detail: replayPackage,
  });
  await updateControlSessionAction(control, actionId, "done", {
    schema: replayPackage.schema,
    evidence_id: `${controlSessionId}-swarm-replay-${safeTimestamp(
      replayPackage.exportedAt,
    )}`,
    agent_count: replayPackage.agents.length,
    timeline_count: replayPackage.timeline.length,
  });
}

export function buildSwarmReplayPackage(
  overview: SwarmRunOverviewModel,
  events: LiveToolEvent[],
): SwarmReplayPackage {
  return {
    schema: "echo.swarm_replay_package.v1",
    exportedAt: new Date().toISOString(),
    overview: {
      activePhase: overview.activePhase.id,
      capacity: overview.capacity,
      counts: overview.counts,
      evidenceCount: overview.evidenceCount,
      phaseCount: overview.phases.length,
      progress: overview.progress,
      resultCount: overview.resultCount,
      status: overview.status,
      toolCount: overview.toolCount,
    },
    agents: overview.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      task: agent.task,
      currentTool: agent.currentTool,
      filesTouched: [...(agent.filesTouched ?? [])],
      blackboardWrites: [...(agent.blackboardWrites ?? [])],
    })),
    phases: overview.phases.map((phase) => ({
      id: phase.id,
      status: phase.status,
      count: phase.count,
    })),
    timeline: buildSwarmReplayTimeline(events),
    synthesis: overview.synthesis,
    events: events.map((event) => ({ ...event })),
  };
}

function buildSwarmReplayTimeline(events: LiveToolEvent[]) {
  return [...events]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((event) => ({
      id: event.id,
      at: new Date(event.startedAt).toISOString(),
      agentId: event.agentId,
      agentName: event.agentName ?? event.subagentCodename,
      event: event.name.replace(/^mcp:/, ""),
      lifecycle: event.lifecycle,
      parentToolUseId: event.parentToolUseId,
      status: event.status,
      summary: eventSummary(event),
    }));
}

function eventSummary(event: LiveToolEvent): string {
  const direct =
    event.thought ??
    event.observation ??
    stringFromUnknown(event.output) ??
    stringFromUnknown(event.input?.task) ??
    stringFromUnknown(event.input?.query) ??
    stringFromUnknown(event.input?.path) ??
    stringFromUnknown(event.input?.url);
  if (direct) return compactDetail(direct, 180);
  if (isRecord(event.output)) {
    const outputSummary =
      stringFromUnknown(event.output.summary) ??
      stringFromUnknown(event.output.result) ??
      stringFromUnknown(event.output.reply);
    if (outputSummary) return compactDetail(outputSummary, 180);
  }
  const specs = event.input?.specs;
  if (Array.isArray(specs)) return `${specs.length} member dispatch`;
  return event.lifecycle ?? event.name.replace(/^mcp:/, "");
}

export function downloadSwarmReplayPackage(pkg: SwarmReplayPackage) {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("Replay export is only available in a browser");
  }
  const blob = new Blob([JSON.stringify(pkg, null, 2)], {
    type: "application/json",
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `echo-swarm-replay-${safeTimestamp(pkg.exportedAt)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}
