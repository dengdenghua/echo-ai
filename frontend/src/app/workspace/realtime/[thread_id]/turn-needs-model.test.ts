import { describe, expect, it } from "vitest";

import type { Message } from "@/core/api/types";

import { turnNeedsModel } from "./use-agent-run-state";

function failedTurn(message: string): Message[] {
  return [
    { id: "h1", type: "human", content: "你好" },
    {
      id: "a1",
      type: "ai",
      content: "",
      additional_kwargs: { error: { message, info: { code: "turn_failed" } } },
    },
  ];
}

describe("turnNeedsModel", () => {
  it("reads a structured no-model failure as a setup step", () => {
    expect(
      turnNeedsModel(failedTurn("no LLM model configured"), undefined, false),
    ).toBe(true);
    expect(
      turnNeedsModel(
        failedTurn("先在设置里连接 OpenCode Zen（免费，需要 API Key）。"),
        undefined,
        false,
      ),
    ).toBe(true);
  });

  it("reads a thread-level no-model error too", () => {
    expect(
      turnNeedsModel([], new Error("no LLM model configured"), false),
    ).toBe(true);
  });

  it("keeps real failures, and a turn still loading, out of it", () => {
    expect(
      turnNeedsModel(failedTurn("upstream timed out"), undefined, false),
    ).toBe(false);
    expect(
      turnNeedsModel(failedTurn("no LLM model configured"), undefined, true),
    ).toBe(false);
  });
});
