import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { AgentWorkbenchPanel } from "../agent-workbench-panel";
import type { LiveToolEvent } from "../live-tool-timeline";
import { conversationLandingTab } from "./conversation-landing-tab";

const conversation = vi.hoisted(() => ({ artifacts: [] as string[] }));

vi.mock("@/components/workspace/artifacts/context", () => ({
  useOptionalArtifacts: () => ({ artifacts: conversation.artifacts }),
  useArtifacts: () => ({
    artifacts: conversation.artifacts,
    selectedArtifact: null,
    select: () => undefined,
  }),
}));

vi.mock("@/components/workspace/terminal-panel", () => ({
  TerminalPanel: () => <div data-testid="mock-terminal-panel" />,
}));

vi.mock("@/components/ai-elements/streamdown-host", () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
  LocalizedStreamdown: ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  ),
}));

afterEach(() => {
  conversation.artifacts = [];
});

const events: LiveToolEvent[] = [
  {
    id: "event-1",
    name: "web_search",
    status: "done",
    startedAt: 1000,
    iteration: 0,
    input: { query: "hello world in python" },
  },
];

describe("conversationLandingTab", () => {
  const base = {
    mergeProjectHome: false,
    isDevelopmentWorkbench: false,
    hasArtifacts: false,
    hasDiff: false,
    dismissed: new Set<never>(),
  };

  it("prefers produced files, then file changes, then the workbench home", () => {
    expect(
      conversationLandingTab({ ...base, hasArtifacts: true, hasDiff: true }),
    ).toBe("artifacts");
    expect(conversationLandingTab({ ...base, hasDiff: true })).toBe("diff");
    expect(conversationLandingTab(base)).toBe("workspace");
    expect(
      conversationLandingTab({ ...base, isDevelopmentWorkbench: true }),
    ).toBe("diff");
  });

  it("keeps a project's home and skips tabs the user closed", () => {
    expect(
      conversationLandingTab({
        ...base,
        mergeProjectHome: true,
        hasArtifacts: true,
      }),
    ).toBe("project");
    expect(
      conversationLandingTab({
        ...base,
        hasArtifacts: true,
        hasDiff: true,
        dismissed: new Set(["artifacts"] as const),
      }),
    ).toBe("diff");
  });
});

describe("chat workbench opened without a target", () => {
  it("lands on the artifacts tab when the conversation produced files", () => {
    conversation.artifacts = [
      "workspace-output:final:hello.py",
      "workspace-output:final:README.md",
    ];
    renderWithProviders(
      <AgentWorkbenchPanel
        hideMainOverview
        activeTab="agent"
        threadId="thread-1"
        events={events}
        hasAnswer
        runSettled
      />,
      { locale: "zh-CN" },
    );

    expect(screen.getByRole("tab", { name: "产物" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("hello.py")).toBeInTheDocument();
    expect(screen.queryByLabelText("工作台能力")).not.toBeInTheDocument();

    // Closing it falls back instead of reopening the same tab.
    fireEvent.click(screen.getByRole("button", { name: "关闭标签页：产物" }));
    expect(screen.queryByRole("tab", { name: "产物" })).not.toBeInTheDocument();
  });

  it("shows produced files even when no tool events were replayed", () => {
    conversation.artifacts = ["workspace-output:final:hello.py"];
    renderWithProviders(
      <AgentWorkbenchPanel
        hideMainOverview
        activeTab="agent"
        threadId="thread-1"
        events={[]}
      />,
      { locale: "zh-CN" },
    );
    expect(screen.getByText("hello.py")).toBeInTheDocument();
  });

  it("keeps an explicitly requested tab", () => {
    conversation.artifacts = ["workspace-output:final:hello.py"];
    renderWithProviders(
      <AgentWorkbenchPanel
        hideMainOverview
        activeTab="terminal"
        threadId="thread-1"
        events={events}
      />,
      { locale: "zh-CN" },
    );
    expect(screen.getByTestId("mock-terminal-panel")).toBeInTheDocument();
  });

  it("keeps the workbench home when nothing was produced", () => {
    renderWithProviders(
      <AgentWorkbenchPanel
        hideMainOverview
        activeTab="agent"
        threadId="thread-1"
        events={events}
        hasAnswer
        runSettled
      />,
      { locale: "zh-CN" },
    );
    expect(screen.getByLabelText("工作台能力")).toBeInTheDocument();
  });
});
