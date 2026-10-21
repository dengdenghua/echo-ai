import type { AIMessage, Message, ToolMessage } from "@/core/api/types";
import { repairMojibakeText, type AgentTile } from "../agent-workbench-utils";
import type { LiveToolEvent } from "../live-tool-timeline";
import type { WorkBlock } from "../work-blocks";
import { memberErrorText } from "./member-error";

function publicBlockOutput(block: WorkBlock): string {
  const observation = block.event.observation?.trim();
  if (observation) return repairMojibakeText(readableResultText(observation));
  if (block.event.error?.trim()) return repairMojibakeText(block.event.error);
  // Prefer a readable text channel inside an object payload over a raw
  // JSON.stringify dump — same contract as subagentResultText. Fall back to
  // the stringified snapshot only when the payload carries no text field.
  const rawOutput = block.event.output;
  if (rawOutput && typeof rawOutput === "object" && !Array.isArray(rawOutput)) {
    const readable = readableResultText(rawOutput);
    if (readable) return repairMojibakeText(readable);
  }
  const output = block.outputText.trim();
  if (output) return repairMojibakeText(readableResultText(output));
  return "";
}

const RESULT_TEXT_KEYS = [
  "output",
  "summary",
  "result",
  "reason",
  "message",
  "text",
  "content",
  "output_preview",
  "stdout",
  "content_text",
];

/** Turn a structured result — including legacy JSON-in-a-string envelopes —
 * into the sentence a person is meant to read. Metadata-only envelopes stay
 * blank instead of leaking implementation details into the conversation. */
function readableResultText(value: unknown, depth = 0): string {
  if (depth > 2 || value === null || value === undefined) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        const readable = readableResultText(parsed, depth + 1);
        if (readable) return readable;
      } catch {
        // It only looked like JSON; preserve the original public text.
      }
    }
    return trimmed;
  }
  if (typeof value !== "object" || Array.isArray(value)) return "";
  // Type predicate instead of an assertion: the ratchet counts `as` casts.
  function isRecord(candidate: unknown): candidate is Record<string, unknown> {
    return (
      typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)
    );
  }
  if (!isRecord(value)) return "";
  const record: Record<string, unknown> = value;
  for (const key of RESULT_TEXT_KEYS) {
    const readable = readableResultText(record[key], depth + 1);
    if (readable) return readable;
  }
  return "";
}

/** Readable final-answer text for a finished sub-agent event.
 *
 * Prefer explicit text channels (``observation``, ``result.output`` /
 * ``summary`` / ``output_preview`` / ``result``). Never JSON-stringify the
 * whole result envelope as a stand-in answer — that used to render the
 * lifecycle metadata ({codename, role, agent_id, duration_s, ...}) as if it
 * were the agent's verdict. */
function subagentResultText(event: LiveToolEvent): string {
  const observation = event.observation?.trim();
  if (observation) return readableResultText(observation);
  for (const bag of [event.input, event.output]) {
    const text = readableResultText(bag);
    if (text) return text;
  }
  return event.error?.trim() ?? "";
}

/**
 * Project one selected sub-agent's event stream onto the exact message model
 * used by the main conversation. MessageGroup then owns thinking/execution
 * streaming, aggregation and disclosure state; this view owns only isolation.
 */
export function subagentMessages(
  agent: AgentTile,
  blocks: WorkBlock[],
): {
  task: Message | null;
  process: Message[];
  answer: Message | null;
} {
  const taskText = repairMojibakeText(
    agent.prompt ?? agent.task ?? agent.lastThought ?? "",
  );
  const task: Message | null = taskText
    ? {
        id: `subagent-${agent.id}-task`,
        type: "human",
        content: taskText,
      }
    : null;
  const process: Message[] = [];
  // Once the agent settles, a trailing block that never received a done event
  // must not keep rendering as "running": fold its output into a real result
  // row instead of leaving a half-open step.
  const settled = agent.status === "done" || agent.status === "error";
  let answerText = "";
  let answerId = `subagent-${agent.id}-answer`;

  for (const block of blocks) {
    const event = block.event;
    if (event.lifecycle === "spawned") continue;
    if (event.lifecycle === "finished") {
      const text = repairMojibakeText(
        subagentResultText(event) || agent.resultSummary || agent.error || "",
      );
      if (text) {
        answerText = text;
        answerId = `${block.id}-answer`;
      }
      continue;
    }

    const callId = event.id || block.id;
    const output = publicBlockOutput(block);
    const thought = repairMojibakeText(event.thought?.trim() || "");
    const ai: AIMessage = {
      id: `${block.id}-assistant`,
      type: "ai",
      content: "",
      tool_calls: [
        {
          id: callId,
          name: event.name,
          args: {
            ...(event.input ?? {}),
            // Match the main conversation's realtime adapter contract: live
            // execution output belongs to the active tool call until it ends.
            ...(event.status === "running" && !settled && output
              ? { output }
              : {}),
          },
          parentItemId: event.parentToolUseId ?? null,
        },
      ],
      additional_kwargs: {
        ...(thought ? { reasoning_content: thought } : {}),
        agent_id: agent.id,
        agent_display_name: agent.codename ?? agent.name,
      },
    };
    process.push(ai);

    if (event.status === "done" || event.status === "error" || settled) {
      const tool: ToolMessage = {
        id: `${block.id}-result`,
        type: "tool",
        tool_call_id: callId,
        content: output || event.error || "",
        status: event.status === "error" ? "error" : "success",
      };
      process.push(tool);
    }
  }

  if (!answerText) {
    answerText = repairMojibakeText(
      readableResultText(agent.resultSummary ?? agent.error ?? ""),
    );
  }
  if (agent.status === "error") answerText = memberErrorText(answerText);
  const answer: Message | null = answerText
    ? {
        id: answerId,
        type: "ai",
        content: answerText,
        additional_kwargs: {
          agent_id: agent.id,
          agent_display_name: agent.codename ?? agent.name,
          ...(agent.status === "error" ? { response_state: "failed" } : {}),
        },
      }
    : null;

  return { task, process, answer };
}
