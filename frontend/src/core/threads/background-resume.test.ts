import { describe, expect, it } from "vitest";
import type { Message } from "@/core/api/types";
import {
  backgroundResumeMessageId,
  conversationMessageIndexes,
  visibleConversationMessages,
} from "./background-resume";
import {
  acknowledgedClientMessageIds,
  newClientMessageId,
} from "./optimistic-messages";

describe("background continuation", () => {
  it("preserves fork/feedback positions after hiding a continuation", () => {
    const messages: Message[] = [
      { type: "human", id: backgroundResumeMessageId(), content: "internal" },
      { type: "ai", id: "reply", content: "answer" },
      {
        type: "human",
        id: backgroundResumeMessageId(),
        content: "internal",
        additional_kwargs: { delivery_state: "failed" },
      },
    ];
    const visible = visibleConversationMessages(messages, "Continue");
    const positions = conversationMessageIndexes(messages, visible);
    expect(positions.get(visible[0]!)).toBe(1);
    expect(positions.get(visible[1]!)).toBe(2);
  });
  it("keeps the sent id and delivery receipt while hiding generated prompt bubbles", () => {
    const id = backgroundResumeMessageId();
    expect(newClientMessageId(id)).toBe(id);
    const messages: Message[] = [
      { type: "human", id, content: "internal continuation" },
    ];
    expect(acknowledgedClientMessageIds(messages).has(id)).toBe(true);
    expect(visibleConversationMessages(messages, "Continue")).toEqual([]);
    expect(
      visibleConversationMessages(
        JSON.parse(JSON.stringify(messages)),
        "Continue",
      ),
    ).toEqual([]);
  });

  it("retains manually typed text and keeps failed background sends retryable", () => {
    const manual: Message = {
      type: "human",
      id: "itm_user_manual",
      content: "internal continuation",
    };
    const failed: Message = {
      type: "human",
      id: backgroundResumeMessageId(),
      content: "internal continuation",
      additional_kwargs: {
        delivery_state: "failed",
        delivery_error: "offline",
      },
    };
    const result = visibleConversationMessages([manual, failed], "Continue");
    expect(result[0]).toBe(manual);
    expect(result[1]?.content).toBe("Continue");
    expect(result[1]?.additional_kwargs).toEqual(failed.additional_kwargs);
  });
});
