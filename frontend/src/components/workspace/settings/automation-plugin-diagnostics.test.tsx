import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { AutomationPluginDiagnostics } from "./automation-plugin-diagnostics";

const probe = vi.hoisted(() => vi.fn());
vi.mock("@/core/plugins/api", () => ({ hubAutomationDiagnostics: probe }));

it("distinguishes a loaded plugin from missing drivers and refreshes diagnostics", async () => {
  probe.mockResolvedValueOnce({
    execution_status: "blocked",
    checks: [{ id: "pyautogui", status: "unavailable" }],
  });
  renderWithProviders(
    <AutomationPluginDiagnostics
      pluginId="computer_control"
      lifecycle="enabled"
    />,
    { locale: "zh-CN" },
  );
  expect(await screen.findByText("驱动缺失或无法加载")).toBeVisible();
  expect(screen.getByText(/尚不具备执行条件/)).toBeVisible();
  probe.mockResolvedValueOnce({
    execution_status: "unverified",
    checks: [
      { id: "pyautogui", status: "available" },
      { id: "desktop_session", status: "unverified" },
    ],
  });
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "重新检查" }));
  expect(await screen.findByText("驱动可用")).toBeVisible();
  expect(screen.getByText("待实际验证")).toBeVisible();
  expect(screen.getByText(/尚未验证完整操作/)).toBeVisible();
});
