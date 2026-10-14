import { fireEvent, screen, within } from "@testing-library/react";
import { FileDiffIcon, FolderIcon, TerminalIcon } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";
import type { AgentWorkbenchTabId } from "../agent-workbench-utils";
import { WorkbenchTabHeader, type WorkbenchTab } from "./workbench-tab-header";

const tabs: WorkbenchTab[] = [
  { id: "diff", label: "Diff", Icon: FileDiffIcon },
  { id: "terminal", label: "Terminal", Icon: TerminalIcon },
  { id: "workspace", label: "Workspace", Icon: FolderIcon },
];

function renderHeader(activeTab: AgentWorkbenchTabId = "terminal") {
  const onTabClick = vi.fn();
  const onTabClose = vi.fn();
  renderWithProviders(
    <WorkbenchTabHeader
      mainButton={{
        active: false,
        label: "Main",
        onClick: vi.fn(),
        runState: "done",
        title: "Main",
      }}
      visibleTabs={tabs}
      workbenchTabs={tabs}
      closedTabs={new Set()}
      effectiveActiveTab={activeTab}
      onTabClick={onTabClick}
      onTabClose={onTabClose}
    />,
  );
  return { onTabClick, onTabClose };
}

describe("<WorkbenchTabHeader /> tablist keyboard support", () => {
  it("keeps only the selected tab in the Tab order", () => {
    renderHeader();
    const tablist = screen.getByRole("tablist");
    const [diff, terminal, workspace] = within(tablist).getAllByRole("tab");
    expect(terminal).toHaveAttribute("tabindex", "0");
    expect(diff).toHaveAttribute("tabindex", "-1");
    expect(workspace).toHaveAttribute("tabindex", "-1");
  });

  it("falls back to the first tab when no visible tab is selected", () => {
    renderHeader("agent");
    expect(screen.getByRole("tab", { name: "Diff" })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("moves focus with ArrowLeft/ArrowRight/Home/End without activating", () => {
    const { onTabClick } = renderHeader();
    const diff = screen.getByRole("tab", { name: "Diff" });
    const terminal = screen.getByRole("tab", { name: "Terminal" });
    const workspace = screen.getByRole("tab", { name: "Workspace" });

    terminal.focus();
    fireEvent.keyDown(terminal, { key: "ArrowRight" });
    expect(workspace).toHaveFocus();
    fireEvent.keyDown(workspace, { key: "ArrowRight" });
    expect(diff).toHaveFocus();
    fireEvent.keyDown(diff, { key: "ArrowLeft" });
    expect(workspace).toHaveFocus();
    fireEvent.keyDown(workspace, { key: "Home" });
    expect(diff).toHaveFocus();
    fireEvent.keyDown(diff, { key: "End" });
    expect(workspace).toHaveFocus();
    expect(onTabClick).not.toHaveBeenCalled();
  });

  it("closes a tab with Delete and keeps focus in the list", () => {
    const { onTabClose } = renderHeader();
    const terminal = screen.getByRole("tab", { name: "Terminal" });
    terminal.focus();
    fireEvent.keyDown(terminal, { key: "Delete" });
    expect(onTabClose).toHaveBeenCalledWith("terminal");
    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveFocus();

    const workspace = screen.getByRole("tab", { name: "Workspace" });
    fireEvent.keyDown(workspace, { key: "Delete" });
    expect(onTabClose).toHaveBeenCalledTimes(1);
  });

  it("keeps close buttons out of the tab sequence with a 24px target", () => {
    const { onTabClose } = renderHeader();
    const close = screen.getByRole("button", { name: "Close tab: Diff" });
    expect(close).toHaveAttribute("tabindex", "-1");
    expect(close).toHaveClass("size-6");
    expect(
      screen.queryByRole("button", { name: "Close tab: Workspace" }),
    ).not.toBeInTheDocument();
    fireEvent.click(close);
    expect(onTabClose).toHaveBeenCalledWith("diff");
  });
});
