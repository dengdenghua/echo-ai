import { screen } from "@testing-library/react";
import { Route, Routes, useLocation, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EchoAPIError } from "@/core/api/request";
import { unbornThreadFailure } from "@/core/api/unborn-threads";
import { eventBus } from "@/core/events";
import {
  isAssistantThreadId,
  personalAssistantThreadId,
} from "@/core/threads/assistant-thread";
import { isNavRouteActive } from "@/core/workspace/sidebar-routing";
import { renderWithProviders } from "@/test/harness";

const mocks = vi.hoisted(() => ({
  auth: {
    authStatus: { enabled: true },
    user: { user_id: "local:reader", actor_id: "local:reader" },
  } as {
    authStatus: { enabled: boolean };
    user: { user_id: string; actor_id?: string };
  },
  getThread: vi.fn(),
}));

vi.mock("@/providers/AuthProvider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/core/api", () => ({
  getAPIClient: () => ({ threads: { get: mocks.getThread } }),
}));

import { AssistantThreadAlias } from "./assistant-thread-alias";

function Chat() {
  const { threadId } = useParams();
  const location = useLocation();
  return (
    <div>
      chat {threadId}
      {location.search}
    </div>
  );
}

function renderAlias(route = "/workspace/realtime/echo-assistant?agent=echo") {
  return renderWithProviders(
    <Routes>
      <Route
        path="/workspace/realtime/:threadId"
        element={
          <AssistantThreadAlias>
            <Chat />
          </AssistantThreadAlias>
        }
      />
    </Routes>,
    { initialRoute: route },
  );
}

describe("AssistantThreadAlias", () => {
  beforeEach(() => {
    mocks.auth = {
      authStatus: { enabled: true },
      user: { user_id: "local:reader", actor_id: "local:reader" },
    };
    mocks.getThread.mockReset();
  });

  it("gives an account without the original thread its own assistant", async () => {
    // Another account wrote to echo-assistant first; this one cannot read it.
    mocks.getThread.mockRejectedValue(
      new EchoAPIError("not found", 404, "thread not found"),
    );
    renderAlias();
    const own = personalAssistantThreadId("local:reader");
    expect(
      await screen.findByText(`chat ${own}?agent=echo`),
    ).toBeInTheDocument();
  });

  it("keeps the original thread for the account that already has it", async () => {
    mocks.getThread.mockResolvedValue({ thread_id: "echo-assistant" });
    renderAlias();
    expect(
      await screen.findByText("chat echo-assistant?agent=echo"),
    ).toBeInTheDocument();
  });

  it("keeps the alias when sign-in is off, and leaves other threads alone", async () => {
    mocks.auth = {
      authStatus: { enabled: false },
      user: { user_id: "anonymous" },
    };
    mocks.getThread.mockResolvedValue({ thread_id: "echo-assistant" });
    renderAlias();
    expect(
      await screen.findByText("chat echo-assistant?agent=echo"),
    ).toBeInTheDocument();

    mocks.getThread.mockReset();
    renderAlias("/workspace/realtime/t-abc");
    expect(screen.getByText("chat t-abc")).toBeInTheDocument();
    expect(mocks.getThread).not.toHaveBeenCalled();
  });

  it("answers reads of an assistant thread locally until its first run", async () => {
    mocks.getThread.mockRejectedValue(
      new EchoAPIError("not found", 404, "thread not found"),
    );
    renderAlias();
    const own = personalAssistantThreadId("local:reader");
    await screen.findByText(`chat ${own}?agent=echo`);

    expect(
      unbornThreadFailure("GET", `/api/threads/${own}/state`),
    ).toMatchObject({ status: 404 });
    expect(unbornThreadFailure("POST", `/api/threads/${own}/state`)).toBeNull();

    eventBus.emit("thread:run-status", { threadId: own, state: "running" });
    expect(unbornThreadFailure("GET", `/api/threads/${own}/state`)).toBeNull();
  });
});

describe("assistant thread ids", () => {
  it("are stable per account, distinct across accounts, and recognised", () => {
    const a = personalAssistantThreadId("local:ada");
    expect(personalAssistantThreadId("local:ada")).toBe(a);
    expect(personalAssistantThreadId("local:bob")).not.toBe(a);
    expect(a).not.toContain("ada");
    expect(isAssistantThreadId(a)).toBe(true);
    expect(isAssistantThreadId("echo-assistant")).toBe(true);
    expect(isAssistantThreadId("t-abc")).toBe(false);
  });

  it("keep the 助手 entry highlighted on the account's own thread", () => {
    const to = "/workspace/realtime/echo-assistant?agent=echo";
    const own = personalAssistantThreadId("local:ada");
    expect(isNavRouteActive(`/workspace/realtime/${own}`, to)).toBe(true);
    expect(isNavRouteActive("/workspace/realtime/echo-assistant", to)).toBe(
      true,
    );
    expect(isNavRouteActive("/workspace/realtime/t-abc", to)).toBe(false);
  });
});
