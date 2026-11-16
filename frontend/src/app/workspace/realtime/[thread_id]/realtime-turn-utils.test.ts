import { describe, expect, it } from "vitest";

import type { Message } from "@/core/api/types";

import {
  collectConversationUserInput,
  latestTurnPreviewBlocks,
} from "./realtime-turn-utils";

function human(
  id: string,
  content: string,
  additional_kwargs?: Record<string, unknown>,
): Message {
  return { id, type: "human", content, additional_kwargs } as Message;
}

function ai(id: string, content: string): Message {
  return { id, type: "ai", content } as Message;
}

describe("collectConversationUserInput", () => {
  it("keeps identity stable while only assistant tokens are appended", () => {
    const firstHuman = human("human-1", "first");
    const firstAi = ai("ai-1", "answer");
    const initial = collectConversationUserInput([firstHuman, firstAi]);
    const streamed = collectConversationUserInput([
      firstHuman,
      firstAi,
      ai("ai-2", "more tokens"),
    ]);
    expect(streamed).toBe(initial);
  });

  it("aggregates files across humans and dedupes by filename", () => {
    const first = human("human-1", "first", {
      files: [
        { filename: "brief.md", path: "/tmp/brief.md" },
        { filename: "shared.png", path: "/tmp/shared.png" },
      ],
    });
    const second = human("human-2", "follow up", {
      attachments: [{ filename: "shared.png" }, { filename: "later.png" }],
    });
    expect(collectConversationUserInput([first, ai("ai-1", "ok"), second])).toEqual({
      text: "follow up",
      uploadedFiles: [
        { filename: "brief.md", path: "/tmp/brief.md" },
        { filename: "shared.png", path: "/tmp/shared.png" },
      ],
      attachments: [{ filename: "later.png" }],
    });
  });

  it("invalidates when an earlier human message is removed", () => {
    const first = human("human-1", "first", {
      files: [{ filename: "brief.md", path: "/tmp/brief.md" }],
    });
    const second = human("human-2", "second");
    const withHistory = collectConversationUserInput([first, second]);
    expect(withHistory?.uploadedFiles).toHaveLength(1);

    const withoutHistory = collectConversationUserInput([second]);
    expect(withoutHistory).not.toBe(withHistory);
    expect(withoutHistory).toEqual({
      text: "second",
      uploadedFiles: [],
      attachments: [],
    });
  });

  it("returns null when the conversation has no human message", () => {
    expect(collectConversationUserInput([ai("ai-1", "hello")])).toBeNull();
  });
});

describe("latestTurnPreviewBlocks", () => {
  it("reuses parsed blocks for an unchanged assistant message", () => {
    const request = human("human-1", "render this");
    const answer = ai("ai-1", "```html\n<div>Hello</div>\n```");
    const first = latestTurnPreviewBlocks([request, answer]);
    expect(first).not.toBeNull();
    expect(latestTurnPreviewBlocks([request, answer, ai("ai-2", "tail")])).toBe(
      first,
    );
  });
});
