import { StrictMode } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { emptyConversation, type Turn } from "@/core/realtime/items";
import type { PersonalAppTask } from "@/core/apps/personal-app-task";
import { PersonalAppTaskRunner } from "./personal-app-task-runner";

const realtime = vi.hoisted(() => ({
  startTurn: vi.fn(),
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

const task: PersonalAppTask = {
  id: "app-task",
  clientItemId: "input-one",
  appId: "customers",
  deploymentId: "release",
  appName: "Customers",
  request: { kind: "ai", prompt: "Summarize" },
};
function turn(status: Turn["status"]): Turn {
  return {
    id: "t1",
    threadId: task.id,
    status,
    startedAt: "",
    completedAt: null,
    error: null,
    items: [
      {
        id: task.clientItemId,
        type: "userMessage",
        status: "completed",
        createdAt: "",
        text: "Summarize",
      },
    ],
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  realtime.startTurn.mockResolvedValue(undefined);
  realtime.interrupt.mockResolvedValue(undefined);
  realtime.state = emptyConversation(task.id);
  realtime.readyForMutations = true;
  realtime.connectionPhase = "ready";
});

describe("personal app real-time task", () => {
  it("waits for recovery readiness and never resubmits on reconnect or strict-effect replay", async () => {
    realtime.readyForMutations = false;
    realtime.connectionPhase = "connecting";
    const onSnapshot = vi.fn();
    const element = () => (
      <StrictMode>
        <PersonalAppTaskRunner task={task} onSnapshot={onSnapshot} />
      </StrictMode>
    );
    const view = renderWithProviders(element(), { locale: "en-US" });
    expect(realtime.startTurn).not.toHaveBeenCalled();
    realtime.readyForMutations = true;
    realtime.connectionPhase = "ready";
    view.rerender(element());
    await waitFor(() => expect(realtime.startTurn).toHaveBeenCalledTimes(1));
    // A resolved RPC on reconnect does not make the task successful.
    expect(onSnapshot.mock.lastCall?.[0].terminal).toBe(false);
    realtime.readyForMutations = false;
    realtime.connectionPhase = "reconnecting";
    view.rerender(element());
    expect(screen.getByRole("status")).toHaveTextContent("Reconnecting");
    realtime.readyForMutations = true;
    realtime.connectionPhase = "ready";
    realtime.state = { ...realtime.state, turns: [turn("failed")] };
    view.rerender(element());
    expect(onSnapshot.mock.lastCall?.[0]).toMatchObject({
      status: "failed",
      terminal: true,
    });
    expect(realtime.startTurn).toHaveBeenCalledTimes(1);
  });

  it("cancels before connection without ever starting a task", async () => {
    realtime.readyForMutations = false;
    realtime.connectionPhase = "connecting";
    const onSnapshot = vi.fn();
    const view = renderWithProviders(
      <PersonalAppTaskRunner task={task} onSnapshot={onSnapshot} />,
      { locale: "en-US" },
    );
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    realtime.readyForMutations = true;
    view.rerender(
      <PersonalAppTaskRunner task={task} onSnapshot={onSnapshot} />,
    );
    expect(realtime.startTurn).not.toHaveBeenCalled();
    expect(onSnapshot.mock.lastCall?.[0]).toMatchObject({
      status: "cancelled",
      terminal: true,
    });
  });

  it("uses normal approval controls and waits for the server to acknowledge interruption", async () => {
    const onSnapshot = vi.fn();
    const view = renderWithProviders(
      <PersonalAppTaskRunner task={task} onSnapshot={onSnapshot} />,
      { locale: "en-US" },
    );
    realtime.state = {
      ...realtime.state,
      turns: [turn("inProgress")],
      pendingApprovals: [
        {
          requestId: "approval-1",
          method: "item/commandExecution/requestApproval",
          params: { tool: "shell", argsPreview: "echo test" },
        },
      ],
    };
    view.rerender(
      <PersonalAppTaskRunner task={task} onSnapshot={onSnapshot} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Waiting for your approval",
    );
    expect(realtime.resolveApproval).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Reject/i }));
    expect(realtime.resolveApproval).toHaveBeenCalledWith("approval-1", false);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(realtime.interrupt).toHaveBeenCalledTimes(1);
    expect(onSnapshot.mock.lastCall?.[0].terminal).toBe(false);
    realtime.state = {
      ...realtime.state,
      pendingApprovals: [],
      turns: [turn("interrupted")],
    };
    view.rerender(
      <PersonalAppTaskRunner task={task} onSnapshot={onSnapshot} />,
    );
    expect(onSnapshot.mock.lastCall?.[0]).toMatchObject({
      status: "interrupted",
      terminal: true,
    });
  });

  it("ignores unrelated turns and reports an uncertain send without retrying", async () => {
    realtime.startTurn.mockRejectedValue(
      new Error("Connection lost before receipt"),
    );
    const onSnapshot = vi.fn();
    const view = renderWithProviders(
      <PersonalAppTaskRunner task={task} onSnapshot={onSnapshot} />,
      { locale: "en-US" },
    );
    await screen.findByRole("alert");
    const unrelated = turn("completed");
    unrelated.items[0]!.id = "other-input";
    realtime.state = { ...realtime.state, turns: [unrelated] };
    view.rerender(
      <PersonalAppTaskRunner task={task} onSnapshot={onSnapshot} />,
    );
    expect(onSnapshot.mock.lastCall?.[0]).toMatchObject({
      status: "unknown",
      terminal: false,
      text: "",
    });
    expect(realtime.startTurn).toHaveBeenCalledTimes(1);
  });
});
