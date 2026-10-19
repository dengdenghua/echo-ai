import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/harness";
import { PersonalAppViewer } from "./personal-app-viewer";
import { emptyConversation } from "@/core/realtime/items";

const realtime = vi.hoisted(() => ({
  startTurn: vi.fn().mockResolvedValue(undefined),
  interrupt: vi.fn(),
  resolveApproval: vi.fn(),
  resume: vi.fn(),
  readyForMutations: true,
  connectionPhase: "ready",
  state: {} as ReturnType<typeof emptyConversation>,
}));
vi.mock("@/core/realtime/use-realtime-thread", () => ({
  useRealtimeThread: () => realtime,
}));
beforeEach(() => {
  vi.clearAllMocks();
  realtime.state = emptyConversation("test");
  realtime.readyForMutations = true;
  realtime.connectionPhase = "ready";
});

const item = {
  id: "v1",
  app: {
    schema: "echo.app.v1" as const,
    id: "customers",
    name: "Customers",
    description: "",
    version: "0.1.0",
    permissions: ["task.request"],
  },
};

function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname + location.search}
    </output>
  );
}

function requestFromApp() {
  const frame = screen.getByTitle("Customers") as HTMLIFrameElement;
  const channel = JSON.parse(
    frame.srcdoc.match(/const channel=("[^\n]*?");/)![1]!,
  );
  const reply = vi
    .spyOn(frame.contentWindow!, "postMessage")
    .mockImplementation(() => {});
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "null",
        data: {
          type: "echo.app.request",
          channel,
          id: "task-1",
          method: "task.request",
          params: {
            kind: "skill",
            target: "summarize",
            prompt: "Summarize these customers",
          },
        },
      }),
    ),
  );
  return reply;
}

describe("app task review", () => {
  it("requires review, executes once, and returns only its final answer to the app", async () => {
    const view = renderWithProviders(
      <>
        <PersonalAppViewer item={item} html="<h1>Customers</h1>" />
        <Location />
      </>,
      { locale: "en-US" },
    );
    const reply = requestFromApp();
    expect(await screen.findByText("Summarize these customers")).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("/");
    expect(realtime.startTurn).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Run task" }));
    await waitFor(() =>
      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          result: expect.objectContaining({
            status: "connecting",
            terminal: false,
          }),
        }),
        "*",
      ),
    );
    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(realtime.startTurn).toHaveBeenCalledTimes(1);
    const input = realtime.startTurn.mock.calls[0]![0];
    expect(input).toMatchObject({
      approvalPolicy: "on-request",
      sandboxPolicy: { type: "workspaceWrite", networkAccess: false },
    });
    const handle = reply.mock.calls.find(([data]) => data.result?.taskId)![0]
      .result;
    // startTurn resolving does not imply execution completed.
    expect(screen.getByText("Running…")).toBeVisible();
    realtime.state = {
      ...realtime.state,
      turns: [
        {
          id: "turn-one",
          threadId: handle.taskId,
          status: "completed",
          startedAt: "",
          completedAt: "",
          error: null,
          items: [
            {
              id: input.clientItemId,
              type: "userMessage",
              text: "request",
              status: "completed",
              createdAt: "",
            },
            {
              id: "reasoning",
              type: "reasoning",
              summary: [],
              content: "private reasoning",
              durationMs: null,
              status: "completed",
              createdAt: "",
            },
            {
              id: "answer",
              type: "agentMessage",
              text: "Call Alice tomorrow",
              messageKind: "answer",
              status: "completed",
              createdAt: "",
            },
          ],
        },
      ],
    };
    view.rerender(
      <>
        <PersonalAppViewer item={item} html="<h1>Customers</h1>" />
        <Location />
      </>,
    );
    expect(await screen.findByText("Call Alice tomorrow")).toBeVisible();
    const frame = screen.getByTitle("Customers") as HTMLIFrameElement;
    const channel = JSON.parse(
      frame.srcdoc.match(/const channel=("[^\n]*?");/)![1]!,
    );
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: "null",
          data: {
            type: "echo.app.request",
            channel,
            id: "get-1",
            method: "task.get",
            params: { taskId: handle.taskId },
          },
        }),
      ),
    );
    await waitFor(() =>
      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "get-1",
          result: expect.objectContaining({
            status: "completed",
            terminal: true,
            text: "Call Alice tomorrow",
          }),
        }),
        "*",
      ),
    );
    expect(JSON.stringify(reply.mock.calls)).not.toContain("private reasoning");
    expect(realtime.startTurn).toHaveBeenCalledTimes(1);
    await userEvent.click(
      screen.getByRole("link", { name: "Open task conversation" }),
    );
    expect(screen.getByTestId("location").textContent).toContain(
      `/workspace/realtime/${handle.taskId}`,
    );
  });

  it("rejects cancellation without preparing a task", async () => {
    renderWithProviders(
      <PersonalAppViewer item={item} html="<h1>Customers</h1>" />,
      { locale: "en-US" },
    );
    const reply = requestFromApp();
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel" }),
    );
    await waitFor(() =>
      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ message: "Task request cancelled" }),
        }),
        "*",
      ),
    );
    expect(realtime.startTurn).not.toHaveBeenCalled();
  });
});
