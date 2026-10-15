import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import type { LiveToolEvent } from "./live-tool-timeline";
import type { SessionContextStatus } from "./session-status-sections";
import { WorkspaceContextMenu } from "./workspace-context-menu";

const tasks = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
}));

vi.mock("@/core/tasks/hooks", () => ({
  useTasks: () => ({ data: tasks.data }),
}));
vi.mock("./artifacts/context", () => ({
  useOptionalArtifacts: () => ({ artifacts: [] }),
}));

function setup({
  context = {},
  events = [],
}: {
  context?: Partial<SessionContextStatus>;
  events?: LiveToolEvent[];
} = {}) {
  renderWithProviders(
    <WorkspaceContextMenu
      workDir={null}
      events={events}
      onOpenDiff={vi.fn()}
      onOpenFile={vi.fn()}
      threadId="thread-1"
      environment={{
        workLocation: { kind: "local" },
        folder: "",
        engine: "codex",
        modelLabel: "gpt-6.1-sol",
      }}
      context={{
        contextTokens: 20_000,
        maxContextTokens: 100_000,
        contextSegments: [],
        isCompressingContext: false,
        onCompressContext: vi.fn(),
        modelLabel: "gpt-6.1-sol",
        turnCount: 20,
        measured: true,
        ...context,
      }}
    />,
    { locale: "en-US" },
  );
  return screen.getByRole("button", { name: "Session status" });
}

describe("WorkspaceContextMenu status extras", () => {
  it("says how much room is left before auto-compaction", async () => {
    await userEvent.setup().click(setup());
    // 90% of 100K is the trigger; 20K are used.
    expect(screen.getByTestId("session-status-auto-compact")).toHaveTextContent(
      "Auto-compacts in about 70K",
    );
  });

  it("warns once the trigger is reached", async () => {
    await userEvent
      .setup()
      .click(setup({ context: { contextTokens: 95_000 } }));
    const line = screen.getByTestId("session-status-auto-compact");
    expect(line).toHaveTextContent("auto-compact");
    expect(line.className).toContain("text-warning");
  });

  it("lists paused tasks and running sub-agents of this conversation only", async () => {
    tasks.data = {
      paused: [
        {
          task_id: "p1",
          thread_id: "thread-1",
          note: "Refactor the parser",
          reason: "user_request",
        },
        {
          task_id: "p2",
          thread_id: "other",
          note: "Not ours",
          reason: "user_request",
        },
      ],
    };
    const events: LiveToolEvent[] = [
      {
        id: "e1",
        name: "web_search",
        status: "running",
        startedAt: 1,
        iteration: 1,
        subagentCodename: "Spark-3a4",
        agentName: "Researcher",
      },
    ];
    try {
      await userEvent.setup().click(setup({ events }));
      const list = screen.getByTestId("session-background-tasks");
      expect(list).toHaveTextContent("Refactor the parser");
      expect(list).toHaveTextContent("Researcher");
      expect(list).not.toHaveTextContent("Not ours");
    } finally {
      tasks.data = {};
    }
  });

  it("hides the section when nothing runs in the background", async () => {
    await userEvent.setup().click(setup());
    expect(screen.queryByTestId("session-background-tasks")).toBeNull();
  });
});
