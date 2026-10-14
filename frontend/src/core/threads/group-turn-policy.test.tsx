import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRealtimeThread } from "@/core/realtime";
import { useThreadStreamRealtime } from "./use-thread-stream-realtime";
import { queuesGroupInput } from "./group-turn-policy";

vi.mock("@/core/realtime", () => ({ useRealtimeThread: vi.fn() }));
vi.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    t: {
      conversation: {
        previousMessagePending: "pending",
        steeringTurnUnavailable: "unavailable",
      },
      chatInputBox: { uploadFailed: "upload failed" },
    },
  }),
}));

describe("group composer queue policy", () => {
  it("requires the actual group context rather than guessing from text", () => {
    expect(queuesGroupInput({ group_conversation: true })).toBe(true);
    expect(queuesGroupInput({ group_conversation: "true" })).toBe(false);
    expect(queuesGroupInput(undefined)).toBe(false);
  });

  it("submits consecutive group messages as new turns while a peer is running", async () => {
    const startTurn = vi.fn((_input: { input: string; clientItemId?: string }) => new Promise<void>(() => {}));
    const steer = vi.fn();
    const state = {
      threadId: "shared",
      pendingApprovals: [],
      tokenUsage: null,
      resumeState: "resumed",
      turns: [
        {
          id: "peer-turn",
          threadId: "shared",
          status: "inProgress",
          startedAt: "2026-10-11T00:00:00.000Z",
          completedAt: null,
          error: null,
          items: [
            {
              id: "itm_user_peer",
              type: "userMessage",
              text: "peer input",
              status: "completed",
              createdAt: "2026-10-11T00:00:00.000Z",
            },
          ],
        },
      ],
    };
    vi.mocked(useRealtimeThread).mockReturnValue({
      state,
      connected: true,
      readyForMutations: true,
      connectionPhase: "ready",
      startTurn,
      steer,
      resolveApproval: vi.fn(),
      resume: vi.fn(),
      interrupt: vi.fn(),
      compact: vi.fn(),
      decideHunk: vi.fn(),
    } as never);
    const { result, unmount } = renderHook(() =>
      useThreadStreamRealtime({
        threadId: "shared",
        context: { group_conversation: true, team_mode: "chat" },
      }),
    );
    act(() =>
      result.current[1]("shared", { text: "first group input", files: [] }),
    );
    await waitFor(() => expect(startTurn).toHaveBeenCalledTimes(1));
    act(() =>
      result.current[1]("shared", { text: "second group input", files: [] }),
    );
    await waitFor(() => expect(startTurn).toHaveBeenCalledTimes(2));
    expect(steer).not.toHaveBeenCalled();
    expect(startTurn.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({
        input: "first group input",
        clientItemId: expect.stringMatching(/^itm_/),
      }),
      expect.objectContaining({
        input: "second group input",
        clientItemId: expect.stringMatching(/^itm_/),
      }),
    ]);
    expect(
      result.current[0].messages.map((message) => message.content),
    ).toEqual(["peer input", "first group input", "second group input"]);
    unmount();
  });
});
