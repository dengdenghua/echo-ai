import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CollaborationRealtimeBridge,
  countOnlineRoomParticipants,
} from "./collaboration-realtime-bridge";
import {
  createCollabAnnotation,
  getCollabAnnotations,
  getCollabMessageReactions,
  getCollabPinnedMessages,
} from "@/core/cowork/api";
import { useCollab, type Annotation } from "./collab-provider";

vi.mock("@/core/cowork/api", () => ({
  getCollabAnnotations: vi.fn(async () => []),
  getCollabMessageReactions: vi.fn(async () => []),
  getCollabPinnedMessages: vi.fn(async () => []),
  createCollabAnnotation: vi.fn(),
}));

vi.mock("@/core/auth/api", () => ({ getToken: () => "room-token" }));
vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "",
  getBackendWebSocketBaseURL: () => "ws://collab.test",
}));

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly protocols?: string | string[];
  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }

  send = vi.fn();

  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  receive(payload: Record<string, unknown>) {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(payload) }),
    );
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("countOnlineRoomParticipants", () => {
  it("deduplicates a comment when its broadcast arrives before the HTTP response", async () => {
    const annotation: Annotation = {
      annotation_id: "a1",
      message_id: "m1",
      author: null,
      body: "Shared comment",
      created_at: 1,
      resolved: false,
      replies: [],
    };
    let complete!: (value: Annotation) => void;
    vi.mocked(createCollabAnnotation).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    function Comments() {
      const collab = useCollab();
      return (
        <>
          <button
            onClick={() => void collab.addAnnotation("m1", "Shared comment")}
          >
            Add
          </button>
          <output>{collab.annotations.length}</output>
        </>
      );
    }
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <CollaborationRealtimeBridge
          roomId="room"
          threadId="thread"
          participantId="alice"
        >
          <Comments />
        </CollaborationRealtimeBridge>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(getCollabAnnotations).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Add", { exact: true }));
    vi.mocked(getCollabAnnotations).mockResolvedValueOnce([annotation]);
    act(() =>
      FakeWebSocket.instances[0].receive({
        type: "thread:update",
        thread_id: "thread",
        reason: "annotation",
        participant_id: "",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("1"),
    );
    await act(async () => complete(annotation));
    expect(screen.getByRole("status")).toHaveTextContent("1");
    view.unmount();
  });
  it("counts unique active room members", () => {
    expect(
      countOnlineRoomParticipants([
        { id: "alice", status: "active" },
        { id: "alice", status: "online" },
        { id: "bob", status: "offline" },
        { participant_id: "carol", status: "online" },
        { id: "removed", status: "removed" },
      ]),
    ).toBe(2);
  });

  it("connects the open workspace and refreshes its canonical session", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const view = render(
      <QueryClientProvider client={queryClient}>
        <CollaborationRealtimeBridge
          roomId="room one"
          threadId="thread-1"
          participantId="alice"
          displayName="Alice"
        />
      </QueryClientProvider>,
    );

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe(
      "ws://collab.test/api/teams/room%20one/ws?participant_id=alice&display_name=Alice&thread_id=thread-1",
    );
    expect(socket.protocols).toEqual(["bearer.b64", "cm9vbS10b2tlbg"]);

    act(() => {
      socket.open();
      socket.receive({
        type: "presence",
        participants: [{ id: "alice", display_name: "Alice" }],
      });
    });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["cowork", "session", "thread-1"],
      }),
    );

    invalidate.mockClear();
    act(() =>
      socket.receive({
        type: "thread:update",
        thread_id: "another-thread",
        reason: "message",
      }),
    );
    expect(invalidate).not.toHaveBeenCalled();
    act(() =>
      socket.receive({
        type: "thread:update",
        thread_id: "thread-1",
        reason: "message",
        participant_id: "",
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["cowork", "session", "thread-1"],
    });

    // Reopening the transport must catch social updates missed while offline.
    act(() => socket.onerror?.(new Event("error")));
    vi.mocked(getCollabAnnotations).mockClear();
    vi.mocked(getCollabMessageReactions).mockClear();
    vi.mocked(getCollabPinnedMessages).mockClear();
    act(() => socket.open());
    await waitFor(() => {
      expect(getCollabAnnotations).toHaveBeenCalledWith("thread-1");
      expect(getCollabMessageReactions).toHaveBeenCalledWith("thread-1");
      expect(getCollabPinnedMessages).toHaveBeenCalledWith("thread-1");
    });

    view.unmount();
    expect(socket.close).toHaveBeenCalled();
  });
});
