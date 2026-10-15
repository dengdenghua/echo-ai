import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HubPluginInfo } from "@/core/plugins/types";
import { renderWithProviders } from "@/test/harness";

import { PluginStoreSection } from "./plugin-store-section";

const api = vi.hoisted(() => ({
  hubListPlugins: vi.fn(),
  hubChangeLifecycle: vi.fn(),
}));
vi.mock("@/core/plugins/api", () => api);

function plugin(overrides: Partial<HubPluginInfo> = {}): HubPluginInfo {
  return {
    id: "clip_studio",
    name: "AI 剪辑工坊",
    version: "0.7.0",
    description: "manifest description",
    author: "Echo",
    capabilities: [],
    loaded: false,
    installed: false,
    started: false,
    enabled: false,
    optional: true,
    dir: "",
    dependencies: [],
    state: "uninstalled",
    ...overrides,
  };
}

describe("PluginStoreSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only on-demand plugins and installs one live", async () => {
    const user = userEvent.setup();
    let clip = plugin();
    api.hubListPlugins.mockImplementation(async () => [
      clip,
      plugin({
        id: "computer_control",
        name: "电脑控制",
        optional: false,
        installed: true,
        enabled: true,
        loaded: true,
      }),
    ]);
    api.hubChangeLifecycle.mockImplementation(async () => {
      clip = { ...clip, installed: true, enabled: true, loaded: true };
    });

    renderWithProviders(<PluginStoreSection />, { locale: "zh-CN" });

    const row = await screen.findByTestId("optional-plugin-clip_studio");
    expect(within(row).getByText("未安装")).toBeVisible();
    expect(
      screen.queryByTestId("optional-plugin-computer_control"),
    ).not.toBeInTheDocument();

    await user.click(
      within(row).getByRole("button", { name: "安装AI 剪辑工坊" }),
    );
    expect(api.hubChangeLifecycle).toHaveBeenCalledWith(
      "clip_studio",
      "install",
    );
    await waitFor(() =>
      expect(within(row).getByText("已安装 · v0.7.0")).toBeVisible(),
    );
  });

  it("uninstalls through the manage menu and keeps the row installable", async () => {
    const user = userEvent.setup();
    let github = plugin({
      id: "github",
      name: "github",
      version: "0.1.0",
      installed: true,
      enabled: true,
      loaded: true,
    });
    api.hubListPlugins.mockImplementation(async () => [github]);
    api.hubChangeLifecycle.mockImplementation(async () => {
      github = { ...github, installed: false, enabled: false, loaded: false };
    });

    renderWithProviders(<PluginStoreSection />, { locale: "en-US" });

    await user.click(
      await screen.findByRole("button", { name: "Manage GitHub" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Uninstall (keep data)" }),
    );
    expect(api.hubChangeLifecycle).toHaveBeenCalledWith("github", "uninstall");
    expect(
      await screen.findByRole("button", { name: "Install GitHub" }),
    ).toBeVisible();
  });

  it("renders nothing when the backend has no on-demand plugins", async () => {
    api.hubListPlugins.mockResolvedValue([
      plugin({ id: "computer_control", optional: false, installed: true }),
    ]);
    renderWithProviders(<PluginStoreSection />, { locale: "zh-CN" });
    await waitFor(() => expect(api.hubListPlugins).toHaveBeenCalled());
    expect(screen.queryByTestId("plugin-store")).not.toBeInTheDocument();
  });
});
