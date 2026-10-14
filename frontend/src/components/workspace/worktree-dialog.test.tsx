import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { worktreeCopy } from "@/core/i18n/locales/worktrees";
import {
  createGitWorktree,
  listGitWorktrees,
} from "@/core/workspace/worktrees";
import { WorktreeDialog } from "./worktree-dialog";

const host = vi.hoisted(() => ({ url: "http://host-a" }));
vi.mock("@/core/config", () => ({ getBackendBaseURL: () => host.url }));
vi.mock("@/core/workspace/worktrees", () => ({
  listGitWorktrees: vi.fn(),
  createGitWorktree: vi.fn(),
}));
const listing = {
  root: "/repo",
  branches: ["main", "release"],
  worktrees: [
    {
      path: "/repo",
      branch: "main",
      commit: "1234567890",
      current: true,
      locked: false,
    },
    {
      path: "/separate",
      branch: "task",
      commit: "1234567890",
      current: false,
      locked: false,
    },
  ],
};
const created = {
  path: "/new-task",
  branch: "echo/task-new",
  commit: "1234567890",
  source: "/repo",
};
const listMock = vi.mocked(listGitWorktrees);
const createMock = vi.mocked(createGitWorktree);

beforeEach(() => {
  vi.clearAllMocks();
  host.url = "http://host-a";
  listMock.mockResolvedValue(listing);
  createMock.mockResolvedValue(created);
});

function setup(open = true) {
  const onOpenTask = vi.fn();
  const onOpenChange = vi.fn();
  const props = { open, onOpenChange, projectPath: "/repo", onOpenTask };
  const rendered = renderWithProviders(<WorktreeDialog {...props} />);
  return { ...rendered, props, onOpenTask, user: userEvent.setup() };
}

describe("worktree task entry", () => {
  it("does not inspect a repository while closed", () => {
    setup(false);
    expect(listMock).not.toHaveBeenCalled();
  });
  it("creates from the selected committed branch on the captured host", async () => {
    const { user, onOpenTask } = setup();
    await user.selectOptions(
      await screen.findByLabelText("Starting branch"),
      "release",
    );
    await user.click(
      screen.getByRole("button", { name: "Create and open task" }),
    );
    await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith("/new-task"));
    expect(createMock).toHaveBeenCalledExactlyOnceWith(
      "/repo",
      "release",
      "http://host-a",
    );
  });
  it("reuses an existing checkout without creating another", async () => {
    const { user, onOpenTask } = setup();
    await user.click(
      (await screen.findAllByRole("button", { name: "Open new task" }))[1]!,
    );
    expect(onOpenTask).toHaveBeenCalledWith("/separate");
    expect(createMock).not.toHaveBeenCalled();
  });
  it("does not retry an uncertain creation or auto-navigate after a host change", async () => {
    let resolve: (value: typeof created) => void = () => {};
    createMock.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { user, props, rerender, onOpenTask } = setup();
    await user.click(
      await screen.findByRole("button", { name: "Create and open task" }),
    );
    host.url = "http://host-b";
    rerender(<WorktreeDialog {...props} />);
    await act(async () => {
      resolve(created);
    });
    expect(onOpenTask).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1);
  });
  it("ignores a creation result after dismissing and reopening the dialog", async () => {
    let resolve: (value: typeof created) => void = () => {};
    createMock.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { user, props, rerender, onOpenTask } = setup();
    await user.click(
      await screen.findByRole("button", { name: "Create and open task" }),
    );
    rerender(<WorktreeDialog {...props} open={false} />);
    rerender(<WorktreeDialog {...props} open />);
    await act(async () => {
      resolve(created);
    });
    expect(onOpenTask).not.toHaveBeenCalled();
  });
  it("requires refreshing after a creation error", async () => {
    createMock.mockRejectedValue(new Error("response lost"));
    const { user } = setup();
    await user.click(
      await screen.findByRole("button", { name: "Create and open task" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Refresh before attempting another creation",
    );
    expect(
      screen.getByRole("button", { name: "Create and open task" }),
    ).toBeDisabled();
    expect(createMock).toHaveBeenCalledTimes(1);
  });
  it.each(["ja-JP", "ko-KR"] as const)(
    "offers translated task controls in %s",
    async (locale) => {
      renderWithProviders(
        <WorktreeDialog
          open
          onOpenChange={vi.fn()}
          projectPath="/repo"
          onOpenTask={vi.fn()}
        />,
        { locale },
      );
      expect(
        await screen.findByRole("button", {
          name: worktreeCopy(locale).create,
        }),
      ).toBeInTheDocument();
    },
  );
});
