import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Message } from "@/core/api/types";
import { composerActionsCopy } from "@/core/i18n/locales/composer-actions";
import { visibleConversationMessages } from "@/core/threads/background-resume";
import { RETRY_PENDING_MESSAGE_EVENT } from "@/core/threads/optimistic-messages";
import { emptyVitals } from "@/core/realtime/stream-vitals";

import {
  useConversationTurnSenders,
  useDirectTurnSenders,
} from "./use-turn-lifecycle";
import type { RealtimeThread } from "./realtime-page-types";

vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({ locale: "zh-CN" }),
}));

const messages: Message[] = [
  { id: "request-1", type: "human", content: "生成自行车动画" },
  { id: "partial-1", type: "ai", content: "已完成链条建模。" },
];

function setup(
  overrides: {
    messages?: Message[];
    isLoading?: boolean;
    readyForMutations?: boolean;
  } = {},
) {
  const props = {
    threadId: "thread-1",
    isLoading: false,
    readyForMutations: true,
    sendMessage: vi.fn(),
    markSidebarThreadRunning: vi.fn(),
    messages,
    ...overrides,
  };
  const hook = renderHook((input) => useDirectTurnSenders(input), {
    initialProps: props,
  });
  return { ...hook, props };
}

describe("shared task recovery", () => {
  it("shares the same click guard with failed-response regeneration", () => {
    const sendMessage = vi.fn();
    const thread: RealtimeThread = {
      messages,
      streamingMessage: null,
      subgraphStreams: {},
      values: { messages },
      isLoading: false,
      error: undefined,
      stop: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
      submit: vi.fn(),
      threadId: "thread-1",
      connectionPhase: "ready",
      readyForMutations: true,
      vitals: emptyVitals(),
      lastTurnStatus: "failed",
    };
    const { result } = renderHook(() =>
      useConversationTurnSenders({
        thread,
        threadId: "thread-1",
        sendMessage,
        markSidebarThreadRunning: vi.fn(),
        isLoading: false,
        readyForMutations: true,
      }),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent("echo:regenerate", {
          detail: { threadId: "thread-1" },
        }),
      );
      result.current.handleRetryTask();
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        text: composerActionsCopy("zh-CN").resumePrompt,
        clientMessageId: expect.stringMatching(/^ui-resume-/),
      }),
    );
  });

  it.each(["composer", "transcript"])(
    "resumes from %s without replaying the request or showing a bubble",
    (entry) => {
      const { result, props } = setup();
      act(() => {
        if (entry === "composer") result.current.handleRetryTask();
        else {
          const onRetryTask: (prompt: string) => void =
            result.current.handleRetryTask;
          onRetryTask("生成自行车动画");
        }
      });
      expect(props.sendMessage).toHaveBeenCalledTimes(1);
      expect(props.sendMessage).toHaveBeenCalledWith("thread-1", {
        text: composerActionsCopy("zh-CN").resumePrompt,
        files: [],
        clientMessageId: expect.stringMatching(/^ui-resume-/),
      });
      const sent = props.sendMessage.mock.calls[0]![1];
      expect(
        visibleConversationMessages(
          [
            ...messages,
            {
              id: sent.clientMessageId,
              type: "human",
              content: sent.text,
            },
          ],
          "继续",
        ),
      ).toEqual(messages);
    },
  );

  it("coalesces clicks across both entry points even when they provide different text", () => {
    const { result, props } = setup();
    act(() => {
      const transcriptRetry: (prompt: string) => void =
        result.current.handleRetryTask;
      transcriptRetry("生成自行车动画");
      result.current.handleRetryTask();
    });
    expect(props.sendMessage).toHaveBeenCalledTimes(1);
    expect(props.markSidebarThreadRunning).toHaveBeenCalledTimes(1);
  });

  it.each(["request-1", "ui-resume-failed"])(
    "retries failed outbound %s through the original delivery ledger",
    (id) => {
      const { result, props } = setup({
        messages: [
          {
            id,
            type: "human",
            content: "原始待发送内容",
            additional_kwargs: {
              delivery_state: "failed",
              attachments: [{ filename: "drawing.png" }],
            },
          },
        ],
      });
      const retry = vi.fn();
      window.addEventListener(RETRY_PENDING_MESSAGE_EVENT, retry);
      try {
        act(() => result.current.handleRetryTask());
        expect(retry).toHaveBeenCalledTimes(1);
        expect(retry.mock.calls[0]![0].detail).toEqual({
          threadId: "thread-1",
          clientMessageId: id,
        });
        expect(props.sendMessage).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener(RETRY_PENDING_MESSAGE_EVENT, retry);
      }
    },
  );

  it.each([{ isLoading: true }, { readyForMutations: false }])(
    "does not enqueue recovery while blocked: %j",
    (blocked) => {
      const { result, props } = setup(blocked);
      act(() => result.current.handleRetryTask());
      expect(props.sendMessage).not.toHaveBeenCalled();
      expect(props.markSidebarThreadRunning).not.toHaveBeenCalled();
    },
  );

  it("keeps explicit project commands as visible user instructions", () => {
    const { result, props } = setup();
    act(() => result.current.handleSendFollowUp("运行项目检查"));
    expect(props.sendMessage).toHaveBeenCalledWith("thread-1", {
      text: "运行项目检查",
      files: [],
    });
  });
});
