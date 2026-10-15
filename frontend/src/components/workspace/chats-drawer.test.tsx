import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { eventBus } from "@/core/events";
import {
  resetModuleStateCache,
  setModuleAvailabilitySnapshot,
} from "@/core/modules/enabled-modules";
import { renderWithProviders } from "@/test/harness";

import { ChatsDrawer } from "./chats-drawer";

const { useThreadsMock } = vi.hoisted(() => ({
  useThreadsMock: vi.fn(() => ({ data: [] })),
}));

vi.mock("@/core/threads/hooks", () => ({
  useThreads: (...args: unknown[]) => useThreadsMock(...args),
  useThreadListVisibility: () => ({ isPending: false, mutate: vi.fn() }),
  useRenameThread: () => ({ isPending: false, mutate: vi.fn() }),
}));

describe("ChatsDrawer", () => {
  it("offers a persistent removed-list recovery surface", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatsDrawer open onOpenChange={vi.fn()} />, {
      locale: "zh-CN",
    });
    await user.click(
      screen.getByRole("button", { name: "已移除的对话", exact: true }),
    );
    expect(await screen.findByText("没有已移除的对话")).toBeVisible();
    expect(useThreadsMock).toHaveBeenCalledWith(
      expect.objectContaining({ hidden_only: true }),
    );
  });
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem("echo.active-agent", "installed_researcher");
  });

  it("migrates an on-demand identity selection to the default fixed persona", () => {
    renderWithProviders(<ChatsDrawer open onOpenChange={vi.fn()} />, {
      locale: "zh-CN",
    });

    expect(useThreadsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 50,
        sortBy: "updated_at",
        sortOrder: "desc",
        select: ["thread_id", "updated_at", "values", "metadata"],
      }),
      undefined,
      "eve",
    );
  });

  it("keeps settings reachable from the narrow-screen navigation", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const openSettings = vi.fn();
    const offOpenSettings = eventBus.on("ui:open-settings", openSettings);

    renderWithProviders(<ChatsDrawer open onOpenChange={onOpenChange} />, {
      locale: "zh-CN",
    });

    await user.click(screen.getByRole("button", { name: "设置" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(openSettings).toHaveBeenCalledTimes(1));
    offOpenSettings();
  });

  it("reaches the account surfaces a phone has no account menu for", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<ChatsDrawer open onOpenChange={onOpenChange} />, {
      locale: "zh-CN",
      initialRoute: "/workspace/realtime/new",
    });

    expect(screen.getByRole("button", { name: "积分中心" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "组织管理" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps primary workspace destinations reachable on narrow screens", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    resetModuleStateCache();
    setModuleAvailabilitySnapshot({
      community: true,
      intelligence: true,
      evolution: true,
    });

    renderWithProviders(<ChatsDrawer open onOpenChange={onOpenChange} />, {
      locale: "zh-CN",
    });

    expect(screen.getByRole("link", { name: "HUB" })).toHaveAttribute(
      "href",
      "/workspace/agents?surface=chat",
    );
    expect(screen.getByRole("link", { name: "助手" })).toHaveAttribute(
      "href",
      "/workspace/realtime/echo-assistant?agent=echo",
    );
    expect(screen.getByRole("link", { name: "广场" })).toHaveAttribute(
      "href",
      "/workspace/community",
    );
    expect(screen.getByRole("link", { name: "自动化" })).toHaveAttribute(
      "href",
      "/workspace/intelligence?surface=chat",
    );
    expect(screen.getByRole("link", { name: "自进化" })).toHaveAttribute(
      "href",
      "/workspace/evolution?surface=chat",
    );
    expect(screen.getByRole("link", { name: "资料库" })).toHaveAttribute(
      "href",
      "/workspace/storage?surface=company&library=docs",
    );

    await user.click(screen.getByRole("link", { name: "资料库" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("lists only installed optional apps, like the desktop sidebar", () => {
    // Regression: the phone drawer listed every catalog app (自进化, 自动化,
    // 广场 …) on a fresh install, all with the same compass icon.
    resetModuleStateCache();
    setModuleAvailabilitySnapshot({
      projects: true,
      design: false,
      narrative: false,
      evolution: false,
      intelligence: false,
      community: false,
    });

    renderWithProviders(<ChatsDrawer open onOpenChange={vi.fn()} />, {
      locale: "zh-CN",
    });

    expect(screen.getByRole("link", { name: "项目管理" })).toHaveAttribute(
      "href",
      "/workspace/projects",
    );
    for (const name of ["设计画布", "叙事工坊", "自进化", "自动化", "广场"]) {
      expect(screen.queryByRole("link", { name })).toBeNull();
    }
    expect(screen.getByRole("link", { name: "HUB" })).toBeInTheDocument();
  });
});
