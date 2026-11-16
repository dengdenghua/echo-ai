import { beforeEach, describe, expect, it } from "vitest";

import {
  clearRoomOutboxForScope,
  readRoomOutbox,
  roomOutboxKey,
  writeRoomOutbox,
} from "./room-message-state";

const OWNER = "local:owner";
const READER = "local:reader";

function queued(text: string) {
  return {
    client_message_id: `client-${text}`,
    text,
    created_at: "2026-10-24T16:00:00Z",
  };
}

describe("room outbox account scope", () => {
  beforeEach(() => window.localStorage.clear());

  it("uses disjoint keys for accounts sharing a browser participant id", () => {
    expect(roomOutboxKey("room-1", "browser-7", OWNER)).not.toBe(
      roomOutboxKey("room-1", "browser-7", READER),
    );
  });

  it("does not read or overwrite another account's queued messages", () => {
    writeRoomOutbox("room-1", "browser-7", [queued("owner")], OWNER);
    writeRoomOutbox("room-1", "browser-7", [queued("reader")], READER);

    expect(readRoomOutbox("room-1", "browser-7", OWNER)).toEqual([
      queued("owner"),
    ]);
    expect(readRoomOutbox("room-1", "browser-7", READER)).toEqual([
      queued("reader"),
    ]);
  });

  it("clears only the signing-out account", () => {
    writeRoomOutbox("room-1", "browser-7", [queued("owner")], OWNER);
    writeRoomOutbox("room-1", "browser-7", [queued("reader")], READER);

    clearRoomOutboxForScope(OWNER);

    expect(readRoomOutbox("room-1", "browser-7", OWNER)).toEqual([]);
    expect(readRoomOutbox("room-1", "browser-7", READER)).toEqual([
      queued("reader"),
    ]);
  });

  it("ignores legacy unscoped outbox keys", () => {
    window.localStorage.setItem(
      "echo:room-outbox:room-1:browser-7",
      JSON.stringify([queued("legacy")]),
    );
    expect(readRoomOutbox("room-1", "browser-7", OWNER)).toEqual([]);
  });
});
