import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { AgentWorkbenchPanel } from "./agent-workbench-panel";

vi.mock("@/components/workspace/terminal-panel", () => ({
  TerminalPanel: () => <div data-testid="mock-terminal-panel" />,
}));
vi.mock("./live-preview-panel", () => ({
  LivePreviewPanel: () => <div data-testid="mock-live-preview" />,
}));
vi.mock("./browser-preview-panel", () => ({
  BrowserPreviewPanel: () => <div data-testid="mock-browser-preview" />,
}));
vi.mock("@/components/ai-elements/streamdown-host", () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
  LocalizedStreamdown: ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  ),
}));

describe("<AgentWorkbenchPanel /> setup state", () => {
  test("a session that only lacks a model is neutral, not a failure", () => {
    renderWithProviders(
      <AgentWorkbenchPanel
        activeTab="agent"
        events={[]}
        runSettled
        runNeedsSetup
      />,
      { locale: "zh-CN" },
    );

    const main = screen.getByRole("button", { name: /待连接模型/ });
    expect(main.className).not.toMatch(/destructive|warning/);
    expect(
      screen.queryByRole("button", { name: /已完成|遇到问题/ }),
    ).not.toBeInTheDocument();
  });
});
