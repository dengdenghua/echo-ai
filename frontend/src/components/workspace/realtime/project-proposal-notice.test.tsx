import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { ProjectProposalNotice } from "./project-proposal-notice";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/core/api", () => ({
  getAPIClient: () => ({ threads: { get: mocks.get } }),
}));

describe("retained project proposal", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.get.mockResolvedValue({
      metadata: {
        project_initiation: {
          id: "draft-1",
          status: "approval_expired",
          proposal: { name: "内部演示" },
        },
      },
    });
  });
  it("reopens the exact proposal without approving, and suppresses double click", async () => {
    const review = vi.fn();
    renderWithProviders(
      <ProjectProposalNotice threadId="test" busy={false} onReview={review} />,
    );
    const button = await screen.findByRole("button", { name: "重新提交审批" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(review).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledWith("/project review draft-1");
  });
  it("does not offer a competing request while a turn is running", () => {
    renderWithProviders(
      <ProjectProposalNotice threadId="test" busy onReview={vi.fn()} />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("shows only priority questions and submits literal feedback without approval", async () => {
    mocks.get.mockResolvedValue({
      metadata: {
        project_initiation: {
          id: "draft-2",
          status: "needs_input",
          revision: 2,
          open_questions: [
            "给谁用？",
            "解决什么问题？",
            "什么算成功？",
            "第四个问题",
          ],
          changes: ["本期范围"],
          proposal: {
            name: "内部工具",
            scope: "原型",
            assumptions: ["暂按桌面端考虑"],
          },
          revisions: [
            { id: "draft-1", revision: 1, proposal: { scope: "旧范围" } },
          ],
        },
      },
    });
    const review = vi.fn();
    renderWithProviders(
      <ProjectProposalNotice
        threadId="clarify"
        busy={false}
        onReview={review}
      />,
    );
    expect(
      await screen.findByText("需求草案 · 内部工具 · 第 2 版"),
    ).toBeInTheDocument();
    expect(screen.getByText("给谁用？")).toBeVisible();
    expect(screen.queryByRole("button", { name: /提交.*审批/ })).toBeNull();
    const button = screen.getByRole("button", { name: "更新草案" });
    expect(button).toBeDisabled();
    const feedback = '只做内部原型\n路径 D:\\notes；保留 "草稿"';
    fireEvent.change(screen.getByRole("textbox", { name: "补充或调整需求" }), {
      target: { value: feedback },
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(review).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledWith(`/project refine draft-2 ${feedback}`);
  });

  it("collapses legacy vague-goal questions into one combined prompt", async () => {
    mocks.get.mockResolvedValue({
      metadata: {
        project_initiation: {
          id: "draft-3",
          status: "needs_input",
          goal: "?",
          open_questions: [
            "请说明您的具体目标、服务对象和期望交付物是什么？",
            "您的具体目标是什么，想解决什么问题？",
            "服务对象是谁，为谁做？",
          ],
          proposal: { name: "待明确目标的任务澄清" },
        },
      },
    });
    renderWithProviders(
      <ProjectProposalNotice
        threadId="legacy"
        busy={false}
        onReview={vi.fn()}
      />,
    );
    expect(
      await screen.findByText(
        "请补充：要解决什么问题、服务谁、第一期交付什么？",
      ),
    ).toBeVisible();
    expect(screen.queryByText("服务对象是谁，为谁做？")).toBeNull();
  });
  it("does not approve a ready draft while unsent changes are present", async () => {
    mocks.get.mockResolvedValue({
      metadata: {
        project_initiation: {
          id: "ready",
          status: "needs_review",
          proposal: { name: "原型" },
        },
      },
    });
    const review = vi.fn();
    renderWithProviders(
      <ProjectProposalNotice threadId="ready" busy={false} onReview={review} />,
    );
    const button = await screen.findByRole("button", { name: "提交立项审批" });
    expect(button).toBeEnabled();
    expect(review).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "范围需要调整" },
    });
    expect(button).toBeDisabled();
  });
  it.each(["review_failed", "model_unavailable", "refining"])(
    "retains the draft after %s without offering old approval",
    async (status) => {
      mocks.get.mockResolvedValue({
        metadata: {
          project_initiation: {
            id: "failed",
            status,
            proposal: { name: "原型" },
          },
        },
      });
      renderWithProviders(
        <ProjectProposalNotice
          threadId={status}
          busy={false}
          onReview={vi.fn()}
        />,
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "原草案和补充意见已保留",
      );
      expect(screen.queryByRole("button", { name: /提交.*审批/ })).toBeNull();
    },
  );
});
