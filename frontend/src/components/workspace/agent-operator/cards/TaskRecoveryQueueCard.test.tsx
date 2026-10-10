import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  AgentTraceTaskRecoveryQueue,
  AgentTraceTaskRecoveryQueueItem,
} from "@/core/agent-trace/api";
import { renderWithProviders } from "@/test/harness";

import { TaskRecoveryQueueCard } from "./TaskRecoveryQueueCard";

function item(
  overrides: Partial<AgentTraceTaskRecoveryQueueItem>,
): AgentTraceTaskRecoveryQueueItem {
  return {
    task_id: "loop-run-1",
    status: "paused",
    kind: "loop",
    title: "Background loop",
    recommended_action: "resume_paused_task",
    priority: 75,
    can_takeover: false,
    can_resume: true,
    has_checkpoint: true,
    checkpoint_id: "loop-run:loop-run-1:attempt:1",
    ...overrides,
  };
}

function queue(
  items: AgentTraceTaskRecoveryQueueItem[],
): AgentTraceTaskRecoveryQueue {
  return {
    schema: "echo.task_recovery_queue.v1",
    total: items.length,
    count: items.length,
    limit: 8,
    items,
  };
}

describe("TaskRecoveryQueueCard", () => {
  it("shows why a paused loop run stopped", () => {
    renderWithProviders(
      <TaskRecoveryQueueCard
        queue={queue([
          item({
            pause_reason: "budget_near_limit",
            pause_detail: "$2.90/$3.00 · raise the budget to continue",
          }),
        ])}
        busyId={null}
        onTakeover={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "Paused: budget limit reached · $2.90/$3.00 · raise the budget to continue",
      ),
    ).toBeInTheDocument();
  });

  it("localizes the pause reason", () => {
    renderWithProviders(
      <TaskRecoveryQueueCard
        queue={queue([item({ pause_reason: "approval_required" })])}
        busyId={null}
        onTakeover={vi.fn()}
      />,
      { locale: "zh-CN" },
    );

    expect(screen.getByText("已暂停：审批无人应答")).toBeInTheDocument();
  });

  it("renders no pause line for runs that are not paused", () => {
    renderWithProviders(
      <TaskRecoveryQueueCard
        queue={queue([
          item({
            task_id: "failed-loop",
            status: "failed",
            recommended_action: "resume_from_checkpoint",
            pause_reason: "",
          }),
        ])}
        busyId={null}
        onTakeover={vi.fn()}
      />,
    );

    expect(screen.queryByText(/^Paused/)).not.toBeInTheDocument();
  });
});
