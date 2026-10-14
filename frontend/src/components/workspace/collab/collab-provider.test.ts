import { describe, expect, it } from "vitest";

import {
  upsertRoomMessage,
  upsertRoomMessageReceipt,
  type RoomMessage,
  type RoomMessageReceipt,
} from "./collab-provider";

function message(overrides: Partial<RoomMessage> = {}): RoomMessage {
  return {
    message_id: "room-msg-one",
    participant_id: "alice",
    display_name: "Alice",
    text: "hello",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("room message delivery state", () => {
  it("replaces the optimistic message with the server receipt", () => {
    const pending = message({
      message_id: "local:client-one",
      client_message_id: "client-one",
      delivery_status: "sending",
    });
    const receipt = message({
      client_message_id: "client-one",
      seq: 12,
      delivery_status: "sent",
    });

    expect(upsertRoomMessage([pending], receipt)).toEqual([receipt]);
  });

  it("deduplicates a repeated server receipt", () => {
    const receipt = message({
      client_message_id: "client-one",
      seq: 12,
      delivery_status: "sent",
    });

    expect(upsertRoomMessage([receipt], { ...receipt })).toHaveLength(1);
  });

  it("keeps different participants with the same client id distinct", () => {
    const alice = message({ client_message_id: "shared", seq: 1 });
    const bob = message({
      message_id: "bob-message",
      participant_id: "bob",
      client_message_id: "shared",
      seq: 2,
    });
    expect(upsertRoomMessage([alice], bob)).toEqual([alice, bob]);
  });

  it("merges a late history snapshot without downgrading reads or reordering newer live messages", () => {
    const read = message({ seq: 1, delivery_status: "read" });
    const live = message({ message_id: "newer", seq: 3 });
    const historical = message({ message_id: "middle", seq: 2 });
    let messages = upsertRoomMessage([read, live], historical);
    messages = upsertRoomMessage(messages, {
      ...read,
      delivery_status: "sent",
    });
    expect(messages.map((item) => item.seq)).toEqual([1, 2, 3]);
    expect(messages[0]?.delivery_status).toBe("read");
  });
});

describe("room message receipts", () => {
  const delivered: RoomMessageReceipt = {
    room_id: "room-one",
    message_id: "room-msg-one",
    participant_id: "bob",
    status: "delivered",
    seq: 12,
  };

  it("never regresses a read receipt back to delivered", () => {
    const read = { ...delivered, status: "read" as const };
    expect(upsertRoomMessageReceipt([read], delivered)[0]?.status).toBe("read");
  });

  it("keeps receipts distinct per participant", () => {
    const other = { ...delivered, participant_id: "carol" };
    expect(upsertRoomMessageReceipt([delivered], other)).toHaveLength(2);
  });
});
