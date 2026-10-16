import { builtinPersonaDisplayName } from "@/core/agents/persona-display";

import { type AgentTile, agentEventGroupId } from "./agent-workbench-utils";
import { pickCurrentWorkBlock, type WorkBlock } from "./work-blocks";

export function isAgentCreationBlock(
  block: WorkBlock | null | undefined,
): boolean {
  const event = block?.event;
  return Boolean(
    event &&
    (event.lifecycle === "spawned" || /subagent_spawned/i.test(event.name)),
  );
}

export function isAgentLifecycleBlock(block: WorkBlock): boolean {
  return Boolean(
    block.event.lifecycle ||
    /subagent_(spawned|finished)/i.test(block.event.name),
  );
}

export function pickCurrentScreenFrame(blocks: WorkBlock[]): WorkBlock | null {
  const newestFirst = [...blocks].reverse();
  return (
    newestFirst.find(
      (block) =>
        !isAgentLifecycleBlock(block) &&
        (block.status === "running" || block.status === "waiting_approval"),
    ) ??
    newestFirst.find((block) => !isAgentLifecycleBlock(block)) ??
    pickCurrentWorkBlock(blocks) ??
    blocks[blocks.length - 1] ??
    null
  );
}

export function agentTileForBlock(
  block: WorkBlock | null | undefined,
  agents: AgentTile[],
): AgentTile | undefined {
  const event = block?.event;
  if (!event) return undefined;
  const id = agentEventGroupId(event);
  return agents.find(
    (agent) =>
      agent.id === id ||
      agent.id === event.agentId ||
      agent.codename === event.subagentCodename ||
      agent.name === event.agentName ||
      agent.role === event.subAgentRole,
  );
}

export function findAgentTileByFocusId(
  focusId: string,
  agents: AgentTile[],
): AgentTile | undefined {
  return agents.find((agent) =>
    [
      agent.id,
      agent.codename,
      agent.name,
      agent.role,
      agent.parentToolUseId,
      agent.label,
    ].some((value) => value === focusId),
  );
}

export function friendlyRoleName(role: string | undefined | null): string {
  const value = role?.trim();
  if (!value) return "Task Agent";
  const personaName = builtinPersonaDisplayName(value);
  if (personaName) return personaName;
  const lower = value.toLowerCase();
  const map: Record<string, string> = {
    architect: "Architect",
    critic: "Reviewer",
    debugger: "Debugger",
    designer: "Designer",
    implementer: "Builder",
    planner: "Planner",
    researcher: "Researcher",
    reviewer: "Reviewer",
    security: "Security Reviewer",
    synthesizer: "Synthesizer",
    writer: "Writer",
  };
  return map[lower] ?? value.replace(/[_-]+/g, " ");
}
