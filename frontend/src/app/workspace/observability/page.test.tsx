import { screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import ObservabilityPage from "./page";

vi.mock("@/components/workspace/workspace-container", () => ({
  WorkspaceContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  WorkspaceBody: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/core/streaming/sse", () => ({
  openSseStream: () => () => undefined,
}));
vi.mock("@/components/workspace/agent-operator-panel", () => ({
  AgentOperatorPanel: () => <div>Operator panel</div>,
}));
vi.mock("../diagnostics/page", () => ({
  DiagnosticsContent: () => <div>Diagnostics</div>,
}));

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({}), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("uses the tabs as the only navigation and drops refactor notes", async () => {
  renderWithProviders(<ObservabilityPage />, {
    locale: "zh-CN",
    initialRoute: "/workspace/observability",
  });

  expect(
    screen.getByText("查看任务运行情况、协作事件、资源消耗和系统状态。"),
  ).toBeInTheDocument();
  const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
  expect(tabs).toEqual(["总览", "事件流", "资源与成本", "系统"]);

  // The old intro cards duplicated the tabs; none of their copy remains.
  for (const removed of ["实时事件", "系统状态", "运行复盘"]) {
    expect(screen.queryByText(removed)).not.toBeInTheDocument();
  }
  expect(screen.queryByText(/不再把它们拆成/)).not.toBeInTheDocument();
  expect(screen.queryByText(/sub_tool_start/)).not.toBeInTheDocument();
  expect(screen.queryByText(/运行时自省面板/)).not.toBeInTheDocument();
});

it("renders the run review summary and empty state inside one card", async () => {
  renderWithProviders(<ObservabilityPage />, {
    locale: "zh-CN",
    initialRoute: "/workspace/observability?tab=events",
  });

  const panel = await screen.findByTestId("run-review-panel");
  expect(within(panel).getByText("运行复盘雷达")).toBeInTheDocument();
  expect(within(panel).getByText("运行数")).toBeInTheDocument();
  expect(within(panel).getByText("暂无运行事件")).toBeInTheDocument();
  // No card nested inside the section's card.
  expect(panel.querySelector('[data-slot="card"]')).toBeNull();
});

it("opens the overview tab without a duplicate intro or second start-task button", async () => {
  renderWithProviders(<ObservabilityPage />, {
    locale: "zh-CN",
    initialRoute: "/workspace/observability?tab=overview",
  });

  expect(await screen.findByText("Operator panel")).toBeInTheDocument();
  expect(screen.queryByText("先从总览开始")).not.toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /任务/ })).toHaveLength(1);
});
