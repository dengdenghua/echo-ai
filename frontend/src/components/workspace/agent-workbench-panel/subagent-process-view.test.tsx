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
      inputText: "{ target: \"system\" }",
    },
  ];

  it("renders subagent process and top promote-to-thread button", () => {
    renderWithProviders(
      <SubagentProcessView
        agent={mockAgent}
        blocks={mockBlocks}
        currentBlockId={null}
        onOpenMain={vi.fn()}
        onSelectBlock={vi.fn()}
      />,
    );

    expect(screen.getByText("以独立会话打开")).toBeInTheDocument();
    expect(screen.getByText("同步至群公共")).toBeInTheDocument();
    expect(screen.getByTestId("subagent-followup-bar")).toBeInTheDocument();
  });

  it("clicking promote-to-public emits composer:insert-mention with delivery text and submit true", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    renderWithProviders(
      <SubagentProcessView
        agent={mockAgent}
        blocks={mockBlocks}
        currentBlockId={null}
        onOpenMain={vi.fn()}
        onSelectBlock={vi.fn()}
      />,
    );

    const publishBtn = screen.getByRole("button", { name: "同步至群公共" });
    fireEvent.click(publishBtn);

    expect(emitSpy).toHaveBeenCalledWith(
      "composer:insert-mention",
      expect.objectContaining({
        text: expect.stringContaining("📢 来自并列协作者【规划专家】的阶段交付"),
        submit: true,
      }),
    );

    emitSpy.mockRestore();
  });

  it("clicking promote-to-thread navigates to new thread with agent context", () => {
    renderWithProviders(
      <SubagentProcessView
        agent={mockAgent}
        blocks={mockBlocks}
        currentBlockId={null}
        onOpenMain={vi.fn()}
        onSelectBlock={vi.fn()}
      />,
    );

    const promoteButton = screen.getByRole("button", { name: "以独立会话打开" });
    fireEvent.click(promoteButton);

    expect(mocks.navigate).toHaveBeenCalledOnce();
    const calledUrl = mocks.navigate.mock.calls[0][0];
    expect(calledUrl).toContain("/workspace/realtime/new?");
    expect(calledUrl).toContain("agent=planner-agent");
    expect(calledUrl).toContain("prompt=");
  });

  it("submitting followup instruction via direct send emits composer:insert-mention with submit true", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    renderWithProviders(
      <SubagentProcessView
        agent={mockAgent}
        blocks={mockBlocks}
        currentBlockId={null}
        onOpenMain={vi.fn()}
        onSelectBlock={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(/随时打字向并列协作者 规划专家/);
    fireEvent.change(input, { target: { value: "请将方案细化到文件级别" } });

    const submitBtn = screen.getByRole("button", { name: "直接发送" });
    fireEvent.click(submitBtn);

    expect(emitSpy).toHaveBeenCalledWith(
      "composer:insert-mention",
      expect.objectContaining({
        text: "@planner-agent 请将方案细化到文件级别",
        submit: true,
      }),
    );

    emitSpy.mockRestore();
  });

  it("submitting followup instruction via draft emits composer:insert-mention with submit false", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    renderWithProviders(
      <SubagentProcessView
        agent={mockAgent}
        blocks={mockBlocks}
        currentBlockId={null}
        onOpenMain={vi.fn()}
        onSelectBlock={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(/随时打字向并列协作者 规划专家/);
    fireEvent.change(input, { target: { value: "先拟定目录结构" } });

    const draftBtn = screen.getByRole("button", { name: "装入草稿" });
    fireEvent.click(draftBtn);

    expect(emitSpy).toHaveBeenCalledWith(
      "composer:insert-mention",
      expect.objectContaining({
        text: "@planner-agent 先拟定目录结构",
        submit: false,
      }),
    );

    emitSpy.mockRestore();
  });

  it("clicking '固化为决策' emits composer:insert-mention with decision prefix and updates button text", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    renderWithProviders(
      <SubagentProcessView
        agent={mockAgent}
        blocks={mockBlocks}
        currentBlockId={null}
        onOpenMain={vi.fn()}
        onSelectBlock={vi.fn()}
      />,
    );

    const decisionBtn = screen.getByRole("button", { name: "固化为决策" });
    fireEvent.click(decisionBtn);

    expect(emitSpy).toHaveBeenCalledWith(
      "composer:insert-mention",
      expect.objectContaining({
        text: expect.stringContaining("🏛️ [项目决策固化] 采纳并列协作者【规划专家】交付方案"),
        submit: true,
      }),
    );
    expect(screen.getByText("已固化为决策")).toBeInTheDocument();

    emitSpy.mockRestore();
  });

  it("clicking '推演沙盒' emits composer:insert-mention with sandbox prompt and submit true", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    renderWithProviders(
      <SubagentProcessView
        agent={mockAgent}
        blocks={mockBlocks}
        currentBlockId={null}
        onOpenMain={vi.fn()}
        onSelectBlock={vi.fn()}
      />,
    );

    const sandboxBtn = screen.getByRole("button", { name: "推演沙盒" });
    fireEvent.click(sandboxBtn);

    expect(emitSpy).toHaveBeenCalledWith(
      "composer:insert-mention",
      expect.objectContaining({
        text: expect.stringContaining("🌱 【方案推演沙盒】针对并列协作者【规划专家】的方案开启隔离推演验证"),
        submit: true,
      }),
    );

    emitSpy.mockRestore();
  });
});
