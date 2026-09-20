import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { eventBus } from "@/core/events/event-bus";
import { SandboxMergeBanner } from "./sandbox-merge-banner";

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

describe("SandboxMergeBanner", () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    vi.restoreAllMocks();
  });

  it("renders sandbox banner with agent name and merge button", () => {
    renderWithProviders(
      <SandboxMergeBanner
        agentName="规划专家"
        parentThreadId="thread-parent-123"
      />,
    );

    expect(screen.getByTestId("sandbox-merge-banner")).toBeInTheDocument();
    expect(screen.getByText("方案推演沙盒模式")).toBeInTheDocument();
    expect(screen.getByText(/规划专家/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /合并结论至主项目/ })).toBeInTheDocument();
  });

  it("clicking dismiss button hides the banner", () => {
    renderWithProviders(
      <SandboxMergeBanner
        agentName="规划专家"
      />,
    );

    const closeBtn = screen.getByLabelText("收起推演沙盒横幅");
    fireEvent.click(closeBtn);

    expect(screen.queryByTestId("sandbox-merge-banner")).toBeNull();
  });

  it("clicking merge button opens dialog and confirming emits merge payload and navigates", async () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    renderWithProviders(
      <SandboxMergeBanner
        agentName="测试架构师"
        parentThreadId="thread-parent-456"
        initialConclusion="自动化测试框架方案验证成立，可全面接入。"
      />,
    );

    const openMergeBtn = screen.getByRole("button", { name: /合并结论至主项目/ });
    fireEvent.click(openMergeBtn);

    expect(screen.getByText("合并推演结论至长项目主干")).toBeInTheDocument();
    expect(screen.getByDisplayValue("自动化测试框架方案验证成立，可全面接入。")).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: "确认合并回主项目" });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(mocks.navigate).toHaveBeenCalledWith("/workspace/realtime/thread-parent-456");

    emitSpy.mockRestore();
  });
});
