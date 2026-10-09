import { useState } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";
import type * as ProjectHooks from "@/core/projects/hooks";

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  navigate: vi.fn(),
  agentState: {
    agents: [
      {
        name: "general",
        display_name: "通用助手",
        description: "处理通用项目工作",
        icon: "🐙",
        avatar_url: null,
      },
      {
        name: "planner",
        display_name: "规划师",
        description: "拆解里程碑和事项",
        icon: "📋",
        avatar_url: "/api/agents/planner/avatar",
      },
    ],
    isLoading: false,
    error: null,
  },
}));

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("react-router-dom");
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock("@/core/projects/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof ProjectHooks>()),
  useCreateProject: () => ({ mutate: mocks.createProject, isPending: false }),
}));

vi.mock("@/core/agents", () => ({
  useAgents: () => mocks.agentState,
}));

vi.mock("@/core/agents/active", () => ({
  useActiveAgentId: () => "general",
}));

vi.mock("@/components/workspace/sidebar-footer", () => ({
  AgentAvatar: ({ agent }: { agent?: { display_name?: string } }) => (
    <span aria-hidden="true">{agent?.display_name?.slice(0, 1)}</span>
  ),
}));

import { CreateProjectDialog } from "./create-project-dialog";
import { ProjectCreationRequestError } from "@/core/projects/hooks";

function DialogHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        reopen
      </button>
      <CreateProjectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

