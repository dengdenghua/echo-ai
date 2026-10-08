import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { SharedSpacesDialog } from "./shared-spaces-dialog";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  all: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  sync: vi.fn(),
}));
vi.mock("@/core/workspace/api", () => ({ listWorkspaces: api.all }));
vi.mock("@/core/workspace/shared-spaces", () => ({
  listSharedSpaces: api.list,
  attachSharedSpace: api.attach,
  detachSharedSpace: api.detach,
  syncSharedSpace: api.sync,
}));
vi.mock("./mount-point-dialog", () => ({ MountPointDialog: () => null }));

beforeEach(() => {
  vi.resetAllMocks();
  api.all.mockResolvedValue([{ id: "team", name: "Team" }]);
  api.list.mockResolvedValue({
    spaces: [{ id: "team", name: "Team", path: "/mnt/team", ready: true }],
  });
});

it("previews before applying, sends the exact preview token and shows conflicts", async () => {
  const plan = {
    token: "snapshot",
    applied: false,
    actions: [{ path: "report.txt", direction: "push" }],
    conflicts: ["drawing.step"],
    skipped: [".env"],
  };
  api.sync
    .mockResolvedValueOnce(plan)
    .mockResolvedValueOnce({ ...plan, applied: true });
  renderWithProviders(
    <SharedSpacesDialog threadId="task" open onOpenChange={vi.fn()} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Preview sync" }));
  expect(
    await screen.findByText(/Conflict, preserved: drawing.step/),
  ).toBeVisible();
  expect(api.sync).toHaveBeenCalledTimes(1);
  expect(api.sync).toHaveBeenCalledWith("task", "team");
  fireEvent.click(
    screen.getByRole("button", { name: "Sync non-conflicting files" }),
  );
  await waitFor(() =>
    expect(api.sync).toHaveBeenCalledWith("task", "team", "snapshot"),
  );
  expect(await screen.findByText("Sync completed")).toBeVisible();
});

it("attaches a directory without starting synchronization", async () => {
  api.list.mockResolvedValue({ spaces: [] });
  renderWithProviders(
    <SharedSpacesDialog threadId="task" open onOpenChange={vi.fn()} />,
  );
  await screen.findByRole("option", { name: "Team" });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "team" } });
  await waitFor(() => expect(api.attach).toHaveBeenCalledWith("task", "team"));
  expect(api.sync).not.toHaveBeenCalled();
});

it("shows stale-preview failure and requires another preview", async () => {
  api.sync
    .mockResolvedValueOnce({
      token: "old",
      applied: false,
      actions: [],
      conflicts: [],
      skipped: [],
    })
    .mockRejectedValueOnce(new Error("Files changed since preview"));
  renderWithProviders(
    <SharedSpacesDialog threadId="task" open onOpenChange={vi.fn()} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Preview sync" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Sync non-conflicting files" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Files changed since preview",
  );
  expect(
    screen.queryByRole("button", { name: "Sync non-conflicting files" }),
  ).not.toBeInTheDocument();
});
