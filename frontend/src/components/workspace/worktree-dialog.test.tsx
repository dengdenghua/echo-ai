import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { WorktreeDialog } from "./worktree-dialog";

const list = {
  root: "/project",
  branches: ["main", "feature"],
  worktrees: [
    {
      path: "/project",
      branch: "main",
      commit: "a".repeat(40),
      current: true,
      locked: false,
    },
    {
      path: "/isolated/existing",
      branch: "echo/task-old",
      commit: "a".repeat(40),
      current: false,
      locked: false,
    },
  ],
};

describe("worktree tasks", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(list)));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("creates from the selected branch and opens the returned directory once", async () => {
    const onOpenTask = vi.fn();
    const onOpenChange = vi.fn();
    renderWithProviders(
      <WorktreeDialog
        open
        onOpenChange={onOpenChange}
        projectPath="/project"
        onOpenTask={onOpenTask}
      />,
    );
    fireEvent.change(
      await screen.findByRole("combobox", { name: "Starting branch" }),
      { target: { value: "feature" } },
    );
    vi.mocked(fetch).mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? Response.json({
            path: "/isolated/new",
            branch: "echo/task-new",
            commit: "a".repeat(40),
          })
        : Response.json(list),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create and open task" }),
    );
    await waitFor(() =>
      expect(onOpenTask).toHaveBeenCalledWith("/isolated/new"),
    );
    expect(onOpenTask).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    const post = vi
      .mocked(fetch)
      .mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post![1]!.body as string)).toEqual({
      path: "/project",
      revision: "feature",
    });
  });

  it("reuses an existing checkout without creating another one", async () => {
    const onOpenTask = vi.fn();
    renderWithProviders(
      <WorktreeDialog
        open
        onOpenChange={vi.fn()}
        projectPath="/project"
        onOpenTask={onOpenTask}
      />,
    );
    const buttons = await screen.findAllByRole("button", {
      name: "New task",
      exact: true,
    });
    fireEvent.click(buttons[1]!);
    expect(onOpenTask).toHaveBeenCalledWith("/isolated/existing");
    expect(
      vi.mocked(fetch).mock.calls.every(([, init]) => init?.method !== "POST"),
    ).toBe(true);
  });

  it("shows a repository error and lets the user retry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ detail: "Not a Git repository" }, { status: 400 }),
    );
    renderWithProviders(
      <WorktreeDialog
        open
        onOpenChange={vi.fn()}
        projectPath="/project"
        onOpenTask={vi.fn()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Not a Git repository",
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("combobox")).toBeEnabled();
  });

  it("does not navigate after a creation finishes in a closed dialog", async () => {
    const onOpenTask = vi.fn();
    let finish!: (response: Response) => void;
    const view = renderWithProviders(
      <WorktreeDialog
        open
        onOpenChange={vi.fn()}
        projectPath="/project"
        onOpenTask={onOpenTask}
      />,
    );
    await screen.findByRole("combobox");
    vi.mocked(fetch).mockImplementation((_url, init) =>
      init?.method === "POST"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(Response.json(list)),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create and open task" }),
    );
    await waitFor(() => expect(finish).toBeDefined());
    view.rerender(
      <WorktreeDialog
        open={false}
        onOpenChange={vi.fn()}
        projectPath="/project"
        onOpenTask={onOpenTask}
      />,
    );
    await act(async () => {
      finish(
        Response.json({
          path: "/isolated/new",
          branch: "echo/task-new",
          commit: "a".repeat(40),
        }),
      );
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it("does not redirect an unmounted page when its creation completes", async () => {
    const onOpenTask = vi.fn();
    let finish!: (response: Response) => void;
    const view = renderWithProviders(
      <WorktreeDialog
        open
        onOpenChange={vi.fn()}
        projectPath="/project"
        onOpenTask={onOpenTask}
      />,
    );
    await screen.findByRole("combobox");
    vi.mocked(fetch).mockImplementation((_url, init) =>
      init?.method === "POST"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(Response.json(list)),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create and open task" }),
    );
    await waitFor(() => expect(finish).toBeDefined());
    view.unmount();
    await act(async () => {
      finish(
        Response.json({
          path: "/isolated/new",
          branch: "echo/task-new",
          commit: "a".repeat(40),
        }),
      );
    });
    expect(onOpenTask).not.toHaveBeenCalled();
  });
});
