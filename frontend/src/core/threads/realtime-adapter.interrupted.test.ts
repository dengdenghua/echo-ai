import { describe, expect, it } from "vitest";

import type {
  AgentMessageItem,
  Conversation,
  Turn,
  UserMessageItem,
} from "@/core/realtime/items";
import { conversationToAgentThreadState } from "./realtime-adapter";

function makeConv(turns: Turn[]): Conversation {
  return {
    threadId: "th-test",
    turns,
    pendingApprovals: [],
    tokenUsage: null,
    resumeState: "resumed",
  };
}

function makeTurn(
  items: Turn["items"],
  status: Turn["status"] = "completed",
): Turn {
  return {
    id: "t1",
    threadId: "th-test",
    status,
    startedAt: "2026-05-09T00:00:00Z",
    completedAt: status === "completed" ? "2026-05-09T00:00:01Z" : null,
    items,
    error: null,
  };
}

const userMsg = (text: string, id = "u1"): UserMessageItem => ({
  id,
  type: "userMessage",
  status: "completed",
  createdAt: "2026-05-09T00:00:00Z",
  text,
});

const agentMsg = (text: string, id = "a1"): AgentMessageItem => ({
  id,
  type: "agentMessage",
  status: "completed",
  createdAt: "2026-05-09T00:00:00Z",
  text,
});

describe("conversationToAgentThreadState · interrupted turn", () => {
  it.each(["interrupted", "cancelled"] as const)(
    "preserves an unfinished answer with its %s receipt",
    (status) => {
      const state = conversationToAgentThreadState(
        makeConv([
          makeTurn(
            [
              userMsg("q"),
              { ...agentMsg("partial answer"), messageKind: "answer" },
            ],
            status,
          ),
        ]),
      );
      expect(state.messages[1]).toMatchObject({
        content: "partial answer",
        additional_kwargs: {
          response_state: status,
          interrupted_draft: "partial answer",
        },
      });
    },
  );
});
