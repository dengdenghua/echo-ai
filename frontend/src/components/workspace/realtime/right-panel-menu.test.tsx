import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

import { renderWithProviders } from "@/test/harness";

import { RightPanelMenu, type RightPanelPage } from "./right-panel-menu";

function renderMenu(activePage: RightPanelPage | null = null) {
  const actions = {
    onClosePanel: vi.fn(),
    onOpenAgent: vi.fn(),
    onOpenArtifacts: vi.fn(),
    onOpenPlan: vi.fn(),
    onOpenPreview: vi.fn(),
    onOpenResearch: vi.fn(),
    onOpenResearchHistory: vi.fn(),
  };

  renderWithProviders(
    <RightPanelMenu
      activePage={activePage}
      artifactCount={0}
      hasAgentWorkbench
      hasPlan={false}
      hasPreview={false}
      hasResearch={false}
      hasResearchHistory={false}
      {...actions}
    />,
    { locale: "zh-CN" },
  );

  return actions;
}

describe("RightPanelMenu header toggle", () => {
  beforeEach(() => sessionStorage.clear());
  it("exposes the inactive workbench toggle as unpressed and opens the default panel", async () => {
    const user = userEvent.setup();
    const actions = renderMenu();

    const toggle = screen.getByRole("button", { name: "打开右侧窗口" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("data-state", "closed");

    await user.click(toggle);
    expect(actions.onOpenAgent).toHaveBeenCalledTimes(1);
    expect(actions.onClosePanel).not.toHaveBeenCalled();
  });

  it("exposes an open workbench as pressed and closes the active panel", async () => {
    const user = userEvent.setup();
    const actions = renderMenu("agent");

    const toggle = screen.getByRole("button", { name: "关闭右侧窗口" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveAttribute("data-state", "open");

    await user.click(toggle);
    expect(actions.onClosePanel).toHaveBeenCalledTimes(1);
    expect(actions.onOpenAgent).not.toHaveBeenCalled();
  });

  function restorableProps(): ComponentProps<typeof RightPanelMenu> {
    return {
      threadId: "conversation-a", activePage: null, workbenchTab: "terminal",
      artifactCount: 3, hasAgentWorkbench: true, hasPlan: true,
      hasPreview: true, hasResearch: false, hasResearchHistory: false,
      onClosePanel: vi.fn(), onOpenAgent: vi.fn(), onOpenArtifacts: vi.fn(),
      onOpenPlan: vi.fn(), onOpenPreview: vi.fn(), onOpenResearch: vi.fn(),
      onOpenResearchHistory: vi.fn(), onRestoreWorkbench: vi.fn(),
    };
  }

  it("restores the terminal tab after closing instead of resetting to the agent", async () => {
    const props = restorableProps();
    const view = renderWithProviders(<RightPanelMenu {...props} activePage="agent" />);
    await userEvent.setup().click(screen.getByRole("button"));
    expect(props.onClosePanel).toHaveBeenCalledOnce();
    view.rerender(<RightPanelMenu {...props} activePage={null} />);
    await userEvent.setup().click(screen.getByRole("button"));
    expect(props.onRestoreWorkbench).toHaveBeenCalledWith("terminal");
    expect(props.onOpenAgent).not.toHaveBeenCalled();
  });

  it("remembers artifacts after remount, isolates conversations and falls back when unavailable", async () => {
    const props = restorableProps();
    const first = renderWithProviders(<RightPanelMenu {...props} activePage="artifacts" workbenchTab="artifacts" />);
    first.unmount();
    const next = renderWithProviders(<RightPanelMenu {...props} />);
    await userEvent.setup().click(screen.getByRole("button"));
    expect(props.onOpenArtifacts).toHaveBeenCalledOnce();
    next.rerender(<RightPanelMenu {...props} threadId="conversation-b" />);
    await userEvent.setup().click(screen.getByRole("button"));
    expect(props.onOpenAgent).toHaveBeenCalledOnce();
    next.rerender(<RightPanelMenu {...props} artifactCount={0} />);
    await userEvent.setup().click(screen.getByRole("button"));
    expect(props.onOpenAgent).toHaveBeenCalledTimes(2);
    expect(props.onOpenArtifacts).toHaveBeenCalledOnce();
  });

  it("falls back safely on corrupt storage", async () => {
    sessionStorage.setItem("echo:right-panel:v1", '[{"threadId":"conversation-a","page":"unknown","tab":"terminal"}]');
    const props = restorableProps();
    renderWithProviders(<RightPanelMenu {...props} />);
    await userEvent.setup().click(screen.getByRole("button"));
    expect(props.onOpenAgent).toHaveBeenCalledOnce();
  });
});
