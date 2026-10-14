import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import type { Workspace } from "@/core/workspace/api";
import { ExecutionNodesDialog } from "./execution-nodes-dialog";

const api = vi.hoisted(() => ({ request: vi.fn(), download: vi.fn() }));
vi.mock("@/core/workspace/execution-nodes", () => ({
  executionRequest: api.request,
  downloadNodeArtifact: api.download,
}));
const task = {
  run_id: "job",
  status: "queued",
  attempt: 0,
  input: {
    workspace_id: "team",
    goal: "Write report",
    node_ids: ["node"],
    input_snapshot: { sha256: "test", file_count: 3, skipped_count: 1 },
  },
  result: null,
};
const spaces = [{ id: "team", name: "Team" }] as Workspace[];

beforeEach(() => {
  vi.resetAllMocks();
  api.request.mockImplementation(async (path: string, body?: unknown) => {
    if (path === "/tasks" && body) return task;
    if (path === "/tasks") return { tasks: [] };
    if (path === "/invocations") return { invocations: [] };
    if (path.startsWith("/nodes?"))
      return {
        nodes: [
          { node_id: "node", label: "Device", roles: ["coder"], online: true },
        ],
      };
    return { ...task, status: "cancelled" };
  });
});

async function fillTask() {
  fireEvent.change(screen.getByRole("combobox", { name: "Shared project" }), {
    target: { value: "team" },
  });
  fireEvent.click(await screen.findByRole("checkbox", { name: /Device/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "Role" }), {
    target: { value: "coder" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Task instructions" }), {
    target: { value: "Write report" },
  });
}

it("saves a device task and closing the dialog does not cancel it", async () => {
  const view = renderWithProviders(
    <ExecutionNodesDialog open spaces={spaces} onOpenChange={vi.fn()} />,
  );
  await fillTask();
  fireEvent.click(
    screen.getByRole("button", { name: "Submit background task" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("Task saved");
  expect(screen.getByText(/Pinned 3 submitted files/)).toBeVisible();
  expect(api.request).toHaveBeenCalledWith(
    "/tasks",
    expect.objectContaining({
      workspace_id: "team",
      node_ids: ["node"],
      role: "coder",
      goal: "Write report",
    }),
  );
  view.unmount();
  expect(
    api.request.mock.calls.some(([path]) => path.endsWith("/actions")),
  ).toBe(false);
});

it("reuses the idempotency key when a submit response is lost", async () => {
  let first = true;
  const base = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (path: string, body?: unknown) => {
    if (path === "/tasks" && body && first) {
      first = false;
      throw new Error("Connection lost");
    }
    return base(path, body);
  });
  renderWithProviders(
    <ExecutionNodesDialog open spaces={spaces} onOpenChange={vi.fn()} />,
  );
  await fillTask();
  fireEvent.click(
    screen.getByRole("button", { name: "Submit background task" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  fireEvent.click(
    screen.getByRole("button", { name: "Submit background task" }),
  );
  await screen.findByRole("status");
  const submissions = api.request.mock.calls.filter(
    ([path, body]) => path === "/tasks" && body,
  );
  expect(submissions).toHaveLength(2);
  expect(submissions[0][1].request_id).toBe(submissions[1][1].request_id);
});

it("reports apply conflicts without presenting the delivery as applied", async () => {
  const base = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (path: string, body?: unknown) => {
    if (path === "/tasks" && !body)
      return {
        tasks: [
          {
            ...task,
            status: "completed",
            result: { output: "done", artifacts: [{ path: "report.txt" }] },
          },
        ],
      };
    if (path.endsWith("/actions"))
      throw new Error("workspace changed; preserve conflict");
    return base(path, body);
  });
  renderWithProviders(
    <ExecutionNodesDialog open spaces={spaces} onOpenChange={vi.fn()} />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Apply delivery to project" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("preserve conflict"),
  );
  expect(
    screen.queryByText("Delivery applied to the shared project."),
  ).not.toBeInTheDocument();
});
