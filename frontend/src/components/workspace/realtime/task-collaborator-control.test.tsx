import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Agent } from "@/core/agents";
import { renderWithProviders } from "@/test/harness";

import { TaskCollaboratorControl } from "./task-collaborator-control";

vi.mock("@/components/workspace/sidebar-footer", () => ({
  AgentAvatar: ({ agent }: { agent?: Agent }) => (
    <span aria-hidden="true">{agent?.display_name ?? agent?.name}</span>
  ),
}));

const agents: Agent[] = [
  {
    name: "coder",
    display_name: "Kane",
    description: "白幽灵主控",
    model: null,
    tool_groups: [],
  },
  {
    name: "general",
    display_name: "Eve",
    description: "白幽灵协调员",
    model: null,
    tool_groups: [],
  },
  {
    name: "research-advisor",
    display_name: "研究顾问",
    description: "WorkBuddy 专家",
    model: null,
    tool_groups: [],
  },
  {
    name: "installed_code_reviewer",
    display_name: "Code Reviewer",
    description: "已安装专家",
    model: null,
    tool_groups: [],
  },
];

describe("TaskCollaboratorControl", () => {
  it("discards staged selections on cancel and preserves existing members", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    const mode = vi.fn();
    renderWithProviders(<TaskCollaboratorControl agents={agents} selectedAgents={[agents[1]!]} selectedAgentIds={["general"]} currentAgentName="coder" teamMode="cluster" onSelectedAgentIdsChange={save} onTeamModeChange={mode} roster={[]} />, { locale: "zh-CN" });
    await user.click(screen.getByRole("button", { name: /成员|协作/ }));
    await user.click(screen.getByRole("button", { name: /研究顾问/ }));
    expect(screen.getByText("已选 2 位成员")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /成员|协作/ }));
    expect(screen.getByText("已选 1 位成员")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认成员" })).toBeDisabled();
    expect(mode).not.toHaveBeenCalled();
  });
  it("separates fixed personas from on-demand capabilities", async () => {
    const user = userEvent.setup();
    const onSelectedAgentIdsChange = vi.fn();
    const onTeamModeChange = vi.fn();

    renderWithProviders(
      <TaskCollaboratorControl
        agents={agents}
        selectedAgents={[]}
        selectedAgentIds={[]}
        currentAgentName="coder"
        teamMode="chat"
        open
        onOpenChange={vi.fn()}
        onSelectedAgentIdsChange={onSelectedAgentIdsChange}
        onTeamModeChange={onTeamModeChange}
        roster={[]}
        onlineCount={0}
        humanInviteAction={<button type="button">邀请真人</button>}
      />,
      { locale: "zh-CN" },
    );

    expect(screen.getByRole("region", { name: "白幽灵小队" })).toBeVisible();
    expect(screen.getByRole("region", { name: "按需能力" })).toBeVisible();
    expect(
      screen.getByText(
        "专家、数位分身和已安装能力只加入当前对话，不会切换你的主身份。",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /研究顾问/ })).toHaveAttribute(
      "data-capability-kind",
      "on-demand",
    );
    expect(screen.getByRole("button", { name: /Eve/ })).toHaveAttribute(
      "data-capability-kind",
      "primary",
    );
    expect(screen.getByTestId("collaborator-remote-invite")).toContainElement(
      screen.getByRole("button", { name: "邀请真人" }),
    );

    await user.click(screen.getByRole("button", { name: /研究顾问/ }));

    expect(onTeamModeChange).not.toHaveBeenCalled();
    expect(onSelectedAgentIdsChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Eve/ }));
    expect(screen.getByText("已选 2 位成员")).toBeVisible();
    expect(onSelectedAgentIdsChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "创建群聊" }));
    expect(onTeamModeChange).toHaveBeenCalledWith("cluster");
    expect(onSelectedAgentIdsChange).toHaveBeenCalledWith(["research-advisor", "general"]);
  });
});
