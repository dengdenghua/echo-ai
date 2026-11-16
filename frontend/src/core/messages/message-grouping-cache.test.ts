import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "@/core/api/types";

const extractCalls = vi.hoisted(() => [] as string[]);

vi.mock("./visible-content", async () => {
  const actual = await vi.importActual<typeof import("./visible-content")>(
    "./visible-content",
  );
  return {
    ...actual,
    extractContentFromMessage: (message: Message) => {
      extractCalls.push(String(message.id));
      return actual.extractContentFromMessage(message);
    },
  };
});

const { extractContentFromMessage, groupMessages } = await import("./utils");

function history(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => {
    if (index % 2 === 0) {
      return {
        id: `human-${index}`,
        type: "human",
        content: `request ${index}`,
      } as Message;
    }
    return {
      id: `ai-${index}`,
      type: "ai",
      content: `settled answer ${index}`,
      additional_kwargs: { message_kind: "answer", run_status: "completed" },
    } as Message;
  });
}

describe("message grouping content cache", () => {
  beforeEach(() => {
    extractCalls.length = 0;
  });

  it("shares one extraction across every consumer of the same message", () => {
    const message = history(1)[0]!;
    expect(extractContentFromMessage(message)).toBe("request 0");
    expect(extractContentFromMessage(message)).toBe("request 0");
    expect(extractCalls).toEqual(["human-0"]);
  });

  it("reparses only the changed streaming message on the next frame", () => {
    const messages = history(500);
    const firstGroups = groupMessages(messages, (group) => group);
    expect(firstGroups.length).toBeGreaterThan(0);
    expect(extractCalls.length).toBeGreaterThan(0);

    extractCalls.length = 0;
    const streamingMessage = {
      id: "ai-streaming",
      type: "ai",
      content: "partial answer",
      additional_kwargs: {
        message_kind: "answer",
        run_status: "streaming",
      },
    } as Message;
    const nextMessages = [
      ...messages,
      streamingMessage,
    ];
    groupMessages(nextMessages, (group) => group);

    expect(new Set(extractCalls)).toEqual(new Set(["ai-streaming"]));
  });

  it("does not reuse a previous content classification for a new object", () => {
    const seed = history(20);
    const first = {
      id: "ai-tail",
      type: "ai",
      content: "short",
      additional_kwargs: { message_kind: "answer", run_status: "streaming" },
    } as Message;
    const firstGroups = groupMessages([...seed, first], (group) => group);

    const second = {
      ...first,
      content: `${"detail ".repeat(80)}`,
    } as Message;
    const secondGroups = groupMessages([...seed, second], (group) => group);

    expect(firstGroups.length).toBe(secondGroups.length);
    expect(extractCalls).toContain("ai-tail");
    expect(
      secondGroups.at(-1)?.messages.some((message) => message.id === "ai-tail"),
    ).toBe(true);
  });
});
