import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { AutomationPluginCard } from "./automation-plugin-card";

const api = vi.hoisted(() => ({
  hubListPlugins: vi.fn(),
  hubChangeLifecycle: vi.fn(),
}));
vi.mock("@/core/plugins/api", () => ({
  ...api,
  hubAutomationDiagnostics: async (plugin_id: string) => ({
    plugin_id,
    execution_status: "unverified",
    checks: [],
  }),
}));

describe("automation plugin lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.hubChangeLifecycle.mockResolvedValue(undefined);
  });

  it("disables persistently, reloads status and allows reinstall after uninstall", async () => {
    const user = userEvent.setup();
    let plugin = {
      id: "browser_control",
      version: "0.1.0",
      installed: true,
      enabled: true,
      loaded: true,
      started: true,
    };
    api.hubListPlugins.mockImplementation(async () => [plugin]);
    api.hubChangeLifecycle.mockImplementation(async (_id, action) => {
      plugin = {
        ...plugin,
        installed: action !== "uninstall",
        enabled: action === "install",
        loaded: action === "install",
        started: action === "install",
      };
    });
    renderWithProviders(<AutomationPluginCard pluginId="browser_control" />, {
      locale: "zh-CN",
    });
    await user.click(await screen.findByRole("button", { name: "停用插件" }));
    expect(api.hubChangeLifecycle).toHaveBeenCalledWith(
      "browser_control",
      "disable",
    );
    expect(await screen.findByText(/已停用/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "卸载插件" }));
    const install = await screen.findByRole("button", { name: "安装并启用" });
    await waitFor(() => expect(install).toBeEnabled());
    await user.click(install);
    await waitFor(() =>
      expect(api.hubChangeLifecycle).toHaveBeenCalledWith(
        "browser_control",
        "install",
      ),
    );
    expect(
      await screen.findByRole("button", { name: "停用插件" }),
    ).toBeVisible();
  });

  it("shows rejected enablement without claiming the plugin is active", async () => {
    api.hubListPlugins.mockResolvedValue([
      {
        id: "computer_control",
        version: "0.1.0",
        installed: true,
        enabled: false,
        loaded: false,
      },
    ]);
    api.hubChangeLifecycle.mockRejectedValue(
      new Error("Desktop automation is disabled"),
    );
    renderWithProviders(<AutomationPluginCard pluginId="computer_control" />, {
      locale: "zh-CN",
    });
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "启用插件" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Desktop automation is disabled",
    );
    expect(screen.getByText(/已停用/)).toBeVisible();
  });
});
