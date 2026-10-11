import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createTurnDeliveryWatch, turnContainsUserItem } from "./turn-delivery";
import { useRealtimeThread } from "./use-realtime-thread";

describe("queued turn delivery receipts", () => {
  it("mints a stable input coordinate when the caller omitted one", () => {
    const watch = createTurnDeliveryWatch();
    expect(watch.clientItemId).toMatch(/^itm_[A-Za-z0-9][A-Za-z0-9_-]{4,}$/);
    expect(createTurnDeliveryWatch("itm_user_existing").clientItemId).toBe(
      "itm_user_existing",
    );
    expect(
      turnContainsUserItem(
        { items: [{ type: "userMessage", id: watch.clientItemId }] },
        watch.clientItemId,
      ),
    ).toBe(true);
    expect(
      turnContainsUserItem(
        { items: [{ type: "agentMessage", id: watch.clientItemId }] },
        watch.clientItemId,
      ),
    ).toBe(false);
  });

  it.each([false, true])(
    "does not acknowledge peer input; own receipt=%s",
    async (ownReceipt) => {
      let emit!: (note: {
        method: string;
        params: Record<string, unknown>;
      }) => void;
      let reject!: (error: Error) => void;
      let userItemId: unknown;
      const factory = (deps: {
        onNotification: typeof emit;
        onOpen?: () => void;
      }) => {
        emit = deps.onNotification;
        return {
          connect: () => deps.onOpen?.(),
          close: () => {},
          notify: () => {},
          request: (method: string, params: Record<string, unknown>) => {
            if (method === "thread/resume")
              return Promise.resolve({ thread: { id: "shared" }, turns: [] });
            userItemId = params.userItemId;
            expect(params.queueIfBusy).toBe(true);
            return new Promise((_resolve, rejectRequest) => {
              reject = rejectRequest;
            });
          },
        };
      };
      const { result, unmount } = renderHook(() =>
        useRealtimeThread({
          threadId: "shared",
          clientFactory: factory as never,
        }),
      );
      await waitFor(() =>
        expect(result.current.state.resumeState).toBe("resumed"),
      );
      let settled!: Promise<string>;
      act(() => {
        settled = result.current.startTurn({ input: "same text" }).then(
          () => "delivered",
          () => "undelivered",
        );
      });
      act(() => {
        emit({
          method: "turn/started",
          params: {
            threadId: "shared",
            turn: {
              id: "peer-turn",
              threadId: "shared",
              status: "inProgress",
              items: [
                { type: "userMessage", id: "itm_user_peer", text: "same text" },
              ],
              startedAt: "2026-10-11T00:00:00.000Z",
              completedAt: null,
              error: null,
            },
          },
        });
        if (ownReceipt)
          emit({
            method: "item/started",
            params: {
              threadId: "shared",
              turnId: "own-turn",
              item: { id: userItemId, type: "userMessage", text: "same text" },
            },
          });
        reject(new Error("connection closed while waiting"));
      });
      await expect(settled).resolves.toBe(
        ownReceipt ? "delivered" : "undelivered",
      );
      unmount();
    },
  );
});
