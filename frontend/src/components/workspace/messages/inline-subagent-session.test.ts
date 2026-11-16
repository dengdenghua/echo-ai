import { describe, expect, it } from "vitest";
import type { AIMessage } from "@/core/api/types";
import {
  deriveSubagentsFromMessages,
  type InlineSubagentInfo,
} from "./inline-subagent-cards";
import { mergeInlineSubagentLists } from "./inline-subagent-merge";

describe("subagent continuation identities", () => {
  it("preserves the task name when a receipt supplies the shared role display name", () => {
    const message: AIMessage = {
      id: "named",
      type: "ai",
      content: "",
      tool_calls: [
        {
          id: "call",
          name: "call_agent",
          args: {
            agent_id: "build-agent",
            name: "续接验证员",
            output: JSON.stringify({
              success: true,
              display_name: "Build Agent",
              session_id: "session-a",
              output: "verified",
            }),
          },
        },
      ],
    };
    expect(deriveSubagentsFromMessages([message])[0]).toMatchObject({
      name: "续接验证员",
      sessionId: "session-a",
      status: "done",
    });
  });
  it("keeps separate calls to one role distinct and preserves a failed receipt", () => {
    const message: AIMessage = {
      id: "ai",
      type: "ai",
      content: "",
      tool_calls: [
        {
          id: "call-a",
          name: "call_agent",
          args: {
            agent_id: "build-agent",
            name: "Agent A",
            prompt: "Compute A",
            output: "host task missing",
            status: "failed",
          },
        },
        {
          id: "call-b",
          name: "call_agent",
          args: {
            agent_id: "build-agent",
            name: "Agent B",
            prompt: "Verify B",
            output: "verified",
            status: "completed",
          },
        },
      ],
    };
    expect(
      deriveSubagentsFromMessages([message]).map((a) => [
        a.id,
        a.name,
        a.status,
      ]),
    ).toEqual([
      ["call-a", "Agent A", "error"],
      ["call-b", "Agent B", "done"],
    ]);
  });
  it("matches same-role parallel results by agent identity before role", () => {
    const message: AIMessage = {
      id: "ai",
      type: "ai",
      content: "",
      tool_calls: [
        {
          id: "batch",
          name: "call_agent_parallel",
          args: {
            specs: [
              { agent_id: "a", role: "reviewer" },
              { agent_id: "b", role: "reviewer" },
            ],
            output: JSON.stringify({
              successes: [
                {
                  agent_id: "a",
                  role: "reviewer",
                  session_id: "session-a",
                  output: "A",
                },
                {
                  agent_id: "b",
                  role: "reviewer",
                  session_id: "session-b",
                  output: "B",
                },
              ],
            }),
          },
        },
      ],
    };
    const agents = deriveSubagentsFromMessages([message]);
    expect(
      agents.map((agent) => [agent.id, agent.sessionId, agent.summary]),
    ).toEqual([
      ["a", "session-a", "A"],
      ["b", "session-b", "B"],
    ]);
  });
  it("does not merge different durable sessions merely because their names match", () => {
    const base: InlineSubagentInfo = {
      id: "a",
      name: "Reviewer",
      role: "reviewer",
      sessionId: "session-a",
      task: "Review A",
      status: "done",
      filesTouchedCount: 0,
    };
    const other = {
      ...base,
      id: "b",
      task: "Review B",
      sessionId: "session-b",
    };
    expect(
      mergeInlineSubagentLists([other], [base])
        .map((agent) => agent.sessionId)
        .sort(),
    ).toEqual(["session-a", "session-b"]);
  });
});
