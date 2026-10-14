import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";
import { useGitSummary } from "@/core/workspace/use-git-summary";
import { WorkspaceContextMenu } from "./workspace-context-menu";
import type { SessionContextStatus } from "./session-status-sections";

const artifactsState = vi.hoisted(() => ({ artifacts: [] as string[] }));

vi.mock("./artifacts/context", () => ({
  useOptionalArtifacts: () => artifactsState,
}));

vi.mock("@/core/workspace/use-git-summary", () => ({
  useGitSummary: vi.fn(() => ({
    summary: { branch: "codex/source-menu", changedFiles: 2, added: 24, removed: 6, untrackedFiles: 0 },
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  })),
}));

function setup(workDir: string | null = "D:/echo-ai") {
  const callbacks = { onOpenDiff: vi.fn(), onOpenFile: vi.fn() };
  renderWithProviders(<>
    <button>Outside</button>
    <WorkspaceContextMenu workDir={workDir} events={[]} {...callbacks}
      userInput={{ uploadedFiles: [1, 2, 3, 4].map(n => ({ filename: `reference-${n}.png`, path: `/uploads/${n}.png` })), attachments: [{ filename: "reference-1.png" }] }}
      groundingSources={[{kind: "doc", title: "Private profile", path: "agents/private/AGENTS.md"}]} />
  </>, { locale: "en-US" });
  return { user: userEvent.setup(), trigger: screen.getByRole("button", { name: "Environment and sources" }), ...callbacks };
}

describe("WorkspaceContextMenu", () => {
  it("starts closed, closes outside and on Escape, and restores trigger focus", async () => {
    localStorage.setItem("echo.workspace-note.expanded", "1");
    const { user, trigger } = setup();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(useGitSummary).toHaveBeenLastCalledWith("D:/echo-ai", { enabled: false });
    await user.click(trigger);
    expect(screen.getByRole("menu")).toHaveAttribute("data-side", "bottom");
    expect(useGitSummary).toHaveBeenLastCalledWith("D:/echo-ai", { enabled: true });
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(trigger);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    localStorage.removeItem("echo.workspace-note.expanded");
  });

  it("shows all deduplicated sources immediately and after reopening", async () => {
    const { user, trigger, onOpenFile } = setup();
    await user.click(trigger);
    expect(screen.getAllByText("reference-1.png")).toHaveLength(1);
    expect(screen.getByText("reference-4.png")).toBeInTheDocument();
    expect(screen.queryByText("Private profile")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /View all/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "reference-4.png" }));
    expect(onOpenFile).toHaveBeenCalledWith("/uploads/4.png");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByText("reference-4.png")).toBeInTheDocument();
  });

  it("opens the existing diff view and omits unsupported actions and process status", async () => {
    const { user, trigger, onOpenDiff } = setup();
    await user.click(trigger);
    expect(screen.getByText("codex/source-menu")).toBeInTheDocument();
    expect(screen.getByText("+24")).toBeInTheDocument();
    expect(screen.queryByText(/Pull Request/)).not.toBeInTheDocument();
    expect(screen.queryByText("Process")).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Changes/ }));
    expect(onOpenDiff).toHaveBeenCalledOnce();
  });

  it("keeps sources accessible without a code workspace", async () => {
    const { user, trigger } = setup(null);
    await user.click(trigger);
    expect(screen.getByText("Sources")).toBeInTheDocument();
    expect(screen.queryByText("codex/source-menu")).not.toBeInTheDocument();
    expect(screen.queryByText("+24")).not.toBeInTheDocument();
  });
});


it("opens an observed file directly without reopening the retired overview", async () => {
  const onOpenFile = vi.fn();
  renderWithProviders(<WorkspaceContextMenu events={[{
    id: "read", name: "read_file", status: "done", startedAt: 1, iteration: 0,
    input: {path: "docs/research.md"}, output: "Research notes",
  }]} onOpenDiff={vi.fn()} onOpenFile={onOpenFile} />, {locale: "en-US"});
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", {name: "Environment and sources"}));
  await user.click(screen.getByRole("menuitem", {name: "research.md"}));
  expect(onOpenFile).toHaveBeenCalledWith("docs/research.md");
});

describe("WorkspaceContextMenu status sections", () => {
  function setupStatus(context: Partial<SessionContextStatus> = {}) {
    const onOpenFile = vi.fn();
    const onCompressContext = vi.fn();
    renderWithProviders(
      <WorkspaceContextMenu
        workDir={null}
        events={[]}
        onOpenDiff={vi.fn()}
        onOpenFile={onOpenFile}
        environment={{
          workLocation: { kind: "local" },
          folder: "E:/projects/demo-app",
          engine: "opencode",
          modelLabel: "GPT-5.5",
        }}
        context={{
          contextTokens: 20_000,
          maxContextTokens: 100_000,
          contextSegments: [
            { label: "Messages", tokens: 12_000, color: "bg-primary" },
            { label: "System prompt", tokens: 8_000, color: "bg-warning" },
          ],
          isCompressingContext: false,
          onCompressContext,
          modelLabel: "GPT-5.5",
          ...context,
        }}
      />,
      { locale: "en-US" },
    );
    return {
      user: userEvent.setup(),
      trigger: screen.getByRole("button", { name: "Session status" }),
      onOpenFile,
      onCompressContext,
    };
  }

  it("shows the environment, the context breakdown and compresses in place", async () => {
    const { user, trigger, onCompressContext } = setupStatus();
    await user.click(trigger);
    const menu = screen.getByRole("menu");
    for (const text of [
      "Environment",
      "Local",
      "E:/projects/demo-app",
      "OpenCode",
      "GPT-5.5",
    ]) {
      expect(menu).toHaveTextContent(text);
    }
    const context = screen.getByTestId("session-status-context");
    expect(menu).toHaveTextContent("Context20K / 100K (20%)");
    expect(context).toHaveTextContent("System prompt");
    expect(context).toHaveTextContent("Free space");
    expect(context).not.toHaveTextContent("auto-compact");
    await user.click(screen.getByTestId("session-status-compress"));
    expect(onCompressContext).toHaveBeenCalledOnce();
    // Compressing keeps the menu open so its progress stays visible.
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("warns near auto-compaction and counts compression seconds", () => {
    vi.useFakeTimers();
    try {
      setupStatus({
        contextTokens: 80_000,
        contextSegments: [],
        isCompressingContext: true,
      });
      const trigger = screen.getByRole("button", { name: "Session status" });
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
      fireEvent.click(trigger);
      const context = screen.getByTestId("session-status-context");
      expect(context).toHaveTextContent(
        "older turns auto-compact at about 90%",
      );
      const button = screen.getByTestId("session-status-compress");
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent("Compressing… 0s");
      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(button).toHaveTextContent("Compressing… 3s");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists produced files and opens the one chosen", async () => {
    artifactsState.artifacts = [
      "/mnt/user-data/outputs/report.md",
      "/mnt/user-data/outputs/chart.png",
    ];
    try {
      const { user, trigger, onOpenFile } = setupStatus();
      await user.click(trigger);
      expect(screen.getByText("Outputs")).toBeInTheDocument();
      await user.click(screen.getByRole("menuitem", { name: "chart.png" }));
      expect(onOpenFile).toHaveBeenCalledWith(
        "/mnt/user-data/outputs/chart.png",
      );
    } finally {
      artifactsState.artifacts = [];
    }
  });

  it("says so when nothing has been produced", async () => {
    const { user, trigger } = setupStatus();
    await user.click(trigger);
    expect(screen.getByRole("menu")).toHaveTextContent(
      "No files produced in this conversation yet.",
    );
  });
});
