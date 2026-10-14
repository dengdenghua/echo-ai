import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import * as clipboard from "@/core/clipboard";
import {
  ProjectDecisionsModal,
  type ProjectDecisionItem,
} from "./project-decisions-modal";

describe("ProjectDecisionsModal", () => {
  const mockDecisions: ProjectDecisionItem[] = [
    {
      id: "dec-1",
      title: "采用微服务架构",
      decision: "核心业务拆分为用户服务与订单服务",
      actor: "规划专家",
      created_at: "2026-09-20 10:00",
    },
    {
      id: "dec-2",
      title: "采用 Tailwind CSS 规范",
      summary: "统一设计系统变量与间距基准",
      actor: "UI设计师",
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders decisions modal with all decisions when open", () => {
    renderWithProviders(
      <ProjectDecisionsModal
        isOpen={true}
        onClose={vi.fn()}
        projectName="微服务协同工程"
        decisions={mockDecisions}
      />,
    );

    expect(screen.getByText(/微服务协同工程 · 核心事实库与历史决议/)).toBeInTheDocument();
    expect(screen.getByText("采用微服务架构")).toBeInTheDocument();
    expect(screen.getByText(/核心业务拆分为用户服务与订单服务/)).toBeInTheDocument();
    expect(screen.getByText("采用 Tailwind CSS 规范")).toBeInTheDocument();
    expect(screen.getByText(/UI设计师/)).toBeInTheDocument();
  });

  it("filters decisions based on search input", () => {
    renderWithProviders(
      <ProjectDecisionsModal
        isOpen={true}
        onClose={vi.fn()}
        projectName="微服务协同工程"
        decisions={mockDecisions}
      />,
    );

    const searchInput = screen.getByPlaceholderText(/按决议标题、内容或协作者搜索/);
    fireEvent.change(searchInput, { target: { value: "Tailwind" } });

    expect(screen.getByText("采用 Tailwind CSS 规范")).toBeInTheDocument();
    expect(screen.queryByText("采用微服务架构")).toBeNull();
  });

  it("copies single decision content to clipboard", async () => {
    const copySpy = vi.spyOn(clipboard, "copyTextToClipboard").mockResolvedValue(true);

    renderWithProviders(
      <ProjectDecisionsModal
        isOpen={true}
        onClose={vi.fn()}
        projectName="微服务协同工程"
        decisions={mockDecisions}
      />,
    );

    const copyButtons = screen.getAllByTitle("复制单条决议");
    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });

    expect(copySpy).toHaveBeenCalledWith("核心业务拆分为用户服务与订单服务");
  });

  it("copies all decisions to clipboard", async () => {
    const copySpy = vi.spyOn(clipboard, "copyTextToClipboard").mockResolvedValue(true);

    renderWithProviders(
      <ProjectDecisionsModal
        isOpen={true}
        onClose={vi.fn()}
        projectName="微服务协同工程"
        decisions={mockDecisions}
      />,
    );

    const copyAllBtn = screen.getByRole("button", { name: "复制全部决策" });
    await act(async () => {
      fireEvent.click(copyAllBtn);
    });

    expect(copySpy).toHaveBeenCalled();
    const calledText = copySpy.mock.calls[0][0];
    expect(calledText).toContain("微服务协同工程");
    expect(calledText).toContain("采用微服务架构");
    expect(calledText).toContain("采用 Tailwind CSS 规范");
  });

  it("renders empty state message when decisions is empty", () => {
    renderWithProviders(
      <ProjectDecisionsModal
        isOpen={true}
        onClose={vi.fn()}
        projectName="空白工程"
        decisions={[]}
      />,
    );

    expect(screen.getByText(/暂无已沉淀的决策/)).toBeInTheDocument();
  });
});