describe("CreateProjectDialog", () => {
  it("blocks a second POST when a disconnected creation has an unknown outcome", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DialogHarness />, { locale: "zh-CN" });
    const name = screen.getByRole("textbox", { name: "项目名称" });
    await user.type(name, "Maybe saved");
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    const callbacks = mocks.createProject.mock.calls[0]?.[1] as {
      onError: (error: Error) => void;
    };
    act(() =>
      callbacks.onError(
        new ProjectCreationRequestError(
          "disconnected",
          0,
          "PROJECT_CREATION_OUTCOME_UNKNOWN",
        ),
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "连接中断，尚未确认创建结果。请先检查项目列表。",
    );
    expect(screen.getByRole("button", { name: "创建项目" })).toBeDisabled();
    fireEvent.keyDown(name, { key: "Enter" });
    expect(mocks.createProject).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "查看已有对话" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "reopen" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "项目名称" }),
      "Explicit new request",
    );
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    expect(mocks.createProject).toHaveBeenCalledTimes(2);
  });

  it.each(["zh-CN", "en-US"] as const)(
    "keeps a 503 draft and visibly permits manual retry in %s",
    async (locale) => {
      const user = userEvent.setup();
      renderWithProviders(<CreateProjectDialog open onOpenChange={vi.fn()} />, {
        locale,
      });
      const name = screen.getByRole("textbox");
      await user.type(name, "Keep this plan");
      await user.click(
        screen.getByRole("button", {
          name: locale === "zh-CN" ? "创建项目" : "Create project",
        }),
      );
      const callbacks = mocks.createProject.mock.calls[0]?.[1] as {
        onError: (error: Error) => void;
      };
      act(() =>
        callbacks.onError(
          new ProjectCreationRequestError(
            "模型暂不可用",
            503,
            "PROJECT_PLANNING_UNAVAILABLE",
            { retryable: true },
          ),
        ),
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        locale === "zh-CN" ? "未创建项目" : "No project was created",
      );
      expect(name).toHaveValue("Keep this plan");
      const retry = screen.getByRole("button", {
        name: locale === "zh-CN" ? "重试创建" : "Retry creation",
      });
      expect(retry).toBeEnabled();
      await user.click(retry);
      expect(mocks.createProject).toHaveBeenCalledTimes(2);
      expect(mocks.createProject.mock.calls[1]?.[0].name).toBe(
        "Keep this plan",
      );
    },
  );

  it("blocks duplicate creation after recovery pending and navigates only the retained conversation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DialogHarness />, { locale: "zh-CN" });
    const name = screen.getByRole("textbox", { name: "项目名称" });
    await user.type(name, "Already saved");
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    const callbacks = mocks.createProject.mock.calls[0]?.[1] as {
      onError: (error: Error) => void;
    };
    act(() =>
      callbacks.onError(
        new ProjectCreationRequestError(
          "incomplete",
          409,
          "PROJECT_GROUP_CREATION_RECOVERY_PENDING",
          { projectId: "P-saved", threadId: "thread/saved" },
        ),
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "项目已保存但工作群未完成，请查看已有项目",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("P-saved");
    expect(screen.getByRole("button", { name: "创建项目" })).toBeDisabled();
    fireEvent.keyDown(name, { key: "Enter" });
    expect(mocks.createProject).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "查看已有对话" }));
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/workspace/realtime/thread%2Fsaved",
      { state: { openProjectWorkbench: true } },
    );
    expect(mocks.createProject).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "reopen" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "项目名称" })).toHaveValue("");
  });

  it("shows a retained project without inventing a conversation when no thread exists", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateProjectDialog open onOpenChange={vi.fn()} />, {
      locale: "zh-CN",
    });
    await user.type(screen.getByRole("textbox", { name: "项目名称" }), "Saved");
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    const callbacks = mocks.createProject.mock.calls[0]?.[1] as {
      onError: (error: Error) => void;
    };
    act(() =>
      callbacks.onError(
        new ProjectCreationRequestError(
          "incomplete",
          409,
          "PROJECT_GROUP_CREATION_RECOVERY_PENDING",
          { projectId: "P-only" },
        ),
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("已保留项目：P-only");
    expect(
      screen.queryByRole("button", { name: "查看已有对话" }),
    ).not.toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "创建项目" })).toBeDisabled();
  });

  it("searches stable IDs and distinguishes roles with the same display name", async () => {
    const previousAgents = mocks.agentState.agents;
    mocks.agentState.agents = [
      previousAgents[0]!,
      { ...previousAgents[1]!, display_name: "同名助手" },
      { ...previousAgents[1]!, name: "planner-two", display_name: "同名助手" },
      previousAgents[0]!,
    ];
    try {
      renderWithProviders(<CreateProjectDialog open onOpenChange={vi.fn()} />, {
        locale: "zh-CN",
      });
      expect(screen.getAllByRole("button", { name: "通用助手" })).toHaveLength(
        1,
      );
      fireEvent.click(screen.getByRole("button", { name: "成员与邀请设置" }));
      expect(
        screen.getByRole("button", { name: "同名助手 (planner)" }),
      ).toBeInTheDocument();
      fireEvent.change(
        // type=search (autofill guard) makes this a searchbox, not a textbox.
        screen.getByRole("searchbox", { name: "搜索成员名称、标识或能力" }),
        { target: { value: "planner-two" } },
      );
      expect(
        screen.queryByRole("button", { name: "同名助手 (planner)" }),
      ).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "同名助手 (planner-two)" }),
      );
      fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), {
        target: { value: "测试" },
      });
      fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
      expect(
        mocks.createProject.mock.calls[0]?.[0].initialAgents.map(
          (agent: { id: string }) => agent.id,
        ),
      ).toEqual(["general", "planner-two"]);
    } finally {
      mocks.agentState.agents = previousAgents;
    }
  });

  beforeEach(() => {
    mocks.createProject.mockReset();
    mocks.navigate.mockReset();
  });

  it("clears an abandoned draft before the dialog is reopened", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DialogHarness />, { locale: "zh-CN" });

    const name = screen.getByRole("textbox", { name: "项目名称" });
    await user.type(name, "不会创建的项目");
    await user.click(screen.getByRole("button", { name: "成员与邀请设置" }));
    await user.click(screen.getByRole("button", { name: "规划师" }));
    await user.click(
      screen.getByRole("switch", { name: "进入工作群后立即邀请" }),
    );
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "reopen" }));

    expect(screen.getByRole("textbox", { name: "项目名称" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "通用助手" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "规划师" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "成员与邀请设置" }));
    expect(screen.getByRole("button", { name: "规划师" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByRole("switch", { name: "进入工作群后立即邀请" }),
    ).not.toBeChecked();
  });

  it("does not submit an empty project from the Enter key", () => {
    renderWithProviders(<CreateProjectDialog open onOpenChange={vi.fn()} />, {
      locale: "zh-CN",
    });

    fireEvent.keyDown(screen.getByRole("textbox", { name: "项目名称" }), {
      key: "Enter",
    });

    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it("creates immediately with the default AI collaborator", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateProjectDialog open onOpenChange={vi.fn()} />, {
      locale: "zh-CN",
    });

    await user.type(
      screen.getByRole("textbox", { name: "项目名称" }),
      "发布新版",
    );
    await user.click(screen.getByRole("button", { name: "创建项目" }));

    expect(mocks.createProject).toHaveBeenCalledWith(
      {
        name: "发布新版",
        icon: "📁",
        category: undefined,
        initialAgents: [
          {
            id: "general",
            displayName: "通用助手",
            description: "处理通用项目工作",
            avatarUrl: null,
            icon: "🐙",
          },
        ],
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it("keeps the White Ghost leader first and adds other roles as members", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateProjectDialog open onOpenChange={vi.fn()} />, {
      locale: "zh-CN",
    });

    expect(screen.getByRole("button", { name: "通用助手" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "成员与邀请设置" }));
    await user.click(screen.getByRole("button", { name: "规划师" }));
    expect(screen.getByRole("button", { name: "通用助手" })).toBeDisabled();
    await user.type(
      screen.getByRole("textbox", { name: "项目名称" }),
      "增长实验",
    );
    await user.click(screen.getByRole("button", { name: "创建项目" }));

    expect(mocks.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        initialAgents: [
          {
            id: "general",
            displayName: "通用助手",
            description: "处理通用项目工作",
            avatarUrl: null,
            icon: "🐙",
          },
          {
            id: "planner",
            displayName: "规划师",
            description: "拆解里程碑和事项",
            avatarUrl: "/api/agents/planner/avatar",
            icon: "📋",
          },
        ],
      }),
      expect.any(Object),
    );
  });

  it("states that people join after creation and the creator is owner", () => {
    renderWithProviders(<CreateProjectDialog open onOpenChange={vi.fn()} />, {
      locale: "zh-CN",
    });

    fireEvent.click(screen.getByRole("button", { name: "成员与邀请设置" }));
    expect(screen.getByText("真人成员")).toBeInTheDocument();
    expect(screen.getByText("创建后邀请")).toBeInTheDocument();
    expect(screen.getByText("项目负责人 · 群主")).toBeInTheDocument();
    expect(
      screen.getByText(/再通过安全邀请链接选择成员或访客/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "进入工作群后立即邀请" }),
    ).not.toBeChecked();
  });

  it("requests the human invite dialog through navigation state when opted in", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateProjectDialog open onOpenChange={vi.fn()} />, {
      locale: "zh-CN",
    });

    await user.click(screen.getByRole("button", { name: "成员与邀请设置" }));
    await user.click(
      screen.getByRole("switch", { name: "进入工作群后立即邀请" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "项目名称" }),
      "协作项目",
    );
    await user.click(screen.getByRole("button", { name: "创建项目" }));
    const callbacks = mocks.createProject.mock.calls[0]?.[1] as {
      onSuccess: (home: { threadId: string }) => void;
    };
    act(() => callbacks.onSuccess({ threadId: "thread/project" }));

    expect(mocks.navigate).toHaveBeenCalledWith(
      "/workspace/realtime/thread%2Fproject",
      {
        state: {
          openProjectWorkbench: true,
          openHumanInviteAfterCreate: true,
        },
      },
    );
  });
});
