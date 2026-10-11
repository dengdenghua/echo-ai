import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { subscribeProjectUpdates } from "./project-updates-api";

const mocks = vi.hoisted(() => ({ headers: vi.fn(), actor: vi.fn() }));
vi.mock("@/core/auth/api", () => ({
  authHeaders: mocks.headers,
  currentActorId: mocks.actor,
}));
vi.mock("@/core/config", () => ({
  getBackendWebSocketBaseURL: () => "ws://localhost:8310/",
}));

class Socket {
  static instances: Socket[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn(() => this.onclose?.());
  constructor(
    public url: string,
    public protocols?: string[],
  ) {
    Socket.instances.push(this);
  }
  emit(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  Socket.instances = [];
  mocks.headers.mockReturnValue({
    Authorization: "Bearer private-session-token",
  });
  mocks.actor.mockReturnValue("alice");
  vi.stubGlobal("WebSocket", Socket);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("uses bearer subprotocols and accepts only ready/update for this project", () => {
  const update = vi.fn();
  const dispose = subscribeProjectUpdates("project/a", update);
  const socket = Socket.instances[0];
  expect(socket.url).toBe(
    "ws://localhost:8310/api/projects/project%2Fa/updates",
  );
  expect(socket.url).not.toContain("private-session-token");
  expect(socket.protocols?.[0]).toBe("bearer.b64");
  socket.emit({ type: "project:ready", project_id: "project/a" });
  socket.emit({ type: "project:update", project_id: "other" });
  socket.emit({ type: "project:heartbeat", project_id: "project/a" });
  socket.emit({ type: "project:update", project_id: "project/a" });
  socket.onmessage?.({ data: "malformed" });
  expect(update).toHaveBeenCalledTimes(2);
  dispose();
  socket.emit({ type: "project:update", project_id: "project/a" });
  expect(update).toHaveBeenCalledTimes(2);
});

it("reconnects with fresh credentials and ignores an old socket", () => {
  const update = vi.fn();
  const dispose = subscribeProjectUpdates("P", update);
  const first = Socket.instances[0];
  first.onclose?.();
  mocks.headers.mockReturnValue({ Authorization: "Bearer new-session" });
  vi.advanceTimersByTime(500);
  const second = Socket.instances[1];
  expect(second.protocols?.[1]).not.toBe(first.protocols?.[1]);
  first.emit({ type: "project:update", project_id: "P" });
  second.emit({ type: "project:ready", project_id: "P" });
  expect(update).toHaveBeenCalledTimes(1);
  dispose();
  vi.advanceTimersByTime(10000);
  expect(Socket.instances).toHaveLength(2);
});

it("closes on an account change before invalidating queries", () => {
  const update = vi.fn();
  const dispose = subscribeProjectUpdates("P", update);
  const socket = Socket.instances[0];
  mocks.actor.mockReturnValue("bob");
  socket.emit({ type: "project:update", project_id: "P" });
  expect(update).not.toHaveBeenCalled();
  expect(socket.close).toHaveBeenCalledOnce();
  dispose();
});

it("keeps the caller usable when the browser refuses socket construction", () => {
  vi.stubGlobal(
    "WebSocket",
    class {
      constructor() {
        throw new Error("unavailable");
      }
    },
  );
  const update = vi.fn();
  let dispose = () => {};
  expect(() => {
    dispose = subscribeProjectUpdates("P", update);
  }).not.toThrow();
  dispose();
  expect(update).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
