import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { WorkDirSelector } from "./workdir-selector";

const remote = vi.hoisted(() => ({ list: vi.fn(), directory: vi.fn() }));
vi.mock("@/core/workspace/api", () => ({
  listWorkspaces: remote.list,
  getWorkspaceExecutionDirectory: remote.directory,
}));
vi.mock("@/hooks/use-feature-flags", () => ({
  useFeatureFlags: () => ({ loading: false, isOn: () => true }),
}));
vi.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({
    authStatus: { enabled: false },
    isAuthenticated: false,
    isLoading: false,
  }),
}));

beforeEach(() => {
  remote.list.mockClear();
  remote.list.mockResolvedValue([
    {
      id: "shared",
      name: "Team project",
      mount_type: "webdav",
      mount_target: "https://files.example/team",
    },
  ]);
  remote.directory.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function pick() {
  fireEvent.click(screen.getByTitle(/C:\/old$/));
  fireEvent.mouseDown(
    await screen.findByRole("tab", { name: "Remote mount" }),
    { button: 0, ctrlKey: false },
  );
  fireEvent.click(await screen.findByRole("button", { name: /Team project/ }));
}

it("binds the executing device's verified directory instead of the storage URL", async () => {
  remote.directory.mockResolvedValue("/mnt/team/project");
  const change = vi.fn();
  renderWithProviders(
    <WorkDirSelector workDir="C:/old" onWorkDirChange={change} />,
  );
  await pick();
  await waitFor(() => expect(change).toHaveBeenCalledWith("/mnt/team/project"));
});

it("keeps the current directory when the shared mount is unavailable", async () => {
  remote.directory.mockRejectedValue(new Error("mount offline"));
  const change = vi.fn();
  renderWithProviders(
    <WorkDirSelector workDir="C:/old" onWorkDirChange={change} />,
  );
  await pick();
  expect(await screen.findByText(/mount offline/)).toBeVisible();
  expect(change).not.toHaveBeenCalled();
});

it("opens a new task for a locked existing conversation", async () => {
  remote.directory.mockResolvedValue("/mnt/team/project");
  const change = vi.fn();
  const open = vi.fn();
  renderWithProviders(
    <WorkDirSelector
      workDir="C:/old"
      onWorkDirChange={change}
      lockToCurrentThread
      onOpenWorkDirInNewTask={open}
    />,
  );
  await pick();
  await waitFor(() => expect(open).toHaveBeenCalledWith("/mnt/team/project"));
  expect(change).not.toHaveBeenCalled();
});

it("offers mount registration and attachment from an existing task", async () => {
  renderWithProviders(<WorkDirSelector threadId="task" workDir="C:/old" />);
  fireEvent.click(screen.getByTitle(/C:\/old$/));
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "Remote mount" }), { button: 0, ctrlKey: false });
  expect(await screen.findByRole("button", { name: "Attach shared space / sync" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Connect shared directory" }));
  expect(await screen.findByRole("dialog")).toBeVisible();
});

it("does not continuously reload an empty shared directory list", async () => {
  remote.list.mockResolvedValue([]);
  renderWithProviders(<WorkDirSelector workDir="C:/old" />);
  fireEvent.click(screen.getByTitle(/C:\/old$/));
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "Remote mount" }), { button: 0, ctrlKey: false });
  await screen.findByRole("button", { name: "Connect shared directory" });
  expect(remote.list).toHaveBeenCalledTimes(1);
});
