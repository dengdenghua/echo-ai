import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { renderWithProviders } from "@/test/harness";
import { eventBus } from "@/core/events/event-bus";
import { InlineSubagentCardExpansion } from "./inline-subagent-card-expansion";
import type { InlineSubagentInfo } from "./inline-subagent-cards";

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

describe("<InlineSubagentCardExpansion />", () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
  });

  const mockAgent: InlineSubagentInfo = {
    id: "sub-agent-01",
    name: "架构规划专家",
    role: "planner",
    status: "done",
    task: "分析并拆解微服务架构演进路径",
    summary: "已完成架构拆解，包含 3 个核心服务与鉴权网关。",
    filesTouchedCount: 4,
    iterationCount: 2,
    index: 0,
  };

  it("renders null when isOpen is false", () => {
    const { container } = renderWithProviders(
      <InlineSubagentCardExpansion
        agent={mockAgent}
        isOpen={false}
        onOpenWorkbench={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders first-person subjective perspective badge and task details when isOpen is true", () => {
    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={mockAgent}
        isOpen={true}
        onOpenWorkbench={vi.fn()}
      />,
    );

    expect(screen.getByText("我的第一视角 · 并列协作者")).toBeInTheDocument();
    expect(screen.getByText("架构规划专家")).toBeInTheDocument();
    expect(screen.getByText("分析并拆解微服务架构演进路径")).toBeInTheDocument();
    expect(
      screen.getByText("已完成架构拆解，包含 3 个核心服务与鉴权网关。"),
    ).toBeInTheDocument();
    expect(screen.getByText("修改了 4 个文件")).toBeInTheDocument();
  });

  it("clicking '同步至群公共' emits composer:insert-mention with submit true", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={mockAgent}
        isOpen={true}
        onOpenWorkbench={vi.fn()}
      />,
    );

    const publishBtn = screen.getByRole("button", { name: /同步至群公共/ });
    fireEvent.click(publishBtn);

    expect(emitSpy).toHaveBeenCalledWith(
      "composer:insert-mention",
      expect.objectContaining({
        text: expect.stringContaining(
          "📢 来自并列协作者【架构规划专家】的阶段交付",
        ),
        submit: true,
      }),
    );

    emitSpy.mockRestore();
  });

  it("clicking '定向追问' emits composer:insert-mention with submit false", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={mockAgent}
        isOpen={true}
        onOpenWorkbench={vi.fn()}
      />,
    );

    const followupBtn = screen.getByRole("button", { name: /定向追问/ });
    fireEvent.click(followupBtn);

    expect(emitSpy).toHaveBeenCalledWith(
      "composer:insert-mention",
      expect.objectContaining({
        text: "@架构规划专家 ",
        submit: false,
      }),
    );

    emitSpy.mockRestore();
  });

  it("clicking '固化为决策' emits composer:insert-mention with decision prefix and updates label", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={mockAgent}
        isOpen={true}
        onOpenWorkbench={vi.fn()}
      />,
    );

    const decisionBtn = screen.getByRole("button", { name: /固化为决策/ });
    fireEvent.click(decisionBtn);

    expect(emitSpy).toHaveBeenCalledWith(
      "composer:insert-mention",
      expect.objectContaining({
        text: expect.stringContaining("🏛️ [项目决策固化]"),
        submit: true,
      }),
    );
    expect(screen.getByText("已固化为决策")).toBeInTheDocument();

    emitSpy.mockRestore();
  });

  it("clicking '推演沙盒' navigates to new thread with sandbox param", () => {
    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={mockAgent}
        isOpen={true}
        onOpenWorkbench={vi.fn()}
      />,
    );

    const sandboxBtn = screen.getByRole("button", { name: /推演沙盒/ });
    fireEvent.click(sandboxBtn);

    expect(mocks.navigate).toHaveBeenCalledOnce();
    const calledUrl = mocks.navigate.mock.calls[0][0];
    expect(calledUrl).toContain("/workspace/realtime/new?");
    expect(calledUrl).toContain("sandbox=true");
    expect(calledUrl).toContain("agent=%E6%9E%B6%E6%9E%84%E8%A7%84%E5%88%92%E4%B8%93%E5%AE%B6");
  });

  it("clicking '推演沙盒' calls onForkSandbox when provided as prop", () => {
    const onForkSandbox = vi.fn();

    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={mockAgent}
        isOpen={true}
        onOpenWorkbench={vi.fn()}
        onForkSandbox={onForkSandbox}
      />,
    );

    const sandboxBtn = screen.getByRole("button", { name: /推演沙盒/ });
    fireEvent.click(sandboxBtn);

    expect(onForkSandbox).toHaveBeenCalledOnce();
  });

  it("clicking '在大屏工作台查看完整流' calls onOpenWorkbench callback", () => {
    const onOpenWorkbench = vi.fn();

    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={mockAgent}
        isOpen={true}
        onOpenWorkbench={onOpenWorkbench}
      />,
    );

    const openBtn = screen.getByRole("button", {
      name: /在大屏工作台查看完整流/,
    });
    fireEvent.click(openBtn);

    expect(onOpenWorkbench).toHaveBeenCalledOnce();
  });
});
