import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import NotificationSettingsPage from "./notification-settings-page";

const notificationMock = vi.hoisted(() => ({
  current: {
    permission: "denied" as NotificationPermission,
    isSupported: true,
    isReady: true,
    requestPermission: vi.fn(),
    showNotification: vi.fn(() => true),
  },
}));

vi.mock("@/core/notification/hooks", () => ({
  useNotification: () => notificationMock.current,
}));

describe("NotificationSettingsPage", () => {
  beforeEach(() => {
    notificationMock.current = {
      permission: "denied",
      isSupported: true,
      isReady: true,
      requestPermission: vi.fn(),
      showNotification: vi.fn(() => true),
    };
  });

  it("names the disabled switch and explains denied desktop permission", () => {
    renderWithProviders(<NotificationSettingsPage />, { locale: "zh-CN" });

    expect(screen.getByRole("switch", { name: "启用通知" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "系统或浏览器的通知设置",
    );
    expect(screen.getByText("权限被拒绝")).toBeInTheDocument();
  });

  it("offers per-type attention toggles that follow the master switch", () => {
    renderWithProviders(<NotificationSettingsPage />, { locale: "zh-CN" });
    for (const name of ["任务完成", "任务失败", "需要审批或回复", "任务暂停"]) {
      expect(screen.getByRole("switch", { name })).toBeDisabled();
    }
  });

  it("saves a per-type toggle once notifications are allowed", () => {
    notificationMock.current = {
      ...notificationMock.current,
      permission: "granted",
    };
    renderWithProviders(<NotificationSettingsPage />, { locale: "zh-CN" });
    const paused = screen.getByRole("switch", { name: "任务暂停" });
    expect(paused).toBeEnabled();
    expect(paused).toBeChecked();

    fireEvent.click(paused);

    expect(paused).not.toBeChecked();
    expect(
      JSON.parse(window.localStorage.getItem("echo.local-settings") ?? "{}"),
    ).toMatchObject({ notification: { enabled: true, paused: false } });
    window.localStorage.removeItem("echo.local-settings");
  });

  it("shows a stable loading state before capability detection completes", () => {
    notificationMock.current = {
      ...notificationMock.current,
      isReady: false,
    };

    renderWithProviders(<NotificationSettingsPage />, { locale: "zh-CN" });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
