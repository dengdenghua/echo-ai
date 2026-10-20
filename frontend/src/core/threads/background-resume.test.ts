import { describe, expect, it } from "vitest";
import { composerActionsCopy } from "@/core/i18n/locales/composer-actions";
import type { Message } from "@/core/api/types";
import {
  backgroundResumeMessageId,
  isBackgroundResumePrompt,
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
    expect(visible).toHaveLength(1);
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

  it("retains manually typed text and hides failed background sends", () => {
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
    expect(result).toEqual([manual]);
    expect(failed.additional_kwargs?.delivery_state).toBe("failed");
  });
});

it.each(["zh-CN", "en-US", "ja-JP", "ko-KR"])(
  "hides legacy generated prompts in %s without hiding typed continue",
  (locale) => {
    const copy = composerActionsCopy(locale);
    const generated: Message = {
      type: "human",
      id: "old-id",
      content: copy.resumePrompt,
    };
    const failed: Message = {
      type: "human",
      id: backgroundResumeMessageId(),
      content: copy.resume,
      additional_kwargs: { delivery_state: "failed" },
    };
    const manual: Message = {
      type: "human",
      id: "typed-id",
      content: copy.resume,
    };
    expect(isBackgroundResumePrompt(copy.resumePrompt)).toBe(true);
    expect(isBackgroundResumePrompt(copy.resume)).toBe(false);
    expect(
      visibleConversationMessages([failed, generated, manual], copy.resume),
    ).toEqual([manual]);
    expect(
      visibleConversationMessages(
        JSON.parse(JSON.stringify([failed, generated])),
        copy.resume,
      ),
    ).toEqual([]);
  },
);
