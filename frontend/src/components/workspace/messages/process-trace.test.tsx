import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { renderWithProviders } from "@/test/harness";

import type { LiveToolEvent } from "../live-tool-timeline";
import { ProcessTrace } from "./process-trace";
import {
  AGENT_WORKBENCH_FOCUS_EVENT,
  type AgentWorkbenchFocusDetail,
} from "../agent-workbench-events";

function agentEvent(
  id: string,
  role: string,
  status: LiveToolEvent["status"],
  overrides: Partial<LiveToolEvent> = {},
): LiveToolEvent {
  return {
    id,
    name: "call_agent_parallel",
    status,
    startedAt: 1,
    agentId: `runtime-${role}`,
    subagentCodename: role,
    subAgentRole: role,
    input: { prompt: `${role} research` },
    ...overrides,
  };
}

describe("ProcessTrace agent cluster", () => {
  test("keeps a manual collapse while live tools finish and a new tool starts", () => {
    const event: LiveToolEvent = {
      id: "read",
      name: "read_file",
      status: "running",
      startedAt: 1,
    };
    const { rerender } = renderWithProviders(
      <ProcessTrace mode="react" events={[event]} />,
      { locale: "zh-CN" },
    );
    const trigger = screen.getByRole("button", { name: /过程线索/ });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(trigger);
    rerender(
      <ProcessTrace
        mode="react"
        hasAnswer
        events={[{ ...event, status: "done" }]}
      />,
    );
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    rerender(
      <ProcessTrace mode="react" live events={[{ ...event, id: "next" }]} />,
    );
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("automatically folds finished details unless the user chose to keep them open", () => {
    const event: LiveToolEvent = {
      id: "read",
      name: "read_file",
      status: "running",
      startedAt: 1,
    };
    const { rerender } = renderWithProviders(
      <ProcessTrace mode="react" events={[event]} />,
      { locale: "zh-CN" },
    );
    const trigger = screen.getByRole("button", { name: /过程线索/ });
    rerender(
      <ProcessTrace
        mode="react"
        hasAnswer
        events={[{ ...event, status: "done" }]}
      />,
    );
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    rerender(
      <ProcessTrace
        mode="react"
        hasAnswer
        events={[{ ...event, id: "more", status: "done" }]}
      />,
    );
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      document.getElementById(trigger.getAttribute("aria-controls")!),
    ).toBeVisible();
  });

  test("shows an explicit waiting state for approvals", () => {
    renderWithProviders(
      <ProcessTrace
        mode="react"
        events={[
          {
            id: "approve",
            name: "write_file",
            status: "waiting_approval",
            startedAt: 1,
          },
        ]}
      />,
      { locale: "zh-CN" },
    );
    expect(screen.getByTestId("conversation-process")).toHaveAttribute(
      "data-status",
      "waiting",
    );
    expect(
      screen.getByRole("button", { name: /过程线索.*等待中/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test("shows agent progress instead of raw parallel task wording", () => {
    renderWithProviders(
      <ProcessTrace
        mode="team"
        hasAnswer
        events={[
          agentEvent("profile-start", "profile", "running"),
          agentEvent("profile-done", "profile", "done", {
            output: { summary: "Company profile complete" },
          }),
          agentEvent("market-start", "market", "running"),
          agentEvent("market-error", "market", "error", {
            error: "Source timed out",
          }),
        ]}
      />,
      { locale: "zh-CN" },
    );

    expect(
      screen.getByText("2 个子智能体 · 1 已完成 · 1 异常"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/并行任务/)).not.toBeInTheDocument();
    expect(screen.getAllByText("profile")).toHaveLength(1);
    expect(screen.getAllByText("market")).toHaveLength(1);
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("异常")).toBeInTheDocument();
    expect(screen.getByText("Source timed out")).toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: /profile/ })
        .querySelector('[aria-label="progress 100%"]'),
    ).not.toBeNull();
    expect(
      screen.queryByText("Company profile complete"),
    ).not.toBeInTheDocument();

    const focused: AgentWorkbenchFocusDetail[] = [];
    const handleFocus = (event: Event) =>
      focused.push((event as CustomEvent<AgentWorkbenchFocusDetail>).detail);
    window.addEventListener(AGENT_WORKBENCH_FOCUS_EVENT, handleFocus);
    fireEvent.click(screen.getByRole("button", { name: /profile/ }));
    window.removeEventListener(AGENT_WORKBENCH_FOCUS_EVENT, handleFocus);
    expect(focused.at(-1)).toEqual({
      agentId: "profile",
      tab: "agent",
      view: "screen",
    });
  });

  test("compacts repeated delegation records by role", () => {
    const delegationEvent = (
      id: string,
      status: LiveToolEvent["status"],
    ): LiveToolEvent => ({
      id,
      name: "call_agent",
      status,
      startedAt: Number(id),
      iteration: Number(id),
      input: { role: "reviewer", prompt: "review" },
    });
    renderWithProviders(
      <ProcessTrace
        mode="team"
        events={[
          delegationEvent("1", "done"),
          delegationEvent("2", "done"),
          delegationEvent("3", "running"),
        ]}
      />,
      { locale: "zh-CN" },
    );

    expect(screen.getByText(/reviewer/)).toBeInTheDocument();
    expect(screen.getByText(/3×/)).toBeInTheDocument();
  });
});
