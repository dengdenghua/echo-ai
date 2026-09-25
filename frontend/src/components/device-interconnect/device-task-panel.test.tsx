import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeviceTaskPanel, DeviceTaskSection } from "./device-task-panel";
import { taskWorkspaceRequest, type DeviceTask } from "./task-workspace-api";

vi.mock("./device-directory", () => ({
  useDeviceDirectory: () => ({
    status: {
      devices: [
        { id: "pc", model: "我的电脑", platform: "windows", online: true },
      ],
    },
  }),
}));
vi.mock("./task-workspace-api", () => ({ taskWorkspaceRequest: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const task: DeviceTask = {
  id: "from-phone",
  task: "整理文件",
  device_id: "pc",
  source_device: "phone",
  status: "awaiting_approval",
  current_step: 0,
  in_flight_step: null,
  steps: [
    {
      action: "desktop.write",
      arguments: { path: "notes.txt", content: "hello" },
    },
  ],
  results: [],
  revision: "displayed-plan",
  busy: false,
};

it("loads the phone task and approves only the displayed plan revision", async () => {
  vi.mocked(taskWorkspaceRequest).mockResolvedValue({ tasks: [task] });
  render(<DeviceTaskPanel />);
  fireEvent.click(await screen.findByText("确认计划并执行"));
  await waitFor(() =>
    expect(taskWorkspaceRequest).toHaveBeenCalledWith(
      "approve",
      { id: "from-phone", revision: "displayed-plan" },
      expect.any(AbortSignal),
    ),
  );
  expect(screen.getByText("phone → pc")).toBeInTheDocument();
  expect(screen.getByText(/notes.txt/)).toBeInTheDocument();
});

it("requires explicit outcome review for an interrupted action", async () => {
  vi.mocked(taskWorkspaceRequest).mockResolvedValue({
    tasks: [{ ...task, status: "paused", in_flight_step: 0 }],
  });
  render(<DeviceTaskPanel />);
  expect(await screen.findByText(/结果不明/)).toBeInTheDocument();
  expect(screen.queryByText("继续任务")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("已核对完成，继续"));
  await waitFor(() =>
    expect(taskWorkspaceRequest).toHaveBeenCalledWith(
      "resume",
      { id: "from-phone", revision: "displayed-plan", resolution: "completed" },
      expect.any(AbortSignal),
    ),
  );
});

it("reuses the submission id if the network loses its response", async () => {
  vi.mocked(taskWorkspaceRequest).mockImplementation(async (command) => {
    if (command === "submit") throw new Error("网络断开");
    return { tasks: [] };
  });
  render(<DeviceTaskPanel />);
  fireEvent.change(screen.getByLabelText("执行设备"), {
    target: { value: "pc" },
  });
  fireEvent.change(screen.getByLabelText("任务内容"), {
    target: { value: "整理文件" },
  });
  fireEvent.click(screen.getByText("生成执行计划"));
  await screen.findByText("网络断开");
  fireEvent.click(screen.getByText("生成执行计划"));
  await waitFor(() =>
    expect(
      vi
        .mocked(taskWorkspaceRequest)
        .mock.calls.filter((c) => c[0] === "submit"),
    ).toHaveLength(2),
  );
  const calls = vi
    .mocked(taskWorkspaceRequest)
    .mock.calls.filter((c) => c[0] === "submit");
  expect(calls[0]?.[1]?.id).toBe(calls[1]?.[1]?.id);
});

it("does not poll hidden task sections", () => {
  render(<DeviceTaskSection />);
  expect(taskWorkspaceRequest).not.toHaveBeenCalled();
});
