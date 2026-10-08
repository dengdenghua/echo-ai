import type { CoordinationTask } from "@/core/cowork/coordination";
import type { AgentTile } from "../agent-workbench-utils";

/** Durable work remains visible after the original tool call/turn has ended. */
export function mergeCoordinatedAgents(agents: AgentTile[], tasks: CoordinationTask[]): AgentTile[] {
  const result = [...agents];
  const seen = new Set<string>();
  for (const task of [...tasks].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))) {
    if (!task.background || seen.has(task.member_id)) continue;
    seen.add(task.member_id);
    const index = result.findIndex(agent => [agent.name, agent.id].some(value => value.toLowerCase() === task.member_id.toLowerCase()));
    const previous = index >= 0 ? result[index] : undefined;
    const startedAt = (task.created_at ?? 0) * 1000;
    if (previous && previous.startedAt > startedAt) continue;
    const failed = ["failed", "cancelled"].includes(task.status);
    const tile: AgentTile = {
      ...(previous ?? { id: task.member_id, name: task.member_id, label: task.member_id,
        blackboardWrites: [], filesTouched: [], eventCount: 0 }),
      task: task.title,
      prompt: task.title,
      startedAt,
      status: task.status === "done" ? "done" : failed ? "error" : task.status === "working" ? "running" : "pending",
      resultSummary: task.status === "done" ? task.result : undefined,
      error: failed ? task.result || "任务未完成" : undefined,
    };
    if (index >= 0) result[index] = tile;
    else result.push(tile);
  }
  return result;
}
