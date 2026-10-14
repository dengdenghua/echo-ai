import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet } from "@/core/api/request";
import { swallow } from "@/core/utils/log";
import {
  readRoomOutbox,
  enqueueRoomOutbox,
  type RoomMessage,
  type RoomMessageReceipt,
} from "./room-message-state";
import { useRoomTranscript } from "./use-room-transcript";

vi.mock("@/core/api/request", () => ({ apiGet: vi.fn() }));
vi.mock("@/core/utils/log", () => ({ swallow: vi.fn() }));

function line(seq: number, participant = "sender", clientId = "") {
  return {
    message_id: `message-${participant}-${seq}`,
    seq,
    session_seq: seq + 30,
    text: `line ${seq}`,
    participant_id: participant,
    display_name: participant,
    client_message_id: clientId,
    session_id: "thread-1",
    ts: "2026-10-13T00:00:00Z",
    receipts: [],
  };
}
function page(
  messages: ReturnType<typeof line>[],
  epoch = "epoch-1",
  more = false,
) {
  return {
    messages,
    cursor_epoch: epoch,
    next_after_seq: messages.at(-1)?.seq ?? 0,
    has_more: more,
    cursor_reset: false,
  };
}
function useHarness(teamId = "room-1") {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [receipts, setReceipts] = useState<RoomMessageReceipt[]>([]);
  const receive = useRoomTranscript({
    teamId,
    participantId: "owner",
    threadId: "thread-1",
    displayName: "Owner",
    setMessages,
    setReceipts,
  });
  return { messages, receipts, receive, setMessages };
}
beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
});

describe("Room transcript recovery", () => {
  it("restores messages and receipts, then paginates a matching reconnect cursor", async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce(
        page([
          {
            ...line(1),
            receipts: [
              {
                message_id: "message-sender-1",
                participant_id: "reader",
                status: "read",
                seq: 1,
              },
            ],
          },
        ]) as never,
      )
      .mockResolvedValueOnce(page([line(2), line(3)], "epoch-1", true) as never)
      .mockResolvedValueOnce(page([line(4)]) as never);
    const { result } = renderHook(() => useHarness());
    act(() =>
      result.current.receive({ type: "ready", cursor_epoch: "epoch-1" }),
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]?.session_seq).toBe(31);
    expect(result.current.receipts[0]?.status).toBe("read");
    act(() =>
      result.current.receive({ type: "ready", cursor_epoch: "epoch-1" }),
    );
    await waitFor(() =>
      expect(result.current.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]),
    );
    expect(vi.mocked(apiGet).mock.calls[1]?.[1]).toMatchObject({
      query: { after_seq: 1, cursor_epoch: "epoch-1" },
    });
    expect(vi.mocked(apiGet).mock.calls[2]?.[1]).toMatchObject({
      query: { after_seq: 3, cursor_epoch: "epoch-1" },
    });
  });

  it("drops obsolete epoch responses while preserving the local outbox and newer live messages", async () => {
    let resolveOld!: (value: never) => void;
    vi.mocked(apiGet)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(page([line(2)], "epoch-2") as never);
    enqueueRoomOutbox("room-1", "owner", {
      client_message_id: "pending",
      text: "pending",
    });
    const { result } = renderHook(() => useHarness());
    act(() =>
      result.current.receive({ type: "ready", cursor_epoch: "epoch-1" }),
    );
    act(() =>
      result.current.receive({ type: "ready", cursor_epoch: "epoch-2" }),
    );
    act(() =>
      result.current.setMessages((current) => [
        ...current,
        {
          message_id: "new-live",
          participant_id: "sender",
          display_name: "sender",
          text: "live",
          created_at: "now",
          seq: 3,
        },
      ]),
    );
    await waitFor(() =>
      expect(result.current.messages.some((m) => m.seq === 2)).toBe(true),
    );
    await act(async () => resolveOld(page([line(1)], "epoch-1") as never));
    expect(result.current.messages.map((m) => m.message_id)).toEqual([
      "message-sender-2",
      "new-live",
      "local:pending",
    ]);
    expect(readRoomOutbox("room-1", "owner")).toHaveLength(1);
  });

  it("ignores a response for the previous Room", async () => {
    let resolveOld!: (value: never) => void;
    vi.mocked(apiGet).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ teamId }) => useHarness(teamId),
      { initialProps: { teamId: "room-1" } },
    );
    act(() =>
      result.current.receive({ type: "ready", cursor_epoch: "epoch-1" }),
    );
    rerender({ teamId: "room-2" });
    await act(async () => resolveOld(page([line(1)]) as never));
    expect(result.current.messages).toEqual([]);
  });

  it("only removes queued messages belonging to the acknowledged participant", async () => {
    enqueueRoomOutbox("room-1", "owner", {
      client_message_id: "shared",
      text: "mine",
    });
    vi.mocked(apiGet)
      .mockResolvedValueOnce(page([line(1, "another", "shared")]) as never)
      .mockResolvedValueOnce(page([line(2, "owner", "shared")]) as never);
    const { result } = renderHook(() => useHarness());
    act(() =>
      result.current.receive({ type: "ready", cursor_epoch: "epoch-1" }),
    );
    await waitFor(() =>
      expect(result.current.messages.some((m) => m.seq === 1)).toBe(true),
    );
    expect(readRoomOutbox("room-1", "owner")).toHaveLength(1);
    act(() => result.current.receive({ type: "thread:update" }));
    await waitFor(() => expect(readRoomOutbox("room-1", "owner")).toEqual([]));
    expect(result.current.messages).toHaveLength(2);
  });

  it("retains prior history when catch-up fails", async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce(page([line(1)]) as never)
      .mockRejectedValueOnce(new Error("temporarily unavailable"));
    const { result } = renderHook(() => useHarness());
    act(() =>
      result.current.receive({ type: "ready", cursor_epoch: "epoch-1" }),
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    act(() =>
      result.current.receive({ type: "ready", cursor_epoch: "epoch-1" }),
    );
    await waitFor(() => expect(swallow).toHaveBeenCalled());
    expect(result.current.messages[0]?.seq).toBe(1);
  });
});
