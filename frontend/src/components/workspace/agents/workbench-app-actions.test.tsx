import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import {
  WorkbenchInstallControl,
  WorkbenchManageMenu,
  WorkbenchStatusLine,
} from "./workbench-app-actions";

function renderInstallControl(
  overrides: Partial<Parameters<typeof WorkbenchInstallControl>[0]> = {},
) {
  const props = {
    appName: "设计画布",
    canManage: true,
    isInSidebar: false,
    hasRecoveries: false,
    isMutating: false,
    disabled: false,
    statusUnread: false,
    onRemoveFromSidebar: vi.fn(),
    onInstall: vi.fn(),
    ...overrides,
  };
  renderWithProviders(
    <div className="relative">
      <WorkbenchInstallControl {...props} />
    </div>,
  );
  return props;
}

function renderManageMenu(canManage: boolean) {
  const props = {
    appName: "设计画布",
    canManage,
    isInSidebar: true,
    isRuntimeEnabled: true,
    isUpdateAvailable: false,
    needsRepair: false,
    rollbackOperation: "update",
    onToggleSidebar: vi.fn(),
    onOperation: vi.fn(),
    onUninstall: vi.fn(),
  };
  renderWithProviders(
    <div className="relative">
      <WorkbenchManageMenu {...props} />
    </div>,
  );
  return props;
}

describe("WorkbenchInstallControl", () => {
  it("offers install to the admin", async () => {
    const props = renderInstallControl();
    await userEvent.click(screen.getByRole("button", { name: "安装设计画布" }));
    expect(props.onInstall).toHaveBeenCalledTimes(1);
  });

  it("tells an ordinary account the admin installs it, without a button", () => {
    const props = renderInstallControl({ canManage: false });
    expect(screen.getByText("由管理员安装")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    expect(props.onInstall).not.toHaveBeenCalled();
  });

  it("still lets an ordinary account unpin a missing app from its own sidebar", async () => {
    const props = renderInstallControl({ canManage: false, isInSidebar: true });
    await userEvent.click(
      screen.getByRole("button", { name: "从侧栏移除设计画布" }),
    );
    expect(props.onRemoveFromSidebar).toHaveBeenCalledTimes(1);
    expect(props.onInstall).not.toHaveBeenCalled();
  });
});

describe("WorkbenchManageMenu", () => {
  it("gives the admin the package lifecycle actions", async () => {
    const props = renderManageMenu(true);
    await userEvent.click(screen.getByRole("button", { name: "管理设计画布" }));
    expect(screen.getByRole("menuitem", { name: "停用应用" })).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "回退上个版本" }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("menuitem", { name: /卸载/ }));
    expect(props.onUninstall).toHaveBeenCalledTimes(1);
  });

  it("keeps only the personal sidebar pin for an ordinary account", async () => {
    const props = renderManageMenu(false);
    await userEvent.click(screen.getByRole("button", { name: "管理设计画布" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    expect(screen.getByText(/工作台由本机管理员安装和管理/)).toBeVisible();
    await userEvent.click(screen.getByRole("menuitem", { name: "从侧栏移除" }));
    expect(props.onToggleSidebar).toHaveBeenCalledTimes(1);
    expect(props.onOperation).not.toHaveBeenCalled();
    expect(props.onUninstall).not.toHaveBeenCalled();
  });
});

describe("WorkbenchStatusLine", () => {
  it("drops click hints the account cannot act on", () => {
    const state = {
      isBroken: false,
      isIncompatible: false,
      isUpdateAvailable: false,
      isDisabled: true,
      hasRecoveries: false,
    };
    const { rerender } = renderWithProviders(
      <WorkbenchStatusLine canManage {...state} />,
    );
    expect(screen.getByText("已停用 · 点击重新启用")).toBeVisible();
    rerender(<WorkbenchStatusLine canManage={false} {...state} />);
    expect(screen.getByText("已停用 · 需管理员启用")).toBeVisible();
    rerender(
      <WorkbenchStatusLine
        canManage={false}
        {...state}
        isBroken
        isDisabled={false}
      />,
    );
    expect(screen.getByText("安装损坏 · 需管理员修复")).toBeVisible();
  });
});
