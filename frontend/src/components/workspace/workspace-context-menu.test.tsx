import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";
import { useGitSummary } from "@/core/workspace/use-git-summary";
import { WorkspaceContextMenu } from "./workspace-context-menu";

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
