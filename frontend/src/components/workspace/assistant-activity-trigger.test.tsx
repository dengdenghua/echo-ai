import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ActivityModule from "@/core/assistant/activity";

import { renderWithProviders } from "@/test/harness";

import { AssistantActivityTrigger } from "./assistant-activity-trigger";

const account = vi.hoisted(() => ({ id: "alice" }));
vi.mock("@/providers/AuthProvider", () => ({
  useOptionalAuth: () => ({
    user: { user_id: account.id, actor_id: account.id },
    isLoading: false,
    authStatus: { enabled: true },
    isAuthenticated: true,
  }),
}));
vi.mock("@/core/assistant/activity", async (importOriginal) => ({
  ...(await importOriginal<typeof ActivityModule>()),
  useAssistantActivity: () => ({
    data: { items: [], summary: { working: 0, attention: 0, completed: 0 } },
    isFetching: false,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

describe("assistant activity entry", () => {
  beforeEach(() => {
    account.id = "alice";
  });
  it("opens recent activity and restores keyboard focus after Escape", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssistantActivityTrigger />, { locale: "zh-CN" });
    const trigger = screen.getByRole("button", { name: "助手活动" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "助手活动" })).toBeVisible();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("clears a personal search when the active account changes", async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(<AssistantActivityTrigger />, {
      locale: "zh-CN",
    });
    await user.click(screen.getByRole("button", { name: "助手活动" }));
    await user.type(
      screen.getByRole("textbox", { name: "搜索活动" }),
      "private Alice task",
    );
    account.id = "bob";
    view.rerender(<AssistantActivityTrigger />);
    expect(screen.getByRole("textbox", { name: "搜索活动" })).toHaveValue("");
    expect(screen.getByRole("tab", { name: /^全部/ })).toHaveAttribute(
      "data-state",
      "active",
    );
  });
});
