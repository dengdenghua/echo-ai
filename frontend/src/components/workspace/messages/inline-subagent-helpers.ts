import type { LiveToolEvent } from "@/components/workspace/live-tool-timeline";
import { isAIMessage, type Message, type ToolMessage } from "@/core/api/types";
import { isTeammateToolName } from "@/components/workspace/messages/action-display";

export type InlineSubagentStatus = "running" | "done" | "error" | "waiting";

export interface InlineSubagentInfo {
  id: string;
  /** Durable continuation identity; a role/name/lane id is never a session. */
  sessionId?: string;
  name: string;
  role?: string;
  avatar?: string;
  /** Market avatar URL ("我的安装"); takes priority over emoji `avatar`. */
  avatarUrl?: string;
  status: InlineSubagentStatus;
  task: string;
  summary?: string;
  filesTouchedCount: number;
  iterationCount?: number;
  error?: string;
  index?: number;
  /** Progress 0-1. Undefined means "just spawned, no activity yet".
   *  Done agents always have progress=1 and are rendered as ✓ instead. */
  progress?: number;
}

export function firstString(
  input: Record<string, unknown> | undefined,
  keys: string[],
): string {
  if (!input) return "";
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** Turn the model-facing custom-role wrapper into the one-line task brief a
 * human expects on the Kimi-style cluster card. The full prompt remains in
 * the detail/workbench view. */
export function compactSubagentTask(value: string): string {
  let task = value.trim();
  if (/^#\s*Role:/i.test(task)) {
    const separator = task.match(/\n\s*---\s*\n/);
    if (separator?.index !== undefined) {
      task = task.slice(separator.index + separator[0].length).trim();
    }
  }
  task = task.replace(/\s+/g, " ").trim();
  return task.length > 220 ? `${task.slice(0, 219).trimEnd()}…` : task;
}

/** Fallback: estimate progress from activity event count when no real progress data exists.
 *  Uses a slow saturating curve so it doesn't "fill up immediately".
 *  count=0 → 0.1 (just spawned, 1 col dim), 1→0.2, 3→0.4, 7→0.8, 9+→0.9 */
export function estimateProgressFromEventCount(count: number): number {
  if (count <= 0) return 0.1;
  return Math.min(0.9, 0.1 + count * 0.1);
}

/** Compute a stable lane ID that matches message-derived specs.
 *  A role is not an identity: parallel custom agents can both resolve to
 *  ``explorer``. The realtime adapter normalizes ``agentId`` to the requested
 *  spec id (or a unique codename for legacy history), so role is last-resort. */
export function stableAgentKey(event: LiveToolEvent): string | null {
  const agentId =
    event.agentId &&
    event.agentId !== "__main__" &&
    event.agentId !== event.subAgentRole
      ? event.agentId
      : null;
  return (
    agentId ??
    event.subagentCodename ??
    (event.agentId && event.agentId !== "__main__" ? event.agentId : null) ??
    event.agentName ??
    event.subAgentRole ??
    null
  );
}

export function parseToolContent(msg: ToolMessage): unknown {
  const content = msg.content;
  if (typeof content !== "string") return null;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

export function recordArrayFromUnknown(
  value: unknown,
): Record<string, unknown>[] {
  let parsed = value;
  if (typeof value === "string" && value.trim()) {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}

export function roleEmoji(role?: string): string | undefined {
  if (!role) return undefined;
  const r = role.toLowerCase();
  if (r.includes("research") || r.includes("搜索") || r.includes("调研"))
    return "🔍";
  if (
    r.includes("code") ||
    r.includes("coder") ||
    r.includes("开发") ||
    r.includes("编程")
  )
    return "💻";
  if (r.includes("write") || r.includes("writer") || r.includes("写作"))
    return "✍️";
  if (r.includes("review") || r.includes("审查") || r.includes("评审"))
    return "👀";
  if (r.includes("design") || r.includes("设计")) return "🎨";
  if (r.includes("test") || r.includes("测试")) return "🧪";
  if (r.includes("plan") || r.includes("规划")) return "📋";
  if (r.includes("analysis") || r.includes("分析")) return "📊";
  return undefined;
}

function compactMission(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const firstSentenceEnd = normalized.search(/[。！？!?]/);
  const sentence =
    firstSentenceEnd >= 0
      ? normalized.slice(0, firstSentenceEnd + 1)
      : normalized;
  return sentence.length > 140
    ? `${sentence.slice(0, 137).trimEnd()}…`
    : sentence;
}

/** Recover the shared mission for replayed clusters whose persisted lifecycle
 * markers contain identity/status but omit each worker's prompt. */
export function deriveSubagentMissionFromMessages(messages: Message[]): string {
  for (const message of messages) {
    if (!isAIMessage(message)) continue;
    for (const toolCall of message.tool_calls ?? []) {
      const toolName = toolCall.name.toLowerCase();
      if (
        !isTeammateToolName(toolName) &&
        !toolName.includes("orchestrat") &&
        !toolName.includes("parallel")
      ) {
        continue;
      }
      const mission = firstString(toolCall.args ?? {}, [
        "goal",
        "objective",
        "mission",
        "task",
        "prompt",
      ]);
      if (mission) return compactMission(mission);
    }
  }

  const humanPrompt = messages.find(
    (message) =>
      message.type === "human" && typeof message.content === "string",
  )?.content;
  return typeof humanPrompt === "string" ? compactMission(humanPrompt) : "";
}
