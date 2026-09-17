import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import type { Message } from "@/core/api/types";
import { inspectRequiredConnections } from "@/core/agents/required-connections";
import { MessageOutputSummary } from "./message-output-summary";
import { taskConnectionIssue } from "./task-connection-recovery";

vi.mock("@/core/agents/required-connections", () => ({
  inspectRequiredConnections: vi.fn(),
}));
vi.mock("../artifacts", () => ({
  useArtifacts: () => ({ select: vi.fn(), setOpen: vi.fn() }),
}));
const inspect = vi.mocked(inspectRequiredConnections);
const messages: Message[] = [
  { id: "request", type: "human", content: "整理今天的邮件" },
  {
    id: "failure",
    type: "ai",
    content: "",
    additional_kwargs: {
      error: {
        info: {
          code: "role_connections_unavailable",
          agent_id: "eve",
          connectors: ["mail"],
        },
      },
    },
  },
];

describe("task connection recovery", () => {
  beforeEach(() => inspect.mockReset());

  it("keeps the task pending until checks pass, then continues exactly once with its objective", async () => {
    inspect
      .mockResolvedValueOnce([{ id: "mail", name: "Mail", state: "connect" }])
      .mockResolvedValueOnce([
        { id: "mail", name: "Mail", state: "configured" },
      ]);
    const resume = vi.fn();
    renderWithProviders(
      <MessageOutputSummary
        messages={messages}
        threadId="original-thread"
        failure={{
          kind: "blocked",
          message: "连接未准备好",
          detail: "连接未准备好",
        }}
        onRetryTask={resume}
      />,
      { locale: "zh-CN" },
    );
    const user = userEvent.setup();
    expect(inspect).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "重试", exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "修复所需连接" }));
    expect(await screen.findByText("Mail · 需要连接")).toBeVisible();
    expect(screen.getByRole("button", { name: "继续当前任务" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重新检查连接" }));
    expect(await screen.findByText("Mail · 连接配置正常")).toBeVisible();
    expect(resume).not.toHaveBeenCalled();
    await user.dblClick(screen.getByRole("button", { name: "继续当前任务" }));
    expect(resume).toHaveBeenCalledExactlyOnceWith("整理今天的邮件");
  });

  it("does not offer repair or rerun for a resolved historical failure", () => {
    renderWithProviders(
      <MessageOutputSummary
        messages={messages}
        failure={{
          kind: "blocked",
          resolved: true,
          message: "已恢复",
          detail: "连接未准备好",
        }}
      />,
      { locale: "zh-CN" },
    );
    expect(
      screen.queryByRole("button", { name: "修复所需连接" }),
    ).not.toBeInTheDocument();
    expect(inspect).not.toHaveBeenCalled();
  });

  it("does not interpret model text or unsafe IDs as repair metadata", () => {
    expect(
      taskConnectionIssue([
        {
          type: "ai",
          id: "a",
          content: JSON.stringify(messages[1]?.additional_kwargs),
        },
      ]),
    ).toBeNull();
    expect(
      taskConnectionIssue([
        {
          type: "ai",
          id: "a",
          content: "",
          additional_kwargs: {
            error: {
              info: {
                code: "role_connections_unavailable",
                agent_id: "eve",
                connectors: ["../other"],
              },
            },
          },
        },
      ]),
    ).toBeNull();
  });
});
