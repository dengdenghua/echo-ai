import { afterEach, describe, expect, it, vi } from "vitest";
import { eventBus, type EventMap } from "@/core/events/event-bus";
import {
  MESSAGE_CONFIRMED_EVENT,
  submitComposerRequest,
} from "./composer-request";
import { newClientMessageId } from "./optimistic-messages";

afterEach(() => {
  eventBus.clear();
  vi.useRealTimers();
});

describe("scoped composer receipts", () => {
  it("fails when there is no composer", async () => {
    expect(await submitComposerRequest("t1", "publish")).toBe("failed");
  });
  it("ignores another chat or message and accepts only the matching server receipt", async () => {
    let request!: EventMap["composer:submit-request"];
    eventBus.on("composer:submit-request", (value) => {
      request = value;
    });
    const pending = submitComposerRequest("t1", "publish");
    const done = vi.fn();
    void pending.then(done);
    expect(newClientMessageId(request.clientMessageId)).toBe(
      request.clientMessageId,
    );
    window.dispatchEvent(
      new CustomEvent(MESSAGE_CONFIRMED_EVENT, {
        detail: { threadId: "other", clientMessageId: request.clientMessageId },
      }),
    );
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    window.dispatchEvent(
      new CustomEvent(MESSAGE_CONFIRMED_EVENT, {
        detail: { threadId: "t1", clientMessageId: request.clientMessageId },
      }),
    );
    expect(await pending).toBe("confirmed");
  });
  it("reports failed transport separately from an unknown timeout", async () => {
    vi.useFakeTimers();
    let request!: EventMap["composer:submit-request"];
    eventBus.on("composer:submit-request", (value) => {
      request = value;
    });
    const failed = submitComposerRequest("t1", "publish");
    window.dispatchEvent(
      new CustomEvent("echo:send-failed", {
        detail: { threadId: "t1", clientMessageId: request.clientMessageId },
      }),
    );
    expect(await failed).toBe("failed");
    const unknown = submitComposerRequest("t1", "publish");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await unknown).toBe("unknown");
  });
});
