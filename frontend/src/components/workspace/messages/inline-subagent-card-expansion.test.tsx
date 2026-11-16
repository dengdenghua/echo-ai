import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { renderWithProviders } from "@/test/harness";
import { eventBus } from "@/core/events/event-bus";
import { InlineSubagentCardExpansion } from "./inline-subagent-card-expansion";
import type { InlineSubagentInfo } from "./inline-subagent-cards";
import type { EventMap } from "@/core/events/event-bus";
import { formatSessionReferenceMention } from "../mention-autocomplete";

let request: EventMap["composer:submit-request"] | undefined;

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useParams: () => ({ thread_id: "thread-1" }),
  };
});

describe("<InlineSubagentCardExpansion />", () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    eventBus.clear();
    request = undefined;
    eventBus.on("composer:submit-request", (value) => {
      request = value;
    });
  });
  afterEach(async () => {
    await act(async () => request?.onResult("failed"));
    eventBus.clear();
  });

  const mockAgent: InlineSubagentInfo = {
    id: "sub-agent-01",
    sessionId: "session-01",
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
      { locale: "zh-CN" },
    );
    expect(container.firstChild).toBeNull();
  });

  it("keeps the report visible without repeating the member identity and collapses the brief", () => {
    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={mockAgent}
        isOpen={true}
        onOpenWorkbench={vi.fn()}
      />,
      { locale: "zh-CN" },
    );

    expect(
      screen.queryByText("我的第一视角 · 并列协作者"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("架构规划专家")).not.toBeInTheDocument();
    const task = screen.getByText("分析并拆解微服务架构演进路径");
    expect(task.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("任务目标"));
    expect(task).toBeVisible();
    expect(
      screen.getByText("已完成架构拆解，包含 3 个核心服务与鉴权网关。"),
    ).toBeInTheDocument();
    expect(screen.getByText("修改了 4 个文件")).toBeInTheDocument();
  });

  it("renders report headings, emphasis and generated file references as readable content", () => {
    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={{
          ...mockAgent,
          summary:
            "## 核对结果\n\n**2870**\n\n[output/final/check.md](output/final/check.md)",
        }}
        isOpen
        onOpenWorkbench={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "核对结果" })).toBeVisible();
    expect(screen.getByText("2870")).toBeVisible();
    expect(screen.getByRole("button", { name: "check.md" })).toBeVisible();
    expect(screen.queryByText(/\*\*2870\*\*/)).not.toBeInTheDocument();
  });

  it("waits for a server receipt before reporting publication", async () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={mockAgent}
        isOpen={true}
        onOpenWorkbench={vi.fn()}
      />,
      { locale: "zh-CN" },
    );

    const publishBtn = screen.getByRole("button", { name: /同步至群公共/ });
    fireEvent.click(publishBtn);

    expect(emitSpy).toHaveBeenCalledWith(
      "composer:submit-request",
      expect.objectContaining({
        text: expect.stringContaining(
          "📢 来自并列协作者【架构规划专家】的阶段交付",
        ),
        threadId: "thread-1",
      }),
    );
    expect(screen.queryByText("已同步至群公共")).toBeNull();
    expect(publishBtn).toBeDisabled();
    fireEvent.click(publishBtn);
    expect(
      emitSpy.mock.calls.filter(([name]) => name === "composer:submit-request"),
    ).toHaveLength(1);
    await act(async () => request?.onResult("confirmed"));
    expect(screen.getByText("已同步至群公共")).toBeInTheDocument();

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
      { locale: "zh-CN" },
    );

    const followupBtn = screen.getByRole("button", { name: /定向追问/ });
    fireEvent.click(followupBtn);

    expect(emitSpy).toHaveBeenCalledWith(
      "composer:insert-mention",
      expect.objectContaining({
        text: `${formatSessionReferenceMention("session-01", "架构规划专家")} `,
        submit: false,
      }),
    );

    emitSpy.mockRestore();
  });

  it("records a decision only after confirmation", async () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={mockAgent}
        isOpen={true}
        onOpenWorkbench={vi.fn()}
      />,
      { locale: "zh-CN" },
    );

    const decisionBtn = screen.getByRole("button", { name: /固化为决策/ });
    fireEvent.click(decisionBtn);

    expect(emitSpy).toHaveBeenCalledWith(
      "composer:submit-request",
      expect.objectContaining({
        text: expect.stringContaining("🏛️ [项目决策固化]"),
        threadId: "thread-1",
      }),
    );
    expect(screen.queryByText("已固化为决策")).toBeNull();
    await act(async () => request?.onResult("confirmed"));
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
      { locale: "zh-CN" },
    );

    const sandboxBtn = screen.getByRole("button", { name: /推演沙盒/ });
    fireEvent.click(sandboxBtn);

    expect(mocks.navigate).toHaveBeenCalledOnce();
    const calledUrl = mocks.navigate.mock.calls[0][0];
    expect(calledUrl).toContain("/workspace/realtime/new?");
    expect(calledUrl).toContain("sandbox=true");
    expect(calledUrl).toContain(
      "agent=%E6%9E%B6%E6%9E%84%E8%A7%84%E5%88%92%E4%B8%93%E5%AE%B6",
    );
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
      { locale: "zh-CN" },
    );

    const sandboxBtn = screen.getByRole("button", { name: /推演沙盒/ });
    fireEvent.click(sandboxBtn);

    expect(onForkSandbox).toHaveBeenCalledOnce();
  });

  it("follows the UI language without changing the stored decision marker", async () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={mockAgent}
        isOpen={true}
        onOpenWorkbench={vi.fn()}
      />,
    );

    expect(
      screen.queryByText("My view · Parallel collaborator"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("4 files changed")).toBeInTheDocument();
    expect(screen.getByText("2 iterations")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record as decision" }));

    expect(emitSpy).toHaveBeenCalledWith(
      "composer:submit-request",
      expect.objectContaining({
        text: expect.stringMatching(
          /^🏛️ \[项目决策固化\] Adopted the deliverable from collaborator 架构规划专家:/,
        ),
        threadId: "thread-1",
      }),
    );
    await act(async () => request?.onResult("confirmed"));
    expect(screen.getByText("Recorded as decision")).toBeInTheDocument();

    emitSpy.mockRestore();
  });

  it("shows rejection without success and permits a retry", async () => {
    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={mockAgent}
        isOpen
        onOpenWorkbench={vi.fn()}
      />,
      { locale: "zh-CN" },
    );
    fireEvent.click(screen.getByRole("button", { name: /同步至群公共/ }));
    await act(async () => request?.onResult("failed"));
    expect(screen.getByRole("alert")).toHaveTextContent("未确认发送");
    expect(screen.getByRole("button", { name: /同步至群公共/ })).toBeEnabled();
    expect(screen.queryByText("已同步至群公共")).toBeNull();
  });

  it("awaits custom decision persistence and handles its rejection", async () => {
    const callback = vi.fn().mockRejectedValue(new Error("offline"));
    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={mockAgent}
        isOpen
        onOpenWorkbench={vi.fn()}
        onRecordDecision={callback}
      />,
      { locale: "zh-CN" },
    );
    fireEvent.click(screen.getByRole("button", { name: "固化为决策" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("已固化为决策")).toBeNull();
  });

  it("does not guess a continuation target from the display name", () => {
    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={{ ...mockAgent, sessionId: undefined }}
        isOpen
        onOpenWorkbench={vi.fn()}
      />,
      { locale: "zh-CN" },
    );
    expect(screen.getByRole("button", { name: "定向追问" })).toBeDisabled();
  });

  it("clicking '在大屏工作台查看完整流' calls onOpenWorkbench callback", () => {
    const onOpenWorkbench = vi.fn();

    renderWithProviders(
      <InlineSubagentCardExpansion
        agent={mockAgent}
        isOpen={true}
        onOpenWorkbench={onOpenWorkbench}
      />,
      { locale: "zh-CN" },
    );

    const openBtn = screen.getByRole("button", {
      name: "查看详情",
    });
    fireEvent.click(openBtn);

    expect(onOpenWorkbench).toHaveBeenCalledOnce();
  });
});
