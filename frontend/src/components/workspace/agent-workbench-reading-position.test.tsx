import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";
import { AgentWorkbenchPanel } from "./agent-workbench-panel";
import type { LiveToolEvent } from "./live-tool-timeline";

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

afterEach(() => vi.restoreAllMocks());

test("restores member reading state after changing tabs without sharing it across conversations or tasks", async () => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  const spawn: LiveToolEvent = {
    id: "spawn-reader",
    name: "subagent",
    lifecycle: "spawned",
    status: "running",
    agentId: "reader",
    subAgentRole: "coder",
    subagentCodename: "Spark-abc",
    startedAt: 1000,
    iteration: 0,
    input: { prompt: "Read the project and summarize it" },
  };
  function panel(
    tab: "agent" | "terminal",
    threadId = "reading-thread-a",
    startedAt = 1000,
  ) {
    return (
      <AgentWorkbenchPanel
        activeTab={tab}
        threadId={threadId}
        events={[{ ...spawn, startedAt }]}
        focusedAgentId="reader"
        focusedAgentNonce={1}
        isLoading
        showMachineScopeRail={false}
      />
    );
  }
  const view = renderWithProviders(panel("agent"), { locale: "zh-CN" });
  const scroll = await screen.findByTestId("member-process-scroll");
  scroll.scrollTop = 230;
  fireEvent.scroll(scroll);
  const brief = screen.getByText("任务说明").closest("details");
  if (!brief) throw new Error("Missing task brief");
  fireEvent.click(screen.getByText("任务说明"));
  await waitFor(() =>
    expect(within(brief).getByText("Read the project and summarize it")).toBeVisible(),
  );

  view.rerender(panel("terminal"));
  expect(screen.queryByTestId("member-process-scroll")).not.toBeInTheDocument();
  expect(screen.getByTestId("mock-terminal-panel")).toBeInTheDocument();
  view.rerender(panel("agent"));
  expect(screen.getByTestId("member-process-scroll").scrollTop).toBe(230);
  expect(screen.getByText("任务说明").closest("details")).toHaveAttribute("open");

  view.rerender(panel("agent", "reading-thread-b"));
  expect(screen.getByTestId("member-process-scroll").scrollTop).toBe(1200);
  expect(screen.getByText("任务说明").closest("details")).not.toHaveAttribute("open");
  view.rerender(panel("agent"));
  expect(screen.getByTestId("member-process-scroll").scrollTop).toBe(230);
  view.rerender(panel("agent", "reading-thread-a", 2000));
  expect(screen.getByTestId("member-process-scroll").scrollTop).toBe(1200);
  expect(screen.getByText("任务说明").closest("details")).not.toHaveAttribute("open");
});
