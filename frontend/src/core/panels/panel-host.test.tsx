import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/harness";
import { ensureDefaultPanels } from "./default-panels";
import { PanelHost } from "./panel-host";
import { registerPanel, resetPanelsForTests } from "./panel-manifest";

// The reference panel renders a react-router `<Link>`, so these cases need a
// Router in the tree — a bare `render` throws on a null router context.
describe("PanelHost", () => {
  beforeEach(() => {
    resetPanelsForTests();
    ensureDefaultPanels();
  });

  it("renders nothing for an empty zone", () => {
    renderWithProviders(<PanelHost zone="settings" />);
    expect(screen.queryByTestId("panel-host-settings")).toBeNull();
  });

  it("renders the registered panels of a zone with context", () => {
    renderWithProviders(
      <PanelHost zone="workspace" context={{ threadId: "t-9" }} />,
    );
    expect(screen.getByTestId("panel-workbench.system-status")).toBeTruthy();
    expect(screen.getByText("thread: t-9")).toBeTruthy();
  });

  it("only renders panels of the requested zone", () => {
    registerPanel({
      id: "workspace.extra",
      title: "Extra",
      zone: "workspace",
      component: () => <div>extra</div>,
    });
    renderWithProviders(<PanelHost zone="workbench" />);
    expect(screen.queryByText("extra")).toBeNull();
  });

  it("uses a custom header renderer when provided", () => {
    renderWithProviders(
      <PanelHost
        zone="workspace"
        renderHeader={(title) => <div data-testid="custom-header">{title}</div>}
      />,
    );
    // The reference panel ships a localized title ("运行诊断"), not "System Status".
    expect(screen.getByTestId("custom-header")).toHaveTextContent("运行诊断");
  });
});
