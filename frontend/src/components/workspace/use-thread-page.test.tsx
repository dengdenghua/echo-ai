import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Message } from "@/core/api/types";
import type { BaseStream } from "@/core/api/use-stream-types";
import type { AgentThreadState } from "@/core/threads";

import { useRegenerateHandler } from "./use-thread-page";

function threadWithStop(
  stop: BaseStream<AgentThreadState>["stop"],
): BaseStream<AgentThreadState> {
  const messages: Message[] = [
    { id: "human-1", type: "human", content: "retry this request" },
  ];
  return {
    messages,
    streamingMessage: null,
    subgraphStreams: {},
    values: { messages },
    isLoading: true,
    error: undefined,
    stop,
    refresh: vi.fn(),
    submit: vi.fn(),
    threadId: "thread-1",
  };
}

describe("useRegenerateHandler", () => {
  it("uses shared recovery for a failed turn instead of replaying the last request", () => {
    const sendMessage = vi.fn();
    const retryFailedTask = vi.fn();
    const thread = { ...threadWithStop(vi.fn()), isLoading: false };
    renderHook(() =>
      useRegenerateHandler(thread, sendMessage, "thread-1", retryFailedTask),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent("echo:regenerate", {
          detail: { threadId: "thread-1" },
        }),
      );
    });
    expect(retryFailedTask).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(thread.stop).not.toHaveBeenCalled();
  });

  it("waits for an active turn to stop before sending the regenerated prompt", async () => {
    let resolveStop!: () => void;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveStop = resolve;
        }),
    );
    const sendMessage = vi.fn();

    renderHook(() =>
      useRegenerateHandler(threadWithStop(stop), sendMessage, "thread-1"),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent("echo:regenerate", {
          detail: { threadId: "thread-1" },
        }),
      );
    });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      resolveStop();
      await Promise.resolve();
    });
    expect(sendMessage).toHaveBeenCalledWith("thread-1", {
      text: "retry this request",
      files: [],
    });
  });

  it("does not regenerate when stopping the active turn is rejected", async () => {
    const stop = vi.fn().mockRejectedValue(new Error("worker rejected stop"));
    const sendMessage = vi.fn();

    renderHook(() =>
      useRegenerateHandler(threadWithStop(stop), sendMessage, "thread-1"),
    );
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("echo:regenerate", {
          detail: { threadId: "thread-1" },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
