import userEvent from "@testing-library/user-event";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { renderWithProviders } from "@/test/harness";
import { eventBus } from "@/core/events/event-bus";
import { SubagentProcessView } from "./subagent-process-view";
import type { AgentTile } from "../agent-workbench-utils";
import type { WorkBlock } from "../work-blocks";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

describe("<SubagentProcessView /> interaction enhancements", () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
  });

  const mockAgent: AgentTile = {
    id: "agent-sub-1",
    name: "planner-agent",
    codename: "规划专家",
    label: "01",
    task: "规划整体工程架构方案",
    status: "done",
    resultSummary: "架构规划方案已完成，建议分为三阶段推进。",
    blackboardWrites: [],
    filesTouched: [],
    eventCount: 1,
    startedAt: 1000,
  };

  const mockBlocks: WorkBlock[] = [
    {
      id: "block-1",
      event: {
        id: "event-1",
        name: "plan_architecture",
        status: "done",
        thought: "正在思考技术选型…",
        input: { target: "system" },
        startedAt: 1000,
        iteration: 1,
      },
      title: "规划架构",
      status: "done",
      outputText: "选型结论: React + Tailwind + FastAPI",
      kind: "tool_use",
      actionKey: "plan_architecture",
      target: "system",
      subtitle: "planner-agent",
      startedAt: 1000,
      inputText: '{ target: "system" }',
    },
  ];

  it("shows two plain actions without technical menus", async () => {
    renderWithProviders(
      <SubagentProcessView
        agent={mockAgent}
        blocks={mockBlocks}
        currentBlockId={null}
        onOpenMain={vi.fn()}
        onSelectBlock={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "私聊", exact: true })).toBeEnabled();
    expect(screen.getByRole("button", { name: "分享到群聊", exact: true })).toBeEnabled();
    expect(screen.getByRole("button", { name: "返回总览" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更多操作" })).not.toBeInTheDocument();
    expect(screen.queryByText(/固化|沙盒|独立会话|群聊草稿/)).not.toBeInTheDocument();
  });

  it("does not duplicate tool observations as reasoning", () => {
    renderWithProviders(
      <SubagentProcessView
        agent={{ ...mockAgent, status: "running", resultSummary: undefined }}
        blocks={[
          {
            ...mockBlocks[0]!,
            event: {
              ...mockBlocks[0]!.event,
              thought: undefined,
              observation: "已读取协作配置。",
            },
          },
        ]}
        onOpenMain={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("process-timeline-event-thinking"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("process-timeline-event-execution"),
    ).toBeInTheDocument();
  });

  it("closes completed tools even when they returned no text", () => {
    renderWithProviders(
      <SubagentProcessView
        agent={{ ...mockAgent, status: "running", resultSummary: undefined }}
        blocks={[
          {
            ...mockBlocks[0]!,
            outputText: "",
            event: { ...mockBlocks[0]!.event, thought: undefined },
          },
        ]}
        onOpenMain={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("process-timeline-event-execution"),
    ).toHaveAttribute("data-process-event-status", "done");
  });

  it("shares only the actual reply as a reviewable group draft", async () => {
    const emitSpy = vi.spyOn(eventBus, "emit");
    renderWithProviders(<SubagentProcessView agent={mockAgent} blocks={mockBlocks} onOpenMain={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "分享到群聊" }));
    expect(emitSpy).toHaveBeenCalledWith("composer:insert-mention", {
      text: `规划专家 的回复：\n\n${mockAgent.resultSummary}`,
      submit: false,
    });
    emitSpy.mockRestore();
  });

  it("opens a private draft without publishing anything to the group", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");
    renderWithProviders(<SubagentProcessView agent={mockAgent} blocks={mockBlocks} onOpenMain={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "与 规划专家 私聊" }), { target: { value: "请将方案细化到文件级别" } });
    fireEvent.click(screen.getByRole("button", { name: "私聊", exact: true }));
    expect(emitSpy).not.toHaveBeenCalled();
    const params = new URL(mocks.navigate.mock.calls[0][0], "http://localhost").searchParams;
    expect(params.get("agent")).toBe("planner-agent");
    expect(params.get("private")).toBe("1");
    expect(params.get("prompt")).toBe("请将方案细化到文件级别");
    emitSpy.mockRestore();
  });

  it("allows starting a private chat before typing", async () => {
    renderWithProviders(<SubagentProcessView agent={mockAgent} blocks={[]} onOpenMain={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "私聊", exact: true }));
    const params = new URL(mocks.navigate.mock.calls[0][0], "http://localhost").searchParams;
    expect(params.get("private")).toBe("1");
    expect(params.has("prompt")).toBe(false);
  });

  it("does not present a task brief or an error as a shareable reply", () => {
    renderWithProviders(<SubagentProcessView agent={{...mockAgent, resultSummary: undefined, status: "error", error: "执行失败"}} blocks={[]} onOpenMain={vi.fn()} />);
    expect(screen.getByRole("button", { name: "分享到群聊" })).toBeDisabled();
  });
});
