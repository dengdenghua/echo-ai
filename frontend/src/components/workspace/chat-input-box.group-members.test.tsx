import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";
import { ChatInputBox, GroupMemberAvatarStack } from "./chat-input-box";
import type { MentionMemberInput } from "./mention-autocomplete";

vi.mock("@/core/uploads/api", () => ({
  uploadFiles: vi.fn(),
  uploadFilesWithProgress: vi.fn(),
}));

vi.mock("@/core/models/hooks", () => ({
  useModels: () => ({ models: [] }),
}));

describe("GroupMemberAvatarStack & Input Box Group Members", () => {
  const mockMembers: MentionMemberInput[] = [
    { name: "leader", display_name: "组长", mention_value: "agent:leader" },
    { name: "coder", display_name: "工程师", mention_value: "coder" },
    { name: "designer", display_name: "设计师", mention_value: "designer" },
    { name: "tester", display_name: "测试员", mention_value: "tester" },
    { name: "reviewer", display_name: "审查员", mention_value: "reviewer" },
    { name: "intern", display_name: "实习生", mention_value: "intern" },
    { name: "pm", display_name: "产品经理", mention_value: "pm" },
  ];

  it("renders all members without overflow when members count <= 10", () => {
    renderWithProviders(<GroupMemberAvatarStack members={mockMembers} />);
    const stack = screen.getByTestId("group-member-avatar-stack");
    expect(stack).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "查看 组长 并行进程（右键 @ 提及）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看 工程师 并行进程（右键 @ 提及）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看 设计师 并行进程（右键 @ 提及）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看 测试员 并行进程（右键 @ 提及）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看 审查员 并行进程（右键 @ 提及）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看 实习生 并行进程（右键 @ 提及）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看 产品经理 并行进程（右键 @ 提及）" }),
    ).toBeInTheDocument();

    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("renders compressed avatars and overflow pill when members exceed 10", () => {
    const twelveMembers: MentionMemberInput[] = [
      ...mockMembers,
      { name: "a8", display_name: "成员8", mention_value: "a8" },
      { name: "a9", display_name: "成员9", mention_value: "a9" },
      { name: "a10", display_name: "成员10", mention_value: "a10" },
      { name: "a11", display_name: "成员11", mention_value: "a11" },
      { name: "a12", display_name: "成员12", mention_value: "a12" },
    ];
    renderWithProviders(<GroupMemberAvatarStack members={twelveMembers} />);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("renders in ChatInputBox status strip when isGroupConversation is true", () => {
    renderWithProviders(
      <ChatInputBox
        mode="react"
        threadId="group-thread-1"
        isGroupConversation={true}
        mentionMembers={mockMembers}
      />,
    );

    expect(screen.getByTestId("group-member-avatar-stack")).toBeInTheDocument();
  });

  it("does not render group avatar stack in personal/non-group conversation", () => {
    renderWithProviders(
      <ChatInputBox
        mode="react"
        threadId="personal-thread-1"
        isGroupConversation={false}
        mentionMembers={mockMembers}
      />,
    );

    expect(screen.queryByTestId("group-member-avatar-stack")).toBeNull();
  });

  it("left-clicking a member avatar triggers workbench focus to view parallel process", () => {
    const focusSpy = vi.fn();
    window.addEventListener("echo:agent-workbench-focus", focusSpy);

    renderWithProviders(
      <ChatInputBox
        mode="react"
        threadId="group-thread-2"
        isGroupConversation={true}
        mentionMembers={mockMembers}
      />,
    );

    const leaderButton = screen.getByRole("button", {
      name: "查看 组长 并行进程（右键 @ 提及）",
    });
    fireEvent.click(leaderButton);

    expect(focusSpy).toHaveBeenCalledOnce();
    const event = focusSpy.mock.calls[0][0] as CustomEvent;
    expect(event.detail.agentId).toBe("leader");
    expect(event.detail.tab).toBe("agent");
    expect(event.detail.view).toBe("screen");

    window.removeEventListener("echo:agent-workbench-focus", focusSpy);
  });

  it("right-clicking a member avatar inserts mention into the composer draft", () => {
    renderWithProviders(
      <ChatInputBox
        mode="react"
        threadId="group-thread-3"
        isGroupConversation={true}
        mentionMembers={mockMembers}
        defaultValue="已有内容"
      />,
    );

    const leaderButton = screen.getByRole("button", {
      name: "查看 组长 并行进程（右键 @ 提及）",
    });
    fireEvent.contextMenu(leaderButton);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toContain("@agent:leader");
  });
});
